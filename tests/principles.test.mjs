// RED tests for the personal principle store engine (P2/P4/P5/P6/P7, `lib/principles.mjs`
// — t8). Dynamic-imports the module inside every async test body (ADR-018) so this file,
// written in the same wave as t8's implementation, is not tied to import order; each test
// uses its own `mkdtempSync` dir so no test ever touches a developer's real
// `~/.astro/principles/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mkStoreDir() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-'));
}

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

// --- principlesDir / loadPrinciples on an absent dir -------------------------------

test('principlesDir defaults to $HOME/.astro/principles, ASTRO_PRINCIPLES_DIR wins', async () => {
  const { principlesDir } = await import('../lib/principles.mjs');
  assert.equal(principlesDir({ HOME: '/home/dev' }), join('/home/dev', '.astro', 'principles'));
  assert.equal(
    principlesDir({ HOME: '/home/dev', ASTRO_PRINCIPLES_DIR: '/elsewhere' }),
    '/elsewhere',
  );
});

test('loadPrinciples on an absent dir returns empty and creates nothing', async () => {
  const { loadPrinciples } = await import('../lib/principles.mjs');
  const dir = join(mkStoreDir(), 'does-not-exist-yet');
  const result = loadPrinciples(dir);
  assert.deepEqual(result, { entries: [], damaged: [] });
  assert.equal(existsSync(dir), false);
});

// --- add ----------------------------------------------------------------------------

test('addPrinciple writes exactly one accepted .md file with a dated-slug id', async () => {
  const { addPrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const entry = await addPrinciple(dir, {
    statement: 'Never mock the database in integration tests',
    kind: 'antipattern', why: 'Mocks hid a broken migration.', now,
  });
  assert.equal(entry.status, 'accepted');
  assert.match(entry.id, /^2026-09-24-never-mock-the-database/);
  const files = mdFiles(dir);
  assert.equal(files.length, 1);
  const text = readFileSync(join(dir, files[0]), 'utf8');
  assert.match(text, /Never mock the database in integration tests/);
  const { entries } = loadPrinciples(dir);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, 'accepted');
});

test('addPrinciple with propose:true creates a proposed entry instead', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const entry = await addPrinciple(dir, {
    statement: 'Prefer composition over inheritance', kind: 'principle', why: 'Seen twice this month.', propose: true,
  });
  assert.equal(entry.status, 'proposed');
});

// A fresh proposal (D4b, CRITERIA C5) carries no signal for a human reviewer without its
// why — a plain human `add` (propose:false) still allows an empty why (D7: manual add is
// not subject to the review rules), so the refusal is scoped to the propose path only.
test('a fresh proposal (no id) without a why is refused, and writes nothing', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = join(mkStoreDir(), 'does-not-exist-yet');
  await assert.rejects(
    () => addPrinciple(dir, { statement: 'No why here', kind: 'principle', propose: true }),
    /why/i,
  );
  await assert.rejects(
    () => addPrinciple(dir, { statement: 'Empty why', kind: 'principle', why: '   ', propose: true }),
    /why/i,
  );
  assert.ok(!existsSync(dir), 'the store must not be created when a proposal is refused');
});

// --- validation leaves the store untouched -------------------------------------------

test('an invalid kind throws and touches nothing', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await assert.rejects(() => addPrinciple(dir, { statement: 'x', kind: 'habit' }));
  assert.equal(mdFiles(dir).length, 0);
});

test('an invalid strength throws and touches nothing', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await assert.rejects(() => addPrinciple(dir, { statement: 'x', kind: 'principle', strength: 'maybe' }));
  assert.equal(mdFiles(dir).length, 0);
});

test('an invalid work scope throws and touches nothing', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await assert.rejects(() => addPrinciple(dir, { statement: 'x', kind: 'principle', work: ['cooking'] }));
  assert.equal(mdFiles(dir).length, 0);
});

// --- id collisions --------------------------------------------------------------------

test('the same statement added twice the same day gets a distinct id, first file untouched', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const first = await addPrinciple(dir, { statement: 'Write tests first', kind: 'principle', now });
  const firstFile = join(dir, `${first.id}.md`);
  const firstBytesBefore = readFileSync(firstFile);
  const second = await addPrinciple(dir, { statement: 'Write tests first', kind: 'principle', now });
  assert.notEqual(first.id, second.id);
  // one random suffix per creation (phase-22 verify, C6/C10): same slug, different id
  assert.match(first.id, /^2026-09-24-write-tests-first-[0-9a-f]{4}$/);
  assert.equal(second.id.slice(0, -5), first.id.slice(0, -5));
  assert.equal(mdFiles(dir).length, 2);
  assert.deepEqual(readFileSync(firstFile), firstBytesBefore);
});

test('resolvePrinciple: exact id wins, unique prefix resolves, ambiguous and unknown throw', async () => {
  const { addPrinciple, resolvePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const a = await addPrinciple(dir, { statement: 'Alpha principle', kind: 'principle', now });
  const b = await addPrinciple(dir, { statement: 'Beta principle', kind: 'principle', now });

  assert.equal(resolvePrinciple(dir, a.id).id, a.id);
  assert.equal(resolvePrinciple(dir, a.id.slice(0, -5)).id, a.id);

  const sharedPrefix = a.id.slice(0, 10);
  const bPrefixed = b.id.startsWith(sharedPrefix);
  if (bPrefixed) {
    assert.throws(() => resolvePrinciple(dir, sharedPrefix), /ambiguous/i);
  }

  assert.throws(() => resolvePrinciple(dir, 'nonexistent-id-xyz'), /no principle found/i);
});

// --- lifecycle: legal and illegal moves -----------------------------------------------

async function proposedEntry(dir, now, statement = 'A proposed principle') {
  const { addPrinciple } = await import('../lib/principles.mjs');
  return addPrinciple(dir, { statement, kind: 'principle', why: 'Seen more than once.', propose: true, now });
}

test('accept moves proposed to accepted', async () => {
  const { acceptPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const p = await proposedEntry(dir, now);
  const accepted = await acceptPrinciple(dir, p.id, { now });
  assert.equal(accepted.status, 'accepted');
});

test('reject moves proposed to rejected and requires a reason', async () => {
  const { rejectPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const p = await proposedEntry(dir, now);
  await assert.rejects(() => rejectPrinciple(dir, p.id, { now }));
  const rejected = await rejectPrinciple(dir, p.id, { reason: 'not applicable here', now });
  assert.equal(rejected.status, 'rejected');
});

test('retire moves accepted to retired and requires a reason', async () => {
  const { addPrinciple, retirePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const a = await addPrinciple(dir, { statement: 'Old rule', kind: 'principle', now });
  await assert.rejects(() => retirePrinciple(dir, a.id, { now }));
  const retired = await retirePrinciple(dir, a.id, { reason: 'no longer relevant', now });
  assert.equal(retired.status, 'retired');
});

test('supersede requires an existing, different, accepted target', async () => {
  const { addPrinciple, supersedePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const a = await addPrinciple(dir, { statement: 'Old approach', kind: 'principle', now });
  const b = await addPrinciple(dir, { statement: 'New approach', kind: 'principle', now });

  await assert.rejects(() => supersedePrinciple(dir, a.id, { by: 'no-such-id', now }));
  await assert.rejects(() => supersedePrinciple(dir, a.id, { by: a.id, now }));

  const proposed = await proposedEntry(dir, now, 'Still under review');
  await assert.rejects(() => supersedePrinciple(dir, a.id, { by: proposed.id, now }));

  const superseded = await supersedePrinciple(dir, a.id, { by: b.id, now });
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.supersededBy, b.id);
});

test('amend keeps the id, requires a reason and an actual change, records prior text', async () => {
  const { addPrinciple, amendPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const a = await addPrinciple(dir, { statement: 'Original statement', kind: 'principle', why: 'original why', now });

  await assert.rejects(() => amendPrinciple(dir, a.id, { statement: 'Reworded statement', now }));
  await assert.rejects(() => amendPrinciple(dir, a.id, { reason: 'clarify', now }));

  const amended = await amendPrinciple(dir, a.id, { reason: 'clarify', statement: 'Reworded statement', now });
  assert.equal(amended.id, a.id);
  assert.equal(amended.statement, 'Reworded statement');
  assert.equal(mdFiles(dir).length, 1);
  const lastHistory = amended.history[amended.history.length - 1];
  assert.equal(lastHistory.action, 'amended');
  assert.equal(lastHistory.statement, 'Original statement');
  assert.equal(lastHistory.why, 'original why');
});

test('illegal moves throw and leave the file byte-identical', async () => {
  const { addPrinciple, retirePrinciple, supersedePrinciple, rejectPrinciple, acceptPrinciple } =
    await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');

  const proposed = await proposedEntry(dir, now, 'A proposal not yet reviewed');
  const proposedFile = join(dir, `${proposed.id}.md`);
  const proposedBytes = readFileSync(proposedFile);
  await assert.rejects(() => retirePrinciple(dir, proposed.id, { reason: 'x', now }));
  await assert.rejects(() => supersedePrinciple(dir, proposed.id, { by: proposed.id, now }));
  assert.deepEqual(readFileSync(proposedFile), proposedBytes);

  const accepted = await addPrinciple(dir, { statement: 'Already accepted', kind: 'principle', now });
  const acceptedFile = join(dir, `${accepted.id}.md`);
  const acceptedBytes = readFileSync(acceptedFile);
  await assert.rejects(() => rejectPrinciple(dir, accepted.id, { reason: 'x', now }));
  await assert.rejects(() => acceptPrinciple(dir, accepted.id, { now }));
  assert.deepEqual(readFileSync(acceptedFile), acceptedBytes);

  const proposed3 = await proposedEntry(dir, now, 'Will be rejected');
  const rejected = await rejectPrinciple(dir, proposed3.id, { reason: 'not needed', now });
  const rejectedFile = join(dir, `${rejected.id}.md`);
  const rejectedBytes = readFileSync(rejectedFile);
  await assert.rejects(() => acceptPrinciple(dir, rejected.id, { now }));
  assert.deepEqual(readFileSync(rejectedFile), rejectedBytes);
});

// --- one mutation touches exactly that entry's file -----------------------------------

test('with 4 entries, one mutation changes exactly that entry\'s file hash', async () => {
  const { addPrinciple, retirePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const entries = [];
  for (let i = 0; i < 4; i++) {
    entries.push(await addPrinciple(dir, { statement: `Entry number ${i}`, kind: 'principle', now }));
  }
  const before = new Map(entries.map((e) => [e.id, readFileSync(join(dir, `${e.id}.md`))]));
  await retirePrinciple(dir, entries[2].id, { reason: 'superseded by newer practice', now });
  for (const e of entries) {
    const after = readFileSync(join(dir, `${e.id}.md`));
    if (e.id === entries[2].id) assert.notDeepEqual(after, before.get(e.id));
    else assert.deepEqual(after, before.get(e.id));
  }
});

// --- damaged files ---------------------------------------------------------------------

test('a damaged file is listed under damaged; resolving or mutating it throws and leaves it untouched', async () => {
  const { addPrinciple, loadPrinciples, resolvePrinciple, retirePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const good = await addPrinciple(dir, { statement: 'A healthy entry', kind: 'principle', now });

  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(dir, { recursive: true });
  const damagedId = '2026-09-24-damaged-entry';
  const damagedFile = join(dir, `${damagedId}.md`);
  writeFileSync(damagedFile, '<!-- astro-principle -->\nid: ' + damagedId + '\nmood: happy\n---\n\n# broken\n');
  const damagedBytes = readFileSync(damagedFile);

  const { entries, damaged } = loadPrinciples(dir);
  assert.equal(entries.length, 1);
  assert.equal(damaged.length, 1);
  assert.equal(damaged[0].id, damagedId);

  assert.throws(() => resolvePrinciple(dir, damagedId), (e) => e.message.includes(damagedFile));
  await assert.rejects(() => retirePrinciple(dir, damagedId, { reason: 'x', now }));
  assert.deepEqual(readFileSync(damagedFile), damagedBytes);

  const goodFile = join(dir, `${good.id}.md`);
  const goodBytesBefore = readFileSync(goodFile);
  await retirePrinciple(dir, good.id, { reason: 'no longer needed', now });
  assert.deepEqual(readFileSync(damagedFile), damagedBytes);

  const collision = await addPrinciple(dir, { statement: 'Damaged Entry', kind: 'principle', now });
  assert.notEqual(collision.id, damagedId);
});

// --- secrets never land in the store -----------------------------------------------

test('a source excerpt with secrets is redacted before it is ever written to disk', async () => {
  const { addPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const secretToken = 'ghp_' + 'a'.repeat(36);
  const entry = await addPrinciple(dir, {
    statement: 'Rotate leaked tokens immediately', kind: 'principle', now,
    source: {
      session: 'sess-1', project: 'astro-code', ref: 'ADR-057',
      excerpt: `deploy with token=${secretToken} against git.example.com/r.git`,
    },
  });
  assert.equal(entry.source.excerpt.includes(secretToken), false);
  assert.match(entry.source.excerpt, /deploy with/);
  assert.match(entry.source.excerpt, /git\.example\.com\/r\.git/);

  for (const file of mdFiles(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    assert.equal(text.includes(secretToken), false);
  }
});

// --- proposePrinciple refresh rules (ADR-058) -----------------------------------------

test('proposePrinciple({id}) refreshes a plain proposed entry', async () => {
  const { proposePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const first = await proposePrinciple(dir, { statement: 'Observed pattern', kind: 'pattern', why: 'Seen more than once.', now });
  assert.equal(first.ok, true);
  const later = new Date('2026-09-24T09:00:00.000Z');
  const refreshed = await proposePrinciple(dir, {
    id: first.entry.id, statement: 'Observed pattern, refined', kind: 'pattern', now: later,
  });
  assert.equal(refreshed.ok, true);
  assert.equal(refreshed.refreshed, true);
  assert.equal(refreshed.entry.statement, 'Observed pattern, refined');
  assert.equal(refreshed.entry.status, 'proposed');
});

test('proposePrinciple({id}) refuses to touch accepted, rejected or edited-on-accept entries', async () => {
  const { addPrinciple, proposePrinciple, acceptPrinciple, rejectPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');

  const accepted = await addPrinciple(dir, { statement: 'A human wrote this directly', kind: 'principle', now });
  const acceptedFile = join(dir, `${accepted.id}.md`);
  const acceptedBytes = readFileSync(acceptedFile);
  const resAccepted = await proposePrinciple(dir, { id: accepted.id, statement: 'try to overwrite', kind: 'principle', now });
  assert.equal(resAccepted.ok, false);
  assert.deepEqual(readFileSync(acceptedFile), acceptedBytes);

  const proposed1 = await proposePrinciple(dir, { statement: 'Will be rejected', kind: 'principle', why: 'Seen more than once.', now });
  const rejected = await rejectPrinciple(dir, proposed1.entry.id, { reason: 'not useful', now });
  const rejectedFile = join(dir, `${rejected.id}.md`);
  const rejectedBytes = readFileSync(rejectedFile);
  const resRejected = await proposePrinciple(dir, { id: rejected.id, statement: 'try again', kind: 'principle', now });
  assert.equal(resRejected.ok, false);
  assert.deepEqual(readFileSync(rejectedFile), rejectedBytes);

  const proposed2 = await proposePrinciple(dir, { statement: 'Will be edited on accept', kind: 'principle', why: 'Seen more than once.', now });
  const editedAccepted = await acceptPrinciple(dir, proposed2.entry.id, { statement: 'A human reworded this', now });
  const editedFile = join(dir, `${editedAccepted.id}.md`);
  const editedBytes = readFileSync(editedFile);
  const resEdited = await proposePrinciple(dir, { id: editedAccepted.id, statement: 'try once more', kind: 'principle', now });
  assert.equal(resEdited.ok, false);
  assert.deepEqual(readFileSync(editedFile), editedBytes);

  assert.notEqual(resAccepted.entry?.status, 'accepted');
});

test('no propose path can ever yield an accepted entry', async () => {
  const { proposePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const first = await proposePrinciple(dir, { statement: 'Never accepted directly', kind: 'principle', why: 'Seen more than once.', now });
  assert.equal(first.entry.status, 'proposed');
  const refreshed = await proposePrinciple(dir, { id: first.entry.id, statement: 'still not accepted', kind: 'principle', now });
  assert.equal(refreshed.entry.status, 'proposed');
});

// --- recordPromotion --------------------------------------------------------------------

test('recordPromotion appends a promotion, keeps status accepted, dedupes identical records', async () => {
  const { addPrinciple, recordPromotion } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const now = new Date('2026-09-24T08:00:00.000Z');
  const a = await addPrinciple(dir, { statement: 'Promote me', kind: 'principle', now });

  const withOne = await recordPromotion(dir, a.id, {
    project: 'astro-code', path: '/abs/root', as: 'decision', ref: 'ADR-059', now,
  });
  assert.equal(withOne.status, 'accepted');
  assert.equal(withOne.promotions.length, 1);

  const withTwo = await recordPromotion(dir, a.id, {
    project: 'other-project', path: '/abs/other', as: 'convention', ref: 'convention', now,
  });
  assert.equal(withTwo.promotions.length, 2);

  const dedup = await recordPromotion(dir, a.id, {
    project: 'astro-code', path: '/abs/root', as: 'decision', ref: 'ADR-059', now,
  });
  assert.equal(dedup.promotions.length, 2);
});
