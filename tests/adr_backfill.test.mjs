// lib/adrbackfill.mjs: the one-time claim plus D-series relabel (phase 53 t9, ADR-087).
// Real bare remote plus two clones of the C5 fixture; dynamic import of the new module (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const backfill = () => import('../lib/adrbackfill.mjs');
const canon = () => import('../lib/canon.mjs');

const mkBare = () => {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
};
const commitAll = (w, msg) => { git(['add', '-A'], { cwd: w }); git(['commit', '--quiet', '-m', msg], { cwd: w }); };

// The pre-phase Astrobot shape: docs/adr 0001…0010 (two different 0007s), a DECISIONS log ADR-001…006
// of different decisions except one entry that IS docs/adr/0003, and a doc citing both series.
function mkFixture({ folder = true, logWidthEqual = false } = {}) {
  const bare = mkBare();
  const alice = mkdtempSync(join(tmpdir(), 'ac-bf-alice-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: alice });
  git(['config', 'user.email', 'alice@example.com'], { cwd: alice });
  git(['config', 'user.name', 'alice'], { cwd: alice });
  git(['remote', 'add', 'origin', bare], { cwd: alice });
  initPlanning(alice, { name: 'bf' });
  if (folder) {
    mkdirSync(join(alice, 'docs/adr'), { recursive: true });
    const titles = ['one', 'two', 'three thing', 'four', 'five', 'six', 'seven a', 'eight', 'nine', 'ten'];
    titles.forEach((t, i) => {
      const n = String(i + 1).padStart(4, '0');
      writeFileSync(join(alice, 'docs/adr', `${n}-${t.replace(/ /g, '-')}.md`), `# ADR-${n} — ${t}\n\nSee ADR-002 only in the log.\n`);
    });
    writeFileSync(join(alice, 'docs/adr/0007-seven-b.md'), '# ADR-0007 — seven b\n');
  }
  const w = logWidthEqual ? 4 : 3;
  const id = (i) => `ADR-${String(i).padStart(w, '0')}`;
  const log = ['# Decisions', ''];
  for (let i = 1; i <= 6; i++) log.push(`## ${id(i)} — ${i === 3 ? 'three thing' : `log entry ${i}`}`, '_2026-01-01_', '', `**Why:** relates to ${id(2)}`, '');
  writeFileSync(paths(alice).decisions, log.join('\n'));
  writeFileSync(join(alice, 'NOTES.md'), `Log says ${id(2)} here.\nFolder says ADR-0002 there.\nLookalike ADR-01020 stays.\n`);
  commitAll(alice, 'base');
  git(['push', '--quiet', 'origin', 'main'], { cwd: alice });
  const bob = mkdtempSync(join(tmpdir(), 'ac-bf-bob-'));
  git(['clone', '--quiet', '-b', 'main', bare, bob]);
  git(['config', 'user.email', 'bob@example.com'], { cwd: bob });
  git(['config', 'user.name', 'bob'], { cwd: bob });
  return { bare, alice, bob };
}
const read = (w, rel) => readFileSync(join(w, rel), 'utf8');
const tree = (w) => git(['status', '--porcelain', '-uall'], { cwd: w }).stdout + readFileSync(paths(w).decisions, 'utf8') + read(w, 'NOTES.md');
const tip = (w) => git(['ls-remote', 'origin', 'refs/heads/astro-registry'], { cwd: w }).stdout;

test('dry run reports the relabel map, the reference rewrites, the claims and the duplicate 0007, and writes nothing', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture();
  const before = tree(alice);
  const r = backfillAdr(alice);
  assert.equal(r.active, true);
  assert.equal(r.applied, false);
  assert.deepEqual(r.relabel, { 'ADR-001': 'D-001', 'ADR-002': 'D-002', 'ADR-003': 'ADR-0003', 'ADR-004': 'D-004', 'ADR-005': 'D-005', 'ADR-006': 'D-006' });
  assert.ok(r.rewrites.some((x) => x.file === 'NOTES.md'));
  assert.deepEqual(r.claims, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(r.findings.some((f) => f.kind === 'duplicate' && /0007/.test(f.detail)));
  assert.equal(tree(alice), before);
  assert.equal(tip(alice), '');
});

test('apply relabels log entries to D-001…, keeps the 0003 mirror as ADR-0003, rewrites `ADR-002`→`D-002` and leaves `ADR-0002` and every ADR file name alone', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture();
  const files = readdirSync(join(alice, 'docs/adr')).sort();
  const r = backfillAdr(alice, { apply: true });
  assert.equal(r.applied, true);
  const log = read(alice, '.astrocode/DECISIONS.md');
  assert.match(log, /^## D-001 — log entry 1$/m);
  assert.match(log, /^## ADR-0003 — three thing$/m);
  assert.match(log, /^## D-006 — log entry 6$/m);
  assert.ok(!/## ADR-00\d\b/.test(log));
  assert.match(log, /relates to D-002/);
  assert.equal(read(alice, 'NOTES.md'), 'Log says D-002 here.\nFolder says ADR-0002 there.\nLookalike ADR-01020 stays.\n');
  assert.deepEqual(readdirSync(join(alice, 'docs/adr')).sort(), files);
  assert.match(read(alice, 'docs/adr/0003-three-thing.md'), /^# ADR-0003 — three thing/);
  // the in-force view follows
  assert.match(read(alice, '.astrocode/DECISIONS.in-force.md'), /## D-001/);
  // the registry holds claims 1..10 and the marker
  git(['fetch', '--quiet', 'origin', 'astro-registry'], { cwd: alice });
  const c = JSON.parse(git(['show', 'FETCH_HEAD:adr-claims.json'], { cwd: alice }).stdout);
  assert.deepEqual(c.claims.map((x) => x.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(c.backfill.log_width, 3);
  assert.equal(c.backfill.folder_width, 4);
  assert.equal(c.backfill.relabel['ADR-001'], 'D-001');
});

test('the duplicate 0007 is reported with `ac decision renumber … next`', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture();
  const r = backfillAdr(alice, { apply: true });
  const dup = r.findings.find((f) => f.kind === 'duplicate');
  assert.equal(dup.fix, 'ac decision renumber docs/adr/0007-seven-b.md next');
});

test('after apply, the next decision add from either clone gets 0011', async () => {
  const { backfillAdr } = await backfill();
  const { addDecision, canonPull } = await canon();
  const { alice, bob } = mkFixture();
  backfillAdr(alice, { apply: true });
  const b = await addDecision(bob, { title: 'Bob after', why: 'w' });
  assert.equal(b.id, 'ADR-0011');
  // bob's stale 3-digit log was relabelled, not resurrected beside the D- entries
  const bobLog = read(bob, '.astrocode/DECISIONS.md');
  assert.ok(!/## ADR-00\d\b/.test(bobLog));
  assert.match(bobLog, /## D-002 — log entry 2/);
  assert.equal(canonPull(alice).ok, true);
  const a = await addDecision(alice, { title: 'Alice after', why: 'w' });
  assert.equal(a.id, 'ADR-0012');
});

test('a second apply changes no file and claims nothing', async () => {
  const { backfillAdr } = await backfill();
  const { alice, bob } = mkFixture();
  backfillAdr(alice, { apply: true });
  const before = tree(alice);
  const tipBefore = tip(alice);
  const again = backfillAdr(alice, { apply: true });
  assert.ok(again.already);
  assert.deepEqual(again.claims, []);
  assert.equal(tree(alice), before);
  assert.equal(tip(alice), tipBefore);
  // a second developer, arriving after the claim, is a no-op too and moves no registry tip
  const bobBefore = tree(bob);
  assert.ok(backfillAdr(bob, { apply: true }).already);
  assert.equal(tree(bob), bobBefore);
  assert.equal(tip(bob), tipBefore);
});

test('equal log and folder widths list references instead of rewriting them', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture({ logWidthEqual: true });
  const r = backfillAdr(alice, { apply: true });
  assert.ok(r.ambiguous.length > 0);
  assert.ok(r.ambiguous.some((x) => x.file === 'NOTES.md' && x.line === 1));
  assert.equal(read(alice, 'NOTES.md'), 'Log says ADR-0002 here.\nFolder says ADR-0002 there.\nLookalike ADR-01020 stays.\n');
  assert.match(read(alice, '.astrocode/DECISIONS.md'), /^## D-0001 — log entry 1$/m);
});

test('a project without an ADR folder is untouched, byte-identical DECISIONS.md', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture({ folder: false });
  const before = tree(alice);
  const r = backfillAdr(alice, { apply: true });
  assert.equal(r.active, false);
  assert.equal(tree(alice), before);
  assert.equal(tip(alice), '');
  assert.match(read(alice, '.astrocode/DECISIONS.md'), /^## ADR-001 — log entry 1$/m);
});

test('an unreachable registry refuses with nothing written', async () => {
  const { backfillAdr } = await backfill();
  const { alice } = mkFixture();
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-gone-bf.git')], { cwd: alice });
  const before = tree(alice);
  const r = backfillAdr(alice, { apply: true });
  assert.equal(r.refused, 'registry-unreachable');
  assert.match(r.error, /registry|reach/);
  assert.equal(tree(alice), before);
});
