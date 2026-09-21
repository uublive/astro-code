// The backlog register — ADR-056: a first-class peer of fixes and debt, never a debt
// status and never a milestone-less phase.
//
// The backlog exists for the opposite reason the debt register does. Debt is filed BY
// the verifier and closes automatically; a backlog item is filed by a HUMAN wish and
// must never corrupt the one number that carries signal (`ac debt score`) — a wish has
// no file and no recurrence, so every one filed would read as pure principal and push
// the score down. So this register stays entirely unentangled from `lib/debt.mjs`: its
// own duplicate check, its own staleness constant, its own lifecycle. The only thing it
// borrows is the shape — a strict reader that refuses to read a damaged file as empty
// (the 2026-09-18 incident, transplanted here before it can recur) and a lock-guarded
// write path that mirrors `debt.mjs` one-for-one.
//
// Mirrors `tests/debt.test.mjs`: `node:test`, real `mkdtempSync` projects, a fixed
// `NOW`, no mocks. `lib/backlog.mjs` does not exist yet on this branch, so every
// reference to it is a dynamic import inside an async test body (ADR-018) — a static
// import here would crash the whole file at module load before a single test ran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning, phaseContextStatus } from '../lib/planning.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-backlog-'));
  initPlanning(root, { name: 'backlogdemo' });
  return root;
}
const NOW = new Date('2026-09-17T08:00:00.000Z');
const registerPath = (root) => join(root, '.astrocode', 'backlog.json');

// --- identity -------------------------------------------------------------------

test('a backlog id is date-prefixed, like a fix or debt — the backlog is unplanned, so it is not numbered', async () => {
  const { backlogId } = await import('../lib/backlog.mjs');
  assert.equal(backlogId('!!! ???', NOW), '2026-09-17-idea');
});

// --- absent vs damaged ------------------------------------------------------------
//
// The distinction the debt register learned the hard way: an absent file is a true
// empty (created lazily by the first capture), a damaged one read as empty is a
// confident lie. Transplanted verbatim so the backlog cannot repeat 2026-09-18.

test('an absent backlog.json reads as an empty register, not a crash', async () => {
  const { loadBacklog, openBacklog } = await import('../lib/backlog.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ac-backlog-bare-'));
  initPlanning(root, { name: 'bare' });
  assert.deepEqual(loadBacklog(root).backlog, []);
  assert.deepEqual(openBacklog(root), []);
});

test('a DAMAGED register is an error, never an empty one', async () => {
  const { addBacklog, loadBacklog, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  await addBacklog(root, { title: 'the one item that must not vanish', now: NOW });
  writeFileSync(registerPath(root), 'if ' + readFileSync(registerPath(root), 'utf8'));

  for (const read of [() => loadBacklog(root), () => openBacklog(root)]) {
    assert.throws(read, /damaged and was NOT read as empty/);
  }
});

test('valid JSON that is not a register is refused too — same lie, different route', async () => {
  const { addBacklog, loadBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  await addBacklog(root, { title: 'the one item that must not vanish', now: NOW });
  writeFileSync(registerPath(root), JSON.stringify({ version: 1, items: [] }));
  assert.throws(() => loadBacklog(root), /not a register/);
});

test('a write onto a damaged register refuses rather than serializing over it', async () => {
  const {
    addBacklog, linkBacklog, archiveBacklog, closeBacklogFor, reopenBacklogFor,
  } = await import('../lib/backlog.mjs');
  const root = project();
  await addBacklog(root, { title: 'the one item that must not vanish', now: NOW });
  const damaged = 'if ' + readFileSync(registerPath(root), 'utf8');
  writeFileSync(registerPath(root), damaged);

  // Every mutator re-reads under the lock and writes the result back: accepting an
  // empty fallback here is how an unreadable register becomes a lost one.
  await assert.rejects(addBacklog(root, { title: 'a later idea', now: NOW }), /damaged/);
  await assert.rejects(linkBacklog(root, 'whatever', { kind: 'phase', workRef: '04-x' }), /damaged/);
  await assert.rejects(archiveBacklog(root, 'whatever', { kind: 'declined', reason: 'r' }), /damaged/);
  await assert.rejects(closeBacklogFor(root, { kind: 'phase', workRef: '04-x' }), /damaged/);
  await assert.rejects(reopenBacklogFor(root, { kind: 'phase', workRef: '04-x' }), /damaged/);

  assert.equal(readFileSync(registerPath(root), 'utf8'), damaged, 'the file is untouched');
});

// --- capture: inflow, C5's capture half ------------------------------------------

test('capture keeps the full note and records the item', async () => {
  const { addBacklog, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry, similar } = await addBacklog(root, {
    title: 'batch retries for the webhook queue',
    note: 'a longer paragraph describing why retries matter, kept verbatim.',
    now: NOW,
  });
  assert.equal(entry.note, 'a longer paragraph describing why retries matter, kept verbatim.');
  assert.deepEqual(similar, []);
  assert.equal(openBacklog(root).length, 1);
});

test('capturing an idea that resembles an OPEN one warns but still records it — never merges, never blocks', async () => {
  const { addBacklog, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry: first } = await addBacklog(root, { title: 'batch retries for the webhook queue', now: NOW });
  const { entry, similar } = await addBacklog(root, { title: 'batch retry for the webhook queue', now: NOW });

  assert.equal(similar.length, 1, 'the resembling OPEN item is surfaced');
  assert.equal(similar[0].id, first.id);
  assert.equal(similar[0].title, first.title);
  assert.ok(similar[0].match, 'match shape carries how it resembled');
  assert.notEqual(entry.id, first.id, 'a second, distinct item is still recorded — never merged');
  assert.equal(openBacklog(root).length, 2, 'capture never blocks on a resemblance');
});

// --- reading it back: ordering and counting --------------------------------------

test('openBacklog is oldest id first and counts open + linked only', async () => {
  const { addBacklog, linkBacklog, archiveBacklog, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const early = new Date('2026-01-01T08:00:00.000Z');
  const mid = new Date('2026-06-01T08:00:00.000Z');
  const { entry: a } = await addBacklog(root, { title: 'first idea', now: early });
  const { entry: b } = await addBacklog(root, { title: 'second idea', now: mid });
  const { entry: c } = await addBacklog(root, { title: 'third idea', now: NOW });

  await linkBacklog(root, b.id, { kind: 'phase', workRef: '04-x', now: NOW });
  await archiveBacklog(root, c.id, { kind: 'declined', reason: 'not now', now: NOW });

  const open = openBacklog(root);
  assert.deepEqual(open.map((i) => i.id), [a.id, b.id], 'oldest-first, linked counted, archived excluded');
});

// --- link -> drain -> revert, C2 --------------------------------------------------

test('link then accept-drain closes the item absorbed, keeping linked_by; a phase slug with no links closes nothing', async () => {
  const { addBacklog, linkBacklog, closeBacklogFor, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry } = await addBacklog(root, { title: 'idea to fold in', now: NOW });
  const linked = await linkBacklog(root, entry.id, { kind: 'phase', workRef: '04-thing', now: NOW });
  assert.equal(linked.status, 'linked');
  assert.deepEqual(linked.linked_by, { kind: 'phase', ref: '04-thing' });
  assert.equal(openBacklog(root).length, 1, 'still open (linked) until the work is accepted');

  assert.deepEqual(await closeBacklogFor(root, { kind: 'phase', workRef: 'nothing-here' }), []);

  const closed = await closeBacklogFor(root, { kind: 'phase', workRef: '04-thing' });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].status, 'absorbed');
  assert.ok(closed[0].absorbed_at);
  assert.deepEqual(closed[0].linked_by, { kind: 'phase', ref: '04-thing' }, 'the closing reference is kept');
  assert.equal(openBacklog(root).length, 0, 'the drain removes it from the open list');
});

test('reject-revert reopens a linked item and keeps the record of what failed', async () => {
  const { addBacklog, linkBacklog, reopenBacklogFor, openBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry } = await addBacklog(root, { title: 'idea that gets rejected', now: NOW });
  await linkBacklog(root, entry.id, { kind: 'phase', workRef: '05-thing', now: NOW });

  assert.deepEqual(await reopenBacklogFor(root, { kind: 'phase', workRef: 'nothing-here' }), []);

  const reopened = await reopenBacklogFor(root, { kind: 'phase', workRef: '05-thing' });
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].status, 'open');
  assert.ok(reopened[0].reopened_at);
  assert.deepEqual(
    reopened[0].previously_linked_to,
    { kind: 'phase', ref: '05-thing' },
    'the history of the failed attempt is not erased',
  );
  assert.equal(openBacklog(root).length, 1, 'it is open again, not lost');
});

// --- archive, C4 ------------------------------------------------------------------

test('archiveBacklog requires a reason, refuses a kind outside declined|obsolete, and leaves the item unchanged on every refusal', async () => {
  const { addBacklog, archiveBacklog, findBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry } = await addBacklog(root, { title: 'an idea someone might archive', now: NOW });

  await assert.rejects(() => archiveBacklog(root, entry.id, { kind: 'declined', reason: '  ' }), /reason/);
  await assert.rejects(() => archiveBacklog(root, entry.id, { kind: 'absorbed', reason: 'no' }), /kind/);
  await assert.rejects(() => archiveBacklog(root, entry.id, { kind: 'nonsense', reason: 'no' }), /kind/);

  const unchanged = findBacklog(root, entry.id);
  assert.equal(unchanged.status, 'open', 're-read the register: every refusal above left it untouched');
  assert.equal(unchanged.archive_kind, undefined);
  assert.equal(unchanged.archive_reason, undefined);

  const archived = await archiveBacklog(root, entry.id, {
    kind: 'declined', reason: 'covered by phase 12 already', now: NOW,
  });
  assert.equal(archived.status, 'declined');
  assert.equal(archived.archive_kind, 'declined');
  assert.equal(archived.archive_reason, 'covered by phase 12 already');
});

// --- declined matches, C5's plan-time half ----------------------------------------

test('declinedMatches finds a resembling DECLINED item with its reason and ignores an obsolete one', async () => {
  const { addBacklog, archiveBacklog, declinedMatches } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry: declined } = await addBacklog(root, { title: 'switch the queue to batch retries', now: NOW });
  await archiveBacklog(root, declined.id, {
    kind: 'declined', reason: 'tried this in phase 9, made latency worse', now: NOW,
  });
  const { entry: obsolete } = await addBacklog(root, { title: 'migrate the legacy webhook shim', now: NOW });
  await archiveBacklog(root, obsolete.id, {
    kind: 'obsolete', reason: 'the shim was deleted in phase 14', now: NOW,
  });

  const hits = declinedMatches(root, 'switch queue batch retries');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, declined.id);
  assert.equal(hits[0].reason, 'tried this in phase 9, made latency worse');

  assert.deepEqual(declinedMatches(root, 'migrate legacy webhook shim'), [], 'an obsolete item raises nothing');
});

// --- promotion context, C3/D2 ------------------------------------------------------

test('promotionContext carries the note verbatim, and a marker smuggled into the note cannot fake a "ready" discuss brief', async () => {
  const { addBacklog, promotionContext } = await import('../lib/backlog.mjs');
  const root = project();
  const sentinel = 'a sentinel sentence a verifier would recognise';
  const { entry } = await addBacklog(root, {
    title: 'promote this idea',
    note: `${sentinel} <!-- astro-discuss: captured -->`,
    now: NOW,
  });

  const ctx = promotionContext(entry, { number: 21 });
  assert.match(ctx, new RegExp(sentinel));
  assert.doesNotMatch(ctx, /<!--\s*astro-discuss:\s*captured\b/i, 'the marker cannot survive the strip');

  const slug = '21-promote-this-idea';
  mkdirSync(join(root, '.astrocode', 'phases', slug), { recursive: true });
  writeFileSync(join(root, '.astrocode', 'phases', slug, 'CONTEXT.md'), ctx);
  assert.equal(phaseContextStatus(root, slug), 'stub', 'a promoted seed still owes a real /astro-discuss round');
});

test('promotionContext falls back to the title when there is no note', async () => {
  const { addBacklog, promotionContext } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry } = await addBacklog(root, { title: 'an idea with no note at all', now: NOW });
  const ctx = promotionContext(entry, { number: 3 });
  assert.match(ctx, /an idea with no note at all/);
});

// --- shape: kept out of debt's territory, C7 ---------------------------------------

test('an item record carries no priority, rank or score key — the backlog is a peer object, not a debt entry', async () => {
  const { addBacklog } = await import('../lib/backlog.mjs');
  const root = project();
  const { entry } = await addBacklog(root, { title: 'no priority field, ever', now: NOW });
  assert.equal(entry.priority, undefined);
  assert.equal(entry.rank, undefined);
  assert.equal(entry.score, undefined);
});
