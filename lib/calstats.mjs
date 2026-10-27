// Calibration statistics and seeded selection (phase 51, P4 and P8). Pure, no fs, no clock.
//
// Why a module of its own: every number `ac verify calibrate` prints, logs and compares across
// verifier changes comes from here, so there is exactly one definition of each (9173) and the
// stdout, the --json and the log record cannot disagree.
//
// Why Wilson and not Wald: with a handful of trials a Wald interval on 0 false PASSes collapses to
// [0, 0] and claims a certainty nobody has. Wilson keeps an upper bound above zero (the "rule of
// three" shape), which is the honest statement for a small sample.
//
// Why pass^k and not only a rate: a rate pools trials, so a defect caught 2 of 3 times and one caught
// every time can average out. pass^k is "caught on all k runs", per defect, so the flaky catch shows.
import { randomInt } from 'node:crypto';

export const MIN_DEFECTS_PER_SET = 5;
export const WILSON_Z = 1.96;

/** The one-line definitions both the output and the log carry. */
export const DEFINITIONS = 'false PASS = the verifier passed a build holding a planted defect; defect rate = defects PASSed on at least one valid run / defects run; trial rate = PASS runs / valid runs; both with Wilson 95% intervals; pass^k = share of defects caught on all k runs; invalid runs are excluded; the ADR-085 code gate is not applied';

/** Wilson 95% score interval for `x` of `n`. `[null, null]` when `n` is 0. */
export function wilson(x, n, z = WILSON_Z) {
  if (!(n > 0)) return [null, null];
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** `{ x, n, p, lo, hi }`; `p`, `lo` and `hi` are null when nothing ran (n = 0). */
export function rate(x, n) {
  const [lo, hi] = wilson(x, n);
  return { x, n, p: n > 0 ? x / n : null, lo, hi };
}

// C(n, k) as a float; the arguments are tiny (trials per defect).
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

/**
 * Unbiased pass^k for one defect that was caught on `c` of `n` valid runs: the chance that k runs
 * drawn from them were all caught, `C(c,k)/C(n,k)`, for k = 1..n. Always PASSed is 0,0,0.
 */
export function passK(c, n) {
  return Array.from({ length: n }, (_, i) => choose(c, i + 1) / choose(n, i + 1));
}

/**
 * One set's numbers. `defects` is `[{ id, outcomes: ['pass' | 'fail' | 'invalid', ...] }]`. An
 * invalid run is excluded from every n and counted apart. A set with no defects is `unavailable`
 * with a reason and no number (C8b); one under MIN_DEFECTS_PER_SET is `too_few`.
 */
export function summarizeSet(defects, { reason = 'no defects selected' } = {}) {
  const rows = defects.map((d) => {
    const valid = d.outcomes.filter((o) => o === 'pass' || o === 'fail');
    const passes = valid.filter((o) => o === 'pass').length;
    const caught = valid.length - passes;
    return { id: d.id, trials: valid.length, passes, caught, invalid: d.outcomes.length - valid.length, pass_k: passK(caught, valid.length) };
  });
  const invalid = rows.reduce((n, r) => n + r.invalid, 0);
  if (!rows.length) return { unavailable: reason, too_few: false, invalid, defect_rate: null, trial_rate: null, pass_k: [], defects: [] };
  const ran = rows.filter((r) => r.trials > 0);
  const defectRate = rate(ran.filter((r) => r.passes > 0).length, ran.length);
  const trialRate = rate(ran.reduce((n, r) => n + r.passes, 0), ran.reduce((n, r) => n + r.trials, 0));
  const width = Math.max(0, ...ran.map((r) => r.trials));
  const passKSet = Array.from({ length: width }, (_, i) => {
    const have = ran.filter((r) => r.trials > i);
    return have.reduce((s, r) => s + r.pass_k[i], 0) / have.length;
  });
  return {
    unavailable: null, too_few: ran.length < MIN_DEFECTS_PER_SET, invalid,
    defect_rate: defectRate, trial_rate: trialRate, pass_k: passKSet, defects: rows,
  };
}

// ---- Seeded selection (C6) ----

/** mulberry32: a 32-bit seeded PRNG returning floats in [0, 1). Same seed, same stream. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_SEED = 2 ** 32 - 1;

/** An integer 0..2^32-1 from a number or a digit string; `null` for anything else (true, '', -1, 1.5, 'abc'). */
export function parseSeed(v) {
  if (typeof v === 'string' && /^\d+$/.test(v)) v = Number(v);
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SEED ? v : null;
}

/** A fresh seed, for a run that was given none. The caller prints and logs it so the run can be repeated. */
export function newSeed() {
  return randomInt(0, MAX_SEED + 1);
}

const cmp = (a, b) => {
  if (Array.isArray(a)) {
    for (let i = 0; i < a.length; i += 1) { const c = cmp(a[i], b[i]); if (c) return c; }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
};

/**
 * `n` items of `pool`, chosen by the seed and independent of the order `pool` came in: the pool is
 * first sorted by `keyOf(item)` (a string, number or array of them), then a partial Fisher-Yates
 * shuffle takes the first n. Never repeats an item; fewer than n when the pool is short.
 */
export function selectSeeded(pool, n, seed, keyOf) {
  const items = [...pool].sort((a, b) => cmp(keyOf(a), keyOf(b)));
  const rng = mulberry32(seed);
  const take = Math.min(Math.max(0, n), items.length);
  for (let i = 0; i < take; i += 1) {
    const j = i + Math.floor(rng() * (items.length - i));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items.slice(0, take);
}

/** EASY gets the larger half of an odd request. */
export function splitCounts(n) {
  return { easy: Math.ceil(n / 2), hard: Math.floor(n / 2) };
}
