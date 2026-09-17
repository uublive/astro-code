// The technical-debt register.
//
// The register exists because a markdown list rots: closing an entry required a human
// to remember, so `todo.md` ended up describing a GitFlow implementation that had
// already shipped. Most of these tests therefore pin the two properties that make this
// different from a list — the inflow is automatic, and the OUTFLOW is automatic.
//
// The single most important test in this file is the gate-leak guard
// (`fileFindings` refusing a finding that did not assert `outsideCriteria`). The debt
// channel is the first non-blocking exit the verifier has ever had, and if a finding
// that should have FAILED a phase can be parked here instead, the two-gate guarantee
// (REQ-006) quietly acquires a back door.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addDebt, openDebt, findDebt, payDebt, dropDebt, dismissDebt, closeDebtFor, fileFindings,
  loadDebt, debtId, debtAgeDays, staleDebt, debtScore, debtPressure,
  validateDebtCost, validateDebtStatus, DEBT_STATUSES, DEBT_COSTS, STALE_DAYS,
} from '../lib/debt.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { loadRoadmap } from '../lib/roadmap.mjs';
import { readContext, renderSegmentParts } from '../hooks/_astro-ctx.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-debt-'));
  initPlanning(root, { name: 'debtdemo' });
  return root;
}
const NOW = new Date('2026-09-17T08:00:00.000Z');

// --- identity -------------------------------------------------------------------

test('a debt id is date-prefixed, like a fix — debt is unplanned, so it is not numbered', () => {
  assert.equal(debtId('jq -r result fallback', NOW), '2026-09-17-jq-r-result-fallback');
  assert.ok(!debtId('x'.repeat(200), NOW).endsWith('-'), 'no trailing dash');
  assert.ok(debtId('x'.repeat(200), NOW).length <= 11 + 40);
});

test('a title that slugifies to nothing still yields a usable id', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: '!!! ???', now: NOW });
  assert.equal(entry.id, '2026-09-17-debt');
});

// --- inflow ---------------------------------------------------------------------

test('filing debt does NOT touch the roadmap or claim a phase number', async () => {
  const root = project();
  const before = loadRoadmap(root);
  await addDebt(root, { title: 'raw JSON in the disabled-reason line', phase: '23', now: NOW });
  const after = loadRoadmap(root);
  assert.deepEqual(after.phases, before.phases);
  assert.equal(after.milestone, before.milestone);
});

test('the same finding from a later phase is ONE debt seen twice, not two debts', async () => {
  const root = project();
  const first = await addDebt(root, { title: 'fallback drops jq -r', phase: '23', file: 'method.sh', now: NOW });
  assert.equal(first.created, true);

  const again = await addDebt(root, {
    title: 'Fallback   drops JQ -r', // different case/spacing — same finding
    phase: '27',
    file: 'method.sh',
    now: new Date('2026-10-02T08:00:00.000Z'),
  });
  assert.equal(again.created, false, 'a duplicate must converge, not fragment the register');
  assert.equal(again.entry.id, first.entry.id);

  const [item] = openDebt(root);
  assert.deepEqual(item.also_found_in, ['27'], 'the repeat sighting is recorded — it is signal');
  assert.equal(loadDebt(root).debt.length, 1);
});

test('the same sentence about a DIFFERENT file is a different debt', async () => {
  const root = project();
  await addDebt(root, { title: 'no input validation', file: 'a.mjs', now: NOW });
  const second = await addDebt(root, { title: 'no input validation', file: 'b.mjs', now: NOW });
  assert.equal(second.created, true);
  assert.equal(openDebt(root).length, 2);
  // same title + same day would collide on the bare dated slug; the id must disambiguate
  const ids = openDebt(root).map((d) => d.id);
  assert.equal(new Set(ids).size, 2, `ids must be unique, got ${ids.join(', ')}`);
});

test('a duplicate from the SAME phase does not grow also_found_in', async () => {
  const root = project();
  await addDebt(root, { title: 'dupe', phase: '23', now: NOW });
  await addDebt(root, { title: 'dupe', phase: '23', now: NOW });
  assert.equal(openDebt(root)[0].also_found_in, undefined);
});

test('a debt item needs a title, and an unknown cost is refused on the write path', async () => {
  const root = project();
  await assert.rejects(() => addDebt(root, { title: '   ' }), /needs a title/);
  await assert.rejects(() => addDebt(root, { title: 'x', cost: 'huge' }), /unknown debt cost/);
  assert.throws(() => validateDebtCost('huge'), /unknown debt cost/);
  assert.throws(() => validateDebtStatus('nope'), /unknown debt status/);
  assert.deepEqual(DEBT_COSTS, ['small', 'medium', 'large']);
  assert.deepEqual(DEBT_STATUSES, ['open', 'paying', 'paid', 'dropped', 'dismissed']);
});

// --- the gate leak --------------------------------------------------------------

test('a finding that did not assert outsideCriteria is REFUSED — omission is not consent', async () => {
  const root = project();
  const res = await fileFindings(root, [
    { title: 'genuinely off-criteria', outsideCriteria: true, cost: 'small' },
    { title: 'forgot the flag' },
    { title: 'explicitly on-criteria', outsideCriteria: false },
    { title: 'truthy but not true', outsideCriteria: 'yes' },
  ], { phase: '23', now: NOW });

  assert.deepEqual(res.filed.map((d) => d.title), ['genuinely off-criteria']);
  assert.deepEqual(res.rejected.sort(), ['explicitly on-criteria', 'forgot the flag', 'truthy but not true']);
  assert.equal(openDebt(root).length, 1, 'only the asserted finding may reach the register');
});

test('fileFindings tolerates junk without aborting the phase it runs after', async () => {
  const root = project();
  for (const junk of [null, undefined, 'not an array', 42, {}]) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fileFindings(root, junk, { phase: '1', now: NOW });
    assert.deepEqual(res.filed, []);
  }
  const res = await fileFindings(root, [{ title: '  ', outsideCriteria: true }], { phase: '1', now: NOW });
  assert.deepEqual(res.filed, []);
  assert.equal(openDebt(root).length, 0);
});

test('a finding with a bogus cost is filed at small rather than dropped or thrown', async () => {
  const root = project();
  const res = await fileFindings(root, [{ title: 'x', outsideCriteria: true, cost: 'enormous' }], { now: NOW });
  assert.equal(res.filed[0].cost, 'small');
});

test('a repeat finding across phases reports as merged, not filed', async () => {
  const root = project();
  await fileFindings(root, [{ title: 'same thing', outsideCriteria: true }], { phase: '23', now: NOW });
  const res = await fileFindings(root, [{ title: 'same thing', outsideCriteria: true }], { phase: '24', now: NOW });
  assert.equal(res.filed.length, 0);
  assert.equal(res.merged.length, 1);
});

// --- outflow: the anti-rot mechanism --------------------------------------------

test('paying does NOT close the item — only accepting the work does', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'needs a refactor', now: NOW });

  const paying = await payDebt(root, entry.id, { kind: 'fix', workRef: '2026-09-17-needs-a-refactor' });
  assert.equal(paying.status, 'paying');
  assert.equal(openDebt(root).length, 1, 'still live — a promise is not a payment');

  const closed = await closeDebtFor(root, { kind: 'fix', workRef: '2026-09-17-needs-a-refactor' });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].status, 'paid');
  assert.ok(closed[0].paid_at);
  assert.equal(openDebt(root).length, 0, 'the gate drains the register');
});

test('closeDebtFor only closes items linked to THAT work, and is a no-op otherwise', async () => {
  const root = project();
  const a = await addDebt(root, { title: 'item a', now: NOW });
  const b = await addDebt(root, { title: 'item b', now: NOW });
  await payDebt(root, a.entry.id, { kind: 'fix', workRef: 'fix-1' });
  await payDebt(root, b.entry.id, { kind: 'phase', workRef: '04-thing' });

  assert.deepEqual(await closeDebtFor(root, { kind: 'fix', workRef: 'nothing-here' }), []);
  assert.deepEqual(await closeDebtFor(root, {}), []);
  // the kinds must not cross: a phase slug must not close a fix-linked item
  assert.deepEqual(await closeDebtFor(root, { kind: 'phase', workRef: 'fix-1' }), []);

  const closed = await closeDebtFor(root, { kind: 'phase', workRef: '04-thing' });
  assert.deepEqual(closed.map((d) => d.title), ['item b']);
  assert.equal(openDebt(root).length, 1);
});

test('an unpaid item never closes itself, however old it gets', async () => {
  const root = project();
  await addDebt(root, { title: 'ignored forever', now: NOW });
  const old = new Date('2027-09-17T08:00:00.000Z');
  assert.equal(openDebt(root).length, 1);
  assert.equal(staleDebt(root, { now: old }).length, 1);
});

test('dropping requires a reason — an unexplained removal is not a decision', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'assumption withdrawn', now: NOW });
  await assert.rejects(() => dropDebt(root, entry.id, { reason: '  ' }), /needs a reason/);

  const dropped = await dropDebt(root, entry.id, { reason: 'the module was deleted' });
  assert.equal(dropped.status, 'dropped');
  assert.equal(dropped.drop_reason, 'the module was deleted');
  assert.equal(openDebt(root).length, 0);
  assert.equal(loadDebt(root).debt.length, 1, 'history is kept — a dropped item is a recorded decision');
});

test('terminal states are terminal: a paid item cannot be re-paid or dropped', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'done', now: NOW });
  await payDebt(root, entry.id, { kind: 'fix', workRef: 'f1' });
  await closeDebtFor(root, { kind: 'fix', workRef: 'f1' });
  await assert.rejects(() => payDebt(root, entry.id, { kind: 'fix', workRef: 'f2' }), /already paid/);
  await assert.rejects(() => dropDebt(root, entry.id, { reason: 'x' }), /already paid/);
});

test('pay validates its exit — there is deliberately no third one', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'x', now: NOW });
  await assert.rejects(() => payDebt(root, entry.id, { kind: 'epic', workRef: 'e1' }), /unknown debt exit/);
  await assert.rejects(() => payDebt(root, entry.id, { kind: 'fix', workRef: '' }), /needs the fix/);
  await assert.rejects(() => payDebt(root, 'nope', { kind: 'fix', workRef: 'f' }), /no such debt/);
});

// --- reading it back ------------------------------------------------------------

test('list filters by phase and by file, and file match is a substring', async () => {
  const root = project();
  await addDebt(root, { title: 'a', phase: '23', file: 'src/lib/method.sh', now: NOW });
  await addDebt(root, { title: 'b', phase: '24', file: 'src/admin.tsx', now: NOW });

  assert.equal(openDebt(root, { phase: '23' }).length, 1);
  assert.equal(openDebt(root, { phase: '99' }).length, 0);
  // the verifier records the path it saw; a human asks about the basename
  assert.equal(openDebt(root, { file: 'method.sh' })[0].title, 'a');
  assert.equal(openDebt(root, { file: 'nothing' }).length, 0);
});

test('age is whole days, and is unfazed by a missing or corrupt timestamp', () => {
  const later = new Date('2026-10-17T08:00:00.000Z');
  assert.equal(debtAgeDays({ found_at: NOW.toISOString() }, later), 30);
  assert.equal(debtAgeDays({ found_at: later.toISOString() }, NOW), 0, 'never negative');
  assert.equal(debtAgeDays({}, later), 0);
  assert.equal(debtAgeDays({ found_at: 'garbage' }, later), 0);
  assert.equal(debtAgeDays(null, later), 0);
});

test('stale is measured from filing, and paying does not reset the clock', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'old', now: NOW });
  const later = new Date(NOW.getTime() + (STALE_DAYS + 1) * 86_400_000);
  assert.equal(staleDebt(root, { now: later }).length, 1);
  await payDebt(root, entry.id, { kind: 'fix', workRef: 'f1', now: later });
  assert.equal(staleDebt(root, { now: later }).length, 1, 'in-flight work is still ageing debt');
});

test('findDebt resolves a full id, a bare slug, and a partial', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'the jq fallback thing', now: NOW });
  assert.equal(findDebt(root, entry.id)?.id, entry.id);
  assert.equal(findDebt(root, 'the-jq-fallback-thing')?.id, entry.id);
  assert.equal(findDebt(root, 'jq-fallback')?.id, entry.id);
  assert.equal(findDebt(root, ''), null);
  assert.equal(findDebt(root, 'no-such-thing'), null);
});

test('a word past the id truncation still resolves — verifier titles are long sentences', async () => {
  const root = project();
  // exactly the shape the verifier produces: the distinctive word ("jq") lands past
  // the 40-char id cut, so an id-only lookup would fail on the term the user can see
  const { entry } = await addDebt(root, {
    title: 'step-2 fallback captures the raw JSON envelope without jq -r .result',
    now: NOW,
  });
  assert.ok(!entry.id.includes('jq'), 'precondition: the id really is truncated before "jq"');
  assert.equal(findDebt(root, 'jq -r')?.id, entry.id);
  assert.equal(findDebt(root, 'envelope')?.id, entry.id);
});

// --- dismissal: feedback about the FEED, not about the code ---------------------

test('dismiss closes an item that was never real, and keeps the record', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'the verifier misread this', now: NOW });
  await assert.rejects(() => dismissDebt(root, entry.id, { reason: ' ' }), /needs a reason/);

  const done = await dismissDebt(root, entry.id, { reason: 'that branch is unreachable' });
  assert.equal(done.status, 'dismissed');
  assert.equal(done.dismiss_reason, 'that branch is unreachable');
  assert.equal(openDebt(root).length, 0, 'a dismissed item leaves the live list');
  assert.equal(loadDebt(root).debt.length, 1, 'but stays on the record');
});

test('dismissed and dropped are different measurements and must not be conflated', async () => {
  const root = project();
  const a = await addDebt(root, { title: 'never real', now: NOW });
  const b = await addDebt(root, { title: 'was real, now moot', now: NOW });
  await dismissDebt(root, a.entry.id, { reason: 'misread' });
  await dropDebt(root, b.entry.id, { reason: 'the module was deleted' });

  const s = debtScore(root, { now: NOW });
  // only the dismissal is a verifier error; the drop is the codebase moving on
  assert.equal(s.dismissed, 1);
  assert.equal(s.falsePositiveRate, 50, '1 dismissed of 2 resolved');
});

test('a closed item cannot be resurrected by paying it', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'x', now: NOW });
  await dismissDebt(root, entry.id, { reason: 'not real' });
  await assert.rejects(() => payDebt(root, entry.id, { kind: 'fix', workRef: 'f1' }), /already dismissed/);
});

test('a paid item cannot retroactively be declared unreal', async () => {
  const root = project();
  const { entry } = await addDebt(root, { title: 'x', now: NOW });
  await payDebt(root, entry.id, { kind: 'fix', workRef: 'f1' });
  await closeDebtFor(root, { kind: 'fix', workRef: 'f1' });
  await assert.rejects(() => dismissDebt(root, entry.id, { reason: 'eh' }), /already paid/);
});

// --- the KPI --------------------------------------------------------------------

test('an empty register scores zero and reads healthy', () => {
  const root = project();
  const s = debtScore(root, { now: NOW });
  assert.equal(s.pressure, 0);
  assert.equal(s.band, 'healthy');
  assert.equal(s.open, 0);
});

// THE load-bearing property. A metric that rises with volume is a guilt meter: it
// says "pay debt" every day, which is the same as saying nothing — and it would
// punish the verifier for doing exactly what we built it to do.
test('filing more isolated debt LOWERS pressure — volume alone is never the signal', async () => {
  const root = project();
  await addDebt(root, { title: 'one', file: 'a.mjs', phase: '1', now: NOW });
  await addDebt(root, { title: 'two', file: 'b.mjs', phase: '1', now: NOW });
  // one recurrence, so there is some interest to dilute
  await addDebt(root, { title: 'one', file: 'a.mjs', phase: '2', now: NOW });
  const before = debtScore(root, { now: NOW }).pressure;
  assert.ok(before > 0, 'precondition: a recurrence produced interest');

  for (const n of ['three', 'four', 'five', 'six']) {
    // eslint-disable-next-line no-await-in-loop
    await addDebt(root, { title: n, file: `${n}.mjs`, phase: '3', cost: 'large', now: NOW });
  }
  const after = debtScore(root, { now: NOW });
  assert.ok(after.pressure < before, `pressure must fall: ${before} → ${after.pressure}`);
  assert.equal(after.open, 6);
});

test('recurrence is the strongest signal — one re-hit outweighs a small item entirely', async () => {
  const root = project();
  await addDebt(root, { title: 'tripped over', file: 'x.mjs', phase: '1', cost: 'small', now: NOW });
  const quiet = debtScore(root, { now: NOW });
  assert.equal(quiet.pressure, 0, 'a fresh isolated finding costs nothing');

  await addDebt(root, { title: 'tripped over', file: 'x.mjs', phase: '2', now: NOW });
  const loud = debtScore(root, { now: NOW });
  // principal 1, interest 3 → 75
  assert.equal(loud.pressure, 75);
  assert.equal(loud.band, 'pay-now');
  assert.equal(loud.totals.recurrence, 1);
});

test('concentration in one file raises pressure even with no recurrence', async () => {
  const root = project();
  for (const t of ['a', 'b', 'c']) {
    // eslint-disable-next-line no-await-in-loop
    await addDebt(root, { title: t, file: 'lib/canon.mjs', cost: 'medium', now: NOW });
  }
  const s = debtScore(root, { now: NOW });
  assert.equal(s.totals.hotspot, 6, 'three items in one file = 2 overlaps each');
  assert.equal(s.principal, 9);
  assert.equal(s.pressure, 40);
  assert.equal(s.band, 'watch');
  assert.deepEqual(s.files[0], { file: 'lib/canon.mjs', n: 3 });
});

test('age ALONE is worth nothing — old debt in code you never touch is cheap', async () => {
  const root = project();
  await addDebt(root, { title: 'ancient and untouched', file: 'x.mjs', now: NOW });
  const old = new Date(NOW.getTime() + 400 * 86_400_000);
  const s = debtScore(root, { now: old });
  assert.equal(s.totals.stale, 0);
  assert.equal(s.pressure, 0, 'never re-hit, never shared a file — it costs nothing');
});

test('age counts only once it compounds a recurrence', async () => {
  const root = project();
  await addDebt(root, { title: 'keeps biting', file: 'x.mjs', phase: '1', now: NOW });
  await addDebt(root, { title: 'keeps biting', file: 'x.mjs', phase: '2', now: NOW });
  const fresh = debtScore(root, { now: NOW });
  const aged = debtScore(root, { now: new Date(NOW.getTime() + 60 * 86_400_000) });
  assert.equal(fresh.totals.stale, 0);
  assert.equal(aged.totals.stale, 1);
  assert.ok(aged.pressure > fresh.pressure, 'unpaid AND still recurring is worse over time');
});

test('closed items stop counting toward pressure', async () => {
  const root = project();
  await addDebt(root, { title: 'a', file: 'x.mjs', phase: '1', now: NOW });
  await addDebt(root, { title: 'a', file: 'x.mjs', phase: '2', now: NOW });
  const live = debtScore(root, { now: NOW });
  assert.ok(live.pressure > 0);

  const [item] = openDebt(root);
  await dropDebt(root, item.id, { reason: 'gone' });
  const after = debtScore(root, { now: NOW });
  assert.equal(after.open, 0);
  assert.equal(after.pressure, 0);
});

test('worst-first ranks by friction per unit of effort, and never recommends a quiet item', async () => {
  const root = project();
  // cheap + recurring — the thing you should obviously just fix
  await addDebt(root, { title: 'cheap recurring', file: 'a.mjs', phase: '1', cost: 'small', now: NOW });
  await addDebt(root, { title: 'cheap recurring', file: 'a.mjs', phase: '2', now: NOW });
  // expensive + recurring once — same evidence, far more effort
  await addDebt(root, { title: 'costly recurring', file: 'b.mjs', phase: '1', cost: 'large', now: NOW });
  await addDebt(root, { title: 'costly recurring', file: 'b.mjs', phase: '2', now: NOW });
  // quiet — never re-found, alone in its file
  await addDebt(root, { title: 'quiet', file: 'c.mjs', cost: 'medium', now: NOW });

  const s = debtScore(root, { now: NOW });
  assert.equal(s.worst[0].title, 'cheap recurring', 'best value first');
  assert.equal(s.worst.length, 2, 'a quiet item is not a recommendation');
  assert.ok(!s.worst.some((i) => i.title === 'quiet'));
});

test('an unknown cost is scored as small rather than crashing the KPI', () => {
  const s = debtPressure({ debt: [{ id: 'x', status: 'open', cost: 'gigantic', found_at: NOW.toISOString() }] }, NOW.getTime());
  assert.equal(s.principal, 1);
  assert.equal(s.pressure, 0);
});

test('debtPressure survives a missing, empty or malformed register', () => {
  for (const junk of [null, undefined, {}, { debt: null }, { debt: 'nope' }]) {
    const s = debtPressure(junk, NOW.getTime());
    assert.equal(s.open, 0);
    assert.equal(s.pressure, 0);
    assert.equal(s.band, 'healthy');
  }
});

// --- the statusline segment -----------------------------------------------------

test('the statusline shows debt only once it is actually charging you', () => {
  const base = { milestone: 1, phase: { number: 1, slug: '01-x', name: 'x', status: 'executing' }, phases: [], total: 0 };
  const healthy = renderSegmentParts({ ...base, debt: { open: 9, pressure: 12, band: 'healthy' } });
  assert.ok(!/debt \d/.test(healthy.state), 'a healthy register renders nothing — the segment appearing IS the signal');

  const watch = renderSegmentParts({ ...base, debt: { open: 2, pressure: 40, band: 'watch' } });
  assert.match(watch.state, /debt 40/);

  const pay = renderSegmentParts({ ...base, debt: { open: 2, pressure: 70, band: 'pay-now' } });
  assert.match(pay.state, /debt 70/);
});

test('readContext carries debt pressure, and an absent register is healthy', async () => {
  const root = project();
  assert.equal(readContext(root, 0).debt.band, 'healthy');
  await addDebt(root, { title: 'a', file: 'x.mjs', phase: '1', now: NOW });
  await addDebt(root, { title: 'a', file: 'x.mjs', phase: '2', now: NOW });
  const ctx = readContext(root, Math.floor(NOW.getTime() / 1000));
  assert.equal(ctx.debt.open, 1);
  assert.ok(ctx.debt.pressure > 0);
});

test('an absent debt.json reads as an empty register, not a crash', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-debt-bare-'));
  initPlanning(root, { name: 'bare' });
  assert.deepEqual(loadDebt(root).debt, []);
  assert.deepEqual(openDebt(root), []);
  assert.deepEqual(staleDebt(root), []);
});
