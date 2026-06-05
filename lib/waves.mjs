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
