// adrConsistency, the one finding producer doctor and canon check share (phase 53 t3, ADR-087).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const adr = () => import('../lib/adr.mjs');

const det = { active: true, dir: 'docs/adr', source: 'detected', width: 4, candidates: ['docs/adr'] };
const file = (number, title, name) => ({
  number, width: 4, title, name: name || `${String(number).padStart(4, '0')}-x.md`,
  rel: `docs/adr/${name || `${String(number).padStart(4, '0')}-x.md`}`,
});
const claims = (nums, backfill = { at: 'x', log_width: 3, folder_width: 4, relabel: {} }) => ({
  version: 1, claims: nums.map((number) => ({ number, source: 'backfill' })), backfill,
});
const log = (...heads) => ['# Decisions', '', ...heads.flatMap(([id, t]) => [`## ${id} — ${t}`, '_2026-01-01_', ''])].join('\n');

test('an unclaimed file, a duplicate pair, a post-backfill 3-digit heading and a title-mismatched file each yield exactly one finding of their kind with a concrete fix', async () => {
  const { adrConsistency } = await adr();
  const files = [
    file(1, 'one'), file(2, 'two'), file(7, 'seven a', '0007-a.md'), file(7, 'seven b', '0007-b.md'),
    file(150, 'stray'), file(3, 'three real'),
  ];
  const out = adrConsistency({
    detection: det, files,
    decisionsText: log(['ADR-0001', 'one'], ['ADR-0003', 'three logged'], ['ADR-045', 'old one']),
    claims: claims([1, 2, 3, 7]),
  });
  const kinds = (k) => out.filter((f) => f.kind === k);
  assert.deepEqual(out.map((f) => f.kind).sort(), ['duplicate', 'mismatch', 'old-series', 'unclaimed']);
  assert.equal(kinds('unclaimed')[0].subject, 'docs/adr/0150-x.md');
  assert.equal(kinds('old-series')[0].subject, 'ADR-045');
  assert.equal(kinds('mismatch')[0].subject, 'docs/adr/0003-x.md');
  for (const f of out) assert.match(f.fix, /^ac (decision|config) /);
  assert.equal(kinds('duplicate')[0].fix, 'ac decision renumber docs/adr/0007-b.md next');
});

test('a duplicate names both files', async () => {
  const { adrConsistency } = await adr();
  const [f] = adrConsistency({
    detection: det, decisionsText: '', claims: claims([7]),
    files: [file(7, 'a', '0007-a.md'), file(7, 'b', '0007-b.md')],
  });
  assert.match(f.detail, /0007-a\.md/);
  assert.match(f.detail, /0007-b\.md/);
});

test('no claims record yields one not-backfilled finding, not one per file', async () => {
  const { adrConsistency } = await adr();
  const out = adrConsistency({ detection: det, decisionsText: '', claims: null, files: [file(1, 'a'), file(2, 'b'), file(3, 'c')] });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'not-backfilled');
  assert.equal(out[0].fix, 'ac decision backfill --apply');
  // claims recorded by `decision add` alone, with no backfill marker, are still "not backfilled" —
  // and a shared number is reported regardless
  const some = adrConsistency({
    detection: det, decisionsText: '', claims: claims([11], null),
    files: [file(1, 'a'), file(2, 'b', '0002-b.md'), file(2, 'c', '0002-c.md')],
  });
  assert.deepEqual(some.map((f) => f.kind).sort(), ['duplicate', 'not-backfilled']);
});

test('a clean backfilled project yields none', async () => {
  const { adrConsistency } = await adr();
  const out = adrConsistency({
    detection: det, files: [file(1, 'one'), file(2, 'two')],
    decisionsText: log(['ADR-0001', 'one'], ['D-002', 'old two'], ['D-003', 'old three']),
    claims: claims([1, 2]),
  });
  assert.deepEqual(out, []);
});

test('a non-ADR project yields none; an ambiguous one yields its config fix', async () => {
  const { adrConsistency } = await adr();
  const none = { active: false, source: 'none', candidates: [] };
  assert.deepEqual(adrConsistency({ detection: none, files: [], decisionsText: log(['ADR-001', 'a']), claims: null }), []);
  const amb = adrConsistency({ detection: { active: false, source: 'ambiguous', candidates: ['docs/adr', 'adr'] }, files: [], decisionsText: '', claims: null });
  assert.equal(amb[0].kind, 'ambiguous-dir');
  assert.equal(amb[0].fix, 'ac config set decisions.adr_dir docs/adr');
});

test('ADR-103 vs file 0103 compare numerically', async () => {
  const { adrConsistency } = await adr();
  // claimed 103: neither the file nor a 3-digit-looking heading at folder width is unclaimed
  const out = adrConsistency({
    detection: det, files: [file(103, 'same')],
    decisionsText: log(['ADR-0103', 'same']), claims: claims([103]),
  });
  assert.deepEqual(out, []);
  // the claim record is numeric, so an unclaimed 0103 is still caught
  const bad = adrConsistency({ detection: det, files: [file(103, 'same')], decisionsText: '', claims: claims([5]) });
  assert.equal(bad[0].kind, 'unclaimed');
});
