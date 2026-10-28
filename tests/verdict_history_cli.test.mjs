// Phase 54 t15 (C1, C10, C11): `ac verdict history|show` and the flapping lines on `ac verdict record`,
// driven through the real CLI in a real tmp git project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const ids = ['C1', 'C2', 'C3', 'C4', 'C5'];
const res = (failed = []) => JSON.stringify({ mode: 'full', criteria: ids.map((id) => ({ id, passed: !failed.includes(id) })) });

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vhist-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'vproj' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  writeFileSync(join(dir, '.astrocode', 'phases', ph.slug, 'CRITERIA.md'),
    ids.map((id) => `### ${id} — x\n- **Files:** \`src/${id}.mjs\`\n`).join('\n'));
  for (const id of ids) { mkdirSync(join(dir, 'src'), { recursive: true }); writeFileSync(join(dir, 'src', `${id}.mjs`), ''); }
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, slug: ph.slug, done: () => rmSync(dir, { recursive: true, force: true }) };
}
const track = (dir, rel, body = 'x') => {
  const f = join(dir, rel);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, body);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', `touch ${rel}`);
};

test('ac verdict history lists runs oldest-first with run, mode, PASS/FAIL, short commit and unmet ids; --json gives the lines', async () => {
  const p = await project();
  try {
    assert.match(ac(p.dir, 'verdict', 'history', '1').stdout, /no verdicts recorded/);
    assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C4'])).status, 0);
    assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2'])).status, 0);
    assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', res()).status, 0);
    const out = ac(p.dir, 'verdict', 'history', '1');
    assert.equal(out.status, 0, out.stderr);
    const lines = out.stdout.trim().split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^run 1  full  FAIL  [0-9a-f]{7}  unmet: C2, C4$/);
    assert.match(lines[1], /^run 2  full  FAIL  [0-9a-f]{7}  unmet: C2$/);
    assert.match(lines[2], /^run 3  full  PASS  [0-9a-f]{7}$/);
    const j = JSON.parse(ac(p.dir, 'verdict', 'history', '1', '--json').stdout);
    assert.deepEqual(j.map((h) => h.run), [1, 2, 3]);
    assert.deepEqual(j[0].unmet, ['C2', 'C4']);
  } finally { p.done(); }
});

test('ac verdict show names the latest unmet ids, deferred ids and flapping flags', async () => {
  const p = await project();
  try {
    assert.notEqual(ac(p.dir, 'verdict', 'show', '1').status, 0, 'no verdict yet');
    ac(p.dir, 'verdict', 'record', '1', '--result', res());
    track(p.dir, 'src/C2.mjs');
    const rec = ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C4']));
    const shown = ac(p.dir, 'verdict', 'show', '1');
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /^run 2  full  FAIL/);
    assert.match(shown.stdout, /unmet: C2, C4/);
    assert.match(shown.stdout, /C2 passed in run 1 @ [0-9a-f]{7}, now fails — files changed \(regression\?\)/);
    const j = JSON.parse(ac(p.dir, 'verdict', 'show', '1', '--json').stdout);
    assert.deepEqual(j.unmet, ['C2', 'C4']);
    assert.equal(j.passed, false);
    assert.deepEqual(j.flapping.map((f) => f.id).sort(), ['C2', 'C4']);
    assert.ok(rec.stderr.includes('C2 passed in run 1'));
  } finally { p.done(); }
});

test('ac verdict record prints one stderr line per flapping flag: unchanged vs changed files', async () => {
  const p = await project();
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res());
    track(p.dir, 'src/C2.mjs');
    const r = ac(p.dir, 'verdict', 'record', '1', '--result', res(['C2', 'C3']));
    const warn = r.stderr.split('\n').filter((l) => l.includes('now fails'));
    assert.equal(warn.length, 2);
    assert.match(warn.find((l) => l.startsWith('⚠ C2')), /files changed \(regression\?\)/);
    assert.match(warn.find((l) => l.startsWith('⚠ C3')), /files unchanged \(inconsistent verifier\?\)/);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.failing, ['C2', 'C3'], 'the flag changed nothing else');
  } finally { p.done(); }
});

test('unknown flags and extra tokens die (ADR-029)', async () => {
  const p = await project();
  try {
    for (const args of [['verdict', 'history', '1', '--jsno'], ['verdict', 'show', '1', '--bogus'], ['verdict', 'history', '1', 'extra']]) {
      const r = ac(p.dir, ...args);
      assert.notEqual(r.status, 0, args.join(' '));
    }
  } finally { p.done(); }
});
