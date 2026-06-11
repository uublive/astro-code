// astro-code · execute-phase workflow (Claude Code 4.8 Workflow tool)
//
// Execute a phase wave-by-wave: discover tasks + dependencies, integrate each wave
// onto the working branch (sequential on-branch, or parallel worktrees + an
// integrator agent for wide phases), then verify the phase goal against that branch.
// Invoked by the /astro-execute command via:
//   Workflow({ scriptPath: "<astro-code>/workflows/execute-phase.mjs",
//              args: { root, phase, models } })
//
// Args stay SMALL (scalars + a tiny models map) so they're always valid JSON; the
// spawned agents read canon/CONTEXT from disk. `phase` is a Workflow HOOK, so the
// slug is read as `phaseSlug`.
export const meta = {
  name: 'astro-execute-phase',
  description: 'Execute a phase wave-by-wave on the working branch (sequential, or parallel worktrees+integrator), then verify',
  phases: [
    { title: 'Discover', detail: 'parse plan tasks + dependencies into waves' },
    { title: 'Execute', detail: 'integrate each wave onto the branch (sequential or parallel+integrator)' },
    { title: 'Verify', detail: 'confirm the phase goal is met on the integrated branch' },
  ],
}

// Defensive: accept args as an object, or as a JSON string if the caller stringified it.
const input = typeof args === 'string' ? JSON.parse(args) : args || {}
const { root, phase: phaseSlug, models = {} } = input
if (!root || !phaseSlug) throw new Error('execute-phase requires args { root, phase }')

// Agents read the canon + discussion brief from disk (absolute paths into the main
// repo, so worktree executors see them regardless of git state).
const OBEY =
  `\n\nRead and OBEY: ${root}/.astrocode/CONVENTIONS.md and ${root}/.astrocode/DECISIONS.md (project canon), ` +
  `plus ${root}/.astrocode/phases/${phaseSlug}/CONTEXT.md (this phase's decisions, if present).`

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          file: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'depends_on'],
      },
    },
  },
  required: ['tasks'],
}

phase('Discover')
const disc = await agent(
  `Read every plan/task file under ${root}/.astrocode/phases/${phaseSlug}/ (PLAN.md and any NN-*.md). ` +
    `Return the full task list with explicit dependencies — depends_on lists the ids of tasks ` +
    `that must complete before this one. Use the ids exactly as written in the plan.`,
  { schema: TASK_SCHEMA, phase: 'Discover', model: models.discover },
)

// >>> MIRROR of lib/waves.mjs — keep in sync (Workflow sandbox can't import) >>>
/**
 * Return the set of files a task claims, for collision detection.
 *
 * Why the wildcard '*':  a task with no declared `file` can't be proven
 * disjoint from anything — we don't know what it touches.  Claiming '*'
 * forces it to run alone (safe over fast).  The planner SHOULD declare files;
 * this is the fallback when it doesn't.
 *
 * @param {{ file?: string }} task
 * @returns {Set<string>}
 */
function claimedFiles(task) {
  const raw = (task.file || '').trim()
  if (!raw) return new Set(['*'])
  return new Set(raw.split(/[\s,;]+/).filter(Boolean))
}

/**
 * Return true when two file-claim sets overlap and therefore must NOT share a
 * parallel wave.  The wildcard '*' collides with everything, including another
 * '*', because we never know what a no-file task writes.
 *
 * @param {Set<string>} a
 * @param {Set<string>} b
 * @returns {boolean}
 */
function filesCollide(a, b) {
  return a.has('*') || b.has('*') || [...a].some((f) => b.has(f))
}

/**
 * Partition tasks into dependency-respecting waves, further constrained so
 * that no two tasks in the same wave claim an overlapping file.
 *
 * Algorithm — Kahn layering with a file-disjointness guard:
 *   1. Find all tasks whose dependencies are already in `completed`.
 *   2. Greedily admit ready tasks into the current wave, skipping any whose
 *      file-set would collide with a file already claimed in this wave.
 *      The first ready task is ALWAYS admitted, so progress is guaranteed.
 *   3. Mark the admitted tasks complete and repeat until none remain.
 *   4. If no task is ready (cycle or unknown id) put the remainder together
 *      in one final wave — the least-bad fallback that still terminates.
 *
 * Why greedy admission is correct: the skipped tasks are "ready" (deps done)
 * but deferred only for file-safety; their deps stay satisfied, so they will
 * be admitted to the very next wave.  No task is starved indefinitely.
 *
 * @param {Array<{ id: string, file?: string, depends_on: string[] }>} tasks
 * @returns {{ waves: Array<typeof tasks>, deferredForFiles: number }}
 */
function buildWaves(tasks) {
  const completed = new Set()
  const waves = []
  let deferredForFiles = 0
  let remaining = tasks.slice()

  while (remaining.length) {
    const ready = remaining.filter((t) => t.depends_on.every((d) => completed.has(d)))
    if (!ready.length) {
      // Dependency cycle or a depends_on referencing an id that does not exist
      // in this task list.  Running the remainder together is wrong in the
      // general case but it terminates and doesn't lose tasks, which beats an
      // infinite loop or a hard error that leaves the phase stuck.
      waves.push(remaining)
      break
    }

    // Greedy file-disjoint admission into this wave.
    const wave = []
    const waveFiles = new Set()
    for (const t of ready) {
      const tf = claimedFiles(t)
      if (wave.length && filesCollide(tf, waveFiles)) {
        // File collision with something already admitted this wave — defer to
        // the next iteration.  deps remain satisfied; t will be first-in-line.
        deferredForFiles++
        continue
      }
      wave.push(t)
      tf.forEach((f) => waveFiles.add(f))
    }

    waves.push(wave)
    wave.forEach((t) => completed.add(t.id))
    remaining = remaining.filter((t) => !wave.includes(t))
  }

  return { waves, deferredForFiles }
}

/**
 * Identify which tasks of a parallel wave failed to come back.
 *
 * `parallel()` resolves positionally: results[i] corresponds to wave[i], and a
 * failed or skipped executor resolves to `null` — the Workflow tool never
 * rejects the whole call.  An isolation failure (e.g. "Cannot create agent
 * worktree: not in a git repository" when the harness can't make a worktree)
 * therefore shows up as a null HOLE, not an exception.  Blindly `.filter(Boolean)`
 * over the results drops those deliverables silently — the bug that let a whole
 * wave vanish and only surface as a downstream "goal absent" verdict.
 *
 * This returns exactly the subset of `wave` whose executor returned falsy, so
 * the caller can re-run those tasks on-branch (sequential) and degrade
 * gracefully instead of losing work.  A `results` array shorter than `wave`
 * (defensive: should never happen) treats the missing tail as failed.
 *
 * @param {Array<object>} wave      the tasks dispatched into parallel(), in order
 * @param {Array<unknown>} results  the positional parallel() return (nulls = failed)
 * @returns {Array<object>} the subset of `wave` whose executor returned falsy
 */
function missingFromWave(wave, results) {
  return wave.filter((_, i) => !results[i])
}

/**
 * Classify the file-ownership overflow of one branch against the wave's claim map.
 *
 * WHY THIS EXISTS — phase-04 cause #2:
 *   An executor wrote outside its declared file set.  When the overflow file is
 *   also claimed by a PEER task in the same wave, integrating both branches would
 *   stack duplicate code with NO conflict marker (textual clean ≠ correct code).
 *   ADR-016 mandates the collision path routes to the heal ladder; overflow into
 *   unclaimed files integrates with a ⚠ advisory (the phase-04 t14 hooksPath fix
 *   was legitimate — blanket rejection would have thrown away good work).
 *
 * Rules (ADR-016):
 *   - declared set contains '*' → wildcard task; no overflow is possible (clean).
 *   - extraFiles = changedFiles ∖ declaredFiles.
 *   - If extraFiles is empty → clean.
 *   - If any extraFile is claimed by a DIFFERENT task in waveClaimMap → collision.
 *     (The declaringTaskId entry is ignored — a task cannot collide with itself.)
 *   - Otherwise all extraFiles are harmless overflow → advisory only.
 *
 * @param {string[]} changedFiles
 *   Files actually changed by the executor (output of git diff --name-only).
 *
 * @param {Set<string>} declaredFiles
 *   The claimedFiles() set for the declaring task.  '*' means wildcard.
 *
 * @param {Map<string, Set<string>>} waveClaimMap
 *   Mapping of OTHER tasks' ids → their claimedFiles() sets.  The declaring
 *   task's own id should be omitted by the caller but is also excluded here as
 *   a safety net (a task cannot collide with itself).
 *
 * @param {string} [declaringTaskId]
 *   Optional id of the declaring task.  If it appears in waveClaimMap it is
 *   ignored, preventing self-collision false positives.
 *
 * @returns {{ kind: 'clean' | 'collision' | 'harmless', extraFiles: string[] }}
 */
function classifyOverflow(changedFiles, declaredFiles, waveClaimMap, declaringTaskId) {
  // Wildcard task claims '*' — it can touch anything by definition.  No overflow
  // concept applies; skip all classification and return clean immediately.
  if (declaredFiles.has('*')) {
    return { kind: 'clean', extraFiles: [] }
  }

  // Extra files: changed but not among the task's declared set.
  const extraFiles = changedFiles.filter((f) => !declaredFiles.has(f))

  if (!extraFiles.length) {
    // Executor touched only what it declared — the happy path.
    return { kind: 'clean', extraFiles: [] }
  }

  // Check each extra file against every peer's claim set (excluding self).
  for (const [peerId, peerFiles] of waveClaimMap) {
    // Safety net: ignore own entry — a task cannot collide with itself.
    if (peerId === declaringTaskId) continue
    for (const f of extraFiles) {
      if (peerFiles.has(f) || peerFiles.has('*')) {
        // At least one extra file is claimed by a peer — the whole result is
        // collision.  The integrator must NEVER cherry-pick this branch; route
        // to the heal ladder.  We still return ALL extraFiles (not just the
        // colliding ones) for complete observability in the heal report.
        return { kind: 'collision', extraFiles }
      }
    }
  }

  // All extra files are unclaimed by any wave peer — integrate with ⚠ advisory.
  return { kind: 'harmless', extraFiles }
}

/**
 * Given a wave's task list, the integrator's conflict objects, and the set of
 * task ids the integrator confirmed as integrated, return the ordered
 * (plan/wave order) list of tasks that must be re-run on-branch at the
 * integrated tip.
 *
 * WHY THIS EXISTS — the phase-04 wave-2 trap:
 *   Git auto-merged stacked duplicate helper copies with *no conflict marker*;
 *   textual success ≠ correct code.  ADR-014 mandates drop-and-rerun at the
 *   integrated tip — NEVER rebase.  This function resolves exactly which tasks
 *   need that re-run so wide waves don't wastefully re-run confirmed work.
 *
 * Rules (ref ADR-014 + CONTEXT.md § "Branch→task mapping"):
 *   1. A conflict whose taskId is non-null → add that task (if it exists in
 *      the wave; silently ignore phantom ids from a confused integrator).
 *   2. A conflict whose taskId is null → add every wave task NOT in
 *      integratedTaskIds (the set of task-ids the integrator explicitly
 *      confirmed landed).
 *   3. Deduplicate by task id; preserve wave (plan) order throughout.
 *
 * @param {Array<{ id: string, [key: string]: unknown }>} wave
 *   The ordered task list for the current wave (plan order is preserved in output).
 *
 * @param {Array<{ branch: string, taskId: string|null }>} conflicts
 *   Conflict objects from the integrator.  taskId is the wave-task id the
 *   integrator mapped to this branch, or null when it could not map.
 *
 * @param {Set<string>} integratedTaskIds
 *   The set of task ids the integrator explicitly confirmed as integrated.
 *   Used only for null-taskId conflicts: tasks absent from this set are
 *   candidates for re-run.
 *
 * @param {((branch: string) => string) | undefined} branchForTask
 *   Optional inverse lookup (branch → taskId).  Accepted for API symmetry so
 *   callers can pass their mapping closure; the pure computation here does not
 *   need it — taskIds are already encoded in the conflict objects.
 *
 * @returns {Array<typeof wave[number]>} Deduplicated, plan-order subset of
 *   `wave` that must be re-run.
 */
function resolveHealList(wave, conflicts, integratedTaskIds, branchForTask) {
  // Build a fast id→task index; preserves nothing about order (we re-sort at
  // the end against the original wave array to guarantee plan order).
  const waveById = new Map(wave.map((t) => [t.id, t]))

  // Collect the set of task ids that need re-running (dedup via Set).
  const toRerun = new Set()

  for (const conflict of conflicts) {
    if (conflict.taskId !== null && conflict.taskId !== undefined) {
      // Mapped conflict: the integrator is confident this branch belongs to
      // exactly one task.  Add it if it exists in this wave.
      if (waveById.has(conflict.taskId)) {
        toRerun.add(conflict.taskId)
      }
      // If taskId is not in the wave, ignore — the integrator may reference a
      // task from a different wave or a phantom id; we must not throw.
    } else {
      // Unmapped conflict (taskId === null): we cannot trust *any* un-confirmed
      // task — re-run every wave task the integrator did not confirm integrated.
      // This is the conservative path that closes the phase-04 phantom-merge
      // gap for wide waves where the integrator loses track of a branch.
      for (const t of wave) {
        if (!integratedTaskIds.has(t.id)) {
          toRerun.add(t.id)
        }
      }
    }
  }

  // Return the matching tasks in the original wave (plan) order.  Filtering
  // the wave array (rather than iterating toRerun) is what guarantees this.
  return wave.filter((t) => toRerun.has(t.id))
}
// <<< MIRROR <<<

const tasks = disc.tasks
const { waves, deferredForFiles } = buildWaves(tasks)
log(
  `${tasks.length} task(s) in ${waves.length} wave(s)` +
    (deferredForFiles ? ` (${deferredForFiles} same-file deferral(s) to avoid collisions)` : ''),
)

// ---- pick an execution strategy ---------------------------------------------
// A "sequential": run tasks one at a time directly on the working branch. Each
//   commit is visible to the next task (so depends_on holds by construction) and
//   to the verifier. Correct and simple; no intra-wave parallelism.
// B "parallel": keep worktree isolation within a wave for speed, then an integrator
//   agent merges that wave's commits onto the working branch and advances HEAD, so
//   the NEXT wave's worktrees fork from the integrated tip.
// Auto-rule: stay on A while it's "fast enough" — few tasks, or no wave wide enough
//   for B to pay off — and switch to B otherwise. Override with args.strategy
//   ('sequential' | 'parallel'); tune the A/B cutover with args.seqBudget.
const SEQ_BUDGET = Number(input.seqBudget) || 8
const maxWidth = waves.length ? Math.max(...waves.map((w) => w.length)) : 0
const strategy =
  input.strategy === 'sequential' || input.strategy === 'parallel'
    ? input.strategy
    : tasks.length <= SEQ_BUDGET || maxWidth < 2
      ? 'sequential'
      : 'parallel'
log(`strategy: ${strategy} (${tasks.length} task(s), widest wave ${maxWidth}, budget ${SEQ_BUDGET})`)

const execPrompt = (t) =>
  `Implement task ${t.id} — "${t.title}" — of phase ${phaseSlug} in project ${root}.\n` +
  `Plan/task file: ${t.file || `${root}/.astrocode/phases/${phaseSlug}/PLAN.md`}\n` +
  `Make the change test-first where it adds behavior, run the tests, and make ONE atomic ` +
  `commit with a clear message. Match the project canon exactly (stack, naming, patterns). ` +
  `Return a short summary of what you changed.` +
  OBEY

const runOnBranch = (t) =>
  agent(execPrompt(t), { label: `exec:${t.id}`, phase: 'Execute', agentType: 'astro-executor', model: models.executor })

// healPrompt is DISTINCT from execPrompt — it tells the executor this is a HEAL
// re-run after an integration cherry-pick conflict, so it must not blindly pick up
// where the failed worktree left off.  The dropped attempt on preservedBranch is
// stale by definition (it was written against an old tip); resurrecting it is the
// exact phase-04 wave-2 trap (ADR-014).
//
// open-question-1 (CONTEXT.md § "Open questions"): the planner resolved to bias
// toward fresh implementation and NOT point the executor at the preserved branch's
// diff for "reference" — the dropped attempt is stale by definition, so diffing it
// would anchor the executor to potentially wrong code.  Only the preserved branch
// name is passed (for orientation/blame), not its diff.
const healPrompt = (t, preservedBranch) =>
  `HEAL RE-RUN — task ${t.id} "${t.title}" — after a cherry-pick conflict (ADR-014 drop-and-rerun).\n` +
  `The previous attempt is on \`${preservedBranch}\` (PRESERVED, stale — do NOT resurrect it).\n\n` +
  `Steps:\n` +
  `1. Inspect current HEAD/working-tree state: read relevant files in ${root} first.\n` +
  `2. Implement FRESH against the integrated tip — the dropped attempt is stale by definition.\n` +
  `3. Make ONE atomic commit with a clear message.\n\n` +
  `Plan/task file: ${t.file || `${root}/.astrocode/phases/${phaseSlug}/PLAN.md`}\n` +
  `Make the change test-first where it adds behavior, run the tests. ` +
  `Match the project canon exactly (stack, naming, patterns). ` +
  `Return a short summary of what you changed.` +
  OBEY

const runHealOnBranch = (t, preservedBranch) =>
  agent(healPrompt(t, preservedBranch), { label: `heal:${t.id}`, phase: 'Execute', agentType: 'astro-executor', model: models.executor })

// Strict schema for the healed-wave test gate (see the helper below).
//
// Why additionalProperties:false + required:['passed']:
//   Without a strict schema the agent can return {} or omit `passed` entirely and
//   the script would treat the absence as "unclear" and continue — the exact
//   phase-04 trap of a silently-skipped test gate (ADR-014 § "healed waves are
//   test-gated before the next wave proceeds").  The schema forces the agent to
//   commit to a boolean verdict; any deviation is a schema validation failure that
//   stops the phase loudly rather than silently proceeding on broken code.
//
// output is NOT required — a passing suite has no useful failure output to return,
// and requiring it would force the agent to emit an empty string every time.
const TESTGATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passed: { type: 'boolean' },
    output: { type: 'string' },
  },
  required: ['passed'],
}

// runTestSuite — run the full test suite in `root` via an executor agent.
//
// Why an agent (not a direct shell call): Workflow scripts cannot run processes
// directly (the Workflow-tool sandbox has no `exec`/`spawn`); an astro-executor
// agent runs in the main working tree and CAN invoke `node --test` (or the
// project's test script) and return a structured verdict.  Using `agentType:
// 'astro-executor'` + `phase:'Execute'` keeps the gate in the execution phase
// rather than the verify phase (the verifier runs goal-backward; this is a
// pure regression gate for the healed wave's diff).
const runTestSuite = () =>
  agent(
    `Run the full test suite for the project at ${root}.\n` +
      `Use \`node --test\` (or the equivalent test command for this project) to run ` +
      `all tests under ${root}. Do NOT skip any tests.\n` +
      `Return passed:true if every test passed, passed:false otherwise.\n` +
      `If passed:false, populate output with the failure summary (test names + error messages) ` +
      `so the caller can surface it in the integration-failure report.`,
    { label: 'testgate', phase: 'Execute', agentType: 'astro-executor', model: models.executor, schema: TESTGATE_SCHEMA },
  )

// The strict schema (like TESTGATE_SCHEMA) prevents a silent no-op teardown from
// reading as success: `removed` is required, so the script can diff it against the
// branches it asked for and ⚠-flag any leftover instead of assuming cleanup happened.
const TEARDOWN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    removed: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
  required: ['removed'],
}

// runTeardown — remove the preserved worktree-* branches of SUCCESSFULLY healed
// tasks, after (and only after) the healed wave's test gate passed.
//
// Why this exists (the phase-05 UAT gap): the heal ladder preserves a conflicted
// branch so no work is lost, but once the task has been re-implemented fresh at the
// integrated tip and the suite is green, the preserved branch holds only the stale
// attempt. Leaving it would (a) accumulate dead worktrees and (b) trip the final
// verifier's `git rev-list HEAD..worktree-*` un-integrated-commits check — a
// correctly healed phase would read as stranded work. The script never runs git
// (ADR-005), so an executor agent does the removal; it is given an EXPLICIT list and
// told to touch nothing else — a heal-FAILED branch must stay preserved for
// inspection (ADR-014).
const runTeardown = (w, branches) =>
  agent(
    `You are the HEAL TEARDOWN step for wave ${w + 1} of phase ${phaseSlug}, running in the MAIN ` +
      `working tree of ${root} (you have NO worktree of your own). The following preserved ` +
      `\`worktree-*\` branches belonged to tasks that have since been HEALED: each task was ` +
      `re-implemented fresh and committed on the current branch, and the post-heal test suite ` +
      `passed — so these branches now hold only the stale, superseded attempts:\n` +
      `${JSON.stringify(branches)}\n` +
      `For EACH listed branch, in ${root}: find its worktree path via \`git worktree list\`, run ` +
      `\`git worktree remove --force <path>\` (skip if no worktree), then \`git branch -D <branch>\`, ` +
      `and finally \`git worktree prune\`. Touch ONLY the listed branches — any other ` +
      `\`worktree-*\` branch must stay untouched (it may be a preserved failed heal under ` +
      `inspection). Return removed=[the branches you actually removed].`,
    { label: `teardown:w${w + 1}`, phase: 'Execute', agentType: 'astro-executor', model: models.executor, schema: TEARDOWN_SCHEMA },
  )

// Each conflict item is an object with branch + taskId so the script can drive
// runOnBranch(t) for exactly the right task when healing a wave conflict (ADR-014).
// Keeping items as plain strings would lose the branch→task mapping and force
// re-running the whole wave remainder unnecessarily.  taskId is nullable: the
// integrator maps by commit message + changed files; if it cannot map confidently
// it returns null and the script re-runs every wave task not explicitly confirmed
// as integrated.  additionalProperties:false at every level is required by canon.
const INTEGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    integrated: { type: 'boolean' },
    branches: { type: 'array', items: { type: 'string' } },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string' },
          taskId: { type: ['string', 'null'] },
        },
        required: ['branch', 'taskId'],
      },
    },
    note: { type: 'string' },
  },
  required: ['integrated'],
}

// The integrator is the only actor that can run git (Workflow scripts cannot). It
// folds a wave's isolated worktree commits onto the working branch; clean worktrees
// are torn down so the next wave forks from the integrated tip; conflicting worktrees
// are PRESERVED so no work is ever silently lost (ADR-014). A healed task's preserved
// branch is removed later by runTeardown — only after its re-run commit landed AND the
// healed wave's test gate passed; a FAILED heal's branch stays for inspection.
//
// wave tasks are passed as an inlined JSON scalar so the integrator can map each
// conflicted worktree-* branch to a taskId by commit message + changed files — without
// this the integrator would always return taskId:null and force re-running the whole
// wave remainder (wasteful in wide waves).  The scalar is small (id + title + file
// only) to respect the Workflow-arg-size rule.
const integrateWave = (wave) =>
  agent(
    `You are the WAVE INTEGRATOR for phase ${phaseSlug}, running in the MAIN working tree of ${root} ` +
      `(you have NO worktree of your own). The parallel executors each committed on a separate ` +
      `\`worktree-*\` branch forked from the current HEAD. Fold them onto the CURRENTLY checked-out ` +
      `branch so the next wave and the verifier see one combined tree.\n` +
      `Wave task list (for branch→taskId mapping): ${JSON.stringify(wave.map((t) => ({ id: t.id, title: t.title, file: t.file || '' })))}\n` +
      `Do exactly this, in ${root}:\n` +
      `1. List candidates: \`git for-each-ref --format='%(refname:short)' refs/heads/ | grep '^worktree-'\`. ` +
      `Keep only branches with commits not yet on HEAD (\`git rev-list HEAD..<branch>\` non-empty).\n` +
      `2. Wave tasks are independent, so order does not matter. For each candidate branch, cherry-pick ` +
      `its commits onto the current branch (\`git cherry-pick <range>\`). For each branch, map it to a ` +
      `taskId by matching the commit message and changed files against the wave task list above — return ` +
      `taskId:null only when you cannot map confidently.\n` +
      `On ANY conflict: immediately run \`git cherry-pick --abort\`, then verify \`git status\` shows ` +
      `a clean working tree (nothing to commit) before continuing. PRESERVE that branch and its worktree — ` +
      `do NOT run \`git worktree remove\` or \`git branch -D\` on a conflicting branch. Add it to ` +
      `conflicts[] with its mapped taskId (or null). Stop after the first conflict; return integrated=false.\n` +
      `3. After a CLEAN (conflict-free) cherry-pick, tear down that branch's worktree: ` +
      `\`git worktree remove --force <path>\` (paths from \`git worktree list\`), \`git branch -D <branch>\`, ` +
      `then \`git worktree prune\`. Only clean-merged branches are torn down.\n` +
      `4. Confirm the current branch now contains every integrated commit (\`git log --oneline -n 20\`).\n` +
      `Return integrated=true with the branches[] you merged, or integrated=false with conflicts[] ` +
      `(each item: { branch, taskId }) and a note.` +
      OBEY,
    { label: `integrate:w${wave.length}`, phase: 'Execute', agentType: 'astro-executor', model: models.executor, schema: INTEGRATE_SCHEMA },
  )

phase('Execute')
const results = []
// healedTaskIds accumulates the ids of every task that was successfully healed
// by the self-healing ladder in any wave.  Exposed in the return value so the
// outer command (/astro-execute) can report how many tasks were auto-healed
// and which ones — this is the observability surface for the phase-04 wave-2
// class of incident (ADR-014 § "healed waves are test-gated before the next
// wave proceeds").
const healedTaskIds = []
let integrationFailed = null
for (let w = 0; w < waves.length && !integrationFailed; w++) {
  const wave = waves[w]
  log(`wave ${w + 1}/${waves.length}: ${wave.map((t) => t.id).join(', ')}`)
  // A, or a single-task wave (nothing to parallelize): commit straight on the branch.
  if (strategy === 'sequential' || wave.length === 1) {
    for (const t of wave) {
      const out = await runOnBranch(t)
      if (out) results.push(out)
    }
    continue
  }
  // B: isolated parallel executors, then fold the wave onto the working branch.
  const out = await parallel(
    wave.map((t) => () =>
      agent(execPrompt(t), {
        label: `exec:${t.id}`,
        phase: 'Execute',
        isolation: 'worktree',
        agentType: 'astro-executor',
        model: models.executor,
      }),
    ),
  )
  results.push(...out.filter(Boolean))
  // Graceful degradation (the worktree-isolation gap): a parallel executor that
  // can't create its worktree — e.g. "Cannot create agent worktree: not in a git
  // repository" in a harness that doesn't expose git to that layer — resolves to
  // `null`, NOT an exception. Don't let `.filter(Boolean)` swallow those tasks:
  // re-run exactly the missing ones on-branch (sequential), which needs no
  // worktree and matches the README's "degrades gracefully" promise. If EVERY
  // executor failed, this re-runs the whole wave on-branch; the integrator then
  // finds no `worktree-*` branches and is a clean no-op.
  const missing = missingFromWave(wave, out)
  if (missing.length) {
    log(
      `⚠ ${missing.length}/${wave.length} parallel executor(s) returned nothing ` +
        `(worktree isolation likely unavailable here) — re-running on-branch sequentially: ` +
        missing.map((t) => t.id).join(', '),
    )
    for (const t of missing) {
      const r2 = await runOnBranch(t)
      if (r2) results.push(r2)
    }
  }
  const integ = await integrateWave(wave)

  // ── Self-healing ladder (ADR-014 + CONTEXT.md phase-05) ──────────────────
  //
  // The phase-04 wave-2 incident: git auto-merged stacked duplicate helper
  // copies with NO conflict marker — textual success ≠ correct code.  The old
  // `integrated !== true → integrationFailed` branch silently accepted that bad
  // merge.  ADR-014 mandates: on ANY cherry-pick conflict, DROP the offending
  // worktree-* branch (the integrator preserves it, never tears it down) and
  // RE-RUN the task sequentially at the integrated tip.  A fresh re-run at the
  // current HEAD cannot produce stale/duplicated code by construction.
  //
  // ADR-008 invariant: re-runs are sequential on-branch (no parallel-without-
  // isolation).  The integrator remains the sole git actor; the script only
  // drives agent calls.
  if (integ && integ.integrated !== true && integ.conflicts && integ.conflicts.length) {
    // Log every preserved branch immediately so no work is silently lost.
    for (const conflict of integ.conflicts) {
      log(
        `• wave ${w + 1} conflict: preserved branch \`${conflict.branch}\`` +
          (conflict.taskId ? ` (task ${conflict.taskId})` : ' (branch→task mapping unknown)'),
      )
    }

    // Compute the precise set of tasks that need healing.  resolveHealList
    // (mirrored from lib/waves.mjs) maps each conflict object to the right task
    // (or falls back to every un-confirmed task when taskId is null) and returns
    // them in plan order.  We build integratedTaskIds from the branches the
    // integrator confirmed before the conflict stopped it.
    const integratedTaskIds = new Set(
      (integ.branches || [])
        .map((b) => {
          const hit = integ.conflicts.find((c) => c.branch === b)
          // If the integrator confirmed this branch without listing it as a
          // conflict it's integrated — reverse-map via the wave task list.
          return hit ? null : wave.find((t) => t.id === b || b.includes(t.id))?.id
        })
        .filter(Boolean),
    )
    const healList = resolveHealList(wave, integ.conflicts, integratedTaskIds)

    // Re-run each task in plan order sequentially at the integrated tip.
    // One attempt per task; no retry (ADR-014 § "Re-run failure → fail the
    // phase immediately").
    let ladderFired = false
    const healedBranches = [] // preserved branches whose task healed — torn down post-gate
    for (const t of healList) {
      // Identify the preserved branch for this task so healPrompt can name it.
      const conflict = integ.conflicts.find((c) => c.taskId === t.id)
        || integ.conflicts.find((c) => !c.taskId) // null-mapped fallback
      const preservedBranch = conflict?.branch || 'unknown'

      const healResult = await runHealOnBranch(t, preservedBranch)
      if (healResult) {
        // Heal succeeded: record the result and the healed task id.  The
        // preserved branch is NOT torn down here — only after the wave's test
        // gate passes (runTeardown below); the script never runs git (ADR-005).
        results.push(healResult)
        healedTaskIds.push(t.id)
        if (preservedBranch !== 'unknown') healedBranches.push(preservedBranch)
        ladderFired = true
      } else {
        // Heal failed: fail the phase immediately with a richer note naming
        // the exact task id and branch.  No retry (ADR-014).  The preserved
        // branch is still untouched so the user can inspect it.
        integrationFailed = {
          wave: w + 1,
          taskId: t.id,
          branch: preservedBranch,
          note:
            `heal re-run failed for task ${t.id} ("${t.title}") on preserved branch \`${preservedBranch}\`` +
            ` — re-run returned nothing; inspect the preserved branch and re-run manually`,
        }
        log(
          `✖ wave ${w + 1} heal re-run failed for task ${t.id} on \`${preservedBranch}\`` +
            ` — stopping before verify`,
        )
        break
      }
    }

    // After any healed wave, run the full test suite before proceeding to the
    // next wave (ADR-014 § "Test gate only after a HEALED wave").  A failing
    // suite is treated as an integration failure and stops the phase loudly —
    // this is the guard that would have caught the phase-04 wave-2 bad merge
    // before it poisoned later waves.  Clean (non-healing) waves stay fast;
    // only healed waves pay the suite cost.
    if (ladderFired && !integrationFailed) {
      const gate = await runTestSuite()
      if (!gate || !gate.passed) {
        integrationFailed = {
          wave: w + 1,
          taskId: null,
          branch: null,
          note:
            `test suite failed after healing wave ${w + 1}` +
            (gate?.output ? `: ${gate.output}` : ' (no output returned)'),
        }
        log(
          `✖ wave ${w + 1} test gate failed after heal — stopping before verify`,
        )
      } else {
        log(`✓ wave ${w + 1} test gate passed after heal (${healedTaskIds.length} task(s) healed)`)
        // Only now — re-run commits landed AND the suite is green — is a healed
        // task's preserved branch truly superseded. Tearing down earlier would
        // destroy the only copy of the dropped attempt while its replacement was
        // still unproven; tearing down never would strand stale worktrees and
        // false-FAIL the final verifier's rev-list check (the phase-05 UAT gap).
        if (healedBranches.length) {
          const teardown = await runTeardown(w, healedBranches)
          const removed = teardown && Array.isArray(teardown.removed) ? teardown.removed : []
          if (removed.length) {
            log(`✓ wave ${w + 1} healed branch(es) torn down after re-run commits landed: ${removed.join(', ')}`)
          }
          // Cleanup failure is NOT integration failure — the healed work is on
          // the branch and tested. But silence would read as success, so name
          // every leftover branch for manual cleanup (and so the user knows why
          // the final verifier might flag it).
          const leftover = healedBranches.filter((b) => !removed.includes(b))
          if (leftover.length) {
            log(`⚠ preserved branch(es) not removed — clean up manually: ${leftover.join(', ')}`)
          }
        }
      }
    }
  } else if (!integ || integ.integrated !== true) {
    // The integrator returned integrated=false but with no conflicts array (or
    // an empty one) — the ladder cannot map any task, so we fail immediately.
    // This path covers integrator errors and unexpected response shapes.
    integrationFailed = {
      wave: w + 1,
      taskId: null,
      branch: null,
      note: integ?.note || 'integrator did not confirm success',
    }
    log(`✖ wave ${w + 1} integration failed — stopping before verify`)
  }
}

phase('Verify')
let verdict
if (integrationFailed) {
  // Don't verify a tree the work never reached — fail loudly with a cleanup hint
  // (the guard the issue asked for) instead of a misleading "goal absent" verdict.
  // The richer integrationFailed shape (set by the self-healing ladder) carries
  // taskId + branch so the user knows exactly which task and preserved branch to
  // inspect — not just a raw conflicts array (the phase-04 wave-2 lesson).
  const failDetail = integrationFailed.taskId
    ? `task ${integrationFailed.taskId} on \`${integrationFailed.branch}\``
    : (integrationFailed.branch ? `branch \`${integrationFailed.branch}\`` : 'no branch preserved')
  verdict =
    `FAIL — wave ${integrationFailed.wave} did not integrate onto the working branch ` +
    `(${failDetail}; ${integrationFailed.note}). ` +
    `Executor commits may remain on \`worktree-*\` branches — resolve the conflict and re-run before verifying.`
  log('skipped goal verification — integration failed')
} else {
  verdict = await agent(
    `Verify phase "${phaseSlug}" of the project at ${root}. The phase's work is committed on the ` +
      `CURRENT branch — verify against HEAD/the working tree, NOT a fresh checkout of main. Read its goal ` +
      `in ${root}/.astrocode/phases/${phaseSlug}/ and confirm the implemented code actually delivers it ` +
      `(goal-backward, not just "tasks ran"). First confirm the phase's commits are present ` +
      `(\`git log --oneline\`) and that no \`worktree-*\` branch still holds un-integrated commits ` +
      `(\`git for-each-ref refs/heads/worktree-*\`, then \`git rev-list HEAD..<branch>\` must be empty). ` +
      `Run the test suite. Also flag any violation of the project canon (naming, patterns, prior decisions). ` +
      `Report PASS or FAIL with reasons.` +
      OBEY,
    { phase: 'Verify', agentType: 'astro-verifier', model: models.verifier },
  )
}

return { phase: phaseSlug, tasks: tasks.length, waves: waves.length, strategy, executed: results.length, healed: healedTaskIds, integrationFailed, verdict }
