// RED tests for the store-level forge import writer (P5, `lib/principles.mjs` — t4).
// `importForgeExport` does not exist on this branch yet, so it is reached only with
// `await import('../lib/principles.mjs')` inside each async test body (ADR-018). Every
// store is its own `mkdtempSync` dir — never a developer's real `~/.astro/principles/`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

function mkStoreDir() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-import-'));
}

function mdFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function digestDir(dir) {
  if (!existsSync(dir)) return 'ABSENT';
  const files = mdFiles(dir);
  const h = createHash('sha1');
  for (const f of files) h.update(`${f}\n${readFileSync(join(dir, f), 'utf8')}\n`);
  return h.digest('hex');
}

const NOW = new Date('2026-09-25T09:00:00.000Z');

function doc(nodes, overrides = {}) {
  return JSON.stringify({
    format: 'astro-forge-export', version: 1, exported_at: '2026-09-20T00:00:00.000Z',
    nodes, ...overrides,
  });
}

function fixtureNodes() {
  return [
    {
      slug: 'commit-lockfiles', type: 'Principle', name: 'Commit lockfiles',
      statement: 'Commit the lockfile with every dependency change', why: 'reproducible installs',
      status: 'approved', confidence: 'normal', created: '2026-09-01T00:00:00.000Z',
      signals: [{ text: 'AKIAIOSFODNN7EXAMPLE leaked in a signal', source: 'session a', at: '2026-09-01T00:00:00.000Z' }],
    },
    {
      slug: 'wip-branches', type: 'Pattern', statement: 'Keep WIP on a branch', status: 'pending',
      signals: [{ text: 'a token ghp_1234567890abcdef1234567890abcdef1234 leaked', source: 'session b', at: '2026-09-02T00:00:00.000Z' }],
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
  ];
}

// --- C1/C2: fixture imports; statuses/kinds; evidence, redaction --------------------

test('C1: the fixture imports offline and every forge status lands as the matching entry status/kind', async () => {
  const { importForgeExport, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const result = await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });
  assert.equal(result.created.length, 6);

  const { entries, damaged } = loadPrinciples(dir);
  assert.deepEqual(damaged, []);
  assert.equal(entries.length, 6);
  for (const e of entries) {
    // re-parses clean: loadPrinciples already threw nothing into damaged above.
    assert.ok(e.id);
  }
  const byStatement = new Map(entries.map((e) => [e.statement, e]));
  assert.equal(byStatement.get('Commit the lockfile with every dependency change').status, 'accepted');
  assert.equal(byStatement.get('Commit the lockfile with every dependency change').kind, 'principle');
  assert.equal(byStatement.get('Keep WIP on a branch').status, 'proposed');
  assert.equal(byStatement.get('Never force-push shared branches').status, 'rejected');
  assert.equal(byStatement.get('Never force-push shared branches').reason, 'too strict for solo repos');
  assert.equal(byStatement.get('Always squash merge').status, 'rejected');
  assert.ok(byStatement.get('Always squash merge').reason);
  assert.notEqual(byStatement.get('Old style guide rule').status, 'accepted');
  assert.notEqual(byStatement.get('Old style guide rule').status, 'proposed');
});

test('C2: no raw secret reaches disk, and an imported sighting excerpt matches the native redaction path', async () => {
  const { importForgeExport, loadPrinciples, proposePrinciple } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });

  const files = mdFiles(dir);
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'), `${f} must not carry the raw AWS key`);
    assert.ok(!/ghp_[A-Za-z0-9]{30,}/.test(text), `${f} must not carry the raw GitHub token`);
  }

  const dir2 = mkStoreDir();
  const native = await proposePrinciple(dir2, {
    statement: 'A native statement carrying a secret', kind: 'principle', why: 'why',
    source: { project: 'p', excerpt: 'a token ghp_1234567890abcdef1234567890abcdef1234 leaked' }, now: NOW,
  });
  const nativeExcerpt = native.entry.source.excerpt;

  const { entries } = loadPrinciples(dir);
  const wip = entries.find((e) => e.statement === 'Keep WIP on a branch');
  assert.equal(wip.sightings[0].excerpt, nativeExcerpt);
});

// --- C3: idempotent re-import --------------------------------------------------------

test('C3: re-running the identical import is byte-identical; adding a node/signal adds exactly one file/sighting', async () => {
  const { importForgeExport } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });
  const digest1 = digestDir(dir);

  await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });
  const digest2 = digestDir(dir);
  assert.equal(digest1, digest2);

  const nodesPlus = [...fixtureNodes()];
  nodesPlus[1] = {
    ...nodesPlus[1],
    signals: [...nodesPlus[1].signals, { text: 'a brand new signal', source: 'session c', at: '2026-09-03T00:00:00.000Z' }],
  };
  nodesPlus.push({ slug: 'fresh-node', type: 'Principle', statement: 'A fresh forge node', status: 'approved' });
  const before = mdFiles(dir).length;
  const result = await importForgeExport(dir, doc(nodesPlus), { now: NOW });
  assert.equal(result.created.length, 1);
  assert.equal(mdFiles(dir).length, before + 1);
});

// --- C4: re-import never overwrites a human decision ---------------------------------

test('C4: accepted/edited/rejected/amended entries survive a re-import with different forge data', async () => {
  const {
    importForgeExport, loadPrinciples, acceptPrinciple, amendPrinciple,
  } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });

  const { entries } = loadPrinciples(dir);
  const wip = entries.find((e) => e.statement === 'Keep WIP on a branch'); // proposed
  const noForce = entries.find((e) => e.statement === 'Never force-push shared branches'); // rejected
  const commit = entries.find((e) => e.statement === 'Commit the lockfile with every dependency change'); // accepted

  const accepted = await acceptPrinciple(dir, wip.id, { statement: 'Keep WIP work on its own branch always', now: NOW });
  // noForce is already rejected — used as-is below as the "kept rejected, reason
  // untouched" case (reject is illegal from rejected, so nothing further is done to it).
  const amended = await amendPrinciple(dir, commit.id, { reason: 'wording tweak', statement: 'Commit the lockfile every time deps change', now: NOW });

  const changedNodes = fixtureNodes().map((n) => {
    if (n.slug === 'wip-branches') return { ...n, status: 'rejected', reason: 'forge changed its mind', statement: 'Keep WIP on a branch (forge edit)' };
    if (n.slug === 'no-force-push') return { ...n, status: 'approved', statement: 'Never force-push shared branches (forge edit)' };
    if (n.slug === 'commit-lockfiles') return { ...n, status: 'rejected', reason: 'forge rejected it later', statement: 'Commit the lockfile with every dependency change (forge edit)' };
    return n;
  });
  await importForgeExport(dir, doc(changedNodes), { now: NOW });

  const { entries: after } = loadPrinciples(dir);
  const wipAfter = after.find((e) => e.id === accepted.id);
  const noForceAfter = after.find((e) => e.id === noForce.id);
  const commitAfter = after.find((e) => e.id === amended.id);

  assert.equal(wipAfter.status, 'accepted');
  assert.equal(wipAfter.statement, 'Keep WIP work on its own branch always');
  assert.equal(noForceAfter.status, 'rejected');
  assert.equal(noForceAfter.reason, 'too strict for solo repos');
  assert.equal(commitAfter.status, 'accepted');
  assert.equal(commitAfter.statement, 'Commit the lockfile every time deps change');
});

// --- C5: dedupe against native captures ----------------------------------------------

test('C5: a native addPrinciple statement equal (mod case/punctuation) to a forge node stays one entry', async () => {
  const { importForgeExport, addPrinciple, loadPrinciples } = await import('../lib/principles.mjs');
  const dir = mkStoreDir();
  const native = await addPrinciple(dir, {
    statement: 'commit the LOCKFILE with every dependency change!', kind: 'principle', now: NOW,
  });

  const result = await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });
  const sightedSlugs = result.sighted.map((s) => s.slug);
  assert.ok(sightedSlugs.includes('commit-lockfiles'));

  const { entries } = loadPrinciples(dir);
  const matches = entries.filter((e) => e.id === native.id);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].status, 'accepted');
  assert.equal(matches[0].statement, 'commit the LOCKFILE with every dependency change!');

  // a re-run keys on it — no twin, no new sighting
  const digestBefore = digestDir(dir);
  await importForgeExport(dir, doc(fixtureNodes()), { now: NOW });
  assert.equal(digestDir(dir), digestBefore);
});

// --- C6: malformed input refuses, writes nothing --------------------------------------

test('C6: invalid JSON and a schema-violating doc throw and write nothing; a damaged store refuses', async () => {
  const { importForgeExport } = await import('../lib/principles.mjs');

  const dir1 = join(mkStoreDir(), 'does-not-exist-yet');
  await assert.rejects(() => importForgeExport(dir1, 'not json {', { now: NOW }));
  assert.equal(existsSync(dir1), false);

  const dir2 = mkStoreDir();
  await importForgeExport(dir2, doc(fixtureNodes()), { now: NOW });
  const digestBefore = digestDir(dir2);
  await assert.rejects(() => importForgeExport(dir2, 'still not json {', { now: NOW }));
  assert.equal(digestDir(dir2), digestBefore);

  const badDoc = doc([{ slug: 'x', type: 'Bogus', statement: 'x', status: 'approved' }]);
  await assert.rejects(() => importForgeExport(dir2, badDoc, { now: NOW }));
  assert.equal(digestDir(dir2), digestBefore);

  // a damaged store entry blocks the whole import
  const dir3 = mkStoreDir();
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(dir3, { recursive: true });
  writeFileSync(join(dir3, 'damaged-1.md'), 'not a valid principle file\n');
  const digestBefore3 = digestDir(dir3);
  await assert.rejects(() => importForgeExport(dir3, doc(fixtureNodes()), { now: NOW }));
  assert.equal(digestDir(dir3), digestBefore3);
});
