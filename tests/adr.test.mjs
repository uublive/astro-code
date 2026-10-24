// lib/adr.mjs core (phase 53 t2, ADR-087). Dynamic import: the module is new (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const adr = () => import('../lib/adr.mjs');

function fixture({ config } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'adr-'));
  mkdirSync(join(root, '.astrocode'), { recursive: true });
  mkdirSync(join(root, 'docs/adr'), { recursive: true });
  const titles = ['one', 'two', 'three thing', 'four', 'five', 'six', 'seven a', 'eight', 'nine', 'ten'];
  titles.forEach((t, i) => {
    const n = String(i + 1).padStart(4, '0');
    writeFileSync(join(root, 'docs/adr', `${n}-${t.replace(/ /g, '-')}.md`), `# ADR-${n} — ${t}\n\nbody\n`);
  });
  writeFileSync(join(root, 'docs/adr/0007-seven-b.md'), '# ADR-0007 — seven b\n');
  writeFileSync(join(root, 'docs/adr/README.md'), '# index\n');
  writeFileSync(join(root, 'docs/adr/0000-template.md'), '# template\n');
  const log = ['# Decisions', ''];
  for (let i = 1; i <= 6; i++) log.push(`## ADR-00${i} — ${i === 3 ? 'three thing' : `log ${i}`}`, '_2026-01-01_', '', '**Why:** w', '');
  writeFileSync(join(root, '.astrocode/DECISIONS.md'), log.join('\n'));
  if (config !== undefined) writeFileSync(join(root, '.astrocode/config.json'), JSON.stringify(config));
  return root;
}
const cleanup = (r) => rmSync(r, { recursive: true, force: true });

test('parseAdrRef reads ADR-103 and ADR-0103 as the same number with widths 3 and 4, and never matches ADR-01030', async () => {
  const { parseAdrRef } = await adr();
  const a = parseAdrRef('ADR-103');
  const b = parseAdrRef('ADR-0103');
  assert.equal(a.number, 103);
  assert.equal(b.number, 103);
  assert.deepEqual([a.width, b.width], [3, 4]);
  assert.equal(parseAdrRef('ADR-01030').number, 1030);
  assert.equal(parseAdrRef('D-007').series, 'D');
  assert.equal(parseAdrRef('see ADR-103'), null);
});

test('detectAdrDir reports detected/configured/off/none/ambiguous with the folder and width', async () => {
  const { detectAdrDir } = await adr();
  const r = fixture();
  try {
    const d = detectAdrDir(r);
    assert.deepEqual([d.active, d.dir, d.source, d.width], [true, 'docs/adr', 'detected', 4]);
    // ambiguous: a second candidate with numbered files
    mkdirSync(join(r, 'adr'));
    writeFileSync(join(r, 'adr/001-x.md'), '# x');
    const amb = detectAdrDir(r);
    assert.deepEqual([amb.active, amb.source, amb.candidates], [false, 'ambiguous', ['docs/adr', 'adr']]);
    // configured wins over ambiguity
    writeFileSync(join(r, '.astrocode/config.json'), JSON.stringify({ decisions: { adr_dir: 'adr' } }));
    const c = detectAdrDir(r);
    assert.deepEqual([c.active, c.dir, c.source, c.width], [true, 'adr', 'configured', 3]);
    for (const off of [false, '', 'OFF', 'off']) {
      writeFileSync(join(r, '.astrocode/config.json'), JSON.stringify({ decisions: { adr_dir: off } }));
      assert.equal(detectAdrDir(r).source, 'off');
      assert.equal(detectAdrDir(r).active, false);
    }
  } finally { cleanup(r); }
  const none = mkdtempSync(join(tmpdir(), 'adr-'));
  try {
    mkdirSync(join(none, '.astrocode'));
    assert.deepEqual([detectAdrDir(none).active, detectAdrDir(none).source], [false, 'none']);
  } finally { cleanup(none); }
});

test('an empty configured folder takes width 4', async () => {
  const { detectAdrDir } = await adr();
  const r = mkdtempSync(join(tmpdir(), 'adr-'));
  try {
    mkdirSync(join(r, '.astrocode'));
    writeFileSync(join(r, '.astrocode/config.json'), JSON.stringify({ decisions: { adr_dir: 'records/' } }));
    const d = detectAdrDir(r);
    assert.deepEqual([d.active, d.dir, d.source, d.width], [true, 'records', 'configured', 4]);
  } finally { cleanup(r); }
});

test('scanAdrFiles returns number, width, rel path and title, and skips README/template', async () => {
  const { scanAdrFiles } = await adr();
  const r = fixture();
  try {
    const files = scanAdrFiles(join(r, 'docs/adr'), 'docs/adr');
    assert.equal(files.length, 11);
    const three = files.find((f) => f.number === 3);
    assert.deepEqual([three.width, three.rel, three.title], [4, 'docs/adr/0003-three-thing.md', 'three thing']);
    assert.ok(!files.some((f) => /README|template/.test(f.name)));
    assert.equal(files.filter((f) => f.number === 7).length, 2);
  } finally { cleanup(r); }
});

test('nextAdrClaim is above every claim, every ADR- and D- heading and every file', async () => {
  const { nextAdrClaim } = await adr();
  assert.equal(nextAdrClaim({ files: [{ number: 10 }] }), 11);
  assert.equal(nextAdrClaim({ claims: { claims: [{ number: 40 }] }, files: [{ number: 10 }] }), 41);
  assert.equal(nextAdrClaim({ decisionsText: '## ADR-0050 — a\n\n## D-060 — b\n', files: [{ number: 10 }] }), 61);
  assert.equal(nextAdrClaim({}), 1);
});

test('adrFileName slugs, caps at 60 and falls back to `decision`', async () => {
  const { adrFileName } = await adr();
  assert.equal(adrFileName(11, 4, 'Use  Postgres, not MySQL!'), '0011-use-postgres-not-mysql.md');
  assert.equal(adrFileName(5, 3, '???'), '005-decision.md');
  const long = adrFileName(1, 4, 'word '.repeat(40));
  assert.ok(long.length <= 5 + 60 + 3);
  assert.ok(!/-\.md$/.test(long));
});

test('claims text round-trips and tolerates a missing or corrupt file as empty with no marker', async () => {
  const { parseClaims, claimsText } = await adr();
  const obj = { version: 1, claims: [{ number: 11, title: 't', source: 'add' }], backfill: { at: 'x', relabel: { 'ADR-001': 'D-001' } } };
  assert.deepEqual(parseClaims(claimsText(obj)), obj);
  for (const bad of [undefined, '', '{nope', '{"claims":3}']) {
    assert.deepEqual(parseClaims(bad), { version: 1, claims: [], backfill: null });
  }
});

test('applyRelabel rewrites `ADR-002` and leaves `ADR-0002`, the ADR-01020 lookalike and a D- id untouched', async () => {
  const { applyRelabel } = await adr();
  const map = { 'ADR-001': 'D-001', 'ADR-002': 'D-002' };
  const text = '## ADR-001 — a\nsee ADR-002 and ADR-0002 and ADR-01020 and ADR-0020, D-002, xADR-002, ADR-002.\n## ADR-0002 — keep\n';
  assert.equal(
    applyRelabel(text, map, { folderWidth: 4 }),
    '## D-001 — a\nsee D-002 and ADR-0002 and ADR-01020 and ADR-0020, D-002, xADR-002, D-002.\n## ADR-0002 — keep\n',
  );
  // equal widths: headings still move, references are left for a human
  assert.equal(
    applyRelabel('## ADR-001 — a\nsee ADR-001\n', { 'ADR-001': 'D-001' }, { folderWidth: 3 }),
    '## D-001 — a\nsee ADR-001\n',
  );
});

test('writeClaimsMirror creates `.local/.gitignore` and the mirror', async () => {
  const { writeClaimsMirror, readClaimsMirror } = await adr();
  const r = fixture();
  try {
    assert.equal(readClaimsMirror(r), null);
    writeClaimsMirror(r, { claims: [{ number: 11 }], backfill: null }, { dir: 'docs/adr', width: 4, source: 'detected' });
    assert.equal(readFileSync(join(r, '.astrocode/.local/.gitignore'), 'utf8'), '*\n');
    const m = readClaimsMirror(r);
    assert.deepEqual([m.claims[0].number, m.adr_dir, m.width, m.source], [11, 'docs/adr', 4, 'detected']);
    writeFileSync(join(r, '.astrocode/.local/adr-claims.json'), '{corrupt');
    assert.equal(readClaimsMirror(r), null);
    assert.ok(existsSync(join(r, '.astrocode/.local/.gitignore')));
  } finally { cleanup(r); }
});

test('buildRelabelMap keeps the 0003 mirror at folder width and relabels the rest to D-', async () => {
  const { buildRelabelMap, scanAdrFiles } = await adr();
  const { parseDecisionEntries } = await import('../lib/decisions.mjs');
  const r = fixture();
  try {
    const entries = parseDecisionEntries(readFileSync(join(r, '.astrocode/DECISIONS.md'), 'utf8'));
    const files = scanAdrFiles(join(r, 'docs/adr'), 'docs/adr');
    const { relabel, logWidth } = buildRelabelMap({ entries, files, folderWidth: 4 });
    assert.equal(logWidth, 3);
    assert.deepEqual(relabel, { 'ADR-001': 'D-001', 'ADR-002': 'D-002', 'ADR-003': 'ADR-0003', 'ADR-004': 'D-004', 'ADR-005': 'D-005', 'ADR-006': 'D-006' });
  } finally { cleanup(r); }
});
