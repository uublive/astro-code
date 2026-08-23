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
const { root, phase: phaseSlug, models: baseModels = {} } = input
if (!root || !phaseSlug) throw new Error('execute-phase requires args { root, phase }')

// Phase-10 (ADR-022): the per-phase effort dial.  `effort` arrives as a run-scoped
// arg — the command resolves the stored level (or the hardcoded `standard` default,
// or a `--effort` one-off override) and passes it in; this script NEVER persists it.
// Depth is bought in exactly two places — the bounded verify→remediate loop and the
// model tier — and NEVER in wider research (C9): quota tokens are the scarce resource,
// so spend them on remediate cycles that provably converge, not on fan-out.
// The level→max-cycles map is inlined as a tiny literal (no MIRROR block is warranted
// for three integers): light spends ZERO cycles (today's single-pass behavior),
// standard up to 1, deep up to 3.  An absent/unknown level normalizes to the standard
// budget (`?? 1`) so a typo can never produce an unbounded or zero-when-meant-more loop (C3).
const effort = input.effort || 'standard'
const maxCycles = ({ light: 0, standard: 1, deep: 3 })[effort] ?? 1
// Resolve the EFFECTIVE model tiers ONCE, up front, so every agent() call below
// (Discover, the execute waves, verify, and remediation) reads the same map.  `deep`
// escalates BOTH the executor and the verifier to opus for THIS phase only — a fresh
// object, never a mutation of the persisted config (C4).  Every other level passes the
// base tiers through untouched; discover is deliberately NOT escalated (the dial spends
// on execute+verify only, ADR-022).  `integrator` (phase-14, ADR-027) is likewise NEVER
// escalated by `deep` — it stays a two-arm ternary on purpose (a third arm here is an
// easy one-arm-only bug) and carries its own floor at the wave-integrator call site below.
const models = effort === 'deep' ? { ...baseModels, executor: 'opus', verifier: 'opus' } : baseModels

// Phase-07 / ADR-017: extract the zero-padded phase number from the slug as a
// STRING so the commit-stamp grep pattern "(phase 07 tK)" is correct.
// WHY STRING (not parseInt): the slug prefix "07-…" must become "07", not 7 —
// parseInt strips the leading zero and would produce stamps like "(phase 7 t1)"
// that never match commits stamped with the canonical "(phase 07 t1)" suffix.
// This is the same zero-padding the executor has converged on (13 of the last 30
// commits carry it) and which ADR-017 codifies as the project-wide convention.
// Phase-04 re-run cause: Discover returned every PLAN.md task with no
// done-awareness, so re-running /astro-execute re-executed completed tasks
// unnecessarily — phaseNum feeds into the Discover prompt's stamp-grep
// instruction so it can identify which tasks are already stamped on the branch.
const phaseNum = (phaseSlug.match(/^(\d+)/) || [])[1] || phaseSlug

// Agents read the canon + discussion brief from disk (absolute paths into the main
// repo, so worktree executors see them regardless of git state).
const OBEY =
  `\n\nRead and OBEY: ${root}/.astrocode/CONVENTIONS.md and ${root}/.astrocode/DECISIONS.md (project canon), ` +
  `plus ${root}/.astrocode/phases/${phaseSlug}/CONTEXT.md (this phase's decisions, if present).`

// Phase-07 / ADR-017: TASK_SCHEMA items gain `done: boolean` (required).
// WHY required AND boolean: without a strict schema the Discover agent can omit
// `done` entirely (returns {} or null) and the skip-wiring would treat the
// absence as "unclear" and re-execute — the exact phase-04 re-run trap.
// `additionalProperties: false` at every level is a canon invariant (CONVENTIONS.md).
// The done field drives buildWaves(tasks, preCompleted) pre-seeding so dependents
// of stamped tasks are ready in wave 1 and the stamped tasks never appear in any
// wave (phase-07 resumability, ADR-017).
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
          done: { type: 'boolean' },
        },
        required: ['id', 'title', 'depends_on', 'done'],
      },
    },
  },
  required: ['tasks'],
}

phase('Discover')
// Phase-07 / ADR-017: the Discover prompt's done-detection instruction must be
// DEAD-SIMPLE and mechanical — one grep per task, no reasoning prose.  Discover
// may run on the haiku tier (CONTEXT.md § "Done-detection must be mechanical").
// The exact grep pattern "(phase ${phaseNum} <taskId>)" includes the closing paren
// so `t1` never matches `t14` (the t1/t14 trap, CONTEXT.md note 1).  phaseNum is
// interpolated by the script at prompt-build time (never invented by the agent).
// --fixed-strings ensures parens are literal, not regex metacharacters.
const disc = await agent(
  `Read every plan/task file under ${root}/.astrocode/phases/${phaseSlug}/ (PLAN.md and any NN-*.md). ` +
    `Return the full task list with explicit dependencies — depends_on lists the ids of tasks ` +
    `that must complete before this one. Use the ids exactly as written in the plan.\n\n` +
    `For each task, set done:true or done:false using this EXACT check (replace <taskId> with the task id):\n` +
    `  git log --oneline --fixed-strings --grep "(phase ${phaseNum} <taskId>)"\n` +
    `If the command returns at least one line, set done:true; otherwise set done:false.`,
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
 * Phase-07 resumability — `preCompleted`:
 *   When /astro-execute is re-run after a partial failure, Discover passes the
 *   ids of tasks whose commit stamp was already found on the branch.  Those ids
 *   seed `completed` before the Kahn loop begins, so their dependents are
 *   immediately "ready" in wave 1 (the whole point — without pre-seeding a
 *   dependent would stall behind a dep that is done but absent from `remaining`
 *   and would therefore never enter `completed`).  Pre-seeded tasks are also
 *   filtered OUT of `remaining` so they never appear in any emitted wave —
 *   re-executing a stamped task would be incorrect.  The default `new Set()`
 *   keeps every existing caller compatible with zero behaviour change.
 *
 * @param {Array<{ id: string, file?: string, depends_on: string[] }>} tasks
 * @param {Set<string>} [preCompleted=new Set()]  Task ids already done on the
 *   branch (found via commit-stamp grep).  Safe to omit — defaults to an empty
 *   set so all existing callers are unaffected.
 * @returns {{ waves: Array<typeof tasks>, deferredForFiles: number }}
 */
function buildWaves(tasks, preCompleted = new Set()) {
  // Seed completed with every pre-done id so their dependents are satisfied
  // from the very first Kahn iteration (phase-07 resumability).
  const completed = new Set(preCompleted)
  const waves = []
  let deferredForFiles = 0
  // Filter pre-done ids out of remaining: a stamped task must never appear in
  // any wave even though its id satisfies dependents' depends_on checks above.
  let remaining = tasks.filter((t) => !completed.has(t.id))

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
// Phase-07 / ADR-017: tasks Discover marked done (stamp found on branch) pre-seed
// buildWaves so their dependents are immediately "ready" in wave 1 and the stamped
// tasks themselves never appear in any wave (CONTEXT.md § "Wave building: done task
// ids PRE-SEED the completed set").  skippedTaskIds is exposed in the return value
// so /astro-execute can narrate which tasks were skipped.
// Skips are narrated at discovery time ONLY — never re-checked mid-run
// (CONTEXT.md note 4: a task completed by THIS run is tracked by the run itself,
// not by stamps; re-grepping mid-run would produce false positives for in-flight
// work and is explicitly out of scope per the phase-07 plan).
const skippedTaskIds = tasks.filter((t) => t.done).map((t) => t.id)
const preCompleted = new Set(skippedTaskIds)
for (const id of skippedTaskIds) {
  log(`• task ${id} already on branch (stamp found) — skipping`)
}
// Only tasks that are NOT yet stamped on the branch enter the wave builder.
// We filter to executableTasks rather than passing the full tasks array so the
// call site makes the intent explicit (only executable tasks need waves built).
// preCompleted still seeds the completed set inside buildWaves so dependents of
// done tasks are immediately "ready" in wave 1 (the whole point of pre-seeding).
const executableTasks = tasks.filter((t) => !t.done)
const { waves, deferredForFiles } = buildWaves(executableTasks, preCompleted)
log(
  `${tasks.length} task(s) in ${waves.length} wave(s)` +
    (skippedTaskIds.length ? ` (${skippedTaskIds.length} already done)` : '') +
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
// Worktree robustness: some environments are worktree-HOSTILE — the harness fires
// one `git worktree add` per parallel agent, and under a wide wave the concurrent
// adds lose a lock race, so a MAJORITY fail with "Cannot create agent worktree: not
// in a git repository" while a few win (the partial-success signature: e.g. 6 of 18
// succeeded).  config.use_worktrees (passed through args as `useWorktrees`) lets such
// a project opt out of the parallel path entirely — clean sequential on-branch, zero
// failed-agent noise.  Default true (back-compat).  An explicit args.strategy still
// wins (escape hatch); only the AUTO picker respects the flag.
const useWorktrees = input.useWorktrees !== false
const strategy =
  input.strategy === 'sequential' || input.strategy === 'parallel'
    ? input.strategy
    : !useWorktrees || tasks.length <= SEQ_BUDGET || maxWidth < 2
      ? 'sequential'
      : 'parallel'
log(`strategy: ${strategy} (${tasks.length} task(s), widest wave ${maxWidth}, budget ${SEQ_BUDGET}, worktrees ${useWorktrees})`)

// execPrompt carries the file-ownership hygiene sentence (phase-06 t3 / ADR-016):
// executors must declare up-front if they touch files outside their declared set.
// The integrator — NOT the executor — decides whether that overflow routes to the
// heal ladder (collision) or integrates with a ⚠ advisory (harmless).  Keeping this
// contract in the prompt prevents silent cross-file pollution; the sentence must NOT
// appear in healPrompt because heal re-runs are sequential on-branch and the
// co-scheduling hazard is gone by then (CONTEXT.md note 1).
const execPrompt = (t) =>
  `Implement task ${t.id} — "${t.title}" — of phase ${phaseSlug} in project ${root}.\n` +
  `Plan/task file: ${t.file || `${root}/.astrocode/phases/${phaseSlug}/PLAN.md`}\n` +
  `Make the change test-first where it adds behavior, run the tests, and make ONE atomic ` +
  `commit with a clear message. Match the project canon exactly (stack, naming, patterns). ` +
  `touch ONLY your declared file(s); if other changes are genuinely required, say so in your summary. ` +
  `If this is a RED-test task whose import would crash at module load because the export does not exist yet, use the dynamic-import pattern (\`await import(...)\` inside async tests) — do NOT implement the missing export; that is the impl task's job (ADR-018). ` +
  `End the commit subject with the stamp \`(phase ${phaseNum} ${t.id})\` — this exact suffix ` +
  `enables idempotent re-execution (ADR-017): a later re-run of /astro-execute will detect ` +
  `the stamp and skip this task rather than re-executing it. ` +
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
  `3. Make ONE atomic commit with a clear message, ending the subject with the stamp \`(phase ${phaseNum} ${t.id})\`.\n\n` +
  `Plan/task file: ${t.file || `${root}/.astrocode/phases/${phaseSlug}/PLAN.md`}\n` +
  `Make the change test-first where it adds behavior, run the tests. ` +
  `Match the project canon exactly (stack, naming, patterns). ` +
  `The stamp \`(phase ${phaseNum} ${t.id})\` must appear at the end of the commit subject — ` +
  `it enables idempotent re-execution (ADR-017) so future re-runs skip this healed task. ` +
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
// `ranSuite` (ADR-028) separates "the suite ran and failed" from "this project has
// no runnable suite at all".  Without it the agent faces a question with no correct
// answer — `passed` is forced by the schema, so a project with no tests yields a
// coin-flip verdict, and a `false` there aborts the whole phase over a suite that
// never existed.  It is REQUIRED, not optional: an omitted flag would default-read
// as "a suite ran", reintroducing exactly the ambiguity it exists to remove.
const TESTGATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ranSuite: { type: 'boolean' },
    passed: { type: 'boolean' },
    output: { type: 'string' },
  },
  required: ['ranSuite', 'passed'],
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
      `FIRST decide whether a runnable suite EXISTS at all (a test runner/config, a tests ` +
      `directory, a \`test\` script — anything that defines tests for this project).\n` +
      `- No runnable suite exists → ranSuite:false, passed:true. Say so in output. This is ` +
      `NOT a failure; some projects legitimately have no tests yet.\n` +
      `- A suite exists → ranSuite:true, and passed:true only if every test passed.\n` +
      `CRITICAL: a suite that EXISTS but fails to load, collect, or compile (an import error, ` +
      `a missing module, a collection error) is ranSuite:true + passed:false — a REAL failure. ` +
      `Do NOT report that as "no suite". The distinction is between "there are no tests here" ` +
      `and "the tests are broken"; only the first is benign.\n` +
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
// re-running the whole wave remainder unnecessarily.  taskId is nullable: phase-14 t7
// (ADR-027 decision 3) maps it via a MECHANICAL read of the ADR-017 commit-subject
// stamp `(phase NN tK)` — changed-file/message inference survives only as the
// fallback for a stamp-less commit.  If neither maps confidently the integrator
// returns null and the script re-runs every wave task not explicitly confirmed
// as integrated.  additionalProperties:false at every level is required by canon.
//
// Phase-06 t3 additions (ADR-015 cause #1 stale base; ADR-016 cause #2 overflow):
//   - staleBranches: branches whose merge-base(HEAD, branch) ≠ HEAD — stale fork base.
//     Same item shape as conflicts so the wave loop can feed both into resolveHealList
//     with no fan-out.  Never cherry-picked; always routed to the heal ladder.
//   - advisories: branches that overflowed into files NOT claimed by any same-wave peer.
//     Integrated (not rejected — the phase-04 t14 hooksPath fix was legitimate) but
//     logged with a ⚠.  Each item carries extraFiles so the log can name the overflow.
// Both are optional (the happy path has neither), so they are NOT in required[].
//
// Phase-14 t2 (ADR-027 decision 2): `tornDown` — the branches this run's integrator
// actually deleted (`git branch -D` / `git worktree remove --force`).  Optional on
// purpose: a wave that tore nothing down (e.g. it healed the whole wave, or a heal
// hasn't reached teardown yet) must not read as a failure by omitting the field.
// The script cross-checks it against the CLEANLY-integrated set immediately after
// this call returns — pure data comparison, the script still runs no git (ADR-008).
const INTEGRATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    integrated: { type: 'boolean' },
    branches: { type: 'array', items: { type: 'string' } },
    tornDown: { type: 'array', items: { type: 'string' } },
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
    staleBranches: {
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
    advisories: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          branch: { type: 'string' },
          taskId: { type: ['string', 'null'] },
          extraFiles: { type: 'array', items: { type: 'string' } },
        },
        required: ['branch', 'taskId', 'extraFiles'],
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
// wave tasks are passed as an inlined JSON scalar so the integrator has a target SET
// of taskIds to map each worktree-* branch against.  Phase-14 t7 (ADR-027 decision 3):
// the mapping itself is a MECHANICAL grep of the ADR-017 `(phase NN tK)` commit-subject
// stamp, not a judgement call about commit messages — this is what makes a haiku-tier
// integrator safe rather than merely cheaper.  Changed-file/message inference survives
// ONLY as the labelled fallback for a stamp-less commit.  Without a taskId the
// integrator returns null and the script re-runs every wave task not confirmed
// integrated (safe, if wasteful in wide waves) — see resolveHealList.  The scalar is
// small (id + title + file only) to respect the Workflow-arg-size rule.
//
// Phase-06 t4 (ADR-015 cause #1 stale base; ADR-016 cause #2 overflow):
//   The check order per branch is: staleness FIRST, then overflow classification,
//   then cherry-pick.  Staleness is the cheaper check (one merge-base query) and
//   completely gates the overflow check — a stale branch is NEVER classified for
//   overflow, it is always routed to heal regardless of whether the cherry-pick
//   would apply cleanly.  Phase-04 proved textual cleanliness proves nothing.
const integrateWave = (w, wave) =>
  agent(
    `You are the WAVE INTEGRATOR for phase ${phaseSlug}, running in the MAIN working tree of ${root} ` +
      `(you have NO worktree of your own). The parallel executors each committed on a separate ` +
      `\`worktree-*\` branch forked from the current HEAD. Fold them onto the CURRENTLY checked-out ` +
      `branch so the next wave and the verifier see one combined tree.\n` +
      `Wave task list (taskId mapping target set + declared-file comparison): ` +
      `${JSON.stringify(wave.map((t) => ({ id: t.id, title: t.title, file: t.file || '' })))}\n` +
      `Do exactly this, in ${root}. Each candidate branch is reported under exactly ONE outcome, ` +
      `and once a branch is preserved you MUST CONTINUE to every remaining candidate — never ` +
      `abort the wave on the first bad branch. A preserved branch's clean peers still land in ` +
      `THIS SAME call: resolveHealList already re-runs every wave task not confirmed integrated, ` +
      `so halting early would push correctly-landed work into an executor-tier heal re-run and ` +
      `spend more than the cheap tier saved. Do NOT self-retry a preserved branch and do NOT ask ` +
      `for a stronger model — that is exactly the textual rescue ADR-014/ADR-015 forbid; a bad ` +
      `branch's task is re-run by the heal ladder, never by you.\n` +
      `1. List candidates: \`git for-each-ref --format='%(refname:short)' refs/heads/ | grep '^worktree-'\`. ` +
      `Keep only branches where \`git rev-list HEAD..<branch>\` is non-empty.\n` +
      `2. MAP each candidate to a taskId — MECHANICAL, never a judgement call about commit ` +
      `messages: run \`git log --format=%s HEAD..<branch>\` and look for the stamp ` +
      `\`(phase ${phaseNum} t<id>)\` among the commit subjects — the closing paren is required ` +
      `(it is what stops \`t1\` matching \`t14\`). Equivalently, mirroring the Discover prompt's ` +
      `idiom, you may grep per wave task id: \`git log --oneline --fixed-strings --grep ` +
      `"(phase ${phaseNum} <taskId>)" HEAD..<branch>\`. Exactly ONE distinct stamp matching a ` +
      `wave task id → that taskId. Zero, or more than one distinct stamp → taskId:null (never ` +
      `guess — resolveHealList already falls back safely). FALLBACK, only for a branch with no ` +
      `stamped commit at all: infer taskId from the commit message and changed files against the ` +
      `wave task list above.\n` +
      `3. For each candidate — checks IN ORDER (staleness first, then overflow, then cherry-pick):\n` +
      `  3a. STALENESS (ADR-015 cause #1): \`git merge-base HEAD <branch>\` vs \`git rev-parse HEAD\`. ` +
      `If SHAs differ: STALE — do NOT cherry-pick (a clean pick proves nothing; phase-04 stacked ` +
      `duplicate helpers with zero conflict markers). PRESERVE branch/worktree — do NOT tear it ` +
      `down. Add \`{branch,taskId}\` (the taskId from step 2) to staleBranches[]. CONTINUE to the ` +
      `next candidate.\n` +
      `  3b. OVERFLOW (ADR-016 cause #2): \`git diff --name-only <merge-base>..<branch>\` vs ` +
      `declared file(s) from the wave task list. Extra files (changed but not declared):\n` +
      `    - Any extra file claimed by ANOTHER wave task → COLLISION: do NOT cherry-pick, ` +
      `PRESERVE branch — do NOT tear it down. Add \`{branch,taskId}\` to conflicts[], return ` +
      `integrated=false, CONTINUE to the next candidate.\n` +
      `    - All extra files unclaimed by any wave peer → cherry-pick AND add ` +
      `\`{branch,taskId,extraFiles}\` to advisories[] (⚠ advisory; do NOT reject — the phase-04 ` +
      `t14 hooksPath fix was legitimate out-of-file work).\n` +
      `    - No extra files → proceed to cherry-pick.\n` +
      `  3c. CHERRY-PICK: \`git cherry-pick <range>\`. On ANY conflict: run ` +
      `\`git cherry-pick --abort\`, verify \`git status\` shows a clean working tree ` +
      `(nothing to commit) before continuing. PRESERVE that branch and its worktree — ` +
      `do NOT run \`git worktree remove\` or \`git branch -D\` on a conflicting branch. ` +
      `Add it to conflicts[] with the taskId from step 2 (or null if step 2 could not map it). ` +
      `Return integrated=false, CONTINUE to the next candidate.\n` +
      `4. TEARDOWN — BOUNDED: run \`git worktree remove --force <path>\`, \`git branch -D <branch>\`, ` +
      `\`git worktree prune\` ONLY on a branch YOU cherry-picked cleanly in THIS run (non-stale, ` +
      `non-collision, conflict-free). NEVER on a preserved/stale/conflicted branch and NEVER on a ` +
      `pre-existing branch you did not pick this run. Add every branch you tear down to ` +
      `tornDown[] — and tornDown[] must contain NOTHING else. The script cross-checks tornDown[] ` +
      `against the branches you report cleanly integrated as pure data and fails the wave loudly ` +
      `on any mismatch (ADR-008: it still runs no git).\n` +
      `5. Confirm: \`git log --oneline -n 20\`.\n` +
      `Return integrated=true with branches[] merged, tornDown[] listing exactly what you ` +
      `deleted (empty/omitted if nothing was cleanly picked this run), and advisories[] for any ` +
      `⚠ overflow; or integrated=false with conflicts[]/staleBranches[] (each: {branch,taskId}) ` +
      `and a note.` +
      OBEY,
    // Phase-14 t2 (ADR-027 decision 7): a FLOOR, not the usual "unset = inherit the
    // session model" every other role gets — inheriting here would run the integrator
    // at the session tier (opus) for every project predating this key, the exact
    // opposite of the goal.  Mirrors leanExecutionEnabled's default-on reasoning.  An
    // explicit `ac config set models.integrator sonnet` (or a profile) still wins.
    { label: `integrate:w${w + 1}`, phase: 'Execute', agentType: 'astro-executor', model: models.integrator || 'haiku', schema: INTEGRATE_SCHEMA },
  )

// ── Phase-13 (ADR-026): warm batched sequential executor primitives ────────────
//
// BATCH_SCHEMA pins the batch call's return to the ONE field the recovery path is
// load-bearing on: `committed` (the ids the batch executor actually landed a
// stamped commit for). additionalProperties:false at every level is the canon
// invariant (CONVENTIONS.md). `summary` is narration-only and left OPTIONAL —
// mirrors TEARDOWN_SCHEMA/TESTGATE_SCHEMA, which likewise avoid a hollow required
// field with no enforceable content; forcing `summary` would only make the agent
// invent prose on an all-landed batch. `committed` IS required (even though it
// may legitimately be `[]`) so a batch that returns nothing still yields a valid,
// parseable array the caller can Set-diff — never an omitted field the caller
// would have to null-guard twice.
const BATCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    committed: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['committed'],
}

/**
 * Compute the subset of an ordered batch task list that a batch executor call
 * did NOT report as committed — the set-diff recovery input for the per-task
 * fallback (ADR-026 partial-failure = per-task fallback).
 *
 * WHY SET-BASED, NOT POSITIONAL (unlike missingFromWave's index-aligned
 * `results[i]` above): missingFromWave's `results` is the POSITIONAL parallel()
 * return — one slot per wave task in dispatch order, so index alignment is exact
 * and cheap. A batch call instead returns ONE object for N tasks; the agent may
 * report `committed` in any order, with the mechanically-derived stamp-grep ids
 * in whatever sequence it ran the greps. Treating `committed` as position-aligned
 * here would silently misattribute or drop correctly-landed tasks — the wrong
 * data structure carried over from the wrong code path. Set membership is
 * order-independent and dedup-safe by construction, so it is the only correct
 * comparison for this shape.
 *
 * NULL-SAFETY (caller contract): the caller wraps the batch's `committed` as
 * `(out && out.committed) || []` before calling this, so a failed/null batch
 * return (schema validation failure, isolation hole) yields an EMPTY committed
 * set here — every task in `orderedTasks` then counts as missing and the
 * per-task fallback re-runs the whole batch rather than silently losing work
 * (mirrors missingFromWave's HOLE-not-exception contract above).
 *
 * @param {Array<{id:string}>} orderedTasks  the tasks handed to the batch call, in order
 * @param {Array<string>} committed          the ids the batch executor reported landed
 * @returns {Array<object>} the subset of orderedTasks whose id is absent from committed
 */
function missingFromBatch(orderedTasks, committed) {
  const c = new Set(committed)
  return orderedTasks.filter((t) => !c.has(t.id))
}

// batchPrompt is the FOURTH executor prompt (sibling to execPrompt/healPrompt/
// remediatePrompt) — and the only one that drives ONE astro-executor call over
// MULTIPLE tasks instead of one call per task. It differs from execPrompt in
// exactly three ways: (1) it opens with an emphatic MULTI-TASK-BATCH override of
// the astro-executor persona's "exactly ONE task" framing (agents/astro-executor.md)
// — without this override a warm executor would stop after task 1, believing it
// had fulfilled its mandate; (2) it inlines the FULL ordered task list as a
// trimmed JSON scalar (mirroring integrateWave's wave.map(...) inlining above) so
// the executor sees every task and its dependency order in ONE prompt; (3) it
// tells the executor to derive `committed` MECHANICALLY — the same stamp-grep
// idiom the Discover prompt uses (line ~111) — rather than trusting its own
// belief about what landed, so a batch that silently died mid-run (e.g. on task 3
// of 4) still reports an honest partial `committed` the recovery path
// (missingFromBatch) can act on. Everything else — test-first, the ADR-018
// dynamic-import guidance, touch-only-declared-files, the per-task
// `(phase <NN> <taskId>)` stamp, DO NOT squash — is execPrompt's per-task contract
// reused VERBATIM, because the ADR-017 resumability guarantee must hold
// identically whether a task ran solo or inside a batch.
const batchPrompt = (orderedTasks) =>
  `MULTI-TASK BATCH — implement ALL tasks below in dependency order, ONE commit per task; ` +
  `do not stop after the first. Your default persona says you implement "exactly ONE task" — ` +
  `that does NOT apply to this run: you must work through the ENTIRE ordered list below.\n\n` +
  `Phase ${phaseSlug} in project ${root}. Ordered task list (dependency order — implement in ` +
  `THIS order):\n` +
  `${JSON.stringify(orderedTasks.map((t) => ({ id: t.id, title: t.title, file: t.file, depends_on: t.depends_on })))}\n\n` +
  `For EACH task above, in the order listed:\n` +
  `- Plan/task file: ${root}/.astrocode/phases/${phaseSlug}/PLAN.md (or the task's own \`file\` if set).\n` +
  `- Make the change test-first where it adds behavior, run the tests, and make ONE atomic ` +
  `commit with a clear message scoped to ONLY that task. Match the project canon exactly ` +
  `(stack, naming, patterns). touch ONLY that task's declared file(s); if other changes are ` +
  `genuinely required, say so in your summary.\n` +
  `- If a task is a RED-test task whose import would crash at module load because the export ` +
  `does not exist yet, use the dynamic-import pattern (\`await import(...)\` inside async test ` +
  `bodies) — do NOT implement the missing export; that is a later task's job (ADR-018).\n` +
  `- End that task's commit subject with the stamp \`(phase ${phaseNum} <taskId>)\` (replace ` +
  `<taskId> with the task's own id) — this enables idempotent re-execution (ADR-017).\n` +
  `- DO NOT squash tasks into one commit — each task gets its OWN atomic commit, in order, so ` +
  `a re-run can detect exactly which tasks landed.\n\n` +
  `After implementing every task, derive \`committed\` MECHANICALLY — do NOT rely on your own ` +
  `belief about what landed. For EACH task id, run:\n` +
  `  git log --oneline --fixed-strings --grep "(phase ${phaseNum} <taskId>)"\n` +
  `If it returns at least one line, that task id belongs in committed[]; otherwise omit it. ` +
  `Return committed=[the task ids whose stamp you found] and a short summary.` +
  OBEY

// runBatchOnBranch — a single agent() call carrying the WHOLE ordered task list
// (matching the shape of every other run* wrapper above). Deliberately NO
// isolation:'worktree' — the batch is a single serial writer directly on the
// current branch (ADR-005/008), the same on-branch contract as
// runOnBranch/runHealOnBranch; batching only ever fires in the sequential
// strategy, where isolation buys nothing and only adds a worktree-creation
// failure mode for no benefit.
const runBatchOnBranch = (orderedTasks) =>
  agent(batchPrompt(orderedTasks), {
    label: 'exec:batch',
    phase: 'Execute',
    agentType: 'astro-executor',
    model: models.executor,
    schema: BATCH_SCHEMA,
  })

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
// Adaptive worktree downgrade: once a parallel wave shows the MAJORITY of its
// executors failing to get a worktree (the lock-race signature — partial success,
// not a hard error), the environment is worktree-hostile.  This latch flips the
// wave-loop guard so every REMAINING wave runs on-branch sequentially — the user
// eats the failure noise ONCE, not on every wave.  Correctness is preserved either
// way (on-branch is always valid); only intra-wave parallelism is given up.
let worktreesUnavailable = false
// Phase-07 / ADR-017: all-done short-circuit — when every task is already stamped
// on the branch, executableTasks is empty and waves is empty; the loop below is a
// no-op.  The Verify phase still runs (CONTEXT.md: "a phase may have executed fully
// but failed verification — verify must still run").  We log a narration so the user
// sees why no execution happened rather than an unexplained gap in the log.
// We do NOT early-return here — Verify must execute regardless (never early-return
// before the Verify phase per the phase-07 spec).
if (executableTasks.length === 0 && tasks.length) {
  log(`⊡ all ${tasks.length} task(s) already stamped on branch — skipping Execute, going straight to Verify`)
}

// Phase-13 (ADR-026): the lean/batched opt-out, read straight off `input` (no destructure,
// mirroring `useWorktrees` above) — `execMode:'per-task'` is the explicit-override-wins idiom
// (like `input.strategy`); the `!== false` default keeps callers that never pass `leanExecution`
// (older commands, or a project predating the config key) on the fast batched path.
const leanExecution = input.execMode === 'per-task' ? false : input.leanExecution !== false
// Batching only pays off when there is no worktree isolation to lose (sequential strategy)
// AND at least 2 executable tasks (a lone task gets zero benefit — runOnBranch is already
// one call) AND the opt-out did not fire.  waves.flat() is already a valid, dependency-
// respecting order (buildWaves' Kahn layering already produced it) — no new ordering logic
// is needed, just flatten the waves the existing builder already built.
const leanBatch = strategy === 'sequential' && executableTasks.length >= 2 && leanExecution
if (leanBatch) {
  log(`• lean batch: ONE warm executor over ${executableTasks.length} task(s) in dependency order (ADR-026)`)
  const ordered = waves.flat()
  const out = await runBatchOnBranch(ordered)
  const committed = (out && out.committed) || []
  // One results entry PER COMMITTED TASK — not one entry for the whole batch call — so
  // `results.length` (the "tasks executed" count in the return literal below) stays
  // consistent with every other path, where each entry already corresponds to one task.
  for (const id of committed) results.push({ id, batch: true })
  // Partial-failure = per-task fallback (ADR-026 decision 2): re-run EXACTLY the ids the
  // batch did not report as committed via the existing runOnBranch(t) — conceptually
  // mirrors missingFromWave's recovery above, but is NOT literal reuse: a batch call
  // returns one object for N tasks, not a positional per-task result.
  const missing = missingFromBatch(ordered, committed)
  if (missing.length) {
    log(
      `⚠ batch executor committed ${committed.length}/${ordered.length} task(s) — ` +
        `re-running the missing ${missing.length} on-branch: ${missing.map((t) => t.id).join(', ')}`,
    )
    for (const t of missing) {
      const r2 = await runOnBranch(t)
      if (r2) results.push(r2)
    }
  }
}
// leanBatch already handled every executable task above via ONE warm call (+ per-task
// recovery for anything it missed) — skip the wave loop entirely rather than re-running
// runOnBranch(t) a second time for tasks the batch already stamped.  The loop body itself
// stays byte-for-byte untouched (surgical): the worktree-hostile downgrade path and the
// parallel+integrator path are unaffected, they simply never run when leanBatch is true.
for (let w = 0; w < waves.length && !integrationFailed && !leanBatch; w++) {
  const wave = waves[w]
  log(`wave ${w + 1}/${waves.length}: ${wave.map((t) => t.id).join(', ')}`)
  // A, or a single-task wave (nothing to parallelize), or worktrees proven
  // unavailable this run: commit straight on the branch.
  if (strategy === 'sequential' || wave.length === 1 || worktreesUnavailable) {
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
    // Adaptive downgrade: a MAJORITY worktree-failure means the harness can't
    // reliably create worktrees here (lock-race under width) — not a one-off
    // flake.  Latch on so the rest of the run goes straight on-branch and the
    // user stops seeing the failure noise wave after wave.  A lone transient
    // failure (minority) does NOT trip this — that task just re-ran above.
    if (!worktreesUnavailable && missing.length * 2 >= wave.length) {
      worktreesUnavailable = true
      log(
        `⚠ worktree isolation unreliable here (${missing.length}/${wave.length} failed) — ` +
          `running all remaining waves sequentially on-branch`,
      )
    }
  }
  const integ = await integrateWave(w, wave)

  // ── Phase-14 t2 (ADR-027 decision 2): tornDown bound — pure data, no git ──
  //
  // The integrator may destructively remove ONLY a branch it cherry-picked cleanly
  // in THIS run. The script cannot see git (ADR-008) — its only enforcement is
  // comparing the agent's own claims: tornDown[] must be a subset of the CLEANLY-
  // integrated set, i.e. branches[] minus anything ALSO reported as a conflict or
  // stale. Checked against that derived set (not raw branches[]) so a self-
  // contradictory return — a branch listed in both branches[] and conflicts[] and
  // then torn down — is still caught, the same defensiveness as the existing
  // "keyed on the LISTS, not the flag" comment below. Run BEFORE the advisory/heal
  // handling so an out-of-bounds claim never reaches heal or the test gate.
  const conflictSet = new Set([
    ...(((integ && integ.conflicts) || []).map((c) => c.branch)),
    ...(((integ && integ.staleBranches) || []).map((s) => s.branch)),
  ])
  const cleanBranches = ((integ && integ.branches) || []).filter((b) => !conflictSet.has(b))
  const badTeardown = ((integ && integ.tornDown) || []).filter((b) => !cleanBranches.includes(b))
  if (badTeardown.length) {
    log(
      `✖ wave ${w + 1} teardown out of bounds: \`${badTeardown.join('`, `')}\`` +
        ` reported torn down but not confirmed cleanly integrated this run`,
    )
    // Same shape as the two existing integrationFailed assignments below (taskId
    // is unknown here — this is a script-level contract violation, not a specific
    // task's heal failure) so the FAIL formatter further down keeps working.
    integrationFailed = {
      wave: w + 1,
      taskId: null,
      branch: badTeardown[0],
      note:
        `integrator reported tornDown=[${badTeardown.join(', ')}] without confirming a clean ` +
        `pick this run — the delete already happened agent-side (the script runs no git, ` +
        `ADR-008); the ref may still be recoverable via \`git reflog\` / dangling commits before GC`,
    }
    continue
  }

  // ── Self-healing ladder (ADR-014 + CONTEXT.md phase-05/06) ───────────────
  //
  // The phase-04 wave-2 incident: git auto-merged stacked duplicate helper
  // copies with NO conflict marker — textual success ≠ correct code.  The old
  // `integrated !== true → integrationFailed` branch silently accepted that bad
  // merge.  ADR-014 mandates: on ANY cherry-pick conflict, DROP the offending
  // worktree-* branch (the integrator preserves it, never tears it down) and
  // RE-RUN the task sequentially at the integrated tip.  A fresh re-run at the
  // current HEAD cannot produce stale/duplicated code by construction.
  //
  // Phase-06 extension (ADR-015 cause #1 stale base; ADR-016 cause #2 overflow):
  //   - staleBranches (merge-base ≠ HEAD) are folded into the heal list alongside
  //     conflicts — same ladder, no fork (ADR-014/015).
  //   - advisories (harmless overflow — unclaimed extra files) are integrated but
  //     logged with a ⚠ and set overflowFlagged so the test gate still fires.
  //
  // ADR-008 invariant: re-runs are sequential on-branch (no parallel-without-
  // isolation).  The integrator remains the sole git actor; the script only
  // drives agent calls.

  // Per-wave state — declared here (not at phase scope) so a clean later wave
  // never inherits state from an anomalous earlier one.
  let ladderFired = false
  let overflowFlagged = false
  const healedBranches = [] // preserved branches whose task healed — torn down post-gate

  // ── Phase-06 t5: log ⚠ advisories (harmless overflow, ADR-016 cause #2) ──
  //
  // An advisory means the branch overflowed into files no OTHER wave task claims
  // — it integrated successfully, but the deviation must be surfaced so the user
  // can judge whether it was intentional (the phase-04 t14 hooksPath fix was
  // legitimate; blanket rejection would throw away good work).  Still, ANY wave
  // that deviated from its contract must run the test gate before later waves
  // build on it (CONTEXT.md § "The test gate extends to anomalous waves").
  for (const advisory of (integ && integ.advisories) || []) {
    log(
      `⚠ wave ${w + 1} overflow advisory: branch \`${advisory.branch}\`` +
        (advisory.taskId ? ` (task ${advisory.taskId})` : '') +
        ` touched extra file(s): ${(advisory.extraFiles || []).join(', ')}` +
        ` — integrated with ⚠ (unclaimed overflow, ADR-016)`,
    )
    overflowFlagged = true
  }

  // Keyed on the LISTS, deliberately NOT on the integrated flag: a misbehaving
  // integrator could return integrated=true while still reporting stale/conflicted
  // branches (contradicting its prompt contract) — and silently ignoring those
  // lists would strand preserved branches until the end verifier flags them
  // (the phase-06 UAT finding). Lists present ⇒ heal, whatever the flag says.
  const needsHeal =
    integ &&
    (
      (integ.conflicts && integ.conflicts.length) ||
      (integ.staleBranches && integ.staleBranches.length)
    )

  if (needsHeal) {
    // Log every preserved/stale branch immediately so no work is silently lost.
    for (const conflict of integ.conflicts || []) {
      log(
        `• wave ${w + 1} conflict: preserved branch \`${conflict.branch}\`` +
          (conflict.taskId ? ` (task ${conflict.taskId})` : ' (branch→task mapping unknown)'),
      )
    }

    // Phase-06 t5 (ADR-015 cause #1 stale base): log stale branches routed to heal.
    // A stale branch forked from an old tip; even a textually clean cherry-pick can
    // stack duplicate helpers with no conflict marker (the phase-04 lesson).  The
    // integrator NEVER cherry-picks stale branches — they always route to heal.
    for (const stale of integ.staleBranches || []) {
      log(
        `• wave ${w + 1} stale fork-base: routing \`${stale.branch}\` to heal ladder` +
          (stale.taskId ? ` (task ${stale.taskId})` : ' (branch→task mapping unknown)') +
          ` — merge-base ≠ HEAD, a clean cherry-pick proves nothing (ADR-015)`,
      )
    }

    // Fold staleBranches into the same conflict-shaped list so resolveHealList
    // can treat them identically — same {branch, taskId} shape, same ladder,
    // no fork (ADR-014/015).  Both conflicts and staleBranches are always
    // routed to a fresh re-run at the integrated tip.
    const allHealItems = [
      ...(integ.conflicts || []),
      ...(integ.staleBranches || []),
    ]

    // Compute the precise set of tasks that need healing.  resolveHealList
    // (mirrored from lib/waves.mjs) maps each conflict object to the right task
    // (or falls back to every un-confirmed task when taskId is null) and returns
    // them in plan order.  We build integratedTaskIds from the branches the
    // integrator confirmed before the conflict stopped it.
    const integratedTaskIds = new Set(
      (integ.branches || [])
        .map((b) => {
          const hit = allHealItems.find((c) => c.branch === b)
          // If the integrator confirmed this branch without listing it as a
          // conflict/stale it's integrated — reverse-map via the wave task list.
          return hit ? null : wave.find((t) => t.id === b || b.includes(t.id))?.id
        })
        .filter(Boolean),
    )
    const healList = resolveHealList(wave, allHealItems, integratedTaskIds)
    // allHealItems = [...integ.conflicts, ...integ.staleBranches] — same shape.
    for (const t of healList) {
      // Find preserved branch — check conflicts then staleBranches ({branch,taskId}).
      const conflict =
        allHealItems.find((c) => c.taskId === t.id) ||
        allHealItems.find((c) => !c.taskId) // null-mapped fallback
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

  // ── Extended test gate (phase-06 t5 / CONTEXT.md § "extended gate") ─────
  //
  // Phase-05 shipped: gate fires only when ladderFired (heal ladder ran).
  // Phase-06 extension: gate also fires when overflowFlagged — any wave that
  // deviated from its contract (healed OR integrated-with-overflow-⚠) must
  // prove itself green before later waves build on it (CONTEXT.md § "The test
  // gate extends to anomalous waves").  Clean, contract-conforming waves
  // still skip the gate and stay fast.
  //
  // A failing suite is treated as an integration failure and stops the phase
  // loudly — this is the guard that would have caught the phase-04 wave-2 bad
  // merge before it poisoned later waves.  A project with NO suite is a third
  // outcome the gate reports separately (ADR-028) — see below.
  if ((ladderFired || overflowFlagged) && !integrationFailed) {
    const gate = await runTestSuite()
    // ADR-028 — three outcomes, not two. `ranSuite:false` means the project has no
    // suite to run: the gate can prove nothing, but it also has nothing to report,
    // so the wave proceeds UNPROVEN behind a loud advisory rather than aborting a
    // phase over tests that never existed. A suite that EXISTS and fails — including
    // a load/collect/compile error — still stops the phase exactly as before.
    //
    // The no-suite path deliberately joins the SAME branch as a green gate, because
    // that branch owns healed-branch teardown. Short-circuiting before it would
    // strand `worktree-*` branches and then false-FAIL the verifier's
    // `git rev-list HEAD..worktree-*` check — re-opening the phase-05 UAT gap.
    const noSuite = !!gate && gate.ranSuite === false
    if (!noSuite && (!gate || !gate.passed)) {
      integrationFailed = {
        wave: w + 1,
        taskId: null,
        branch: null,
        note:
          `test suite failed after healing wave ${w + 1}` +
          (gate?.output ? `: ${gate.output}` : ' (no output returned)') +
          `. If the suite failed to LOAD/COMPILE (a barrel or importer references a module ` +
          `this wave deleted), that is a non-compiling wave boundary — a destructive edit was ` +
          `split from the consumer fixups it forced (ADR-020). Fix the PLAN (fold the deletion ` +
          `and its barrel/import updates into one task), not the gate.`,
      }
      log(
        `✖ wave ${w + 1} test gate failed after heal — stopping before verify`,
      )
    } else {
      if (noSuite) {
        log(
          `⚠ wave ${w + 1} test gate SKIPPED — this project has no runnable test suite, so the ` +
            `healed wave is UNPROVEN (${healedTaskIds.length} task(s) healed). The end-of-phase ` +
            `verifier is the only remaining backstop for this wave.`,
        )
      } else {
        log(`✓ wave ${w + 1} test gate passed after heal (${healedTaskIds.length} task(s) healed)`)
      }
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
}

// ── Phase-10 (ADR-022): structured verify verdict + verify→remediate loop ──────
//
// VERIFY_SCHEMA pins the verifier's return to the shape the remediate loop needs:
// a per-criterion result keyed to the EXACT C<n> id from CRITERIA.md, plus — for each
// unmet criterion — the failing command and its output as evidence.  This is what lets
// the loop (a) SCOPE a remediation pass to ONLY the unmet criteria and carry the
// verifier's evidence (C7), and (b) COMPARE failing-criteria sets across cycles for the
// stop-on-no-progress bail (C6).  `criteriaFound` distinguishes a real CRITERIA.md from
// a self-derived bar: when it is false the loop degrades to single-pass (the shrink
// comparison would be undecidable without a stable id set).  additionalProperties:false
// at every level is a canon invariant (CONVENTIONS.md §State).
const VERIFY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passed: { type: 'boolean' },
    criteriaFound: { type: 'boolean' },
    summary: { type: 'string' },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          passed: { type: 'boolean' },
          command: { type: 'string' },
          output: { type: 'string' },
        },
        required: ['id', 'passed'],
      },
    },
  },
  required: ['passed', 'criteriaFound', 'summary'],
}

// REMEDIATE_SCHEMA forces the executor to report the `git rev-parse HEAD` it read
// BEFORE and AFTER its atomic commit.  The Workflow script cannot run git (ADR-005),
// so HEAD-moved is the only trustworthy no-progress signal it can obtain — an
// unchanged SHA means the pass committed nothing and the loop must bail rather than
// grind the same stuck approach (C6).  additionalProperties:false + required both
// heads means a silent empty return cannot read as "made progress".
const REMEDIATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    headBefore: { type: 'string' },
    headAfter: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['headBefore', 'headAfter'],
}

phase('Verify')
let verdict
let remediationCycles = 0
let stoppedReason = 'passed'
if (integrationFailed) {
  // Don't verify a tree the work never reached (phase-04 wave-2 lesson). The richer
  // integrationFailed shape (taskId + branch) is wrapped into the SAME structured
  // verdict object the goal path yields, so the return stays one shape (Phase-10).
  const failDetail = integrationFailed.taskId
    ? `task ${integrationFailed.taskId} on \`${integrationFailed.branch}\``
    : (integrationFailed.branch ? `branch \`${integrationFailed.branch}\`` : 'no branch preserved')
  const summary =
    `FAIL — wave ${integrationFailed.wave} did not integrate onto the working branch ` +
    `(${failDetail}; ${integrationFailed.note}). ` +
    `Executor commits may remain on \`worktree-*\` branches — resolve the conflict and re-run before verifying.`
  verdict = { passed: false, criteriaFound: false, summary, criteria: [] }
  stoppedReason = 'integration-failed'
  log('skipped goal verification — integration failed')
}

// runVerify — the ADR-021 adversarial, plan-blind goal verification, now returning the
// structured VERIFY_SCHEMA verdict so ONE call serves the first verify AND every
// re-verify in the loop (no forked verifier prompt).
const runVerify = () =>
  agent(
    `Verify phase "${phaseSlug}" of the project at ${root}. The work is committed on the ` +
      `CURRENT branch — verify against HEAD/the working tree, NOT a fresh checkout of main.\n\n` +
      `Your job is to PROVE THE WORK IS WRONG. A false PASS is the costliest error — assume the ` +
      `work is broken until you have run the evidence yourself.\n\n` +
      `Check ONLY against: the phase goal, and ${root}/.astrocode/phases/${phaseSlug}/CRITERIA.md ` +
      `(the pre-registered, goal-derived bar). Do NOT read PLAN.md or SPEC.md; do NOT trust task ` +
      `summaries, commit messages, or executor claims; do NOT broad-grep the phase directory (you ` +
      `might incidentally read the plan). If CRITERIA.md is ABSENT, SELF-DERIVE goal criteria from ` +
      `the goal yourself and SAY SO — open the verdict with a provenance line ("CRITERIA.md found ` +
      `(N criteria)" or "CRITERIA.md absent — self-derived N criteria from the goal"); never silently ` +
      `skip the bar, never trust the plan.\n\n` +
      `For EACH criterion, ASSUME IT FAILS until you have independently observed it pass: run its ` +
      `Observe: command / drive the behavior end-to-end, and cite the exact command + its actual ` +
      `output as evidence; actively try its "Fails if:". A green suite is not evidence for a ` +
      `criterion unless it actually exercises that behavior.\n\n` +
      `Also confirm the phase's commits are present (\`git log --oneline\`) and that no \`worktree-*\` ` +
      `branch still holds un-integrated commits (\`git for-each-ref refs/heads/worktree-*\`, then ` +
      `\`git rev-list HEAD..<branch>\` must be empty). Run the full test suite. Flag any project-canon ` +
      `violation.\n\n` +
      `PASS only if EVERY criterion has independent passing evidence you gathered yourself AND the ` +
      `structural checks hold. Otherwise FAIL — name the unmet criterion, the command you ran, the ` +
      `output you saw, and what is needed to close it.\n\n` +
      `RETURN A STRUCTURED VERDICT: set passed=true only if EVERY criterion independently passed; ` +
      `set criteriaFound=true if CRITERIA.md was present (false if you self-derived the bar); put the ` +
      `human-facing FAIL text (unmet criterion, command, output, what closes it) in summary; and for ` +
      `EACH criterion add an item to criteria[] carrying its EXACT C<n> id (verbatim from CRITERIA.md — ` +
      `never re-worded), passed true/false, and for every FAILING criterion the exact failing command ` +
      `and its output as evidence (so the remediate loop can scope + compare the failing set).` +
      OBEY,
    { phase: 'Verify', agentType: 'astro-verifier', model: models.verifier, schema: VERIFY_SCHEMA },
  )

// remediatePrompt is the THIRD executor prompt (sibling to execPrompt/healPrompt): a
// remediation pass scoped to ONLY the unmet criteria, carrying the verifier's evidence
// VERBATIM (the exact failing command + its output) so the executor attacks the real gap,
// plan-blind (C7).  It reuses the EXISTING astro-executor — no new agent type (ADR-022).
// It forbids reading PLAN.md/SPEC.md and re-attacking passing criteria, and instructs the
// executor to report HEAD before/after its ONE atomic commit (the no-progress signal, C6).
const remediatePrompt = (unmet, cycle) =>
  `REMEDIATION PASS (cycle ${cycle + 1}) — phase ${phaseSlug} in project ${root}.\n` +
  `The adversarial, plan-blind verifier FAILED this phase against its goal-derived CRITERIA.md. ` +
  `Close ONLY the unmet criteria listed below — do NOT touch, re-attack, or "improve" any criterion ` +
  `that is not listed here (they already pass; changing them risks regressing them):\n` +
  unmet
    .map(
      (c) =>
        `- ${c.id}` +
        (c.command ? `\n    failing command: ${c.command}` : '') +
        (c.output ? `\n    observed output: ${c.output}` : ''),
    )
    .join('\n') +
  `\n\n` +
  `Stay plan-blind (ADR-021): do NOT read PLAN.md or SPEC.md, and do NOT widen scope beyond the ` +
  `criteria above. First run \`git rev-parse HEAD\` and report it as headBefore. Fix the gap ` +
  `test-first where it adds behavior, run the tests, then make ONE atomic commit whose subject ends ` +
  `with the stamp \`(phase ${phaseNum} remediate-c${cycle})\` (ADR-017 idempotency). After committing, ` +
  `run \`git rev-parse HEAD\` again and report it as headAfter. Match the project canon exactly ` +
  `(stack, naming, patterns). Return headBefore, headAfter, and a short summary of what you changed.` +
  OBEY

const runRemediation = (unmet, cycle) =>
  agent(remediatePrompt(unmet, cycle), {
    label: `remediate:c${cycle}`,
    phase: 'Execute',
    agentType: 'astro-executor',
    model: models.executor,
    schema: REMEDIATE_SCHEMA,
  })

if (!integrationFailed) {
  // ADR-021 — adversarial, plan-blind verification (runVerify, defined above).
  // Phase-10 (ADR-022): the FIRST verify, then the bounded verify→remediate loop.
  verdict = await runVerify()

  // Automated verify→remediate loop.  Fire ONLY when the first verify FAILED against a
  // REAL CRITERIA.md (criteriaFound) and the level's budget is > 0 — light (0 cycles)
  // and an absent CRITERIA.md both degrade to today's single-pass behavior, keeping the
  // shrink-comparison decidable (a self-derived bar has no stable id set to compare).
  if (!verdict.passed && verdict.criteriaFound && maxCycles > 0) {
    for (let cycle = 0; cycle < maxCycles && !verdict.passed; cycle++) {
      const unmet = (verdict.criteria || []).filter((c) => !c.passed)
      const beforeIds = new Set(unmet.map((c) => c.id))
      log(
        `• remediation cycle ${cycle + 1}/${maxCycles}: ${beforeIds.size} unmet criterion/criteria` +
          (beforeIds.size ? ` (${[...beforeIds].join(', ')})` : ''),
      )
      const rem = await runRemediation(unmet, cycle)
      remediationCycles++

      // STOP-ON-NO-PROGRESS #1 (checked BEFORE consuming more budget, C6): the pass
      // committed nothing — HEAD did not move (or the executor returned no heads at
      // all). Grinding a stuck approach only burns quota, so bail to a human FAIL even
      // with budget remaining. verdict.passed stays false — NEVER `verified`.
      const headMoved = rem && rem.headAfter && rem.headBefore && rem.headAfter !== rem.headBefore
      if (!headMoved) {
        stoppedReason = 'no-progress'
        log(`✖ remediation cycle ${cycle + 1} made no commit (HEAD unchanged) — bailing to human FAIL`)
        break
      }

      // Re-verify with the SAME adversarial, schema'd verifier (no forked prompt).
      verdict = await runVerify()
      if (verdict.passed) {
        log(`✓ remediation cycle ${cycle + 1} closed the phase — verified`)
        break
      }

      // STOP-ON-NO-PROGRESS #2 (C6): the failing-criteria set did not STRICTLY shrink.
      // A plain cardinality comparison is deliberate — a cycle that fixes one criterion
      // but incidentally breaks a different one is net-no-progress and bails (safe over
      // fast). Fires even with budget remaining; keeps verdict.passed=false.
      const afterIds = new Set((verdict.criteria || []).filter((c) => !c.passed).map((c) => c.id))
      if (afterIds.size >= beforeIds.size) {
        stoppedReason = 'no-progress'
        log(
          `✖ remediation cycle ${cycle + 1}: failing-criteria set did not shrink ` +
            `(${beforeIds.size} → ${afterIds.size}) — bailing to human FAIL`,
        )
        break
      }
      log(
        `⚠ remediation cycle ${cycle + 1}: ${afterIds.size} criterion/criteria still failing ` +
          `(was ${beforeIds.size}) — continuing`,
      )
    }
    // If the loop exhausted its budget still-failing (and did not bail on no-progress),
    // that is `max-cycles`. verdict.passed remains false; the command surfaces it.
    if (!verdict.passed && stoppedReason !== 'no-progress') stoppedReason = 'max-cycles'
  }
  // A pass on the very first verify (loop never ran) leaves stoppedReason at its
  // 'passed' default; be explicit for any pass so the report is unambiguous. A single-pass
  // FAIL (light, or an absent/self-derived CRITERIA.md — the loop never fired) must NOT keep
  // the 'passed' default: relabel it honestly so telemetry never reads 'passed' on a failure.
  if (verdict.passed) stoppedReason = 'passed'
  else if (stoppedReason === 'passed') stoppedReason = 'single-pass'
}

// verdict is now the structured object; verdict.summary / verdict.passed are what the
// commands read. effort/remediationCycles/stoppedReason are additive (Phase-10 t4).
// The loop's best self-produced status is `verified` — it never sets complete/accepts
// (REQ-006 two-gate closure stays intact, C9).
return {
  phase: phaseSlug,
  tasks: tasks.length,
  waves: waves.length,
  strategy,
  effort,
  executed: results.length,
  skipped: skippedTaskIds,
  healed: healedTaskIds,
  remediationCycles,
  stoppedReason,
  integrationFailed,
  verdict,
}
