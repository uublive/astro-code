// astro-code · pure wave layering algorithm.
//
// Extracted from workflows/execute-phase.mjs so it can be unit-tested.  The
// Workflow-tool sandbox has no filesystem/import access, meaning the workflow
// can't import from lib/.  To keep both sides honest, the workflow carries a
// byte-synced MIRROR of this file's core functions; a drift-guard test in
// tests/workflows.test.mjs enforces that the two copies never diverge.
//
// Why this module exists at all: the Kahn + file-disjointness layering is the
// safety net that prevents same-file collisions in parallel worktree execution
// (ADR-005).  Testing it required a pure, importable home — hence this lift.

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
export function claimedFiles(task) {
  const raw = (task.file || '').trim();
  if (!raw) return new Set(['*']);
  return new Set(raw.split(/[\s,;]+/).filter(Boolean));
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
export function filesCollide(a, b) {
  return a.has('*') || b.has('*') || [...a].some((f) => b.has(f));
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
export function buildWaves(tasks) {
  const completed = new Set();
  const waves = [];
  let deferredForFiles = 0;
  let remaining = tasks.slice();

  while (remaining.length) {
    const ready = remaining.filter((t) => t.depends_on.every((d) => completed.has(d)));
    if (!ready.length) {
      // Dependency cycle or a depends_on referencing an id that does not exist
      // in this task list.  Running the remainder together is wrong in the
      // general case but it terminates and doesn't lose tasks, which beats an
      // infinite loop or a hard error that leaves the phase stuck.
      waves.push(remaining);
      break;
    }

    // Greedy file-disjoint admission into this wave.
    const wave = [];
    const waveFiles = new Set();
    for (const t of ready) {
      const tf = claimedFiles(t);
      if (wave.length && filesCollide(tf, waveFiles)) {
        // File collision with something already admitted this wave — defer to
        // the next iteration.  deps remain satisfied; t will be first-in-line.
        deferredForFiles++;
        continue;
      }
      wave.push(t);
      tf.forEach((f) => waveFiles.add(f));
    }

    waves.push(wave);
    wave.forEach((t) => completed.add(t.id));
    remaining = remaining.filter((t) => !wave.includes(t));
  }

  return { waves, deferredForFiles };
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
export function missingFromWave(wave, results) {
  return wave.filter((_, i) => !results[i]);
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
export function resolveHealList(wave, conflicts, integratedTaskIds, branchForTask) {
  // Build a fast id→task index; preserves nothing about order (we re-sort at
  // the end against the original wave array to guarantee plan order).
  const waveById = new Map(wave.map((t) => [t.id, t]));

  // Collect the set of task ids that need re-running (dedup via Set).
  const toRerun = new Set();

  for (const conflict of conflicts) {
    if (conflict.taskId !== null && conflict.taskId !== undefined) {
      // Mapped conflict: the integrator is confident this branch belongs to
      // exactly one task.  Add it if it exists in this wave.
      if (waveById.has(conflict.taskId)) {
        toRerun.add(conflict.taskId);
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
          toRerun.add(t.id);
        }
      }
    }
  }

  // Return the matching tasks in the original wave (plan) order.  Filtering
  // the wave array (rather than iterating toRerun) is what guarantees this.
  return wave.filter((t) => toRerun.has(t.id));
}
