// Phase 59 t10 — runSuite takes the machine lock, the worker budget and a private temp folder.
// Real tmp git project, a temp ASTRO_HEAVY_DIR, dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn as spawnAsync, spawnSync } from 'node:child_process';

const LOCK = new URL('../lib/machinelock.mjs', import.meta.url).href;
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
// Under `node --test` a nested `node --test` inherits NODE_TEST_CONTEXT and misreports; a real `ac` run never has it.
const { NODE_TEST_CONTEXT, ...CLEAN } = process.env;

function project(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-sbudget-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  put(dir, '.astrocode/.local/.gitignore', '*\n');
  put(dir, 'package.json', '{"type":"module"}\n');
  for (const [p, c] of Object.entries(files)) put(dir, p, c);
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-qm', 'init');
  return dir;
}
const heavyEnv = () => ({ ...CLEAN, ASTRO_HEAVY_DIR: mkdtempSync(join(tmpdir(), 'ac-sbudget-home-')), ASTRO_HEAVY_LOCK: '', GOFLAGS: '' });

test('a node --test command is shaped with --test-concurrency, and the receipt keeps the original command and key', async () => {
  const { runSuite, reusableReceipt, receiptKey } = await import('../lib/receipts.mjs');
  const root = project();
  const env = heavyEnv();
  const seen = [];
  const spawn = (cmd, o) => { seen.push({ cmd, env: o.env }); return { status: 0 }; };
  const rc = runSuite(root, 'node --test', { json: true, spawn, env });
  assert.match(seen[0].cmd, /^node --test --test-concurrency=\d+$/);
  assert.equal(seen[0].cmd, `node --test --test-concurrency=${rc.workers.n}`);
  assert.equal(rc.shaped, 'node --test');
  assert.equal(rc.command, 'node --test');
  assert.equal(rc.key, receiptKey({ commit: rc.commit, tree: rc.tree, command: 'node --test' }));
  const reuse = reusableReceipt(root, 'node --test');
  assert.equal(reuse.ok, true, reuse.reason);
});

test('go test gets -p N, and an opaque command gets the budget through the environment only', async () => {
  const { runSuite } = await import('../lib/receipts.mjs');
  const root = project();
  const env = heavyEnv();
  const seen = [];
  const spawn = (cmd, o) => { seen.push({ cmd, env: o.env }); return { status: 0 }; };
  const go = runSuite(root, 'go test ./...', { json: true, spawn, env });
  assert.equal(seen[0].cmd, `go test -p ${go.workers.n} ./...`);
  assert.equal(go.shaped, 'go test');
  const op = runSuite(root, 'sh ./run.sh', { json: true, spawn, env });
  assert.equal(seen[1].cmd, 'sh ./run.sh');
  assert.equal(op.shaped, null);
  const n = String(op.workers.n);
  assert.deepEqual([seen[1].env.ASTRO_WORKERS, seen[1].env.GOMAXPROCS, seen[1].env.GOFLAGS], [n, n, `-p=${n}`]);
});

test('an opaque script really sees the budget variables, and a real node --test runs and keeps its exit code', async () => {
  const { runSuite } = await import('../lib/receipts.mjs');
  const out = mkdtempSync(join(tmpdir(), 'ac-sbudget-out-'));
  const root = project({
    'run.sh': `env > ${out}/env.txt\n`,
    'tests/a.test.mjs': "import { test } from 'node:test';\ntest('a', () => {});\n",
    'tests/b.test.mjs': "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('b', () => assert.equal(1, 2));\n",
  });
  const env = heavyEnv();
  const op = runSuite(root, 'sh ./run.sh', { json: true, env });
  const dump = readFileSync(join(out, 'env.txt'), 'utf8');
  assert.match(dump, new RegExp(`^ASTRO_WORKERS=${op.workers.n}$`, 'm'));
  assert.match(dump, new RegExp(`^GOMAXPROCS=${op.workers.n}$`, 'm'));
  assert.match(dump, new RegExp(`^GOFLAGS=-p=${op.workers.n}$`, 'm'));
  const green = runSuite(root, 'node --test tests/a.test.mjs', { json: true, env });
  assert.equal(green.exit, 0);
  const red = runSuite(root, 'node --test tests/b.test.mjs', { json: true, env });
  assert.equal(red.exit, 1);
});

test('the suite runs in a run-specific temp folder that is gone afterwards, on a pass and on a fail', async () => {
  const { runSuite } = await import('../lib/receipts.mjs');
  for (const exit of [0, 1]) {
    const out = mkdtempSync(join(tmpdir(), 'ac-sbudget-out-'));
    const root = project({ 'run.sh': `echo "$TMPDIR" > ${out}/tmp.txt\ntouch "$TMPDIR/was-here"\nexit ${exit}\n` });
    const env = heavyEnv();
    const rc = runSuite(root, 'sh ./run.sh', { json: true, env });
    const logged = readFileSync(join(out, 'tmp.txt'), 'utf8').trim();
    assert.equal(rc.exit, exit);
    assert.ok(logged.startsWith(env.ASTRO_HEAVY_DIR), logged);
    assert.match(logged, /\/runs\/ac-run-\d+-[a-z0-9]+\/tmp$/);
    assert.equal(existsSync(logged), false, 'the temp folder must be removed');
    assert.equal(existsSync(dirname(logged)), false, 'and so must its run folder');
  }
});

test('the receipt carries workers, shaped and tmpdir: private; lock and cleaned are returned, never stored', async () => {
  const { runSuite, receiptDir } = await import('../lib/receipts.mjs');
  const root = project();
  const rc = runSuite(root, 'true', { json: true, env: heavyEnv() });
  assert.equal(rc.tmpdir, 'private');
  assert.equal(rc.shaped, null);
  assert.equal(rc.workers.source, 'adaptive');
  assert.equal(rc.lock.waited_ms, 0);
  const stored = JSON.parse(readFileSync(join(receiptDir(root), `${rc.key}.json`), 'utf8'));
  assert.deepEqual(stored.workers, rc.workers);
  assert.equal(stored.lock, undefined);
});

test('a wait for the machine lock is not counted in started_at or seconds', async () => {
  const { runSuite } = await import('../lib/receipts.mjs');
  const root = project();
  const env = heavyEnv();
  const src = `import { acquireMachineLock } from ${JSON.stringify(LOCK)};
const l = acquireMachineLock({ project: 'other', command: 'held', onWait() {} });
console.log('held');
setTimeout(() => { l.release(); process.exit(0); }, 1000);`;
  const child = spawnAsync(process.execPath, ['--input-type=module', '-e', src], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res) => child.stdout.once('data', res));
  const t0 = Date.now();
  const rc = runSuite(root, 'true', { json: true, env });
  assert.ok(Date.now() - t0 >= 500, 'it must have waited for the holder');
  assert.ok(rc.lock.waited_ms >= 500);
  assert.ok(rc.seconds < 1, `seconds ${rc.seconds} must exclude the wait`);
  assert.ok(Date.parse(rc.started_at) >= t0 + 500);
  await new Promise((res) => child.on('exit', res));
});

test('the cheap pass in fast mode reports the budget of the suite run it made, and null when it ran none', async () => {
  const { runCheapPass } = await import('../lib/cheappass.mjs');
  const slug = '07-x';
  const root = project({
    [`.astrocode/phases/${slug}/CRITERIA.md`]: '### C1 — one\n- **Cheap:** `true`\n',
    'src/a.mjs': 'export const a = 1;\n',
  });
  put(root, 'tests/a.test.mjs', "import '../src/a.mjs';\n");
  sh(root, 'add', '-A');
  sh(root, 'commit', '-qm', 'feat (phase 07 t1)');
  const env = heavyEnv();
  const saved = process.env.ASTRO_HEAVY_DIR;
  process.env.ASTRO_HEAVY_DIR = env.ASTRO_HEAVY_DIR;
  try {
    const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: { ...CLEAN, ...o.env } });
    const res = await runCheapPass(root, slug, { spawn });
    assert.ok(res.workers && res.workers.n >= 1, JSON.stringify(res.workers));
    const again = await runCheapPass(root, slug, { spawn });
    assert.equal(again.workers, null, 'a reused receipt ran nothing');
  } finally {
    if (saved === undefined) delete process.env.ASTRO_HEAVY_DIR; else process.env.ASTRO_HEAVY_DIR = saved;
  }
});
