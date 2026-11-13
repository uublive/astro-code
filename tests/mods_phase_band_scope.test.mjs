// Phase 58 — the band's scope: branch, mine and full modes (pure helpers, symbols via dynamic import, ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const band = () => import('../mods/astro-mods/hooks/lib/band.js');

// Fixture mirroring the phase's CRITERIA: M1 holds A's 41 (complete), 42, 43 and B's 44, 45 (one of
// them claimed on develop, historically); M2 holds A's 50. Rows carry what `ac status --json` now adds.
const row = (number, o = {}) => ({ number, name: `P${number}`, slug: `${number}-p`, status: 'pending', planned: false, discussed: false, milestone: 1, mine: true, owner: 'me@example.test', ...o });
const rows = () => [
  row(41, { status: 'complete' }),
  row(42, { feature_branch: 'feature/alpha', onBranch: true, planned: true, discussed: true }),
  row(43, { discussed: true }),
  row(44, { mine: false, owner: 'alex@example.test', owner_tag: 'a', feature_branch: 'feature/alpha' }),
  row(45, { mine: false, owner: 'alex@example.test', owner_tag: 'a' }),
  row(50, { milestone: 2, feature_branch: 'feature/alpha', tied_by: 'milestone', planned: true, discussed: true }),
];
const status = (o = {}) => ({
  milestone: 1, phase: { number: 43, slug: '43-p', name: 'P43', status: 'pending' }, registry: true,
  next: '/astro-plan 43', siblings: ['/astro-discuss 45', '/astro-execute 42', '/astro-execute 50'],
  phases: rows(), ...o,
});
const nums = (v) => v.visible.map((p) => p.number);

test('branch mode: only my tied rows (milestone-inherited included); a teammate\'s tied row is hidden; +N elsewhere = baseline - visible', async () => {
  const { scopeOf, trackedPhases } = await band();
  const s = status();
  const sc = scopeOf(s, { branch: 'feature/alpha' });
  assert.equal(sc.mode, 'branch');
  assert.deepEqual(nums(sc), [42, 50]);
  assert.equal(sc.hidden.label, 'elsewhere');
  assert.equal(sc.hidden.count, trackedPhases(s).length - 1, 'baseline (M1: 41-45) minus the one visible M1 row');
  assert.equal(sc.title, 2, 'the milestone tied via tied_by names the title');
});

test('branch mode: meter, title, buttons and hint cover visible rows only; one count line', async () => {
  const { bandView } = await band();
  const v = bandView(status(), null, { branch: 'feature/alpha' });
  assert.deepEqual(v.meter, { done: 0, total: 2, bar: '▱▱' });
  assert.equal(v.title, 'M2');
  assert.deepEqual(v.buttons.map((b) => b.command), ['/astro-execute 42', '/astro-execute 50']);
  assert.equal(v.hint, null, 'next (plan 43) is not visible, so it is no hint either');
  assert.equal(v.lines.filter((l) => /\+\d+ /.test(l)).length, 1);
  assert.ok(v.lines[1].trim() === '+4 elsewhere', v.lines[1]);
  assert.ok(!v.lines.some((l) => l.startsWith('OTHER')), 'OTHER is full-mode only');
  const roadmap = v.lines[0];
  assert.match(roadmap, /42/); assert.match(roadmap, /50/);
  for (const n of [41, 43, 44, 45]) assert.doesNotMatch(roadmap, new RegExp(String(n)));
});

for (const branch of ['develop', 'main', 'feature/empty', null, 'feature/deleted-upstream']) {
  for (const flow of [true, false]) {
    test(`mine mode on ${branch ?? 'a detached HEAD'} (flow ${flow ? 'on' : 'off'}): my open rows across milestones, +N by others`, async () => {
      const { scopeOf, bandView } = await band();
      // nothing of mine is tied to these branches; flow on/off never reaches the band
      const s = status({ phases: rows().map((p) => (p.number === 42 || p.number === 50 ? { ...p, feature_branch: 'feature/other' } : p)), gitflow: flow });
      const sc = scopeOf(s, { branch });
      assert.equal(sc.mode, 'mine');
      assert.deepEqual(nums(sc), [42, 43, 50], 'the complete 41 is excluded, B\'s 44 and 45 never show');
      assert.deepEqual(sc.hidden, { label: 'by others', count: 2 });
      const v = bandView(s, null, { branch });
      assert.equal(v.lines[1].trim(), '+2 by others');
      assert.deepEqual(v.buttons.map((b) => b.command), ['/astro-plan 43', '/astro-execute 42', '/astro-execute 50']);
      assert.ok(!v.lines[0].includes('44') && !v.lines[0].includes('45'));
    });
  }
}

test('mine mode: a B row with a historic claim branch of develop stays hidden (it never reaches feature_branch)', async () => {
  const { scopeOf } = await band();
  const s = status({ phases: rows().map((p) => (p.number === 45 ? { ...p, branch: 'develop' } : p)) });
  assert.ok(!nums(scopeOf(s, { branch: 'develop' })).includes(45));
});

test('full mode when the registry ref was not readable: today\'s rows, no count line', async () => {
  const { scopeOf, bandView, trackedPhases } = await band();
  const s = status({ registry: undefined });
  const sc = scopeOf(s, { branch: 'feature/alpha' });
  assert.deepEqual([sc.mode, sc.hidden], ['full', null]);
  assert.deepEqual(nums(sc), trackedPhases(s).map((p) => p.number));
  const v = bandView(s, null, { branch: 'feature/alpha' });
  assert.ok(!v.lines.some((l) => /\+\d+ (elsewhere|by others)/.test(l)));
  assert.equal(v.title, 'M1');
  for (const junk of [null, undefined, {}, { registry: 'yes' }]) assert.equal(scopeOf(junk).mode, 'full');
});

test('a branch with a run in flight keeps that phase visible; counts are disjoint and never double count', async () => {
  const { scopeOf } = await band();
  const runs = [{ kind: 'execute', phase: 45, agents: [] }];
  const mine = scopeOf(status(), { branch: 'develop', runs });
  assert.deepEqual(nums(mine), [42, 43, 45, 50]);
  assert.equal(mine.hidden.count, 1, '45 is shown (running), so only 44 is hidden');
  const br = scopeOf(status(), { branch: 'feature/alpha', runs });
  assert.deepEqual(nums(br), [42, 45, 50]);
  assert.equal(br.hidden.label, 'elsewhere');
});

test('the single fallback button mirrors nextAction for the first open visible row', async () => {
  const { bandView } = await band();
  const only = (o) => status({ next: null, siblings: [], phases: [row(7, o)] });
  const cases = [[{ planned: true, discussed: true }, 'execute 7'], [{ discussed: true }, 'plan 7'], [{}, 'discuss 7'], [{ status: 'executing' }, 'execute 7'], [{ status: 'verified' }, 'accept 7']];
  for (const [o, want] of cases) assert.deepEqual(bandView(only(o), null, { branch: 'develop' }).buttons.map((b) => b.command), [`/astro-${want}`]);
});

test('owner_tag, not the raw owner email, draws in the chip; stalePaths adds the registry ref', async () => {
  const { bandView, stalePaths } = await band();
  const v = bandView(status({ registry: undefined }), null, {});
  assert.match(v.lines[0], /45\(a\)/);
  assert.doesNotMatch(v.lines[0], /example\.test/);
  assert.ok(stalePaths('/p', { registry_ref: '/p/.git/refs/remotes/origin/astro-registry' }).includes('/p/.git/refs/remotes/origin/astro-registry'));
  assert.ok(!stalePaths('/p', {}).some((x) => x.includes('refs')));
});
