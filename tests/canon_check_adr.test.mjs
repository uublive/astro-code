// canonCheck returns ADR findings, with or without a registry (phase 53 t7, ADR-087).
// Real bare remote and working copy; dynamic import of the new surface (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const canon = () => import('../lib/canon.mjs');
const adr = () => import('../lib/adr.mjs');

const mkBare = () => {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
};

function mkWork(bare, { seeded = true } = {}) {
  const w = mkdtempSync(join(tmpdir(), 'ac-chk-'));
  git(['init', '--quiet'], { cwd: w });
  git(['config', 'user.email', 'a@example.com'], { cwd: w });
  git(['config', 'user.name', 'a'], { cwd: w });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: w });
  initPlanning(w, { name: 'chk' });
  mkdirSync(join(w, 'docs/adr'), { recursive: true });
  const put = (name, title) => writeFileSync(join(w, 'docs/adr', name), `# ADR-${name.slice(0, 4)} — ${title}\n`);
  for (let i = 1; i <= 10; i++) put(`${String(i).padStart(4, '0')}-f${i}.md`, i === 3 ? 'three real' : `f${i}`);
  if (seeded) {
    put('0150-stray.md', 'stray');
    put('0007-second.md', 'second seven');
  }
  const log = '# Decisions\n\n## ADR-0003 — three logged\n_2026-01-01_\n\n## D-001 — fine\n_2026-01-01_\n\n' + (seeded ? '## ADR-045 — old series\n_2026-01-01_\n' : '');
  writeFileSync(paths(w).decisions, log);
  return w;
}

const claims = (backfill = true) => ({
  version: 1,
  claims: Array.from({ length: 10 }, (_, i) => ({ number: i + 1, source: 'backfill' })),
  backfill: backfill ? { at: 'x', log_width: 3, folder_width: 4, relabel: {} } : null,
});

async function seedRegistry(w) {
  const { claimsText } = await adr();
  const { transact } = await import('../lib/shared.mjs');
  const tx = transact(w, { remote: 'origin', branch: 'astro-registry', message: 'seed' }, () => ({ updates: { 'adr-claims.json': claimsText(claims()) } }));
  assert.equal(tx.ok, true);
}
const snapshotState = (w) => ({
  status: git(['status', '--porcelain', '-uall'], { cwd: w }).stdout,
  tip: git(['ls-remote', 'origin', 'refs/heads/astro-registry'], { cwd: w }).stdout,
});

test('canonCheck lists the four seeded problems from the registry claims', async () => {
  const { canonCheck } = await canon();
  const w = mkWork(mkBare());
  await seedRegistry(w);
  const res = canonCheck(w);
  assert.equal(res.available, true);
  assert.equal(res.adrOk, false);
  const kinds = res.adr.map((f) => `${f.kind}:${f.subject}`).sort();
  assert.deepEqual(kinds, [
    'duplicate:docs/adr/0007-second.md',
    'mismatch:docs/adr/0003-f3.md',
    'old-series:ADR-045',
    'unclaimed:docs/adr/0150-stray.md',
  ]);
  for (const f of res.adr) assert.match(f.fix, /^ac decision renumber /);
});

test('with no registry it falls back to the mirror, and reports not-backfilled when there is neither', async () => {
  const { canonCheck } = await canon();
  const { writeClaimsMirror } = await adr();
  const w = mkWork(null);
  const none = canonCheck(w);
  assert.equal(none.available, false);
  assert.deepEqual(none.adr.map((f) => f.kind).filter((k) => k !== 'duplicate' && k !== 'mismatch'), ['not-backfilled']);
  writeClaimsMirror(w, claims(), { dir: 'docs/adr', width: 4, source: 'detected' });
  const viaMirror = canonCheck(w);
  assert.ok(viaMirror.adr.some((f) => f.kind === 'unclaimed' && f.subject === 'docs/adr/0150-stray.md'));
  assert.ok(!viaMirror.adr.some((f) => f.kind === 'not-backfilled'));
});

test('a clean ADR project and a non-ADR project report `adr: []`', async () => {
  const { canonCheck } = await canon();
  const { writeClaimsMirror } = await adr();
  const w = mkWork(null, { seeded: false });
  writeFileSync(paths(w).decisions, '# Decisions\n\n## ADR-0003 — three real\n_2026-01-01_\n\n## D-001 — fine\n_2026-01-01_\n');
  writeClaimsMirror(w, claims(), { dir: 'docs/adr', width: 4, source: 'detected' });
  const clean = canonCheck(w);
  assert.deepEqual(clean.adr, []);
  assert.equal(clean.adrOk, true);
  const plain = mkdtempSync(join(tmpdir(), 'ac-plain-'));
  git(['init', '--quiet'], { cwd: plain });
  initPlanning(plain, { name: 'plain' });
  assert.deepEqual(canonCheck(plain).adr, []);
  // and through the registry path
  const bare = mkBare();
  git(['remote', 'add', 'origin', bare], { cwd: plain });
  git(['config', 'user.email', 'p@example.com'], { cwd: plain });
  git(['config', 'user.name', 'p'], { cwd: plain });
  const { addDecision } = await canon();
  await addDecision(plain, { title: 'plain one', why: 'w' });
  const reg = canonCheck(plain);
  assert.equal(reg.available, true);
  assert.deepEqual(reg.adr, []);
});

test('canonCheck changes neither the working tree nor the registry tip', async () => {
  const { canonCheck } = await canon();
  const w = mkWork(mkBare());
  await seedRegistry(w);
  const before = snapshotState(w);
  canonCheck(w);
  canonCheck(w);
  assert.deepEqual(snapshotState(w), before);
  assert.match(before.tip, /astro-registry/);
});
