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
// folds a wave's isolated worktree commits onto the working branch and tears the
// worktrees down so the next wave forks from the integrated tip.
const integrateWave = (w) =>
  agent(
    `You are the WAVE INTEGRATOR for phase ${phaseSlug}, running in the MAIN working tree of ${root} ` +
      `(you have NO worktree of your own). The parallel executors for wave ${w + 1} each committed on a ` +
      `separate \`worktree-*\` branch forked from the current HEAD. Fold them onto the CURRENTLY ` +
      `checked-out branch so the next wave and the verifier see one combined tree. Do exactly this, in ${root}:\n` +
      `1. List candidates: \`git for-each-ref --format='%(refname:short)' refs/heads/ | grep '^worktree-'\`. ` +
      `Keep only branches with commits not yet on HEAD (\`git rev-list HEAD..<branch>\` non-empty).\n` +
      `2. Wave tasks are independent, so order does not matter. Cherry-pick each such branch's commits onto ` +
      `the current branch (\`git cherry-pick <range>\`). On ANY conflict: \`git cherry-pick --abort\`, stop, ` +
      `and return integrated=false with the conflicting branch in conflicts[] — do NOT force or hand-resolve.\n` +
      `3. After a clean integration, tear down each merged worktree so it is not reprocessed: ` +
      `\`git worktree remove --force <path>\` (paths from \`git worktree list\`), \`git branch -D <branch>\`, ` +
      `then \`git worktree prune\`.\n` +
      `4. Confirm the current branch now contains every integrated commit (\`git log --oneline -n 20\`).\n` +
      `Return integrated=true with the branches[] you merged, or integrated=false with conflicts[] and a note.` +
      OBEY,
    { label: `integrate:w${w + 1}`, phase: 'Execute', agentType: 'astro-executor', model: models.executor, schema: INTEGRATE_SCHEMA },
  )

phase('Execute')
const results = []
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
  const integ = await integrateWave(w)
  if (!integ || integ.integrated !== true) {
    integrationFailed = {
      wave: w + 1,
      conflicts: integ?.conflicts || [],
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
  verdict =
    `FAIL — wave ${integrationFailed.wave} did not integrate onto the working branch ` +
    `(conflicts: ${integrationFailed.conflicts.join(', ') || 'see note'}; ${integrationFailed.note}). ` +
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

return { phase: phaseSlug, tasks: tasks.length, waves: waves.length, strategy, executed: results.length, integrationFailed, verdict }
