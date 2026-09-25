// `--no-sync` on `ac principles list`/`show` (phase 27 P6, C9): the read-only-consumer path
// the read contract (templates/PRINCIPLES-CONTRACT.md) tells a foreign reader to use. No
// lock dir, no git, no write of any kind — so a store chmod'd a-w still lists and shows,
// and is byte-identical afterwards. The store is seeded through astro-code's own writers;
// there is no import path (ADR-065).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

const mk = (tag) => mkdtempSync(join(tmpdir(), `ac-principles-nosync-${tag}-`));

function run(args, cwd, home, store) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, input: '', encoding: 'utf8', windowsHide: true,
    env: {
      ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store,
      GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
      GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
    },
  });
}

function seed(cwd, home, store) {
  for (const args of [
    ['principles', 'add', 'Commit the lockfile with every dependency change', '--kind', 'principle', '--why', 'reproducible installs'],
    ['principles', 'add', 'Keep WIP on a branch', '--kind', 'pattern', '--why', 'a reason', '--propose'],
  ]) {
    const r = run(args, cwd, home, store);
    assert.equal(r.status, 0, r.stderr);
  }
}

function listing(dir) {
  const out = [];
  function walk(d) {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      out.push(`${full.slice(dir.length)}:${st.isDirectory() ? 'D' : st.size}`);
      if (st.isDirectory()) walk(full);
    }
  }
  if (existsSync(dir)) walk(dir);
  return out.join('\n');
}
const digestDir = (dir) => createHash('sha1').update(listing(dir)).digest('hex');

function chmodRecursive(dir, mode) {
  function walk(d) {
    chmodSync(d, mode);
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else chmodSync(full, mode & 0o555);
    }
  }
  walk(dir);
}

test('--no-sync on list/show never writes the store, even chmod a-w', () => {
  const home = mk('home'); const store = mk('store'); const cwd = mk('cwd');
  seed(cwd, home, store);
  const idR = run(['principles', 'list', '--all', '--json'], cwd, home, store);
  const [{ id }] = JSON.parse(idR.stdout);

  const before = digestDir(store);
  if (process.getuid?.() === 0) return; // chmod does not bind as root — nothing to verify here
  chmodRecursive(store, 0o555);
  try {
    const listR = run(['principles', 'list', '--all', '--json', '--no-sync'], cwd, home, store);
    assert.equal(listR.status, 0, listR.stderr);
    assert.equal(JSON.parse(listR.stdout).length, 2);
    const showR = run(['principles', 'show', id, '--json', '--no-sync'], cwd, home, store);
    assert.equal(showR.status, 0, showR.stderr);
    assert.equal(JSON.parse(showR.stdout).id, id);
  } finally {
    chmodRecursive(store, 0o755);
  }
  assert.equal(digestDir(store), before);
});

test('list without --no-sync still works on a writable store (unchanged behaviour)', () => {
  const home = mk('home'); const store = mk('store'); const cwd = mk('cwd');
  seed(cwd, home, store);
  const r = run(['principles', 'list', '--all', '--json'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
});

test('ac help documents --no-sync and no import verb (ADR-065)', () => {
  const home = mk('home'); const store = mk('store'); const cwd = mk('cwd');
  const r = run(['help'], cwd, home, store);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /--no-sync/);
  assert.doesNotMatch(r.stdout, /principles import/);
  const imp = run(['principles', 'import'], cwd, home, store);
  assert.notEqual(imp.status, 0);
  assert.match(imp.stderr, /unknown: ac principles import/);
});
