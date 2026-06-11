// astro-code · wave-conflict heal list resolver.
//
// WHY THIS MODULE EXISTS — the phase-04 wave-2 trap:
//   During phase 04 the integrator ran cherry-pick against a stale tip.  Git
//   auto-merged stacked duplicate helper copies with *no conflict marker*, so
//   the tree looked clean and tests passed — but the code was semantically
//   broken.  That failure mode is exactly why ADR-014 mandates:
//
//     drop-and-rerun at the integrated tip — NEVER rebase.
//
//   Re-running the task sequentially on-branch at the current integrated tip is
//   always semantically fresh and cannot produce that phantom-merge class of
//   bug.  This module resolves *which* tasks need that re-run.
//
// ADR-014: Wave-conflict healing is drop-and-rerun at the integrated tip — never rebase.
//
// The integrator reports conflicts as objects { branch, taskId } where taskId
// is nullable.  A null taskId means the integrator could not confidently map
// the conflicting branch to a single task (commit message + changed files were
// ambiguous).  In that case, every task the integrator did NOT confirm as
// successfully integrated must be re-run — better to repeat safe work than to
// leave a stale, possibly-phantom-merged task in the tree.

/**
 * Given a wave's task list, the integrator's conflict objects, and the set of
 * branches the integrator confirmed as integrated, return the ordered
 * (plan/wave order) list of tasks that must be re-run on-branch at the
 * integrated tip.
 *
 * Rules (ref ADR-014 + CONTEXT.md § "Branch→task mapping"):
 *   1. A conflict whose taskId is non-null → add that task (if it exists in
 *      the wave; silently ignore phantom ids from a confused integrator).
 *   2. A conflict whose taskId is null → add every wave task NOT in
 *      integratedBranches (the set of task-ids the integrator explicitly
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
 * @param {Set<string>} integratedBranches
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
export function resolveHealList(wave, conflicts, integratedBranches, branchForTask) {
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
        if (!integratedBranches.has(t.id)) {
          toRerun.add(t.id);
        }
      }
    }
  }

  // Return the matching tasks in the original wave (plan) order.  Filtering
  // the wave array (rather than iterating toRerun) is what guarantees this.
  return wave.filter((t) => toRerun.has(t.id));
}
