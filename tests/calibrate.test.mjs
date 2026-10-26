// Phase 51 t6 — lib/calibrate.mjs part 1: accepted phases, candidates, seeded selection, the bill and
// the committed log (C1, C2, C6, C8, C9). Real tmp git projects from the calibration fixture; modules
// reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCalibrationProject, drift, sh } from './fixtures/calibrate/project.mjs';

const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const keys = (l) => l.map((c) => c.key).sort();

test('acceptedPhases lists complete phases from the live roadmap and every milestone snapshot with their directories, never pending or verified ones', async () => {
  const { acceptedPhases } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject();
  try {
    const a = acceptedPhases(p.dir);
    assert.deepEqual(a.map((x) => x.number), [1, 2]);
    assert.equal(a[0].archived, true);
    assert.equal(a[0].dir, p.phases.first.dir);
    assert.match(a[0].dir, /milestones\/1\/phases\//);
    assert.equal(a[1].dir, p.phases.second.dir);
    assert.deepEqual(a[1].criteria_ids, ['C1', 'C2']);
  } finally { done(p); }
});

test('candidates: easy is killed-only, hard is test-gap-only, and nothing comes from a non-accepted phase', async () => {
  const { gatherCandidates } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject();
  try {
    const c = gatherCandidates(p.dir);
    assert.deepEqual(keys(c.easy), keys(p.expected.easy));
    assert.deepEqual(keys(c.hard), keys(p.expected.hard));
    const all = new Set([...c.easy, ...c.hard].map((x) => x.key));
    for (const k of p.expected.trap) assert.equal(all.has(k), false, 'a pending or verified phase offers nothing');
    assert.ok(c.easy.every((x) => x.set === 'easy') && c.hard.every((x) => x.set === 'hard'));
    // both tools are present and carry what planting needs
    assert.ok(c.easy.some((x) => x.tool === 'mutmut' && typeof x.replacement_line === 'string'));
    assert.ok(c.easy.some((x) => x.tool === 'stryker' && typeof x.replacement === 'string' && x.loc));
    // the not-exact mutmut change, the timeout, equivalent and unjudged ones are never drawn
    assert.equal(c.shortfall['not exact'], 1);
  } finally { done(p); }
});

test('a drifted file, a non-exact mutmut change, a pre-phase list and a missing kept run each become a counted shortfall reason', async () => {
  const { gatherCandidates } = await import('../lib/calibrate.mjs');
  const { mutateRunPaths } = await import('../lib/verdict.mjs');
  const p = await makeCalibrationProject({ killed: 2, testGap: 1, equivalent: 0, unjudged: 0, notExact: 1 });
  try {
    drift(p, 'src/first.mjs', 'return a + 0;', 'return a + 0; // edited');
    const first = gatherCandidates(p.dir);
    assert.ok(first.shortfall.drifted >= 1, 'a drifted file');
    assert.equal(first.shortfall['not exact'], 1, 'the non-exact mutmut change');
    // a list written before this phase (no keys), and a phase with no kept run at all
    const second = mutateRunPaths(p.dir, p.phases.second.slug);
    writeFileSync(second.list, readFileSync(second.list, 'utf8').split('\n').filter(Boolean).map((l) => { const o = JSON.parse(l); delete o.key; return JSON.stringify(o); }).join('\n') + '\n');
    rmSync(mutateRunPaths(p.dir, p.phases.first.slug).run);
    const c = gatherCandidates(p.dir);
    assert.equal(c.shortfall['kept list predates calibration'], 1);
    assert.equal(c.shortfall['no kept run'], 1);
    assert.deepEqual([c.easy.length, c.hard.length], [0, 0]);
  } finally { done(p); }
});

test('a phase whose CRITERIA.md has no criteria is skipped with its reason', async () => {
  const { gatherCandidates } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject();
  try {
    writeFileSync(join(p.phases.second.dir, 'CRITERIA.md'), 'nothing numbered here\n');
    const c = gatherCandidates(p.dir);
    assert.equal(c.shortfall['no CRITERIA.md'], 1);
    assert.ok(c.easy.every((x) => x.slug !== p.phases.second.slug));
  } finally { done(p); }
});

test('a gremlins kept run, or pickTool naming Gremlins with no runs, yields `unsupported: gremlins`', async () => {
  const { gatherCandidates } = await import('../lib/calibrate.mjs');
  const g = await makeCalibrationProject({ tools: ['gremlins'] });
  const none = await makeCalibrationProject({ tools: ['gremlins'], noRuns: true });
  try {
    for (const p of [g, none]) {
      const c = gatherCandidates(p.dir);
      assert.deepEqual([c.easy.length, c.hard.length], [0, 0]);
      assert.deepEqual(c.unsupported, ['gremlins (it reports no patch)']);
    }
    assert.equal(gatherCandidates(none.dir).shortfall['no kept run'], 1);
  } finally { done(g); done(none); }
});

test('planCalibration with a seed selects deterministically, splits ceil/floor, never pads a short set and reports requested vs selected', async () => {
  const { planCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 12 });
  const small = await makeCalibrationProject({ killed: 1, testGap: 1, equivalent: 0, unjudged: 0, notExact: 0 });
  try {
    const a = planCalibration(p.dir, { defects: 5, runs: 2, seed: 7 });
    const b = planCalibration(p.dir, { defects: 5, runs: 2, seed: 7 });
    const c = planCalibration(p.dir, { defects: 5, runs: 2, seed: 8 });
    assert.deepEqual(a.defects.map((d) => [d.id, d.key]), b.defects.map((d) => [d.id, d.key]));
    assert.notDeepEqual(a.defects.map((d) => d.key), c.defects.map((d) => d.key));
    assert.deepEqual(a.requested_split, { easy: 3, hard: 2 });
    assert.deepEqual(a.selected, { easy: 3, hard: 2 });
    assert.deepEqual(a.defects.map((d) => d.id), ['E1', 'E2', 'E3', 'H1', 'H2']);
    assert.ok(a.defects.filter((d) => d.set === 'hard').every((d) => p.expected.hard.some((h) => h.key === d.key)));
    assert.equal(a.seed, 7);
    assert.equal(a.seed_given, true);
    // two killed and two test-gap exist in the small project (one each per accepted phase), ten wanted: no padding, counts reported
    const s = planCalibration(small.dir, { defects: 10, runs: 2, seed: 1 });
    assert.deepEqual(s.requested_split, { easy: 5, hard: 5 });
    assert.deepEqual(s.selected, { easy: 2, hard: 2 });
    assert.deepEqual(s.available, { easy: 2, hard: 2 });
    assert.equal(new Set(s.defects.map((d) => d.key)).size, s.defects.length);
    const unseeded = planCalibration(p.dir, { defects: 2, runs: 1 });
    assert.equal(unseeded.seed_given, false);
    assert.ok(Number.isInteger(unseeded.seed));
  } finally { done(p); done(small); }
});

test('the bill scales with defects × runs and names its basis: constant with no log, median of logged per-trial cost with one', async () => {
  const { planCalibration, DEFAULT_TRIAL_USD, appendLog } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 6 });
  try {
    const two = planCalibration(p.dir, { defects: 4, runs: 2, seed: 1 });
    const four = planCalibration(p.dir, { defects: 4, runs: 4, seed: 1 });
    assert.equal(two.per_trial_usd, DEFAULT_TRIAL_USD);
    assert.match(two.cost_basis, /estimate — no recorded runs/);
    assert.equal(two.bill_usd, 4 * 2 * DEFAULT_TRIAL_USD);
    assert.equal(four.bill_usd, 4 * 4 * DEFAULT_TRIAL_USD);
    assert.ok(four.bill_usd > two.bill_usd);
    for (const [spent, trials] of [[10, 5], [30, 10], [12, 4]]) {
      await appendLog(p.dir, { schema: 1, date: '2026-10-26T00:00:00Z', cost_basis: 'measured', spent_usd: spent, completed: { trials } });
    }
    await appendLog(p.dir, { schema: 1, date: '2026-10-26T00:00:00Z', cost_basis: 'estimated', spent_usd: 999, completed: { trials: 1 } });
    const logged = planCalibration(p.dir, { defects: 4, runs: 2, seed: 1 });
    assert.equal(logged.per_trial_usd, 3, 'the median of 2, 3 and 3');
    assert.match(logged.cost_basis, /median of 3 recorded runs/);
    assert.equal(logged.bill_usd, 24);
  } finally { done(p); }
});

test('budget defaults to 1.5× the bill and --budget overrides it', async () => {
  const { planCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 6 });
  try {
    const d = planCalibration(p.dir, { defects: 4, runs: 2, seed: 1 });
    assert.equal(d.budget_usd, d.bill_usd * 1.5);
    assert.equal(d.budget_given, false);
    const o = planCalibration(p.dir, { defects: 4, runs: 2, seed: 1, budget: 5 });
    assert.deepEqual([o.budget_usd, o.budget_given], [5, true]);
  } finally { done(p); }
});

test('appendLog appends one line under the lock, keeps earlier lines byte-identical, commits only that file with the neutral subject, and is not git-ignored', async () => {
  const { appendLog, readLog, CALIBRATION_FILE } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject();
  try {
    writeFileSync(join(p.dir, 'unrelated.txt'), 'staged elsewhere\n');
    sh(p.dir, 'add', 'unrelated.txt');
    const r1 = await appendLog(p.dir, { schema: 1, date: '2026-10-26T10:00:00Z', n: 1 });
    assert.equal(r1.committed, true);
    const first = readFileSync(join(p.dir, CALIBRATION_FILE), 'utf8');
    const r2 = await appendLog(p.dir, { schema: 1, date: '2026-10-27T10:00:00Z', n: 2 });
    assert.equal(r2.committed, true);
    const both = readFileSync(join(p.dir, CALIBRATION_FILE), 'utf8');
    assert.ok(both.startsWith(first), 'the first line is byte-identical');
    assert.equal(both.trim().split('\n').length, 2);
    assert.deepEqual(readLog(p.dir).map((x) => x.n), [1, 2]);
    assert.equal(sh(p.dir, 'log', '-1', '--format=%s').stdout.trim(), 'chore(astro): verifier run log 2026-10-27');
    assert.equal(sh(p.dir, 'show', '--name-only', '--format=', 'HEAD').stdout.trim(), CALIBRATION_FILE);
    assert.equal(sh(p.dir, 'diff', '--cached', '--name-only').stdout.trim(), 'unrelated.txt', 'a file staged for something else stays staged');
    assert.equal(sh(p.dir, 'check-ignore', '-q', CALIBRATION_FILE).status, 1, 'not git-ignored');
    assert.ok(!existsSync(join(p.dir, '.astrocode', '.lock')), 'the lock is released');
  } finally { done(p); }
});

test('planCalibration writes nothing and creates no directory', async () => {
  const { planCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject();
  const snap = () => `${sh(p.dir, 'status', '--porcelain', '--ignored').stdout}${readdirSync(join(p.dir, '.astrocode')).sort().join(',')}${readdirSync(tmpdir()).filter((f) => f.startsWith('ac-v-')).join(',')}`;
  try {
    const before = snap();
    planCalibration(p.dir, { defects: 4, runs: 2, seed: 3 });
    assert.equal(snap(), before);
    assert.equal(existsSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl')), false);
  } finally { done(p); }
});
