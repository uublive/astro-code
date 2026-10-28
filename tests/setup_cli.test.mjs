// Phase 54 t20 (C9, C14): `ac setup run` and `ac setup list`, driven through the real CLI in a real tmp
// git project. The step appends a line to a counter file OUTSIDE the project and writes into $AC_SETUP_OUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-setup-cli-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-setup-cli-out-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'sproj' });
  writeFileSync(join(dir, 'a.txt'), '1');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'one');
  writeFileSync(join(dir, 'a.txt'), '2');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'two');
  const counter = join(out, 'counter');
  const cmd = `echo run >> ${counter} && echo built > "$AC_SETUP_OUT/x"`;
  const set = ac(dir, 'config', 'set', 'setup.steps.build', JSON.stringify({ command: cmd }));
  assert.equal(set.status, 0, set.stderr);
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'config');
  const runs = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  return { dir, runs, done: () => { rmSync(dir, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); } };
}

test('ac setup run twice reports ran then reused with the counter at 1; --commit HEAD~1 runs again', () => {
  const p = project();
  try {
    const a = ac(p.dir, 'setup', 'run', 'build');
    assert.equal(a.status, 0, a.stderr);
    assert.match(a.stdout, /^• ran build @ [0-9a-f]{7}/);
    const b = ac(p.dir, 'setup', 'run', 'build');
    assert.match(b.stdout, /^✓ reused build @ [0-9a-f]{7} — same commit and command/);
    assert.equal(p.runs(), 1);
    const c = ac(p.dir, 'setup', 'run', 'build', '--commit', 'HEAD~1');
    assert.match(c.stdout, /^• ran build/);
    assert.equal(p.runs(), 2);
    assert.equal(sh(p.dir, 'status', '--porcelain').stdout, '', 'nothing new to commit');
  } finally { p.done(); }
});

test('ac setup run --json is pure JSON on stdout and the exit is the step\'s exit', () => {
  const p = project();
  try {
    const j = ac(p.dir, 'setup', 'run', 'build', '--json');
    const out = JSON.parse(j.stdout);
    assert.equal(out.name, 'build');
    assert.equal(out.reused, false);
    assert.equal(out.exit, 0);
    assert.equal(ac(p.dir, 'config', 'set', 'setup.steps.bad', '{"command":"exit 3"}').status, 0);
    const bad = ac(p.dir, 'setup', 'run', 'bad');
    assert.equal(bad.status, 3);
    assert.match(bad.stdout, /✖ bad exited 3 — not cached/);
  } finally { p.done(); }
});

test('ac setup list --json lists the steps and entries; text says ⊡ when nothing is declared', () => {
  const p = project();
  try {
    ac(p.dir, 'setup', 'run', 'build');
    const l = JSON.parse(ac(p.dir, 'setup', 'list', '--json').stdout);
    assert.deepEqual(Object.keys(l.steps), ['build']);
    assert.equal(l.entries.length, 1);
    assert.equal(l.entries[0].name, 'build');
    assert.equal(l.max_mb, 2048);
    assert.match(ac(p.dir, 'setup', 'list').stdout, /build .*\ncached: build@[0-9a-f]{7}/);
    assert.equal(ac(p.dir, 'config', 'unset', 'setup.steps').status, 0);
    assert.match(ac(p.dir, 'setup', 'list').stdout, /^⊡ no setup steps declared/);
  } finally { p.done(); }
});

test('an undeclared name exits non-zero with the ac config set hint; a typo\'d flag and a missing name die', () => {
  const p = project();
  try {
    const r = ac(p.dir, 'setup', 'run', 'nope');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /ac config set setup\.steps\.nope/);
    assert.notEqual(ac(p.dir, 'setup', 'run', 'build', '--comit', 'HEAD').status, 0);
    assert.notEqual(ac(p.dir, 'setup', 'list', '--jsno').status, 0);
    assert.notEqual(ac(p.dir, 'setup', 'run').status, 0);
    assert.notEqual(ac(p.dir, 'setup', 'bogus').status, 0);
    assert.notEqual(ac(p.dir, 'setup', 'run', 'build', '--commit').status, 0);
  } finally { p.done(); }
});
