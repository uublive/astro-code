// lib/mutenv.mjs (phase 48 t4): read-only environment detection for install hints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, delimiter, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const tmp = () => mkdtempSync(join(tmpdir(), 'mutenv-'));
const put = (d, f, body = '') => { mkdirSync(dirname(join(d, f)), { recursive: true }); writeFileSync(join(d, f), body); };

test('detectEnv: the JS manager follows the lockfile (pnpm, yarn, else npm)', async () => {
  const { detectEnv } = await import('../lib/mutenv.mjs');
  const a = tmp(); put(a, 'pnpm-lock.yaml');
  assert.deepEqual(detectEnv(a).node, { manager: 'pnpm', via: 'pnpm-lock.yaml' });
  const b = tmp(); put(b, 'yarn.lock');
  assert.deepEqual(detectEnv(b).node, { manager: 'yarn', via: 'yarn.lock' });
  const c = tmp(); put(c, 'package-lock.json');
  assert.equal(detectEnv(c).node.manager, 'npm');
  assert.equal(detectEnv(tmp()).node.manager, 'npm');
});

test('detectEnv: a .venv with a python but no pip is a uv venv; with pip, or no venv, it is pip; lock files are named', async () => {
  const { detectEnv } = await import('../lib/mutenv.mjs');
  const uv = tmp(); put(uv, '.venv/bin/python');
  assert.deepEqual(detectEnv(uv).python, { installer: 'uv-venv', via: '.venv', locked: null });
  const withPip = tmp(); put(withPip, '.venv/bin/python'); put(withPip, '.venv/bin/pip3');
  assert.equal(detectEnv(withPip).python.installer, 'pip');
  assert.equal(detectEnv(tmp()).python.installer, 'pip');
  for (const lock of ['uv.lock', 'poetry.lock', 'Pipfile.lock']) {
    const d = tmp(); put(d, lock);
    assert.equal(detectEnv(d).python.locked, lock);
  }
});

test('pinsOf finds python pins in requirements, pyproject and lock files', async () => {
  const { pinsOf } = await import('../lib/mutenv.mjs');
  const a = tmp(); put(a, 'requirements-dev.txt', 'pytest\nmutmut==2.4.4\n');
  assert.deepEqual(pinsOf(a, 'mutmut', 'python'), [{ file: 'requirements-dev.txt', spec: '==2.4.4' }]);
  const b = tmp(); put(b, 'pyproject.toml', '[project]\ndependencies = ["mutmut>=3"]\n');
  assert.deepEqual(pinsOf(b, 'mutmut', 'python').map((p) => p.file), ['pyproject.toml']);
  const c = tmp(); put(c, 'uv.lock', '[[package]]\nname = "mutmut"\nversion = "3.8.0"\n');
  assert.deepEqual(pinsOf(c, 'mutmut', 'python'), [{ file: 'uv.lock', spec: 'locked' }]);
  const d = tmp(); put(d, 'requirements.txt', 'mutmut\nmutmut-extras==1\n');
  assert.deepEqual(pinsOf(d, 'mutmut', 'python'), [], 'a bare unpinned name and a different package are not pins');
});

test('pinsOf finds node and go pins; nothing found is an empty list', async () => {
  const { pinsOf } = await import('../lib/mutenv.mjs');
  const a = tmp(); put(a, 'package.json', JSON.stringify({ devDependencies: { '@stryker-mutator/core': '^9.0.0' } }));
  assert.deepEqual(pinsOf(a, '@stryker-mutator/core', 'node'), [{ file: 'package.json', spec: '^9.0.0' }]);
  const b = tmp(); put(b, 'pnpm-lock.yaml', "'@stryker-mutator/core':\n  version: 9.0.0\n");
  assert.deepEqual(pinsOf(b, '@stryker-mutator/core', 'node').map((p) => p.file), ['pnpm-lock.yaml']);
  const c = tmp(); put(c, 'go.mod', 'module x\n\nrequire github.com/go-gremlins/gremlins v0.6.0\n');
  assert.deepEqual(pinsOf(c, 'go-gremlins/gremlins', 'go').map((p) => p.file), ['go.mod']);
  assert.deepEqual(pinsOf(tmp(), 'mutmut', 'python'), []);
  assert.deepEqual(pinsOf(tmp(), 'x', 'node'), []);
});

const digest = (root) => {
  const h = createHash('sha256');
  const walk = (d) => { for (const n of readdirSync(join(root, d)).sort()) {
    const rel = join(d, n);
    if (statSync(join(root, rel)).isDirectory()) walk(rel); else h.update(rel).update(readFileSync(join(root, rel)));
  } };
  walk('');
  return h.digest('hex');
};

test('detection is read-only and spawns nothing', async () => {
  const { detectEnv, pinsOf } = await import('../lib/mutenv.mjs');
  const d = tmp();
  put(d, '.venv/bin/python'); put(d, 'uv.lock', 'name = "mutmut"\n'); put(d, 'pnpm-lock.yaml'); put(d, 'go.mod', 'module x\n');
  const spy = tmp(); const log = join(spy, 'log');
  for (const n of ['npm', 'pip', 'uv', 'go', 'pnpm', 'yarn']) { put(spy, n, `#!/bin/sh\necho ${n} >> ${log}\n`); spawnSync('chmod', ['+x', join(spy, n)]); }
  const oldPath = process.env.PATH;
  process.env.PATH = `${spy}${delimiter}${oldPath}`;
  try {
    const before = digest(d);
    detectEnv(d); pinsOf(d, 'mutmut', 'python'); pinsOf(d, 'x', 'node'); pinsOf(d, 'x', 'go');
    assert.equal(digest(d), before);
  } finally { process.env.PATH = oldPath; }
  assert.throws(() => readFileSync(log), 'no package manager was run');
});
