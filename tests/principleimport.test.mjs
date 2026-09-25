// RED tests for the pure forge-export parser and import planner (P1–P4, phase 27 t1 —
// `lib/principleimport.mjs`, landed in t2). ADR-018: every export this file needs is
// reached with `await import('../lib/principleimport.mjs')` inside each async test body,
// so this file loads cleanly even before t2 exists. Entries passed to `planForgeImport`
// are plain objects shaped exactly like `parsePrinciple` output (id, status, statement,
// source?, sightings?, mergedInto?) — this module never touches a filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const NOW = new Date('2026-09-25T09:00:00.000Z');

function counter(prefix = 'p') {
  let n = 0;
  return () => `${prefix}-${(n += 1)}`;
}

function baseDoc(nodes) {
  return {
    format: 'astro-forge-export',
    version: 1,
    exported_at: '2026-09-20T00:00:00.000Z',
    nodes,
  };
}

// --- parseForgeExport: happy path ---------------------------------------------------

test('parseForgeExport parses a full valid document', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([
    {
      slug: 'commit-lockfiles', type: 'Principle', name: 'Commit lockfiles',
      statement: 'Commit the\nlockfile with every dependency change', why: 'reproducible installs',
      status: 'approved', confidence: 'normal', created: '2026-09-01T00:00:00.000Z',
      signals: [{ text: "the user's words", source: 'session 8f2c', at: '2026-09-01T00:00:00.000Z' }],
    },
  ]);
  const parsed = parseForgeExport(JSON.stringify(doc));
  assert.equal(parsed.nodes.length, 1);
  // statement newlines collapse to a single space run
  assert.equal(parsed.nodes[0].statement, 'Commit the lockfile with every dependency change');
});

// --- parseForgeExport: refusals ------------------------------------------------------

test('parseForgeExport refuses text that is not valid JSON', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  assert.throws(() => parseForgeExport('not json at all {'), /json/i);
});

test('parseForgeExport refuses JSONL-looking text (one JSON object per line)', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const jsonl = `${JSON.stringify({ a: 1 })}\n${JSON.stringify({ b: 2 })}`;
  assert.throws(() => parseForgeExport(jsonl), /json/i);
});

test('parseForgeExport refuses an array top level', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  assert.throws(() => parseForgeExport(JSON.stringify([1, 2, 3])), /object|array/i);
});

test('parseForgeExport refuses the wrong format string', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = { ...baseDoc([]), format: 'something-else' };
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /format/i);
});

test('parseForgeExport refuses version 2', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = { ...baseDoc([]), version: 2 };
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /version/i);
});

test('parseForgeExport refuses an unknown envelope key', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = { ...baseDoc([]), extra: true };
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /extra/);
});

test('parseForgeExport refuses an unknown node key', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{
    slug: 'x', type: 'Principle', statement: 'x', status: 'approved', bogus: 1,
  }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /bogus/);
});

test('parseForgeExport refuses an unknown signal key', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{
    slug: 'x', type: 'Principle', statement: 'x', status: 'approved',
    signals: [{ text: 'x', bogus: 1 }],
  }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /bogus/);
});

test('parseForgeExport refuses a missing slug, naming nodes[1]', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([
    { slug: 'ok', type: 'Principle', statement: 'x', status: 'approved' },
    { type: 'Principle', statement: 'y', status: 'approved' },
  ]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /nodes\[1\]/);
});

test('parseForgeExport refuses a bad slug shape', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: '-bad', type: 'Principle', statement: 'x', status: 'approved' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /slug/i);
});

test('parseForgeExport refuses a duplicate slug', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([
    { slug: 'dup', type: 'Principle', statement: 'x', status: 'approved' },
    { slug: 'dup', type: 'Pattern', statement: 'y', status: 'approved' },
  ]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /duplicate/i);
});

test('parseForgeExport refuses an unknown type', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Concept', statement: 'x', status: 'approved' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /type/i);
});

test('parseForgeExport refuses an unknown status', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Principle', statement: 'x', status: 'maybe' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /status/i);
});

test('parseForgeExport refuses an empty statement', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Principle', statement: '   ', status: 'approved' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /statement/i);
});

test('parseForgeExport refuses a reason on an approved node', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Principle', statement: 'x', status: 'approved', reason: 'no' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /reason/i);
});

test('parseForgeExport refuses superseded_by on a pending node', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Principle', statement: 'x', status: 'pending', superseded_by: 'y' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /superseded_by/i);
});

test('parseForgeExport refuses a node superseding itself', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{ slug: 'x', type: 'Principle', statement: 'x', status: 'superseded', superseded_by: 'x' }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /itself|self/i);
});

test('parseForgeExport refuses a signal with no text', async () => {
  const { parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = baseDoc([{
    slug: 'x', type: 'Principle', statement: 'x', status: 'approved', signals: [{ source: 's' }],
  }]);
  assert.throws(() => parseForgeExport(JSON.stringify(doc)), /text/i);
});

// --- planForgeImport: the P2 mapping table ------------------------------------------

function criteriaNodes() {
  return [
    {
      slug: 'commit-lockfiles', type: 'Principle', name: 'Commit lockfiles',
      statement: 'Commit the lockfile with every dependency change', why: 'reproducible installs',
      status: 'approved', confidence: 'normal', created: '2026-09-01T00:00:00.000Z',
      signals: [{ text: 'signal one', source: 'session a', at: '2026-09-01T00:00:00.000Z' }],
    },
    {
      slug: 'wip-branches', type: 'Pattern', statement: 'Keep WIP on a branch', status: 'pending',
    },
    {
      slug: 'no-force-push', type: 'AntiPattern', statement: 'Never force-push shared branches',
      status: 'rejected', reason: 'too strict for solo repos',
    },
    {
      slug: 'always-squash', type: 'Preference', statement: 'Always squash merge', status: 'rejected',
    },
    {
      slug: 'old-style', type: 'Principle', statement: 'Old style guide rule', status: 'superseded',
      superseded_by: 'new-style',
    },
    {
      slug: 'new-style', type: 'Principle', statement: 'New style guide rule', status: 'approved',
    },
    {
      slug: 'orphan-superseded', type: 'Principle', statement: 'An orphaned rule', status: 'superseded',
      superseded_by: 'ghost-slug',
    },
    {
      slug: 'low-conf-pending', type: 'Pattern', statement: 'A low confidence pattern',
      status: 'pending', confidence: 'low',
    },
    {
      slug: 'low-conf-approved', type: 'Pattern', statement: 'A low confidence approved pattern',
      status: 'approved', confidence: 'low',
    },
  ];
}

test('planForgeImport maps every P2 status/kind combination correctly', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = parseForgeExport(JSON.stringify(baseDoc(criteriaNodes())));
  const plan = planForgeImport([], doc, { now: NOW, idFor: counter() });

  const byslug = new Map(plan.created.map((c) => [c.slug, c]));

  assert.equal(byslug.get('commit-lockfiles').status, 'accepted');
  assert.equal(byslug.get('commit-lockfiles').entry.kind, 'principle');
  assert.equal(byslug.get('wip-branches').status, 'proposed');
  assert.equal(byslug.get('wip-branches').entry.kind, 'pattern');

  const noForce = byslug.get('no-force-push');
  assert.equal(noForce.status, 'rejected');
  assert.equal(noForce.entry.kind, 'antipattern');
  assert.equal(noForce.entry.reason, 'too strict for solo repos');

  const squash = byslug.get('always-squash');
  assert.equal(squash.status, 'rejected');
  assert.equal(squash.entry.kind, 'preference');
  assert.ok(squash.entry.reason && squash.entry.reason.length > 0);

  // superseded → target later in the file still resolves
  const old = byslug.get('old-style');
  assert.equal(old.status, 'superseded');
  assert.equal(old.entry.supersededBy, byslug.get('new-style').id);

  const orphan = byslug.get('orphan-superseded');
  assert.equal(orphan.status, 'retired');
  assert.ok(orphan.entry.reason && /superseded/i.test(orphan.entry.reason));

  assert.equal(byslug.get('low-conf-pending').status, 'proposed');
  assert.equal(byslug.get('low-conf-approved').status, 'accepted');

  // scopes empty, history/source/sighting shape
  const c = byslug.get('commit-lockfiles').entry;
  assert.deepEqual(c.scopes, { stack: [], files: [], work: [] });
  assert.equal(c.history[0].action, 'imported');
  assert.equal(c.history[0].from, 'forge:commit-lockfiles');
  assert.equal(c.history[0].forgeStatus, 'approved');
  assert.equal(c.history[0].name, 'Commit lockfiles');
  assert.equal(c.source.ref, 'forge:commit-lockfiles');
  assert.equal(c.sightings.length, 1);
  assert.match(c.sightings[0].ref, /^forge:commit-lockfiles#/);
});

test('planForgeImport: a known slug with one new signal plans only that signal', async () => {
  const { planForgeImport, parseForgeExport, forgeSignalKey } = await import('../lib/principleimport.mjs');
  const oldSig = { text: 'already seen', source: 's', at: '2026-09-01T00:00:00.000Z' };
  const key = forgeSignalKey('known-slug', oldSig);
  const existing = {
    id: 'known-1', kind: 'principle', strength: 'default', status: 'accepted', created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: 'Known statement', why: '',
    promotions: [], history: [], source: { at: '2026-01-01T00:00:00.000Z', ref: 'forge:known-slug' },
    sightings: [{ at: oldSig.at, ref: `forge:known-slug#${key}` }],
  };
  const newSig = { text: 'a new one', source: 's2', at: '2026-09-02T00:00:00.000Z' };
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'known-slug', type: 'Principle', statement: 'Known statement changed', status: 'rejected', signals: [oldSig, newSig] },
  ])));
  const plan = planForgeImport([existing], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 0);
  assert.equal(plan.sighted.length, 1);
  assert.equal(plan.sighted[0].id, 'known-1');
  assert.equal(plan.sighted[0].added, 1);
});

test('planForgeImport: a known slug with no new signal plans nothing (unchanged)', async () => {
  const { planForgeImport, parseForgeExport, forgeSignalKey } = await import('../lib/principleimport.mjs');
  const sig = { text: 'already seen', source: 's', at: '2026-09-01T00:00:00.000Z' };
  const key = forgeSignalKey('known-slug', sig);
  const existing = {
    id: 'known-1', kind: 'principle', strength: 'default', status: 'accepted', created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: 'Known statement', why: '',
    promotions: [], history: [], source: { at: '2026-01-01T00:00:00.000Z', ref: 'forge:known-slug' },
    sightings: [{ at: sig.at, ref: `forge:known-slug#${key}` }],
  };
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'known-slug', type: 'Principle', statement: 'Known statement', status: 'approved', signals: [sig] },
  ])));
  const plan = planForgeImport([existing], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 0);
  assert.equal(plan.sighted.length, 0);
  assert.deepEqual(plan.unchanged, ['known-slug']);
});

test('planForgeImport never changes a known entry\'s field even when forge status/statement changed (accepted, rejected, edited, proposed)', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const mk = (id, status, extraHistory = []) => ({
    id, kind: 'principle', strength: 'default', status, created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: `${id} statement`, why: '',
    promotions: [], history: extraHistory, source: { at: '2026-01-01T00:00:00.000Z', ref: `forge:${id}` },
    ...(status === 'rejected' ? { reason: 'human rejected' } : {}),
  });
  const entries = [
    mk('e-accepted', 'accepted'),
    mk('e-rejected', 'rejected'),
    mk('e-edited', 'accepted', [{ action: 'edited', at: '2026-02-01T00:00:00.000Z' }]),
    mk('e-proposed', 'proposed'),
  ];
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'e-accepted', type: 'Principle', statement: 'forge changed this', status: 'rejected' },
    { slug: 'e-rejected', type: 'Principle', statement: 'forge changed this too', status: 'approved' },
    { slug: 'e-edited', type: 'Principle', statement: 'forge also changed this', status: 'rejected' },
    { slug: 'e-proposed', type: 'Principle', statement: 'forge changed this as well', status: 'approved' },
  ])));
  const plan = planForgeImport(entries, doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 0);
  // no fields changed — entries objects are untouched by the plan (plan only appends
  // sightings/unchanged, never returns a mutated entry for a known slug)
  for (const e of entries) {
    assert.equal(e.status, e.status); // sanity: same reference, never mutated
  }
});

test('planForgeImport: a native entry with a re-punctuated identical statement is sighted, not created', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const native = {
    id: 'native-1', kind: 'principle', strength: 'default', status: 'accepted', created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: 'Commit the Lockfile, with every dependency change!',
    why: '', promotions: [], history: [],
  };
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'commit-lockfiles', type: 'Principle', statement: 'commit the lockfile with every dependency change', status: 'approved' },
  ])));
  const plan = planForgeImport([native], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 0);
  assert.equal(plan.sighted.length, 1);
  assert.equal(plan.sighted[0].id, 'native-1');
  assert.equal(native.statement, 'Commit the Lockfile, with every dependency change!');
  assert.equal(native.status, 'accepted');
});

test('planForgeImport: an exact match lands on a merged entry\'s survivor', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const survivor = {
    id: 'survivor-1', kind: 'principle', strength: 'default', status: 'accepted', created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: 'Merged statement', why: '', promotions: [], history: [],
  };
  const dup = {
    id: 'dup-1', kind: 'principle', strength: 'default', status: 'merged', mergedInto: 'survivor-1',
    created: '2026-01-01T00:00:00.000Z', scopes: { stack: [], files: [], work: [] },
    statement: 'Merged statement', why: '', promotions: [], history: [],
  };
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'merged-slug', type: 'Principle', statement: 'Merged statement', status: 'approved' },
  ])));
  const plan = planForgeImport([survivor, dup], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 0);
  assert.equal(plan.sighted.length, 1);
  assert.equal(plan.sighted[0].id, 'survivor-1');
});

test('planForgeImport: an overlap-only candidate is created, never sighted', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const native = {
    id: 'native-2', kind: 'principle', strength: 'default', status: 'accepted', created: '2026-01-01T00:00:00.000Z',
    scopes: { stack: [], files: [], work: [] }, statement: 'Use pnpm for every lockfile in JS repos',
    why: '', promotions: [], history: [],
  };
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'overlap-slug', type: 'Principle', statement: 'Commit the pnpm lockfile on every dependency change', status: 'approved' },
  ])));
  const plan = planForgeImport([native], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 1);
  assert.equal(plan.sighted.length, 0);
});

test('planForgeImport: two nodes with the same statement in one file yield one creation and one sighting', async () => {
  const { planForgeImport, parseForgeExport } = await import('../lib/principleimport.mjs');
  const doc = parseForgeExport(JSON.stringify(baseDoc([
    { slug: 'first-slug', type: 'Principle', statement: 'The same idea stated twice', status: 'approved' },
    { slug: 'second-slug', type: 'Principle', statement: 'the same idea stated twice', status: 'approved' },
  ])));
  const plan = planForgeImport([], doc, { now: NOW, idFor: counter() });
  assert.equal(plan.created.length, 1);
  assert.equal(plan.sighted.length, 1);
  assert.equal(plan.sighted[0].id, plan.created[0].id);
});

// --- forgeSignalKey -------------------------------------------------------------------

test('forgeSignalKey is stable across calls and differs when text differs', async () => {
  const { forgeSignalKey } = await import('../lib/principleimport.mjs');
  const sig = { text: 'same text', source: 's', at: '2026-09-01T00:00:00.000Z' };
  const k1 = forgeSignalKey('slug-a', sig);
  const k2 = forgeSignalKey('slug-a', { ...sig });
  assert.equal(k1, k2);
  const k3 = forgeSignalKey('slug-a', { ...sig, text: 'different text' });
  assert.notEqual(k1, k3);
});

// --- exported constants ---------------------------------------------------------------

test('exports the documented constants', async () => {
  const {
    FORGE_TYPES, FORGE_STATUSES, FORGE_NODE_KEYS, FORGE_SIGNAL_KEYS, FORGE_ENVELOPE_KEYS,
  } = await import('../lib/principleimport.mjs');
  assert.deepEqual(Object.keys(FORGE_TYPES).sort(), ['AntiPattern', 'Pattern', 'Preference', 'Principle']);
  assert.deepEqual([...FORGE_STATUSES].sort(), ['approved', 'pending', 'rejected', 'superseded']);
  assert.ok(FORGE_NODE_KEYS.includes('slug') && FORGE_NODE_KEYS.includes('signals'));
  assert.deepEqual([...FORGE_SIGNAL_KEYS].sort(), ['at', 'source', 'text']);
  assert.deepEqual([...FORGE_ENVELOPE_KEYS].sort(), ['exported_at', 'format', 'nodes', 'version']);
});
