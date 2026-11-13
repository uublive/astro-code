// ADR-094 (phase 57 t2): the targeted test set, computed in code on a real scratch git repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-targeted-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'src/b.mjs', 'export const b = 1;\n');
  put(dir, 'tests/a.test.mjs', "import '../src/a.mjs';\n");
  put(dir, 'tests/b.test.mjs', "import '../src/b.mjs';\n");
  put(dir, 'tests/c.test.mjs', "import 'node:test';\n");
  commit(dir, 'base');
  return dir;
}

test('C3 layout: changed test plus the tests importing a changed source, deterministic', async () => {
  const { targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'src/a.mjs', 'export const a = 2;\n');
  put(dir, 'tests/d.test.mjs', "import 'node:test';\n");
  commit(dir, 'feat: a (phase 07 t1)');
  const r = targetedTests(dir, '07');
  assert.deepEqual(r.tests, ['tests/a.test.mjs', 'tests/d.test.mjs']);
  assert.deepEqual(targetedTests(dir, '07').tests, r.tests);
  assert.equal(r.reason, null);
});

test('an unstamped commit and another phase never widen the set', async () => {
  const { targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'src/a.mjs', 'export const a = 2;\n');
  commit(dir, 'feat: a (phase 07 t1)');
  put(dir, 'src/b.mjs', 'export const b = 2;\n');
  commit(dir, 'chore: unstamped');
  put(dir, 'src/b.mjs', 'export const b = 3;\n');
  commit(dir, 'feat: b (phase 08 t1)');
  assert.deepEqual(targetedTests(dir, '07').tests, ['tests/a.test.mjs']);
});

test('dynamic import, quoted path literal and the name rule all link', async () => {
  const { targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'tests/dyn.test.mjs', "test(async () => { await import('../src/dyn.mjs'); });\n");
  put(dir, 'tests/lit.test.mjs', "const p = 'commands/x.md';\n");
  put(dir, 'lib/config.mjs', 'x\n');
  put(dir, 'tests/config.test.mjs', "import 'node:test';\n");
  put(dir, 'src/dyn.mjs', 'x\n');
  put(dir, 'commands/x.md', 'x\n');
  commit(dir, 'base2');
  put(dir, 'src/dyn.mjs', 'y\n');
  put(dir, 'commands/x.md', 'y\n');
  put(dir, 'lib/config.mjs', 'y\n');
  commit(dir, 'feat (phase 09 t1)');
  assert.deepEqual(targetedTests(dir, '09').tests, ['tests/config.test.mjs', 'tests/dyn.test.mjs', 'tests/lit.test.mjs']);
});

test('docs-only phase: no tests, "no linked tests", unmapped lists the files', async () => {
  const { targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'README.md', 'hi\n');
  put(dir, 'commands/x.md', 'hi\n');
  commit(dir, 'docs (phase 07 t1)');
  const r = targetedTests(dir, '07');
  assert.deepEqual(r.tests, []);
  assert.equal(r.reason, 'no linked tests');
  assert.deepEqual(r.unmapped, ['README.md', 'commands/x.md']);
});

test('a deleted file and .astrocode paths never enter', async () => {
  const { targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'src/a.mjs', 'export const a = 2;\n');
  put(dir, '.astrocode/x.test.mjs', 'x\n');
  commit(dir, 'feat (phase 07 t1)');
  rmSync(join(dir, 'tests/a.test.mjs'));
  rmSync(join(dir, 'src/a.mjs'));
  commit(dir, 'rm');
  const r = targetedTests(dir, '07');
  assert.deepEqual(r.tests, []);
  assert.deepEqual(r.changed, []);
});

test('subjectsOf is the same rule read backwards', async () => {
  const { subjectsOf } = await import('../lib/targeted.mjs');
  const dir = repo();
  assert.deepEqual(subjectsOf(dir, 'tests/a.test.mjs'), ['src/a.mjs']);
});

test('targetedCommand single-quotes every file safely', async () => {
  const { targetedCommand } = await import('../lib/targeted.mjs');
  assert.equal(targetedCommand('node --test {files}', ['a b.mjs', "it's.mjs"]), `node --test 'a b.mjs' 'it'\\''s.mjs'`);
});

test('TARGETED_LIMITS is one line and says one hop', async () => {
  const { TARGETED_LIMITS } = await import('../lib/targeted.mjs');
  assert.ok(!TARGETED_LIMITS.includes('\n'));
  assert.match(TARGETED_LIMITS, /one hop/);
});
