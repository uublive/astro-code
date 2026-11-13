// ADR-094 (phase 57 t10): the cheap pass in fast mode (the default): the targeted set runs, the suite never does.
// Real scratch git repo, no verify setting. The suite command appends SUITE to a log outside the repo, and each
// test file appends its own name there. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '07-x';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV });
const OK = 'node -e "process.exit(0)"';

function repo({ setting, docsOnly = false, c2 = OK, red = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-cheapfast-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-cheapfast-out-'));
  const log = join(out, 'log');
  writeFileSync(log, '');
  const suiteCmd = `echo SUITE >> '${log}'`;
  const logTest = (name, exit = 0) => `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, '${name}\\n');\nprocess.exit(${exit});\n`;
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  if (setting) put(dir, '.astrocode/config.json', JSON.stringify({ verify: setting }));
  put(dir, '.astrocode/.local/.gitignore', '*\n');
  put(dir, `.astrocode/phases/${SLUG}/CRITERIA.md`, [
    '### C1 [suite] — the suite', `- **Observe:** \`${suiteCmd}\``, '',
    '### C2 — two', `- **Cheap:** \`${c2}\``, '',
  ].join('\n'));
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'tests/a.test.mjs', `import '../src/a.mjs';\n${logTest('a.test', red ? 1 : 0)}`);
  commit(dir, 'init');
  if (docsOnly) { put(dir, 'README.md', 'docs\n'); commit(dir, 'docs (phase 07 t1)'); }
  else {
    put(dir, 'src/a.mjs', 'export const a = 2;\n');
    put(dir, 'tests/d.test.mjs', logTest('d.test'));
    commit(dir, 'feat (phase 07 t1)');
  }
  return { dir, suiteCmd, lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('C1: no suite runs, the covering tests run, the suite id is carried to the milestone check, nothing is held', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const r = repo();
  const res = await runCheapPass(r.dir, SLUG, { spawn });
  assert.ok(!r.lines().includes('SUITE'));
  assert.deepEqual(r.lines().sort(), ['a.test', 'd.test']);
  assert.equal(res.fast.mode, 'milestone');
  assert.equal(res.mode, 'milestone', 'the mode is stated at the top level too');
  assert.deepEqual(res.fast.tests, ['tests/a.test.mjs', 'tests/d.test.mjs']);
  assert.deepEqual(res.fast.milestone, ['C1']);
  assert.deepEqual(res.held, []);
  assert.equal(res.clean, true);
});

test('a Cheap line that is exactly a suite command goes to fast.milestone and is not run', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const r = repo({ c2: 'npm test' });
  const res = await runCheapPass(r.dir, SLUG, { spawn });
  assert.deepEqual(res.fast.milestone, ['C1', 'C2']);
  assert.equal(res.ran.length, 0);
});

test('C4: a docs-only phase runs no test, says no linked tests, and is clean', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const r = repo({ docsOnly: true });
  const res = await runCheapPass(r.dir, SLUG, { spawn });
  assert.deepEqual(r.lines(), []);
  assert.equal(res.fast.reason, 'no linked tests');
  assert.deepEqual(res.fast.tests, []);
  assert.equal(res.clean, true);
});

test('a red set is unclean, names the failing file, adds no pseudo-id and records no cheap verdict', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const r = repo({ red: true });
  const res = await runCheapPass(r.dir, SLUG, { spawn });
  assert.equal(res.clean, false);
  assert.equal(res.fast.passed, false);
  assert.deepEqual(res.fast.failing, ['tests/a.test.mjs']);
  assert.deepEqual(res.unmet, []);
  assert.equal(res.recorded, null);
});

test('C6: with verify.full_suite phase the suite path is unchanged (a reusable receipt, no fast, nothing held)', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const { runSuite } = await import('../lib/receipts.mjs');
  const r = repo({ setting: { full_suite: 'phase' } });
  runSuite(r.dir, r.suiteCmd, { json: true, spawn });
  assert.deepEqual(r.lines(), ['SUITE']);
  const res = await runCheapPass(r.dir, SLUG, { spawn });
  assert.equal(res.fast, undefined);
  assert.equal(res.mode, 'phase', 'per-phase mode is stated, never left implicit');
  assert.deepEqual(res.held, []);
  assert.equal(res.ran.find((x) => x.id === 'C1').kind, 'suite');
  assert.deepEqual(r.lines(), ['SUITE'], 'the receipt was reused, the suite ran once');
});
