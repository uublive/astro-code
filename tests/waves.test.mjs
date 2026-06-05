// Unit tests for the pure wave-layering algorithm in lib/waves.mjs.
//
// These tests lock in the Kahn + file-disjointness correctness so a future
// change to the layering logic cannot silently break same-file collision
// avoidance.  Every assertion maps directly to a named requirement from the
// Phase 01 plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWaves, missingFromWave } from '../lib/waves.mjs';

// ── helper: flatten waves → ordered task-id list ──────────────────────────
function ids(waves) {
  return waves.map((w) => w.map((t) => t.id));
}

// ── 1. Independent disjoint-file tasks share one wave (parallel-safe) ─────
test('independent tasks with distinct files land in the same wave', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: [] },
    { id: 't3', file: 'lib/c.mjs', depends_on: [] },
  ];
  const { waves, deferredForFiles } = buildWaves(tasks);
  assert.equal(waves.length, 1, 'all three tasks should share a single wave');
  assert.equal(waves[0].length, 3, 'wave must contain all three tasks');
  assert.equal(deferredForFiles, 0, 'no file collisions means nothing was deferred');
});

// ── 2. Two tasks on the same file with no depends_on are never co-scheduled ─
test('two tasks that claim the same file are split across separate waves', () => {
  const tasks = [
    { id: 't1', file: 'lib/shared.mjs', depends_on: [] },
    { id: 't2', file: 'lib/shared.mjs', depends_on: [] },
  ];
  const { waves, deferredForFiles } = buildWaves(tasks);
  assert.ok(waves.length >= 2, 'same-file tasks must be split into at least two waves');
  // Neither wave should contain both tasks
  for (const wave of waves) {
    assert.ok(
      wave.length < 2 || !wave.some((a) => a.id === 't1') || !wave.some((b) => b.id === 't2'),
      'same wave must not contain both t1 and t2',
    );
  }
  assert.ok(deferredForFiles > 0, 'deferredForFiles must be > 0 when a file collision forces a split');
});

// ── 3. A task with no `file` runs alone (wildcard), never beside another ──
test('a task with no declared file runs alone in its wave (wildcard safety)', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2',                    depends_on: [] }, // no file → wildcard
    { id: 't3', file: 'lib/b.mjs', depends_on: [] },
  ];
  const { waves } = buildWaves(tasks);
  // Find which wave t2 lands in and assert it is the sole occupant
  const waveWithT2 = waves.find((w) => w.some((t) => t.id === 't2'));
  assert.ok(waveWithT2, 't2 must appear in exactly one wave');
  assert.equal(
    waveWithT2.length,
    1,
    'the wave containing the no-file (wildcard) task must have only that task',
  );
});

// ── 4. depends_on ordering is respected ────────────────────────────────────
test('a dependent task never lands before its dependency', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
    { id: 't3', file: 'lib/c.mjs', depends_on: ['t2'] },
  ];
  const { waves } = buildWaves(tasks);
  const flat = ids(waves);
  const pos = (id) => flat.findIndex((w) => w.includes(id));
  assert.ok(pos('t1') < pos('t2'), 't1 must come before t2');
  assert.ok(pos('t2') < pos('t3'), 't2 must come before t3');
});

// ── 5. Cycle / unknown id falls back to one remainder wave (no infinite loop)
test('a dependency cycle causes the remaining tasks to be bundled and terminates', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: ['t2'] }, // cycle: t1↔t2
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
  ];
  // Must not hang; must return something that contains both tasks
  const { waves } = buildWaves(tasks);
  const allIds = waves.flat().map((t) => t.id);
  assert.ok(allIds.includes('t1'), 'cycle fallback must include t1');
  assert.ok(allIds.includes('t2'), 'cycle fallback must include t2');
});

test('a depends_on referencing an unknown id falls back without losing the task', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: ['t-nonexistent'] },
  ];
  const { waves } = buildWaves(tasks);
  const allIds = waves.flat().map((t) => t.id);
  assert.ok(allIds.includes('t1'), 'task with unknown dep must still appear in output');
});

// ── 6. Progress guarantee: every task lands in exactly one wave ────────────
test('every task appears in exactly one wave and topological order is valid', () => {
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
    { id: 't3', file: 'lib/a.mjs', depends_on: [] },  // same file as t1 → deferred
    { id: 't4', file: 'lib/c.mjs', depends_on: ['t2'] },
  ];
  const { waves } = buildWaves(tasks);

  // Each task ID must appear exactly once across all waves
  const allIds = waves.flat().map((t) => t.id);
  assert.equal(allIds.length, tasks.length, 'total tasks in waves must equal input length');
  for (const t of tasks) {
    assert.equal(allIds.filter((id) => id === t.id).length, 1, `${t.id} must appear exactly once`);
  }

  // Topological order: for each task, its wave index must be > the wave index
  // of every task it depends on
  const waveIndex = new Map(waves.flatMap((w, i) => w.map((t) => [t.id, i])));
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (waveIndex.has(dep)) {
        assert.ok(
          waveIndex.get(t.id) > waveIndex.get(dep),
          `${t.id} (wave ${waveIndex.get(t.id)}) must come after its dep ${dep} (wave ${waveIndex.get(dep)})`,
        );
      }
    }
  }
});

// ── 7. missingFromWave: the worktree-isolation degradation seam ────────────
//
// parallel() resolves positionally; a failed/skipped executor is `null`, NOT an
// exception. These tests lock in that the workflow can tell exactly which tasks
// to re-run on-branch instead of silently dropping them via .filter(Boolean) —
// the regression that let a whole wave vanish ("three deliverables got silently
// dropped"). Each result index maps to the same-index task in the wave.
const WAVE = [
  { id: 't1', file: 'lib/a.mjs', depends_on: [] },
  { id: 't2', file: 'lib/b.mjs', depends_on: [] },
  { id: 't3', file: 'lib/c.mjs', depends_on: [] },
];

test('missingFromWave: all executors succeed → nothing to re-run', () => {
  const missing = missingFromWave(WAVE, ['ok1', 'ok2', 'ok3']);
  assert.equal(missing.length, 0, 'no nulls means no missing tasks');
});

test('missingFromWave: every executor failed → the whole wave is returned in order', () => {
  // The screenshot case: worktree isolation unavailable, all three come back null.
  const missing = missingFromWave(WAVE, [null, null, null]);
  assert.deepEqual(missing.map((t) => t.id), ['t1', 't2', 't3'], 'all three must be flagged for on-branch re-run');
});

test('missingFromWave: partial failure returns only the failed tasks, positionally', () => {
  // t1 succeeded, t2 failed (null), t3 succeeded → only t2 needs re-running.
  const missing = missingFromWave(WAVE, ['ok1', null, 'ok3']);
  assert.deepEqual(missing.map((t) => t.id), ['t2'], 'only the null-index task is missing');
});

test('missingFromWave: undefined / falsy holes also count as missing', () => {
  // parallel() uses null, but be robust to undefined / empty-string holes too.
  const missing = missingFromWave(WAVE, ['ok1', undefined, '']);
  assert.deepEqual(missing.map((t) => t.id), ['t2', 't3'], 'undefined and "" are both treated as failures');
});

test('missingFromWave: a results array shorter than the wave treats the tail as failed', () => {
  // Defensive: should never happen (parallel preserves length), but losing the
  // tail silently would be the exact bug class we are guarding against.
  const missing = missingFromWave(WAVE, ['ok1']);
  assert.deepEqual(missing.map((t) => t.id), ['t2', 't3'], 'missing tail entries count as failed');
});
