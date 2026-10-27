// Phase 51 t2 — lib/calstats.mjs: Wilson intervals, rates, pass^k and seeded selection (C5, C6, C8a).
// Pure functions; module reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const near = (a, b) => assert.ok(Math.abs(a - b) < 5e-5, `${a} vs ${b}`);

test('wilson(0,10) is [0, 0.2775] and wilson(5,10) is [0.2366, 0.7634] to 4 places', async () => {
  const { wilson } = await import('../lib/calstats.mjs');
  const [a, b] = wilson(0, 10);
  near(a, 0); near(b, 0.2775);
  const [c, d] = wilson(5, 10);
  near(c, 0.2366); near(d, 0.7634);
});

test('every interval contains its estimate and stays in [0,1], and 0/n has an upper bound > 0', async () => {
  const { rate } = await import('../lib/calstats.mjs');
  for (let n = 1; n <= 12; n += 1) {
    for (let x = 0; x <= n; x += 1) {
      const r = rate(x, n);
      assert.ok(r.lo >= 0 && r.hi <= 1 && r.lo <= r.p + 1e-12 && r.p <= r.hi + 1e-12, `${x}/${n}`);
    }
    assert.ok(rate(0, n).hi > 0);
  }
  assert.equal(rate(0, 0).p, null);
});

test('passK distinguishes always-, sometimes- and never-PASSed defects (0,0,0 / .667,.333,0 / 1,1,1)', async () => {
  const { passK } = await import('../lib/calstats.mjs');
  assert.deepEqual(passK(0, 3), [0, 0, 0]);
  const some = passK(2, 3);
  near(some[0], 2 / 3); near(some[1], 1 / 3); near(some[2], 0);
  assert.deepEqual(passK(3, 3), [1, 1, 1]);
});

test('summarizeSet excludes invalid trials from n and counts them', async () => {
  const { summarizeSet } = await import('../lib/calstats.mjs');
  const s = summarizeSet([
    { id: 'E1', outcomes: ['pass', 'pass', 'pass'] },
    { id: 'E2', outcomes: ['pass', 'fail', 'fail'] },
    { id: 'E3', outcomes: ['fail', 'invalid', 'fail'] },
    { id: 'E4', outcomes: ['invalid', 'invalid', 'invalid'] },
  ]);
  assert.equal(s.invalid, 4);
  assert.deepEqual([s.defect_rate.x, s.defect_rate.n], [2, 3], 'E4 never ran validly, so it is not in n');
  assert.deepEqual([s.trial_rate.x, s.trial_rate.n], [4, 8]);
  assert.deepEqual(s.defects.map((d) => [d.trials, d.passes, d.invalid]), [[3, 3, 0], [3, 1, 0], [2, 0, 1], [0, 0, 3]]);
  assert.deepEqual(s.defects[0].pass_k, [0, 0, 0]);
});

test('summarizeSet marks too_few below MIN_DEFECTS_PER_SET and unavailable at zero defects', async () => {
  const { summarizeSet, MIN_DEFECTS_PER_SET } = await import('../lib/calstats.mjs');
  const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `E${i}`, outcomes: ['fail'] }));
  assert.equal(summarizeSet(mk(MIN_DEFECTS_PER_SET - 1)).too_few, true);
  assert.equal(summarizeSet(mk(MIN_DEFECTS_PER_SET)).too_few, false);
  const none = summarizeSet([], { reason: 'no test-gap survivors' });
  assert.equal(none.unavailable, 'no test-gap survivors');
  assert.equal(none.defect_rate, null);
  assert.equal(none.trial_rate, null);
});

test('mulberry32 gives the same stream for the same seed', async () => {
  const { mulberry32 } = await import('../lib/calstats.mjs');
  const a = mulberry32(7); const b = mulberry32(7); const c = mulberry32(8);
  const sa = Array.from({ length: 5 }, a); const sb = Array.from({ length: 5 }, b); const sc = Array.from({ length: 5 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((v) => v >= 0 && v < 1));
});

test('selectSeeded gives the same picks in the same order for the same seed, different picks for seed 7 and 8 over a pool of 20, and never repeats an item', async () => {
  const { selectSeeded } = await import('../lib/calstats.mjs');
  const pool = Array.from({ length: 20 }, (_, i) => ({ k: `k${String(i).padStart(2, '0')}` }));
  const pick = (seed, n = 4) => selectSeeded(pool, n, seed, (x) => x.k).map((x) => x.k);
  assert.deepEqual(pick(7), pick(7));
  assert.notDeepEqual(pick(7), pick(8));
  for (const seed of [1, 7, 8, 99]) assert.equal(new Set(pick(seed, 20)).size, 20);
  assert.equal(selectSeeded(pool.slice(0, 2), 5, 7, (x) => x.k).length, 2, 'a short pool is never padded');
});

test('selection ignores input order (sorted by stable key first)', async () => {
  const { selectSeeded } = await import('../lib/calstats.mjs');
  const pool = Array.from({ length: 12 }, (_, i) => ({ p: i % 3, f: `f${i}` }));
  const key = (x) => [x.p, x.f];
  const a = selectSeeded(pool, 5, 42, key).map((x) => x.f);
  const b = selectSeeded([...pool].reverse(), 5, 42, key).map((x) => x.f);
  assert.deepEqual(a, b);
});

test('parseSeed accepts 0…2³²−1 and rejects true, \'\', -1, 1.5 and \'abc\'', async () => {
  const { parseSeed, newSeed } = await import('../lib/calstats.mjs');
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed(7), 7);
  assert.equal(parseSeed('4294967295'), 4294967295);
  for (const bad of [true, '', -1, '-1', 1.5, '1.5', 'abc', 2 ** 32, '4294967296', undefined]) assert.equal(parseSeed(bad), null, String(bad));
  assert.notEqual(parseSeed(newSeed()), null);
});

test('splitCounts gives ceil/floor', async () => {
  const { splitCounts } = await import('../lib/calstats.mjs');
  assert.deepEqual(splitCounts(10), { easy: 5, hard: 5 });
  assert.deepEqual(splitCounts(5), { easy: 3, hard: 2 });
  assert.deepEqual(splitCounts(1), { easy: 1, hard: 0 });
});
