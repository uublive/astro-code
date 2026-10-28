// Phase 54 t5 (C9): the setup cache. Real tmp git; a step appends to a counter file OUTSIDE the repo
// and writes $AC_SETUP_OUT/x. Modules by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg = 'c') => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); };

function project(steps = {}, maxMb) {
  const root = mkdtempSync(join(tmpdir(), 'setupc-'));
  const outside = mkdtempSync(join(tmpdir(), 'setupc-out-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  put(root, 'src/a.mjs');
  const counter = join(outside, 'counter');
  const cfg = { setup: { steps: {} } };
  for (const [name, s] of Object.entries(steps)) cfg.setup.steps[name] = { command: s.command.replaceAll('COUNTER', counter), ...(s.commit ? { commit: s.commit } : {}) };
  if (maxMb !== undefined) cfg.setup.max_mb = maxMb;
  put(root, '.astrocode/config.json', JSON.stringify(cfg));
  commit(root, 'init');
  const runs = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  return { root, runs, done: () => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); } };
}
const OK = 'echo run >> COUNTER && echo built > "$AC_SETUP_OUT/x"';
const quiet = { json: true };

test('two runs at one commit execute once and the second reports reused; the result is under .local and git is clean', async () => {
  const { runSetup } = await import('../lib/setupcache.mjs');
  const p = project({ build: { command: OK } });
  try {
    const a = await runSetup(p.root, 'build', quiet);
    const b = await runSetup(p.root, 'build', quiet);
    assert.equal(a.reused, false);
    assert.equal(b.reused, true);
    assert.equal(p.runs(), 1);
    assert.equal(readFileSync(join(a.out, 'x'), 'utf8').trim(), 'built');
    assert.ok(a.out.includes(join('.astrocode', '.local', 'setup-cache')));
    assert.equal(sh(p.root, 'status', '--porcelain').stdout, '');
    assert.equal(sh(p.root, 'worktree', 'list').stdout.trim().split('\n').length, 1, 'the temp worktree is removed');
  } finally { p.done(); }
});

test('one character changed in the command, or a different commit, executes again', async () => {
  const { runSetup } = await import('../lib/setupcache.mjs');
  const p = project({ build: { command: OK }, build2: { command: OK + ' ' } });
  try {
    await runSetup(p.root, 'build', quiet);
    await runSetup(p.root, 'build2', quiet);
    assert.equal(p.runs(), 2, 'a changed command is a different key');
    put(p.root, 'src/b.mjs');
    commit(p.root, 'second');
    const c = await runSetup(p.root, 'build', quiet);
    assert.equal(c.reused, false, 'HEAD moved');
    assert.equal(p.runs(), 3);
    const d = await runSetup(p.root, 'build', { ...quiet, commit: 'HEAD~1' });
    assert.equal(d.reused, true, 'the first commit was already built');
    assert.equal(p.runs(), 3);
  } finally { p.done(); }
});

test('a step exiting 1 is not stored and runs again next time', async () => {
  const { runSetup, storedEntries } = await import('../lib/setupcache.mjs');
  const p = project({ bad: { command: 'echo run >> COUNTER; echo partial > "$AC_SETUP_OUT/x"; exit 1' } });
  try {
    const a = await runSetup(p.root, 'bad', quiet);
    assert.equal(a.exit, 1);
    const b = await runSetup(p.root, 'bad', quiet);
    assert.equal(b.reused, false);
    assert.equal(p.runs(), 2);
    assert.deepEqual(storedEntries(p.root), []);
    assert.equal(existsSync(a.out), false, 'no partial output is left behind');
  } finally { p.done(); }
});

test('the step runs on the resolved commit in a detached worktree, with the documented env', async () => {
  const { runSetup } = await import('../lib/setupcache.mjs');
  const p = project({ env: { command: 'echo "$AC_SETUP_COMMIT|$AC_PROJECT_ROOT|$PWD" > "$AC_SETUP_OUT/e"' } });
  try {
    const r = await runSetup(p.root, 'env', quiet);
    const [c, root, pwd] = readFileSync(join(r.out, 'e'), 'utf8').trim().split('|');
    assert.equal(c, sh(p.root, 'rev-parse', 'HEAD').stdout.trim());
    assert.equal(root, p.root);
    assert.notEqual(pwd, p.root, 'not the working tree');
  } finally { p.done(); }
});

test('with setup.max_mb low, entries evict oldest-first, the total stays under the cap, and an over-cap entry is not kept', async () => {
  const { runSetup, storedEntries } = await import('../lib/setupcache.mjs');
  // each step writes ~400 bytes; the cap is 1000 bytes
  const big = (n) => `head -c 400 /dev/zero > "$AC_SETUP_OUT/f${n}"`;
  const p = project({ s1: { command: big(1) }, s2: { command: big(2) }, s3: { command: big(3) }, huge: { command: 'head -c 5000 /dev/zero > "$AC_SETUP_OUT/h"' } }, 1000 / (1024 * 1024));
  try {
    const r1 = await runSetup(p.root, 's1', quiet);
    await new Promise((r) => setTimeout(r, 15));
    const r2 = await runSetup(p.root, 's2', quiet);
    await new Promise((r) => setTimeout(r, 15));
    const r3 = await runSetup(p.root, 's3', quiet);
    assert.deepEqual(r3.evicted, [r1.key], 'the oldest entry went first');
    const left = storedEntries(p.root);
    assert.deepEqual(left.map((e) => e.key), [r2.key, r3.key]);
    assert.ok(left.reduce((n, e) => n + e.bytes, 0) <= 1000);
    const h = await runSetup(p.root, 'huge', quiet);
    assert.equal(h.kept, false);
    assert.match(h.warning, /over setup\.max_mb/);
    assert.equal(storedEntries(p.root).length, 2, 'nothing else was evicted for it');
  } finally { p.done(); }
});

test('an undeclared name refuses with the ac config set hint, and listSetup shows steps and entries', async () => {
  const { runSetup, listSetup } = await import('../lib/setupcache.mjs');
  const p = project({ build: { command: OK } });
  try {
    await assert.rejects(runSetup(p.root, 'nope', quiet), /ac config set setup\.steps\.nope/);
    await runSetup(p.root, 'build', quiet);
    const l = listSetup(p.root);
    assert.deepEqual(Object.keys(l.steps), ['build']);
    assert.equal(l.entries.length, 1);
    assert.equal(l.max_mb, 2048);
  } finally { p.done(); }
});
