// Unit tests for the pure wave-layering algorithm in lib/waves.mjs.
//
// These tests lock in the Kahn + file-disjointness correctness so a future
// change to the layering logic cannot silently break same-file collision
// avoidance.  Every assertion maps directly to a named requirement from the
// Phase 01 plan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWaves, missingFromWave, classifyOverflow } from '../lib/waves.mjs';

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

// ── 8. classifyOverflow — ADR-016 file-ownership enforcement ─────────────────
//
// Phase-04 cause #2: an executor touched a file outside its declared set.  When
// that extra file is claimed by a wave peer, integrating both branches would
// stack duplicate code with NO conflict marker (textual clean ≠ semantically
// correct).  classifyOverflow is the pure decision function that the integrator
// uses to distinguish "collision → heal ladder" from "harmless overflow → ⚠
// advisory" (ADR-016).  These tests drive the implementation in lib/waves.mjs
// (task t1 is test-first; the implementation lands in t2).

test('classifyOverflow: changed files are a subset of declared → kind is clean with no extraFiles', () => {
  // The happy path: executor touched exactly what it declared.  No overflow
  // of any kind; no advisory, no heal needed.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/b.mjs'],
    new Set(['lib/a.mjs', 'lib/b.mjs']),
    new Map([['t2', new Set(['lib/c.mjs'])]]),
  );
  assert.equal(result.kind, 'clean', 'subset of declared is clean');
  assert.deepEqual(result.extraFiles, [], 'no extra files when all changed are declared');
});

test('classifyOverflow: empty changedFiles array → kind is clean', () => {
  // An executor that touched nothing is trivially clean.
  const result = classifyOverflow(
    [],
    new Set(['lib/a.mjs']),
    new Map([['t2', new Set(['lib/b.mjs'])]]),
  );
  assert.equal(result.kind, 'clean', 'empty changed set is always clean');
  assert.deepEqual(result.extraFiles, [], 'no extra files when nothing was changed');
});

test('classifyOverflow: extra file claimed by a different wave task → kind is collision', () => {
  // Phase-04 cause #2: two parallel tasks both write lib/shared.mjs.  The
  // integrator must NEVER cherry-pick both; route one to the heal ladder.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/shared.mjs'],          // changed
    new Set(['lib/a.mjs']),                   // declared: only lib/a.mjs
    new Map([['t2', new Set(['lib/shared.mjs'])]]), // t2 also claims lib/shared.mjs
  );
  assert.equal(result.kind, 'collision', 'overflow into a peer-claimed file is a collision');
  assert.deepEqual(result.extraFiles, ['lib/shared.mjs'], 'the colliding file is reported');
});

test('classifyOverflow: extra file not claimed by any wave peer → kind is harmless', () => {
  // Phase-04 t14: the executor also fixed a hooksPath reference in an
  // unrelated file.  Nobody else in the wave claimed that file, so
  // integrating it is safe; emit a ⚠ advisory but do NOT reject.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/util.mjs'],            // changed; lib/util.mjs is extra
    new Set(['lib/a.mjs']),                   // declared
    new Map([['t2', new Set(['lib/b.mjs'])]]), // peer claims something else entirely
  );
  assert.equal(result.kind, 'harmless', 'unclaimed overflow is harmless, not a collision');
  assert.deepEqual(result.extraFiles, ['lib/util.mjs'], 'the extra file is still reported for the ⚠ advisory');
});

test('classifyOverflow: solo wave (empty waveClaimMap) with overflow → always harmless, never collision', () => {
  // CONTEXT note 4: a wildcard-file task already forces a solo wave; in a solo
  // wave there is no peer to collide with, so any overflow is definitionally harmless.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/surprise.mjs'],
    new Set(['lib/a.mjs']),
    new Map(),                                // empty map = solo wave
  );
  assert.equal(result.kind, 'harmless', 'solo wave: no peers means no collision possible');
  assert.deepEqual(result.extraFiles, ['lib/surprise.mjs'], 'extra files still surface in the advisory');
});

test('classifyOverflow: wildcard declared file (Set with *) treats every changed file as declared → clean', () => {
  // A task with no declared file claims '*' — it can write anything.  Overflow
  // detection must be skipped: extraFiles must be empty and kind must be clean.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/b.mjs', 'lib/c.mjs'],
    new Set(['*']),                           // wildcard: task declared no specific file
    new Map([['t2', new Set(['lib/b.mjs'])]]),
  );
  assert.equal(result.kind, 'clean', 'wildcard-declared task has no overflow by definition');
  assert.deepEqual(result.extraFiles, [], 'no extraFiles when declared is wildcard *');
});

test("classifyOverflow: declarer's own id in waveClaimMap is ignored — only OTHER tasks count", () => {
  // The caller builds waveClaimMap from the wave's OTHER tasks, but as a safety
  // net classifyOverflow must also ignore an entry keyed by the declaring
  // task's own id if one somehow slips in — a task cannot collide with itself.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/extra.mjs'],
    new Set(['lib/a.mjs']),
    // 'self' claims lib/extra.mjs — must be ignored; 't2' claims something else
    new Map([
      ['self', new Set(['lib/extra.mjs'])],
      ['t2',   new Set(['lib/b.mjs'])],
    ]),
    'self',                                   // declaringTaskId
  );
  // lib/extra.mjs is only claimed by 'self'; ignoring that claim means no
  // collision partner → harmless overflow (not collision).
  assert.equal(result.kind, 'harmless', "declarer's own claim entry must not trigger a collision");
  assert.deepEqual(result.extraFiles, ['lib/extra.mjs'], 'the extra file is still reported');
});

test('classifyOverflow: multiple extra files, some collision some harmless → collision wins', () => {
  // If ANY extra file collides with a peer claim, the whole outcome is collision
  // (route to heal).  The integrator never cherry-picks a mixed branch.
  const result = classifyOverflow(
    ['lib/a.mjs', 'lib/shared.mjs', 'lib/util.mjs'],
    new Set(['lib/a.mjs']),
    new Map([
      ['t2', new Set(['lib/shared.mjs'])],    // peer claims lib/shared.mjs → collision
      ['t3', new Set(['lib/z.mjs'])],         // peer claims something else
    ]),
  );
  assert.equal(result.kind, 'collision', 'any collision among extra files makes the whole result a collision');
  // Both extra files should be present in extraFiles
  assert.ok(result.extraFiles.includes('lib/shared.mjs'), 'colliding file included');
  assert.ok(result.extraFiles.includes('lib/util.mjs'), 'non-colliding extra file also included');
});

// ── 9. buildWaves preCompleted — phase-07 resumability pre-seeding ────────────
//
// When /astro-execute is re-run after a partial failure, tasks whose stamp is
// already found on the branch are passed in as `preCompleted`.  The wave builder
// must:
//   a) treat those ids as already done so their DEPENDENTS are ready in wave 1
//      (the entire point — without this, dependents are stuck behind a "done"
//      task that never appears in a wave, so the run stalls).
//   b) NEVER include a preCompleted task in any wave — it is already done and
//      must not be re-executed.
//   c) Leave all existing callers (no second argument) compatible — the default
//      `new Set()` keeps the behaviour identical to the original.

test('buildWaves with no preCompleted arg behaves identically to no-arg call', () => {
  // The default param must keep every existing caller compatible — this test
  // proves the zero-arg path is unchanged.
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
  ];
  const { waves: withDefault } = buildWaves(tasks);
  const { waves: withEmpty }   = buildWaves(tasks, new Set());
  assert.deepEqual(
    ids(withDefault),
    ids(withEmpty),
    'explicit empty Set must produce the same waves as the no-arg call',
  );
});

test('buildWaves preCompleted: a done task never appears in any wave', () => {
  // Phase-07 resumability: t1 is already stamped on the branch.  It must not
  // appear in any wave — re-running a stamped task would be wrong.
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
  ];
  const { waves } = buildWaves(tasks, new Set(['t1']));
  const allIds = waves.flat().map((t) => t.id);
  assert.ok(!allIds.includes('t1'), 'pre-completed t1 must not appear in any wave');
  assert.ok(allIds.includes('t2'), 't2 (dependent of done t1) must still appear');
});

test('buildWaves preCompleted: dependent of a done task is ready in wave 1', () => {
  // The whole point of pre-seeding: t2 depends on t1; t1 is done.  t2 must be
  // ready immediately (wave 0) — not deferred behind a "t1 not yet done" stall.
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
    { id: 't3', file: 'lib/c.mjs', depends_on: ['t2'] },
  ];
  const { waves } = buildWaves(tasks, new Set(['t1']));
  // t2 depends on t1 (done), so it should be in wave 0 of the returned waves.
  assert.ok(waves.length >= 1, 'must produce at least one wave');
  assert.ok(
    waves[0].some((t) => t.id === 't2'),
    't2 must land in the first returned wave because its dep t1 is pre-seeded',
  );
  // t3 depends on t2, which is not done — it must come in a later wave.
  assert.ok(
    waves.flat().some((t) => t.id === 't3'),
    't3 must also appear (in a later wave)',
  );
  const waveIndex = new Map(waves.flatMap((w, i) => w.map((t) => [t.id, i])));
  assert.ok(
    waveIndex.get('t3') > waveIndex.get('t2'),
    't3 must come after t2 in wave order',
  );
});

test('buildWaves preCompleted: multiple done tasks — all absent from waves, all deps unlocked', () => {
  // A realistic re-run: t1 and t2 are both stamped; only t3 (depends on both)
  // needs executing.
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: [] },
    { id: 't3', file: 'lib/c.mjs', depends_on: ['t1', 't2'] },
  ];
  const { waves } = buildWaves(tasks, new Set(['t1', 't2']));
  const allIds = waves.flat().map((t) => t.id);
  assert.ok(!allIds.includes('t1'), 't1 must not appear (pre-completed)');
  assert.ok(!allIds.includes('t2'), 't2 must not appear (pre-completed)');
  assert.ok(allIds.includes('t3'), 't3 must appear — all its deps are pre-seeded');
  // t3 must be in the first wave (deps already satisfied at init).
  assert.ok(
    waves[0].some((t) => t.id === 't3'),
    't3 must be in wave 0 since both t1 and t2 are pre-seeded',
  );
});

test('buildWaves preCompleted: all tasks done → empty waves array', () => {
  // All-done short-circuit: every task is stamped.  The result must have no
  // waves (empty array) and nothing is executed.
  const tasks = [
    { id: 't1', file: 'lib/a.mjs', depends_on: [] },
    { id: 't2', file: 'lib/b.mjs', depends_on: ['t1'] },
  ];
  const { waves } = buildWaves(tasks, new Set(['t1', 't2']));
  assert.equal(waves.length, 0, 'all tasks done → no waves should be produced');
});
