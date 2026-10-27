// Phase 52 t6 — the targeted `ac verdict plan` line, the carried list in `ac phase show` and the
// phase verify gate, through the real CLI in a real tmp git project (amends ADR-079).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const ids = ['C1', 'C2', 'C3', 'C4'];
const files = { C1: 'src/a.mjs', C2: 'src/b.mjs', C3: 'src/c.mjs', C4: 'src/d.mjs' };
const obs = (list, failed = []) => list.map((id) => ({ id, passed: !failed.includes(id) }));

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vtarget-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'tproj' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  writeFileSync(join(dir, '.astrocode', 'phases', ph.slug, 'CRITERIA.md'),
    ids.map((id) => `### ${id} — x\n- **Observe:** read \`${files[id]}\`\n`).join('\n'));
  mkdirSync(join(dir, 'src'));
  for (const f of Object.values(files)) writeFileSync(join(dir, f), 'x');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  const vfile = join(dir, '.astrocode', 'phases', ph.slug, 'VERDICT.json');
  return { dir, vfile, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const record = (p, result) => {
  const r = ac(p.dir, 'verdict', 'record', '1', '--result', JSON.stringify(result));
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};
const change = (p, file) => { writeFileSync(join(p.dir, file), `v${Math.random()}`); sh(p.dir, 'add', '-A'); sh(p.dir, 'commit', '-q', '-m', `fix ${file}`); };
const show = (p) => JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout);

test('verdict plan prints the targeted line naming n of m, the full PASS sha7 and the ids to re-check', async () => {
  const p = await project();
  try {
    const f1 = record(p, { mode: 'full', criteria: obs(ids) });
    change(p, files.C2);
    const line = ac(p.dir, 'verdict', 'plan', '1').stdout.trim();
    assert.equal(line, `• targeted: 1 of 4 criteria affected since full PASS at ${f1.commit.slice(0, 7)} (run 1): re-check C2; carry 3`);
  } finally { p.done(); }
});

test('verdict plan --json is identical across two runs', async () => {
  const p = await project();
  try {
    record(p, { mode: 'full', criteria: obs(ids) });
    change(p, files.C3);
    const a = ac(p.dir, 'verdict', 'plan', '1', '--json').stdout;
    const b = ac(p.dir, 'verdict', 'plan', '1', '--json').stdout;
    assert.equal(a, b);
    const plan = JSON.parse(a);
    assert.equal(plan.mode, 'targeted');
    assert.deepEqual(plan.floor, ['C3']);
  } finally { p.done(); }
});

test('--fulll is refused non-zero after a full PASS', async () => {
  const p = await project();
  try {
    record(p, { mode: 'full', criteria: obs(ids) });
    change(p, files.C2);
    const r = ac(p.dir, 'verdict', 'plan', '1', '--fulll');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown flag/);
    const full = JSON.parse(ac(p.dir, 'verdict', 'plan', '1', '--json', '--full').stdout);
    assert.equal(full.mode, 'full');
    assert.match(full.reason, /--full/);
  } finally { p.done(); }
});

test('phase show lists carried criteria with run and commit after a targeted PASS and has no carried key after a full PASS', async () => {
  const p = await project();
  try {
    const f1 = record(p, { mode: 'full', criteria: obs(ids) });
    assert.equal('carried' in show(p), false);
    change(p, files.C2);
    const t = record(p, { mode: 'targeted', criteria: obs(['C2']) });
    assert.equal(t.passed, true);
    const entry = show(p);
    assert.deepEqual(entry.carried, ['C1', 'C3', 'C4'].map((id) => ({ id, from: { run: 1, commit: f1.commit } })));
    assert.equal(entry.number, 1);
    // a later full PASS drops the key again
    change(p, files.C1);
    record(p, { mode: 'full', criteria: obs(ids) });
    assert.equal('carried' in show(p), false);
  } finally { p.done(); }
});

test('phase verify accepts a valid targeted PASS and refuses one with a skipped floor criterion, naming the reason', async () => {
  const p = await project();
  try {
    record(p, { mode: 'full', criteria: obs(ids) });
    change(p, files.C2);
    const before = readFileSync(p.vfile, 'utf8');
    const bad = record(p, { mode: 'targeted', criteria: [{ id: 'C1', passed: true }, { id: 'C2', carried: true }] });
    assert.equal(bad.passed, false);
    const no = ac(p.dir, 'phase', 'verify', '1');
    assert.notEqual(no.status, 0);
    assert.match(no.stderr, /C2/);
    assert.notEqual(show(p).status, 'verified');
    writeFileSync(p.vfile, before); // a refused record is saved as a FAIL, which the next plan narrows on
    const good = record(p, { mode: 'targeted', criteria: obs(['C2']) });
    assert.equal(good.passed, true);
    const ok = ac(p.dir, 'phase', 'verify', '1');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(show(p).status, 'verified');
  } finally { p.done(); }
});

test('phase show still parses as JSON (existing callers)', async () => {
  const p = await project();
  try {
    const r = ac(p.dir, 'phase', 'show', '1', '--json');
    assert.equal(r.status, 0, r.stderr);
    const e = JSON.parse(r.stdout);
    assert.equal(e.number, 1);
    assert.equal('carried' in e, false);
    assert.equal(head(p.dir).length, 40);
  } finally { p.done(); }
});
