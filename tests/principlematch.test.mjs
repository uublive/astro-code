// RED tests for the pure candidate-matcher module (P1, `lib/principlematch.mjs` — t2).
// Dynamic-imports the module inside every async test body (ADR-018) since the module
// does not exist on this branch yet; a static import here would crash the whole file
// at load. Entries are plain objects shaped like `parsePrinciple` output — no fs, no
// git, no redaction: this module is pure and callers pass already-redacted text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function entry(id, status, statement, extra = {}) {
  return { id, status, statement, ...extra };
}

// --- sameStatement / normaliseStatement ---------------------------------------------

test('sameStatement: case, punctuation, whitespace and dash variants all match (C1)', async () => {
  const { sameStatement } = await import('../lib/principlematch.mjs');
  const base = 'Always use pnpm, never npm, for lockfiles';
  const variants = [
    'always use PNPM — never npm for lockfiles.',
    'Always  use pnpm - never npm, for lockfiles',
    'always use pnpm – never npm for lockfiles', // en-dash
  ];
  for (const v of variants) {
    assert.equal(sameStatement(base, v), true, `expected same for: ${v}`);
  }
});

test('sameStatement: Risk-1 regression — sharing tokens is not sameness', async () => {
  const { sameStatement } = await import('../lib/principlematch.mjs');
  assert.equal(sameStatement('use pnpm for lockfiles', 'use npm for lockfiles'), false);
});

test('sameStatement: empty/blank statements never match each other', async () => {
  const { sameStatement } = await import('../lib/principlematch.mjs');
  assert.equal(sameStatement('', ''), false);
  assert.equal(sameStatement('   ', '.,;'), false);
});

test('normaliseStatement collapses punctuation/whitespace/dash runs to single spaces', async () => {
  const { normaliseStatement } = await import('../lib/principlematch.mjs');
  assert.equal(
    normaliseStatement('Always  use pnpm - never npm, for lockfiles'),
    'always use pnpm never npm for lockfiles',
  );
  assert.equal(normaliseStatement(undefined), '');
});

// --- statementTokens ------------------------------------------------------------------

test('statementTokens drops stopwords and folds plurals, keeps short non-plural tokens like js', async () => {
  const { statementTokens } = await import('../lib/principlematch.mjs');
  const tokens = statementTokens('Use pnpm for every lockfile in JS repos');
  assert.deepEqual(tokens, [...tokens].sort());
  assert.ok(tokens.includes('pnpm'));
  assert.ok(tokens.includes('lockfile'));
  assert.ok(tokens.includes('repo'));
  assert.ok(tokens.includes('js'));
  // stopwords never survive
  for (const stop of ['use', 'for', 'every', 'in']) {
    assert.ok(!tokens.includes(stop), `expected stopword dropped: ${stop}`);
  }
});

test('statementTokens folds a trailing s on tokens longer than 3 chars, but not a double-s', async () => {
  const { statementTokens } = await import('../lib/principlematch.mjs');
  assert.ok(statementTokens('lockfiles').includes('lockfile'));
  assert.ok(statementTokens('repos').includes('repo'));
  // "class" ends in "ss" so it is untouched
  assert.ok(statementTokens('class').includes('class'));
});

// --- findCandidates ---------------------------------------------------------------------

test('findCandidates: C4 overlap candidate with named shared tokens; unrelated statement gets none', async () => {
  const { findCandidates } = await import('../lib/principlematch.mjs');
  const accepted = entry('e1', 'accepted', 'Use pnpm for every lockfile in JS repos');
  const entries = [accepted];

  const overlapResult = findCandidates(entries, 'Commit the pnpm lockfile on every dependency change');
  assert.deepEqual(overlapResult.exact, []);
  assert.equal(overlapResult.overlap.length, 1);
  assert.equal(overlapResult.overlap[0].id, 'e1');
  assert.deepEqual([...overlapResult.overlap[0].shared].sort(), ['lockfile', 'pnpm']);

  const unrelatedResult = findCandidates(entries, 'Name tests as full sentences');
  assert.deepEqual(unrelatedResult.exact, []);
  assert.deepEqual(unrelatedResult.overlap, []);

  // deterministic: two runs produce byte-identical JSON
  const again = findCandidates(entries, 'Commit the pnpm lockfile on every dependency change');
  assert.equal(JSON.stringify(overlapResult), JSON.stringify(again));
});

test('findCandidates: exact match against a rejected entry carries its reason, sorted by id', async () => {
  const { findCandidates } = await import('../lib/principlematch.mjs');
  const entries = [
    entry('b', 'rejected', 'Always use pnpm, never npm, for lockfiles', { reason: 'not my style' }),
    entry('a', 'rejected', 'Always use pnpm, never npm, for lockfiles', { reason: 'not my style' }),
  ];
  const result = findCandidates(entries, 'always use PNPM — never npm for lockfiles.');
  assert.deepEqual(result.exact.map((m) => m.id), ['a', 'b']);
  assert.equal(result.exact[0].status, 'rejected');
  assert.equal(result.exact[0].reason, 'not my style');
});

test('findCandidates: overlap is sorted by shared-token count descending, then by id', async () => {
  const { findCandidates } = await import('../lib/principlematch.mjs');
  const entries = [
    entry('big', 'accepted', 'Commit the pnpm lockfile every dependency change repo'),
    entry('small', 'accepted', 'Use pnpm for lockfile'),
    entry('other-small', 'accepted', 'Use pnpm for lockfile'),
  ];
  const result = findCandidates(entries, 'pnpm lockfile dependency change repo commit');
  assert.equal(result.overlap.length, 3);
  assert.equal(result.overlap[0].id, 'big');
  // ties on shared.length go to smaller id
  assert.deepEqual(result.overlap.slice(1).map((m) => m.id), ['other-small', 'small']);
});

test('findCandidates considers every status', async () => {
  const { findCandidates } = await import('../lib/principlematch.mjs');
  const entries = [
    entry('p', 'proposed', 'Always use pnpm, never npm, for lockfiles'),
    entry('r', 'retired', 'Always use pnpm, never npm, for lockfiles'),
    entry('s', 'superseded', 'Always use pnpm, never npm, for lockfiles'),
    entry('m', 'merged', 'Always use pnpm, never npm, for lockfiles', { mergedInto: 'x' }),
  ];
  const result = findCandidates(entries, 'Always use pnpm, never npm, for lockfiles');
  assert.deepEqual(result.exact.map((m) => m.id).sort(), ['m', 'p', 'r', 's']);
});

// --- pickExactTarget ---------------------------------------------------------------------

test('pickExactTarget: priority accepted > proposed > rejected > retired > superseded > merged', async () => {
  const { pickExactTarget } = await import('../lib/principlematch.mjs');
  const candidates = [
    { id: 'p1', status: 'proposed' },
    { id: 'r1', status: 'rejected' },
    { id: 'a1', status: 'accepted' },
    { id: 'm1', status: 'merged' },
  ];
  assert.equal(pickExactTarget(candidates).id, 'a1');
  assert.equal(pickExactTarget(candidates.filter((c) => c.id !== 'a1')).id, 'p1');
  assert.equal(
    pickExactTarget(candidates.filter((c) => ['r1', 'm1'].includes(c.id))).id,
    'r1',
  );
});

test('pickExactTarget: ties on the same status go to the smaller id', async () => {
  const { pickExactTarget } = await import('../lib/principlematch.mjs');
  const candidates = [
    { id: 'b', status: 'accepted' },
    { id: 'a', status: 'accepted' },
  ];
  assert.equal(pickExactTarget(candidates).id, 'a');
});

// --- groupDuplicates ---------------------------------------------------------------------

test('groupDuplicates: builds connected components and skips singletons', async () => {
  const { groupDuplicates } = await import('../lib/principlematch.mjs');
  const a = entry('a', 'proposed', 'Commit the pnpm lockfile on every dependency change');
  const b = entry('b', 'proposed', 'Always commit the pnpm lockfile for every change');
  const c = entry('c', 'proposed', 'Always commit pnpm lockfile change dependency every');
  const lonely = entry('z', 'proposed', 'Name tests as full sentences');
  const groups = groupDuplicates([a, b, c, lonely]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0], ['a', 'b', 'c'].sort());
});

test('groupDuplicates: groups are ordered by their first id, ids within a group sorted', async () => {
  const { groupDuplicates } = await import('../lib/principlematch.mjs');
  const entries = [
    entry('z2', 'proposed', 'Always use pnpm, never npm, for lockfiles'),
    entry('z1', 'proposed', 'Always use pnpm, never npm, for lockfiles'),
    entry('a2', 'proposed', 'Name tests as full sentences always'),
    entry('a1', 'proposed', 'Name tests as full sentences always'),
  ];
  const groups = groupDuplicates(entries);
  assert.deepEqual(groups, [
    ['a1', 'a2'],
    ['z1', 'z2'],
  ]);
});

// --- buildReviewQueue ---------------------------------------------------------------------

test('buildReviewQueue: only proposed entries, with matches, groupWith and sightingCount', async () => {
  const { buildReviewQueue } = await import('../lib/principlematch.mjs');
  const rejected = entry('rej', 'rejected', 'Always use pnpm, never npm, for lockfiles', {
    reason: 'not my style',
  });
  const merged = entry('mrg', 'merged', 'Something else entirely unrelated statement', {
    mergedInto: 'acc',
  });
  const accepted = entry('acc', 'accepted', 'Something else entirely unrelated statement');
  const dup1 = entry('d1', 'proposed', 'always use PNPM — never npm for lockfiles.', {
    sightings: [{ at: '2026-09-24T00:00:00.000Z' }],
  });
  const dup2 = entry('d2', 'proposed', 'Always  use pnpm - never npm, for lockfiles');
  const other = entry('other', 'proposed', 'Name tests as full sentences');

  const queue = buildReviewQueue([rejected, merged, accepted, dup1, dup2, other]);
  const ids = queue.map((q) => q.id);
  assert.deepEqual(ids.sort(), ['d1', 'd2', 'other']);

  const d1 = queue.find((q) => q.id === 'd1');
  assert.equal(d1.sightingCount, 1);
  assert.ok(d1.matches.some((m) => m.id === 'rej' && m.status === 'rejected' && m.reason === 'not my style'));
  // merged entries never appear in matches
  assert.ok(!d1.matches.some((m) => m.id === 'mrg'));
  assert.deepEqual(d1.groupWith, ['d2']);

  const other2 = queue.find((q) => q.id === 'other');
  assert.equal(other2.sightingCount, 0);
  assert.deepEqual(other2.groupWith, []);
  assert.deepEqual(other2.matches, []);
});
