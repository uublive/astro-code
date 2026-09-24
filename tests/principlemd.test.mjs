// Phase 22 t3 — spec for the entry-file codec (lib/principlemd.mjs), P3 of the phase
// plan. Pure unit tests, no filesystem, no git: this pins the exact `<id>.md` shape
// (fixed header, `---` separator, `# <statement>` + why body) so a future change to
// the render order or the damaged-detection rules fails loudly here first, before it
// can silently corrupt a personal store nobody but the owning developer reviews.
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// (`lib/principlemd.mjs`) does not exist on this branch yet (t4 is its own task in
// the same wave); a static import here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// A fully populated, canonical entry: two globs (one with a comma inside braces),
// stack + work lists, a source with a multi-line, quote-carrying excerpt, two
// promotions, two history lines. Exercises every repeatable header key at once.
function fullEntry() {
  return {
    id: '2026-09-24-never-mock-the-database',
    kind: 'antipattern',
    strength: 'rule',
    status: 'accepted',
    created: '2026-09-24T08:30:00.000Z',
    scopes: {
      stack: ['postgres', 'go'],
      files: ['migrations/**', '**/*.{test,spec}.*'],
      work: ['test', 'review'],
    },
    statement: 'Never mock the database in integration tests',
    why: 'Mocks hid a broken migration.',
    source: {
      session: 'sess-1',
      project: 'astro-code',
      at: '2026-09-24T08:00:00.000Z',
      ref: 'ADR-057',
      excerpt: 'line one\nline two "quoted"',
    },
    promotions: [
      { project: 'astro-code', path: '/abs/root', as: 'decision', ref: 'ADR-059', at: '2026-09-24T09:00:00.000Z' },
      { project: 'other', path: '/abs/other', as: 'convention', ref: 'convention', at: '2026-09-24T10:00:00.000Z' },
    ],
    history: [
      { at: '2026-09-24T08:10:00.000Z', action: 'accepted' },
      { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'clarify', statement: 'prior statement', why: 'prior why' },
    ],
  };
}

// The byte-exact canonical text P3 mandates for `fullEntry()` — fixed key order
// (id kind strength status created stack work files reason superseded-by source
// promotion history), one repeatable key per line, JSON on one line each.
const CANONICAL_TEXT = [
  '<!-- astro-principle -->',
  'id: 2026-09-24-never-mock-the-database',
  'kind: antipattern',
  'strength: rule',
  'status: accepted',
  'created: 2026-09-24T08:30:00.000Z',
  'stack: postgres, go',
  'work: test, review',
  'files: migrations/**',
  'files: **/*.{test,spec}.*',
  `source: ${JSON.stringify({ session: 'sess-1', project: 'astro-code', at: '2026-09-24T08:00:00.000Z', ref: 'ADR-057', excerpt: 'line one\nline two "quoted"' })}`,
  `promotion: ${JSON.stringify({ project: 'astro-code', path: '/abs/root', as: 'decision', ref: 'ADR-059', at: '2026-09-24T09:00:00.000Z' })}`,
  `promotion: ${JSON.stringify({ project: 'other', path: '/abs/other', as: 'convention', ref: 'convention', at: '2026-09-24T10:00:00.000Z' })}`,
  `history: ${JSON.stringify({ at: '2026-09-24T08:10:00.000Z', action: 'accepted' })}`,
  `history: ${JSON.stringify({ at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'clarify', statement: 'prior statement', why: 'prior why' })}`,
  '---',
  '',
  '# Never mock the database in integration tests',
  '',
  'Mocks hid a broken migration.',
  '',
].join('\n');

const FILE = '/store/2026-09-24-never-mock-the-database.md';

// --- round-trip -------------------------------------------------------------------

test('parse(render(entry)) round-trips a fully populated entry, deep-equal', async () => {
  const { renderPrinciple, parsePrinciple } = await import('../lib/principlemd.mjs');
  const entry = fullEntry();
  const text = renderPrinciple(entry);
  const parsed = parsePrinciple(text, { file: FILE, id: entry.id });
  assert.deepEqual(parsed, entry);
});

test('render(parse(text)) reproduces the canonical text byte-for-byte', async () => {
  const { renderPrinciple, parsePrinciple } = await import('../lib/principlemd.mjs');
  const parsed = parsePrinciple(CANONICAL_TEXT, { file: FILE, id: '2026-09-24-never-mock-the-database' });
  assert.equal(renderPrinciple(parsed), CANONICAL_TEXT);
});

test('renderPrinciple on the hand-built entry matches the hand-written canonical text', async () => {
  const { renderPrinciple } = await import('../lib/principlemd.mjs');
  assert.equal(renderPrinciple(fullEntry()), CANONICAL_TEXT);
});

// --- normaliseFields ---------------------------------------------------------------

test('normaliseFields lowercases and trims stack tags', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  const fields = normaliseFields({
    kind: 'antipattern', strength: 'rule',
    stack: ['Postgres', ' Go '], files: ['a/**'], work: ['test'],
    statement: 'A statement', why: 'because',
  });
  assert.deepEqual(fields.scopes.stack, ['postgres', 'go']);
});

test('normaliseFields throws on an out-of-enum kind', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  assert.throws(() => normaliseFields({
    kind: 'habit', strength: 'rule', stack: [], files: [], work: [],
    statement: 'A statement', why: '',
  }), /kind/i);
});

test('normaliseFields throws on an out-of-enum strength', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  assert.throws(() => normaliseFields({
    kind: 'principle', strength: 'maybe', stack: [], files: [], work: [],
    statement: 'A statement', why: '',
  }), /strength/i);
});

test('normaliseFields throws on an out-of-enum work scope', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  assert.throws(() => normaliseFields({
    kind: 'principle', strength: 'rule', stack: [], files: [], work: ['cooking'],
    statement: 'A statement', why: '',
  }), /work/i);
});

test('normaliseFields throws on an empty statement', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  assert.throws(() => normaliseFields({
    kind: 'principle', strength: 'rule', stack: [], files: [], work: [],
    statement: '', why: '',
  }), /statement/i);
});

test('normaliseFields throws on a multi-line statement', async () => {
  const { normaliseFields } = await import('../lib/principlemd.mjs');
  assert.throws(() => normaliseFields({
    kind: 'principle', strength: 'rule', stack: [], files: [], work: [],
    statement: 'line one\nline two', why: '',
  }), /statement/i);
});

// --- damaged entries: every one throws naming the file -----------------------------

function minimalCanonical({ replaceLine, dropLine, addLine, id = '2026-09-24-minimal' } = {}) {
  let lines = [
    '<!-- astro-principle -->',
    `id: ${id}`,
    'kind: principle',
    'strength: default',
    'status: proposed',
    'created: 2026-09-24T08:00:00.000Z',
    '---',
    '',
    '# A minimal statement',
    '',
    '',
  ];
  if (replaceLine) {
    const [match, replacement] = replaceLine;
    lines = lines.map((l) => (l.startsWith(match) ? replacement : l));
  }
  if (dropLine) lines = lines.filter((l) => !l.startsWith(dropLine));
  if (addLine) {
    const idx = lines.indexOf('---');
    lines.splice(idx, 0, addLine);
  }
  return lines.join('\n');
}

test('a damaged entry missing the status key throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ dropLine: 'status:' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /status/i.test(err.message),
  );
});

test('a damaged entry with a garbage kind throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ replaceLine: ['kind:', 'kind: habit'] });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /kind/i.test(err.message),
  );
});

test('an id that does not equal the filename stem throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ id: '2026-09-24-minimal' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-different' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /id/i.test(err.message),
  );
});

test('a duplicate header key throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ addLine: 'kind: principle' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /kind/i.test(err.message),
  );
});

test('an unknown header key throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ addLine: 'mood: happy' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /mood/i.test(err.message),
  );
});

test('unparseable history JSON throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ addLine: 'history: {not json' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /history/i.test(err.message),
  );
});

test('a missing marker line throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical().replace('<!-- astro-principle -->\n', '');
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /marker/i.test(err.message),
  );
});

test('a body missing the `# statement` line throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical().replace('# A minimal statement', 'A minimal statement, no heading');
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /statement/i.test(err.message),
  );
});

test('a rejected entry without a reason throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ replaceLine: ['status:', 'status: rejected'] });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /reason/i.test(err.message),
  );
});

test('a superseded entry without superseded-by throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ replaceLine: ['status:', 'status: superseded'] });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /superseded-by/i.test(err.message),
  );
});

test('a file carrying conflict markers is damaged, never read as valid', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const withConflict = minimalCanonical().replace(
    '# A minimal statement',
    '<<<<<<< HEAD\n# A minimal statement\n=======\n# A different statement\n>>>>>>> theirs',
  );
  assert.throws(
    () => parsePrinciple(withConflict, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE),
  );
});

// --- indexLine -----------------------------------------------------------------

test('indexLine renders one line carrying the id and the statement', async () => {
  const { indexLine } = await import('../lib/principlemd.mjs');
  const line = indexLine(fullEntry());
  assert.equal(line.includes('\n'), false, 'must be a single line');
  assert.match(line, /2026-09-24-never-mock-the-database/);
  assert.match(line, /Never mock the database in integration tests/);
});

// --- compareRevisions ------------------------------------------------------------

function withHistory(history, overrides = {}) {
  return { ...fullEntry(), history, ...overrides };
}

test('compareRevisions: a strict-prefix history is older, the extended one is newer', async () => {
  const { compareRevisions } = await import('../lib/principlemd.mjs');
  const h1 = { at: '2026-09-24T08:10:00.000Z', action: 'accepted' };
  const h2 = { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'r', statement: 's', why: 'w' };
  const older = withHistory([h1]);
  const newer = withHistory([h1, h2]);
  assert.equal(compareRevisions(newer, older), 'newer');
  assert.equal(compareRevisions(older, newer), 'older');
});

test('compareRevisions: byte-equal entries compare same', async () => {
  const { compareRevisions } = await import('../lib/principlemd.mjs');
  const a = fullEntry();
  const b = fullEntry();
  assert.equal(compareRevisions(a, b), 'same');
});

test('compareRevisions: divergent histories off the same base are a conflict', async () => {
  const { compareRevisions } = await import('../lib/principlemd.mjs');
  const base = { at: '2026-09-24T08:10:00.000Z', action: 'accepted' };
  const fromA = { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'r', statement: 'X-from-A', why: 'w' };
  const fromB = { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'r', statement: 'X-from-B', why: 'w' };
  const a = withHistory([base, fromA], { statement: 'X-from-A' });
  const b = withHistory([base, fromB], { statement: 'X-from-B' });
  assert.equal(compareRevisions(a, b), 'conflict');
  assert.equal(compareRevisions(b, a), 'conflict');
});

test('compareRevisions: equal histories with different text is a conflict', async () => {
  const { compareRevisions } = await import('../lib/principlemd.mjs');
  const h1 = { at: '2026-09-24T08:10:00.000Z', action: 'accepted' };
  const a = withHistory([h1], { statement: 'X-from-A' });
  const b = withHistory([h1], { statement: 'X-from-B' });
  assert.equal(compareRevisions(a, b), 'conflict');
});

// --- phase 24, P2: sightings (a new repeatable header key rendered after history) --

// Two sighting records: a plain evidence line and one carrying `mergedFrom` (folded in
// by `mergePrinciple`). Exercises the full `source`-shaped record plus the merge tag.
function entryWithSightings() {
  return {
    ...fullEntry(),
    sightings: [
      { project: 'astro-code', at: '2026-09-24T11:00:00.000Z', excerpt: 'seen again' },
      {
        session: 'sess-2', project: 'other', at: '2026-09-24T12:00:00.000Z',
        ref: 'ref-2', mergedFrom: '2026-09-24-other-entry',
      },
    ],
  };
}

const SIGHTING_LINES = [
  `sighting: ${JSON.stringify({ project: 'astro-code', at: '2026-09-24T11:00:00.000Z', excerpt: 'seen again' })}`,
  `sighting: ${JSON.stringify({
    session: 'sess-2', project: 'other', at: '2026-09-24T12:00:00.000Z',
    ref: 'ref-2', mergedFrom: '2026-09-24-other-entry',
  })}`,
];

// Sighting lines land right after the `history:` lines and before the `---` separator
// (P2: "rendered after `history`"), inserted into the existing fullEntry canonical text.
const CANONICAL_TEXT_WITH_SIGHTINGS = (() => {
  const lines = CANONICAL_TEXT.split('\n');
  const sepIdx = lines.indexOf('---');
  lines.splice(sepIdx, 0, ...SIGHTING_LINES);
  return lines.join('\n');
})();

test('an entry with sightings round-trips deep-equal and byte-exact, rendered after history', async () => {
  const { renderPrinciple, parsePrinciple } = await import('../lib/principlemd.mjs');
  const entry = entryWithSightings();
  const text = renderPrinciple(entry);
  assert.equal(text, CANONICAL_TEXT_WITH_SIGHTINGS);
  const parsed = parsePrinciple(text, { file: FILE, id: entry.id });
  assert.deepEqual(parsed, entry);
});

test('an entry without sightings parses with no sightings key at all', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const parsed = parsePrinciple(CANONICAL_TEXT, { file: FILE, id: '2026-09-24-never-mock-the-database' });
  assert.equal('sightings' in parsed, false);
});

test('a sighting: line with unparseable JSON throws naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ addLine: 'sighting: {not json' });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /sighting/i.test(err.message),
  );
});

// --- phase 24, P3: `merged` terminal state ------------------------------------------

function mergedEntry() {
  return {
    id: '2026-09-24-merged-example',
    kind: 'principle',
    strength: 'default',
    status: 'merged',
    created: '2026-09-24T08:00:00.000Z',
    scopes: { stack: [], files: [], work: [] },
    statement: 'A minimal statement',
    why: '',
    mergedInto: '2026-09-24-survivor',
    promotions: [],
    history: [{ at: '2026-09-24T08:10:00.000Z', action: 'merged', into: '2026-09-24-survivor' }],
  };
}

test('status merged + merged-into round-trips', async () => {
  const { renderPrinciple, parsePrinciple } = await import('../lib/principlemd.mjs');
  const entry = mergedEntry();
  const text = renderPrinciple(entry);
  assert.match(text, /^merged-into: 2026-09-24-survivor$/m);
  const parsed = parsePrinciple(text, { file: FILE, id: entry.id });
  assert.deepEqual(parsed, entry);
});

test('status merged without merged-into is damaged, naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({ replaceLine: ['status:', 'status: merged'] });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /merged-into/i.test(err.message),
  );
});

test('merged-into present on an accepted entry is damaged, naming the file', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = minimalCanonical({
    replaceLine: ['status:', 'status: accepted'],
    addLine: 'merged-into: 2026-09-24-survivor',
  });
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /merged-into/i.test(err.message),
  );
});

// --- phase 24, P2: header key order is now enforced by the parser ------------------

test('a header with status placed after created throws naming the file, out of order', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = [
    '<!-- astro-principle -->',
    'id: 2026-09-24-minimal',
    'kind: principle',
    'strength: default',
    'created: 2026-09-24T08:00:00.000Z',
    'status: proposed',
    '---',
    '',
    '# A minimal statement',
    '',
    '',
  ].join('\n');
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /out of order/i.test(err.message),
  );
});

test('a header with history before source throws naming the file, out of order', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const text = [
    '<!-- astro-principle -->',
    'id: 2026-09-24-minimal',
    'kind: principle',
    'strength: default',
    'status: proposed',
    'created: 2026-09-24T08:00:00.000Z',
    `history: ${JSON.stringify({ at: '2026-09-24T08:10:00.000Z', action: 'proposed' })}`,
    `source: ${JSON.stringify({ at: '2026-09-24T08:00:00.000Z' })}`,
    '---',
    '',
    '# A minimal statement',
    '',
    '',
  ].join('\n');
  assert.throws(
    () => parsePrinciple(text, { file: FILE, id: '2026-09-24-minimal' }),
    (err) => err instanceof Error && err.message.includes(FILE) && /out of order/i.test(err.message),
  );
});

test('a byte-exact phase-22-shaped canonical entry (no sighting or merged-into keys) still parses (C9)', async () => {
  const { parsePrinciple } = await import('../lib/principlemd.mjs');
  const parsed = parsePrinciple(CANONICAL_TEXT, { file: FILE, id: '2026-09-24-never-mock-the-database' });
  assert.equal(parsed.status, 'accepted');
  assert.equal('sightings' in parsed, false);
  assert.equal('mergedInto' in parsed, false);
});

// --- phase 24, P4: sync merges sightings append-only --------------------------------

test('unionSightings deduplicates and sorts deterministically regardless of argument order', async () => {
  const { unionSightings } = await import('../lib/principlemd.mjs');
  const s1 = { project: 'a', at: '2026-09-24T09:00:00.000Z' };
  const s2 = { project: 'b', at: '2026-09-24T08:00:00.000Z' };
  const s3 = { project: 'a', at: '2026-09-24T09:00:00.000Z' }; // duplicate of s1
  const forward = unionSightings([s1], [s2, s3]);
  const backward = unionSightings([s2, s3], [s1]);
  assert.deepEqual(forward, [s2, s1]);
  assert.deepEqual(forward, backward);
});

test('reconcileRevisions: equal history, differing sightings on both sides gives same with the union', async () => {
  const { reconcileRevisions } = await import('../lib/principlemd.mjs');
  const h = [{ at: '2026-09-24T08:10:00.000Z', action: 'accepted' }];
  const sA = { project: 'a', at: '2026-09-24T09:00:00.000Z' };
  const sB = { project: 'b', at: '2026-09-24T08:00:00.000Z' };
  const a = { ...fullEntry(), history: h, sightings: [sA] };
  const b = { ...fullEntry(), history: h, sightings: [sB] };
  const result = reconcileRevisions(a, b);
  assert.equal(result.outcome, 'same');
  assert.deepEqual(result.entry.sightings, [sB, sA]);
});

test('reconcileRevisions: an extended history wins the lifecycle, and both sides sightings survive', async () => {
  const { reconcileRevisions } = await import('../lib/principlemd.mjs');
  const h1 = { at: '2026-09-24T08:10:00.000Z', action: 'proposed' };
  const h2 = { at: '2026-09-24T08:20:00.000Z', action: 'accepted' };
  const sA = { project: 'a', at: '2026-09-24T09:00:00.000Z' };
  const sB = { project: 'b', at: '2026-09-24T08:00:00.000Z' };
  const older = { ...fullEntry(), status: 'proposed', history: [h1], sightings: [sA] };
  const newer = { ...fullEntry(), status: 'accepted', history: [h1, h2], sightings: [sB] };

  const result = reconcileRevisions(newer, older);
  assert.equal(result.outcome, 'newer');
  assert.equal(result.entry.status, 'accepted');
  assert.deepEqual(result.entry.history, [h1, h2]);
  assert.deepEqual(result.entry.sightings, [sB, sA]);

  const reverse = reconcileRevisions(older, newer);
  assert.equal(reverse.outcome, 'older');
  assert.equal(reverse.entry.status, 'accepted');
  assert.deepEqual(reverse.entry.sightings, [sB, sA]);
});

test('reconcileRevisions: divergent history off the same base is a conflict', async () => {
  const { reconcileRevisions } = await import('../lib/principlemd.mjs');
  const base = { at: '2026-09-24T08:10:00.000Z', action: 'accepted' };
  const fromA = { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'r', statement: 'X-from-A', why: 'w' };
  const fromB = { at: '2026-09-24T08:20:00.000Z', action: 'amended', reason: 'r', statement: 'X-from-B', why: 'w' };
  const a = { ...fullEntry(), history: [base, fromA], statement: 'X-from-A', sightings: [{ project: 'a', at: '2026-09-24T09:00:00.000Z' }] };
  const b = { ...fullEntry(), history: [base, fromB], statement: 'X-from-B', sightings: [{ project: 'b', at: '2026-09-24T09:30:00.000Z' }] };
  const result = reconcileRevisions(a, b);
  assert.deepEqual(result, { outcome: 'conflict' });
});
