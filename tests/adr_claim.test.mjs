// addDecision claims ONE number across DECISIONS.md and the project's ADR folder (phase 53 t4, ADR-087).
// Real bare remote and a real working copy (never stubs). Dynamic import of the new surface (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const canon = () => import('../lib/canon.mjs');
const adr = () => import('../lib/adr.mjs');

function mkBare() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}
function mkWork(bare, name, { dir = 'docs/adr', width = 4, top = 10, config } = {}) {
  const w = mkdtempSync(join(tmpdir(), `ac-adr-${name}-`));
  git(['init', '--quiet'], { cwd: w });
  git(['config', 'user.email', `${name}@example.com`], { cwd: w });
  git(['config', 'user.name', name], { cwd: w });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: w });
  initPlanning(w, { name: `proj-${name}` });
  if (dir) {
    mkdirSync(join(w, dir), { recursive: true });
    for (let i = 1; i <= top; i++) {
      const n = String(i).padStart(width, '0');
      writeFileSync(join(w, dir, `${n}-old-${i}.md`), `# ADR-${n} — old ${i}\n`);
    }
  }
  if (config) {
    const cp = paths(w).config;
    writeFileSync(cp, JSON.stringify({ ...JSON.parse(readFileSync(cp, 'utf8')), ...config }));
  }
  return w;
}
const remoteClaims = (w) => {
  const r = git(['fetch', '--quiet', 'origin', 'astro-registry'], { cwd: w });
  if (r.status !== 0) return null;
  const f = git(['show', 'FETCH_HEAD:adr-claims.json'], { cwd: w });
  return f.status === 0 ? JSON.parse(f.stdout) : null;
};
const decisions = (w) => readFileSync(paths(w).decisions, 'utf8');

test('an ADR project tops out at 0010: decision add writes DECISIONS `## ADR-0011` and `docs/adr/0011-<slug>.md`, and the registry\'s adr-claims.json records 11', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice');
  const r = await addDecision(w, { title: 'Use Postgres', why: 'fast', rejected: 'mysql' });
  assert.equal(r.id, 'ADR-0011');
  assert.equal(r.source, 'remote');
  assert.match(decisions(w), /^## ADR-0011 — Use Postgres$/m);
  const file = join(w, 'docs/adr/0011-use-postgres.md');
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /^# ADR-0011 — Use Postgres\n_\d{4}-\d{2}-\d{2}_\n\n\*\*Why:\*\* fast\n\n\*\*Rejected:\*\* mysql/);
  assert.deepEqual([r.adr.file, r.adr.dir, r.adr.source, r.adr.width], ['docs/adr/0011-use-postgres.md', 'docs/adr', 'detected', 4]);
  const claims = remoteClaims(w);
  assert.deepEqual(claims.claims.map((c) => [c.number, c.title, c.source]), [[11, 'Use Postgres', 'add']]);
  // the mirror holds the same claim
  const { readClaimsMirror } = await adr();
  assert.equal(readClaimsMirror(w).claims[0].number, 11);
  // a second add is above the first
  const r2 = await addDecision(w, { title: 'Second', why: 'y' });
  assert.equal(r2.id, 'ADR-0012');
});

test('a 3-digit `adr/` project gets a 3-digit file and heading, and the result says detected', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice', { dir: 'adr', width: 3, top: 5 });
  const r = await addDecision(w, { title: 'Three digits', why: 'w' });
  assert.equal(r.id, 'ADR-006');
  assert.ok(existsSync(join(w, 'adr/006-three-digits.md')));
  assert.equal(r.adr.source, 'detected');
  assert.equal(r.adr.dir, 'adr');
});

test('decisions.adr_dir pointing elsewhere writes there and says configured', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice', { dir: null, config: { decisions: { adr_dir: 'records/adrs' } } });
  const r = await addDecision(w, { title: 'Elsewhere', why: 'w' });
  assert.equal(r.adr.source, 'configured');
  assert.equal(r.id, 'ADR-0001');
  assert.ok(existsSync(join(w, 'records/adrs/0001-elsewhere.md')));
});

test('decisions.adr_dir off writes only the DECISIONS entry', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice', { config: { decisions: { adr_dir: 'off' } } });
  const r = await addDecision(w, { title: 'No folder', why: 'w' });
  assert.equal(r.adr ?? null, null);
  assert.equal(r.id, 'ADR-001');
  assert.ok(!existsSync(join(w, 'docs/adr/0011-no-folder.md')));
  assert.equal(readdirSync(join(w, 'docs/adr')).length, 10);
  assert.equal(remoteClaims(w), null);
});

test('a project with no ADR folder gets today\'s entry, no folder, no adr-claims.json on the branch and no mirror', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice', { dir: null });
  const r = await addDecision(w, { title: 'Plain', why: 'because', rejected: 'nothing', date: '2026-02-03' });
  assert.equal(r.id, 'ADR-001');
  assert.equal(r.adr ?? null, null);
  // the pre-phase entry shape, byte for byte
  assert.ok(decisions(w).endsWith('## ADR-001 — Plain\n_2026-02-03_\n\n**Why:** because\n\n**Rejected:** nothing\n\n'));
  assert.equal(remoteClaims(w), null);
  assert.ok(!existsSync(join(w, 'docs')) && !existsSync(join(w, 'adr')));
  assert.ok(!existsSync(join(paths(w).local, 'adr-claims.json')));
  // and the project without a remote too
  const lone = mkWork(null, 'lone', { dir: null });
  const l = await addDecision(lone, { title: 'Lone', why: 'w' });
  assert.equal(l.source, 'local');
  assert.equal(l.id, 'ADR-001');
});

test('an unreachable remote in an ADR project refuses and writes neither store', async () => {
  const { addDecision } = await canon();
  const bare = mkBare();
  const w = mkWork(bare, 'alice');
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-no-such-remote.git')], { cwd: w });
  const before = git(['status', '--porcelain', '-uall'], { cwd: w }).stdout;
  const logBefore = decisions(w);
  const r = await addDecision(w, { title: 'Nope', why: 'w' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, 'registry-unreachable');
  assert.match(r.error, /registry|reach/);
  assert.equal(git(['status', '--porcelain', '-uall'], { cwd: w }).stdout, before);
  assert.equal(decisions(w), logBefore);
  assert.equal(readdirSync(join(w, 'docs/adr')).length, 10);
  assert.ok(!existsSync(join(paths(w).local, 'adr-claims.json')));
});

test('ambiguous ADR folders refuse with the config fix', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice');
  mkdirSync(join(w, 'adr'));
  writeFileSync(join(w, 'adr/001-x.md'), '# x');
  const logBefore = decisions(w);
  const r = await addDecision(w, { title: 'Which', why: 'w' });
  assert.equal(r.ok, false);
  assert.equal(r.refused, 'adr-ambiguous');
  assert.equal(r.fix, 'ac config set decisions.adr_dir docs/adr');
  assert.equal(decisions(w), logBefore);
});

test('a retried add returns the twin\'s id and writes a missing file once', async () => {
  const { addDecision } = await canon();
  const w = mkWork(mkBare(), 'alice');
  const first = await addDecision(w, { title: 'Retry me', why: 'w' });
  const again = await addDecision(w, { title: 'Retry me', why: 'w' });
  assert.equal(again.existing, true);
  assert.equal(again.id, first.id);
  assert.equal(again.adr, null);
  assert.equal(readdirSync(join(w, 'docs/adr')).filter((f) => f.includes('retry-me')).length, 1);
  // the first attempt died after the push: the file is missing
  rmFile(join(w, first.adr.file));
  const heal = await addDecision(w, { title: 'Retry me', why: 'w' });
  assert.equal(heal.existing, true);
  assert.equal(heal.adr.file, first.adr.file);
  assert.ok(existsSync(join(w, first.adr.file)));
});

import { rmSync } from 'node:fs';
const rmFile = (f) => rmSync(f, { force: true });

test('canon pull refreshes the mirror', async () => {
  const { addDecision, canonPull } = await canon();
  const { readClaimsMirror } = await adr();
  const bare = mkBare();
  const alice = mkWork(bare, 'alice');
  const bob = mkWork(bare, 'bob');
  await addDecision(alice, { title: 'From alice', why: 'w' });
  assert.equal(readClaimsMirror(bob), null);
  const pull = canonPull(bob);
  assert.equal(pull.ok, true);
  assert.deepEqual(readClaimsMirror(bob).claims.map((c) => c.number), [11]);
  // bob's next add skips alice's number even though his folder tops out at 0010
  const r = await addDecision(bob, { title: 'From bob', why: 'w' });
  assert.equal(r.id, 'ADR-0012');
});

test('a stale copy holding pre-relabel ADR-00x entries is relabelled before merge, not resurrected', async () => {
  const { addDecision, canonPull } = await canon();
  const { claimsText } = await adr();
  const { transact } = await import('../lib/shared.mjs');
  const bare = mkBare();
  const alice = mkWork(bare, 'alice');
  const bob = mkWork(bare, 'bob');
  // the shared branch as a backfill leaves it
  const shared = '# Decisions\n\n## D-001 — First thing\n_2026-01-01_\n\n**Why:** a\n\n## D-002 — Second thing\n_2026-01-01_\n\n**Why:** b\n';
  const claims = { version: 1, claims: [{ number: 10, source: 'backfill' }], backfill: { at: 'x', log_width: 3, folder_width: 4, relabel: { 'ADR-001': 'D-001', 'ADR-002': 'D-002' } } };
  const tx = transact(alice, { remote: 'origin', branch: 'astro-registry', message: 'seed' }, () => ({ updates: { 'DECISIONS.md': shared, 'adr-claims.json': claimsText(claims) } }));
  assert.equal(tx.ok, true);
  // bob never pulled: he still has the old-series headings
  writeFileSync(paths(bob).decisions, '# Decisions\n\n## ADR-001 — First thing\n_2026-01-01_\n\n**Why:** a\n\n## ADR-002 — Second thing\n_2026-01-01_\n\n**Why:** b\n');
  const r = await addDecision(bob, { title: 'Bob adds', why: 'w' });
  assert.equal(r.ok === false, false, JSON.stringify(r));
  assert.equal(r.id, 'ADR-0011');
  const text = decisions(bob);
  assert.ok(!/ADR-00[12]\b/.test(text), 'old ids must not be resurrected');
  assert.match(text, /## D-001 — First thing/);
  // and canon pull relabels a stale copy too
  writeFileSync(paths(alice).decisions, '# Decisions\n\n## ADR-001 — First thing\n_2026-01-01_\n\n**Why:** a\n');
  const pull = canonPull(alice);
  assert.equal(pull.ok, true);
  assert.ok(!/## ADR-001\b/.test(decisions(alice)));
  assert.match(decisions(alice), /## D-001 — First thing/);
});
