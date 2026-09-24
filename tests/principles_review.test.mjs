// RED tests for the store's review-workflow verbs (P5, `lib/principles.mjs` — t7/t8).
// Dynamic-imports the module inside every async test body (ADR-018): `recordSighting`,
// `matchPrinciple`, `reopenPrinciple` and `mergePrinciple` do not exist on this branch
// yet, and propose-time dedupe reverses the phase-22/23 "re-proposing mints a fresh
// entry" contract, so a static import here would crash the whole file at module load.
// Every store uses its own `mkdtempSync` dir (explicit `dir`), never a developer's real
// `~/.astro/principles/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function mkStoreDir() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-review-'));
}

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function withoutSightingLines(text) {
  return text.split('\n').filter((l) => !l.startsWith('sighting: ')).join('\n');
}

const NOW = new Date('2026-09-24T08:00:00.000Z');

// --- C1: the pinned sighting-count guard --------------------------------------------

test('C1 (pinned count guard): 1 proposal + 3 formatting variants gives exactly 1 proposed entry with sightings.length === 3', async () => {
  const { proposePrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const first = await proposePrinciple(dir, {
    statement: 'Always use pnpm, never npm, for lockfiles', kind: 'principle', why: 'Seen in CI failures.',
    source: { project: 'p0', excerpt: 'always use pnpm' }, now: NOW,
  });
  assert.equal(first.created, true);
  assert.equal(first.entry.status, 'proposed');

  const variants = [
    { statement: 'always use PNPM — never npm for lockfiles.', project: 'p1' },
    { statement: 'Always  use pnpm - never npm, for lockfiles', project: 'p2' },
    { statement: 'always use pnpm – never npm for lockfiles', project: 'p3' },
  ];
  for (const v of variants) {
    const result = await proposePrinciple(dir, {
      statement: v.statement, kind: 'principle', why: '',
      source: { project: v.project, excerpt: v.statement }, now: NOW,
    });
    assert.equal(result.created, false);
    assert.equal(result.sighted, true);
    assert.equal(result.matched.id, first.entry.id);
  }

  const { entries } = loadPrinciples(dir);
  const proposed = entries.filter((e) => e.status === 'proposed');
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].sightings.length, 3);
  assert.equal(proposed[0].statement, 'Always use pnpm, never npm, for lockfiles');
  assert.deepEqual(proposed[0].sightings.map((s) => s.project).sort(), ['p1', 'p2', 'p3']);
  for (const s of proposed[0].sightings) assert.ok(s.excerpt);
});

// --- C2: repeats against accepted entries never re-queue, text unchanged -----------

test('C2: an exact repeat against an accepted entry records a sighting, mints no new entry, and leaves text unchanged', async () => {
  const {
    addPrinciple, proposePrinciple, acceptPrinciple, loadPrinciples,
  } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const acceptedA = await addPrinciple(dir, {
    statement: 'Commit the pnpm lockfile on every dependency change', kind: 'principle', why: 'CI reproducibility.', now: NOW,
  });
  const proposedB = await proposePrinciple(dir, {
    statement: 'Name every test as a full sentence', kind: 'principle', why: 'Readable failures.', now: NOW,
  });
  const acceptedB = await acceptPrinciple(dir, proposedB.entry.id, { statement: 'Name tests as full sentences', now: NOW });

  const fileA = join(dir, `${acceptedA.id}.md`);
  const fileB = join(dir, `${acceptedB.id}.md`);
  const snapshotA = readFileSync(fileA, 'utf8');
  const snapshotB = readFileSync(fileB, 'utf8');

  const rA = await proposePrinciple(dir, {
    statement: 'commit the PNPM lockfile — on every dependency change.', kind: 'principle', why: '',
    source: { project: 'px' }, now: NOW,
  });
  const rB = await proposePrinciple(dir, {
    statement: 'Name tests as full sentences', kind: 'principle', why: '',
    source: { project: 'py' }, now: NOW,
  });
  assert.equal(rA.created, false);
  assert.equal(rB.created, false);

  const { entries } = loadPrinciples(dir);
  assert.equal(entries.filter((e) => e.status === 'proposed').length, 0);
  assert.equal(entries.length, 2);

  assert.equal(withoutSightingLines(readFileSync(fileA, 'utf8')), snapshotA);
  assert.equal(withoutSightingLines(readFileSync(fileB, 'utf8')), snapshotB);
});

// --- C3: repeats against a rejected entry stay rejected, queue empty ---------------

test('C3: repeats against a rejected entry stay rejected with its reason and 3 sightings, queue empty', async () => {
  const { proposePrinciple, rejectPrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const proposed = await proposePrinciple(dir, {
    statement: 'Always write comments above every function', kind: 'principle', why: 'Reviewer preference.', now: NOW,
  });
  const rejected = await rejectPrinciple(dir, proposed.entry.id, { reason: 'not my style', now: NOW });

  const variants = [
    'always write comments above every function.',
    'Always  write comments - above every function',
    'always write comments – above every function',
  ];
  for (const [i, statement] of variants.entries()) {
    const result = await proposePrinciple(dir, {
      statement, kind: 'principle', why: '', source: { project: `p${i}` }, now: NOW,
    });
    assert.equal(result.created, false);
    assert.equal(result.matched.id, rejected.id);
    assert.equal(result.matched.status, 'rejected');
  }

  const { entries } = loadPrinciples(dir);
  assert.equal(entries.filter((e) => e.status === 'proposed').length, 0);
  const final = entries.find((e) => e.id === rejected.id);
  assert.equal(final.status, 'rejected');
  assert.equal(final.reason, 'not my style');
  assert.equal(final.sightings.length, 3);
});

// --- C4: overlap-only creates a new entry, matchPrinciple names it ------------------

test('C4: an overlap-only proposal creates a new proposed entry, matchPrinciple names it with shared tokens', async () => {
  const { addPrinciple, proposePrinciple, matchPrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const accepted = await addPrinciple(dir, {
    statement: 'Use pnpm for every lockfile in JS repos', kind: 'principle', why: 'Consistency.', now: NOW,
  });

  const result = await proposePrinciple(dir, {
    statement: 'Commit the pnpm lockfile on every dependency change', kind: 'principle', why: 'Seen in a PR.', now: NOW,
  });
  assert.equal(result.created, true);

  const { entries } = loadPrinciples(dir);
  assert.equal(entries.filter((e) => e.status === 'proposed').length, 1);

  // A fresh, never-stored wording: this call names the ACCEPTED entry as an overlap
  // candidate, never an exact one (the earlier proposal above is a different id).
  const match = matchPrinciple(dir, 'Commit pnpm lockfiles every time a dependency changes');
  assert.deepEqual(match.exact, []);
  const hit = match.overlap.find((m) => m.id === accepted.id);
  assert.ok(hit);
  assert.deepEqual([...hit.shared].sort(), ['lockfile', 'pnpm']);
});

// --- C5: secrets in an excerpt never reach disk -------------------------------------

test('C5: a secret-carrying excerpt on a sighting is redacted before it ever reaches disk', async () => {
  const { addPrinciple, proposePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  await addPrinciple(dir, { statement: 'Rotate leaked tokens immediately', kind: 'principle', why: 'Security.', now: NOW });
  const secretExcerpt = 'token AKIAIOSFODNN7EXAMPLE ghp_0123456789abcdefghijklmnopqrstuvwxyzAB leaked';
  await proposePrinciple(dir, {
    statement: 'Rotate leaked tokens immediately', kind: 'principle', why: '',
    source: { project: 'p', excerpt: secretExcerpt }, now: NOW,
  });

  for (const file of mdFiles(dir)) {
    const text = readFileSync(join(dir, file), 'utf8');
    assert.equal(text.includes('AKIAIOSFODNN7EXAMPLE'), false);
    assert.equal(text.includes('ghp_0123456789abcdefghijklmnopqrstuvwxyzAB'), false);
  }
});

// --- evidence-free capture still appends a bare sighting ----------------------------

test('a capture with no source evidence still appends a sighting carrying just at', async () => {
  const { addPrinciple, proposePrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const accepted = await addPrinciple(dir, { statement: 'Keep functions short', kind: 'principle', why: 'Readability.', now: NOW });
  await proposePrinciple(dir, { statement: 'Keep functions short', kind: 'principle', why: '', now: NOW });

  const { entries } = loadPrinciples(dir);
  const found = entries.find((e) => e.id === accepted.id);
  assert.equal(found.sightings.length, 1);
  assert.deepEqual(Object.keys(found.sightings[0]).sort(), ['at']);
});

// --- recordSighting on a merged id redirects to the survivor ------------------------

test('recordSighting on a merged id lands on its survivor and reports redirectedFrom', async () => {
  const { proposePrinciple, mergePrinciple, recordSighting, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const a = await proposePrinciple(dir, { statement: 'Prefer small pull requests', kind: 'principle', why: 'Reviewability.', now: NOW });
  const b = await proposePrinciple(dir, { statement: 'Keep pull requests small and focused for review', kind: 'principle', why: 'Reviewability.', now: NOW });
  await mergePrinciple(dir, b.entry.id, { into: a.entry.id, now: NOW });

  const result = await recordSighting(dir, b.entry.id, { source: { project: 'pz' }, now: NOW });
  assert.equal(result.entry.id, a.entry.id);
  assert.equal(result.redirectedFrom, b.entry.id);

  const { entries } = loadPrinciples(dir);
  const survivor = entries.find((e) => e.id === a.entry.id);
  assert.ok(survivor.sightings.some((s) => s.project === 'pz'));
});

// --- C6: reopen ----------------------------------------------------------------------

test('C6: reopen requires a reason and moves rejected -> proposed, keeping the id, history and sightings', async () => {
  const {
    proposePrinciple, rejectPrinciple, reopenPrinciple,
  } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const proposed = await proposePrinciple(dir, { statement: 'Write an ADR for every reversal', kind: 'principle', why: 'Traceability.', now: NOW });
  const rejected = await rejectPrinciple(dir, proposed.entry.id, { reason: 'too heavy', now: NOW });

  await assert.rejects(() => reopenPrinciple(dir, rejected.id, { now: NOW }), /reason/i);

  const reopened = await reopenPrinciple(dir, rejected.id, { reason: 'reconsidered', now: NOW });
  assert.equal(reopened.id, rejected.id);
  assert.equal(reopened.status, 'proposed');
  assert.equal('reason' in reopened, false);
  assert.ok(reopened.history.some((h) => h.action === 'rejected'));
  assert.ok(reopened.history.some((h) => h.action === 'reopened' && h.reason === 'reconsidered'));
});

test('C6: reopen of an accepted or a proposed entry throws "cannot reopen" and leaves the file byte-identical', async () => {
  const { addPrinciple, proposePrinciple, reopenPrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const accepted = await addPrinciple(dir, { statement: 'Squash before merge', kind: 'principle', why: 'Clean history.', now: NOW });
  const fileAccepted = join(dir, `${accepted.id}.md`);
  const before = readFileSync(fileAccepted, 'utf8');
  await assert.rejects(() => reopenPrinciple(dir, accepted.id, { reason: 'x', now: NOW }), /cannot reopen/);
  assert.equal(readFileSync(fileAccepted, 'utf8'), before);

  const proposed = await proposePrinciple(dir, { statement: 'Delete dead code eagerly', kind: 'principle', why: 'Hygiene.', now: NOW });
  await assert.rejects(() => reopenPrinciple(dir, proposed.entry.id, { reason: 'x', now: NOW }), /cannot reopen/);
});

// --- C7: merge -------------------------------------------------------------------------

test('C7: merging a duplicate folds its evidence into the survivor as a sighting, leaves both ids citable', async () => {
  const { proposePrinciple, mergePrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();

  const a = await proposePrinciple(dir, {
    statement: 'Always run migrations in a transaction', kind: 'principle', why: 'Atomicity.',
    source: { project: 'pa', excerpt: 'a excerpt' }, now: NOW,
  });
  const b = await proposePrinciple(dir, {
    statement: 'Run every migration inside a transaction', kind: 'principle', why: 'Atomicity, seen elsewhere.',
    source: { project: 'pb', excerpt: 'b excerpt' }, now: NOW,
  });

  const historyBefore = a.entry.history;
  const statementBefore = a.entry.statement;

  const { survivor, merged } = await mergePrinciple(dir, b.entry.id, { into: a.entry.id, now: NOW });
  assert.equal(merged.status, 'merged');
  assert.equal(merged.mergedInto, a.entry.id);
  assert.equal(existsSync(join(dir, `${b.entry.id}.md`)), true);

  assert.equal(survivor.statement, statementBefore);
  assert.equal(survivor.status, 'proposed');
  assert.deepEqual(survivor.history, historyBefore);
  assert.ok(survivor.sightings.some((s) => s.mergedFrom === b.entry.id && s.project === 'pb'));

  const { entries } = loadPrinciples(dir);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.filter((e) => e.status === 'proposed').map((e) => e.id), [a.entry.id]);

  // re-proposing B's exact wording lands a sighting on the survivor A, not a rejection
  const reproposed = await proposePrinciple(dir, {
    statement: 'Run every migration inside a transaction', kind: 'principle', why: '',
    source: { project: 'pc' }, now: NOW,
  });
  assert.equal(reproposed.created, false);
  assert.equal(reproposed.matched.id, a.entry.id);
});

test('C7: a self-merge throws', async () => {
  const { proposePrinciple, mergePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const a = await proposePrinciple(dir, { statement: 'Prefer explicit over implicit', kind: 'principle', why: 'Clarity.', now: NOW });
  await assert.rejects(() => mergePrinciple(dir, a.entry.id, { into: a.entry.id, now: NOW }), /itself/);
});

test('C7: merging an already-accepted duplicate throws', async () => {
  const { proposePrinciple, acceptPrinciple, mergePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const dup = await proposePrinciple(dir, { statement: 'Never commit secrets', kind: 'principle', why: 'Security.', now: NOW });
  const accepted = await acceptPrinciple(dir, dup.entry.id, { now: NOW });
  const survivor = await proposePrinciple(dir, { statement: 'Prefer immutable data structures', kind: 'principle', why: 'Safety.', now: NOW });
  await assert.rejects(
    () => mergePrinciple(dir, accepted.id, { into: survivor.entry.id, now: NOW }),
    /proposed → merged/,
  );
});

test('C7: merging into a rejected survivor throws', async () => {
  const { proposePrinciple, rejectPrinciple, mergePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const survivorProposal = await proposePrinciple(dir, { statement: 'Log every retry attempt', kind: 'principle', why: 'Debuggability.', now: NOW });
  const rejectedSurvivor = await rejectPrinciple(dir, survivorProposal.entry.id, { reason: 'noisy', now: NOW });
  const dup = await proposePrinciple(dir, { statement: 'Something totally unrelated statement here', kind: 'principle', why: 'x', now: NOW });
  await assert.rejects(
    () => mergePrinciple(dir, dup.entry.id, { into: rejectedSurvivor.id, now: NOW }),
    /a survivor must be proposed or accepted/,
  );
});

// --- Risk-8: merging the same duplicate twice ---------------------------------------

test('Risk-8: two sequential merges of the same duplicate — the second throws and changes nothing', async () => {
  const { proposePrinciple, mergePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const a = await proposePrinciple(dir, { statement: 'Prefer composition over inheritance always', kind: 'principle', why: 'Flexibility.', now: NOW });
  const b = await proposePrinciple(dir, { statement: 'Always prefer composition to inheritance here', kind: 'principle', why: 'Flexibility.', now: NOW });
  await mergePrinciple(dir, b.entry.id, { into: a.entry.id, now: NOW });

  const fileB = join(dir, `${b.entry.id}.md`);
  const snapshot = readFileSync(fileB, 'utf8');
  await assert.rejects(() => mergePrinciple(dir, b.entry.id, { into: a.entry.id, now: NOW }), (err) => err instanceof Error);
  assert.equal(readFileSync(fileB, 'utf8'), snapshot);
});
