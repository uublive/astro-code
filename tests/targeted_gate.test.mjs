// Phase 59 t7 — which tests the healed-wave gate runs: targeted in fast mode, else the full suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x\n') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const config = (root, cfg) => put(root, '.astrocode/config.json', JSON.stringify(cfg));

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-gate-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'tests/a.test.mjs', "import '../src/a.mjs';\n");
  commit(dir, 'base');
  put(dir, 'src/a.mjs', 'export const a = 2;\n');
  commit(dir, 'feat: a (phase 07 t1)');
  return dir;
}

test('fast mode with linked tests plans the targeted set with the template-shaped command', async () => {
  const { testGatePlan, targetedTests } = await import('../lib/targeted.mjs');
  const dir = repo();
  const p = testGatePlan(dir, '07');
  assert.equal(p.mode, 'targeted');
  assert.deepEqual(p.tests, targetedTests(dir, '07').tests);
  assert.equal(p.command, "node --test 'tests/a.test.mjs'");
  assert.equal(p.reason, null);
});

test('verify.full_suite phase plans the full suite with that reason and the configured command', async () => {
  const { testGatePlan } = await import('../lib/targeted.mjs');
  const dir = repo();
  config(dir, { verify: { full_suite: 'phase', suite_command: 'npm test' } });
  const p = testGatePlan(dir, '07');
  assert.deepEqual([p.mode, p.command, p.reason], ['full', 'npm test', 'verify.full_suite: phase']);
});

test('fast mode with no linked tests plans the full suite and says why (never an empty targeted gate)', async () => {
  const { testGatePlan } = await import('../lib/targeted.mjs');
  const dir = repo();
  put(dir, 'docs/readme.md', 'hi\n');
  commit(dir, 'docs: (phase 08 t1)');
  const p = testGatePlan(dir, '08');
  assert.equal(p.mode, 'full');
  assert.equal(p.command, null);
  assert.match(p.reason, /no linked tests/);
  assert.deepEqual(p.tests, []);
});

test('planning never runs the tests it names', async () => {
  const { testGatePlan } = await import('../lib/targeted.mjs');
  const dir = repo();
  const marker = join(dir, 'ran.marker');
  put(dir, 'tests/a.test.mjs', `import '../src/a.mjs';\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  commit(dir, 'test: a (phase 07 t2)');
  assert.equal(testGatePlan(dir, '07').mode, 'targeted');
  assert.equal(existsSync(marker), false);
});
