// Phase 59 t9 — enterHeavy: lock, budget, sweep, run folder, cache and signals in one entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { enterHeavy } from '../lib/heavy.mjs';

const HEAVY = new URL('../lib/heavy.mjs', import.meta.url).href;
const CAPRUN = new URL('../lib/caprun.mjs', import.meta.url).href;
const mk = (p) => mkdtempSync(join(tmpdir(), p));
const envOf = (home) => ({ ...process.env, ASTRO_HEAVY_DIR: home, ASTRO_HEAVY_LOCK: '', GOFLAGS: '' });
const runs = (home) => (existsSync(join(home, 'runs')) ? readdirSync(join(home, 'runs')) : []);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
const noSleep = () => assert.fail('a free lock must not sleep');

test('enterHeavy returns the budget and an env with a private temp folder and the budget variables', () => {
  const home = mk('heavy-home-');
  const h = enterHeavy(mk('heavy-root-'), { kind: 'suite', command: 'c', env: envOf(home), sleep: noSleep });
  try {
    assert.ok(h.workers.n >= 1);
    assert.match(h.tmp, /runs\/ac-run-\d+-[a-z0-9]{6}\/tmp$/);
    assert.ok(h.tmp.startsWith(home));
    for (const k of ['TMPDIR', 'TMP', 'TEMP', 'GOTMPDIR']) assert.equal(h.env[k], h.tmp, k);
    assert.equal(h.env.GOMAXPROCS, String(h.workers.n));
    assert.equal(h.env.ASTRO_WORKERS, String(h.workers.n));
    assert.equal(h.env.GOFLAGS, `-p=${h.workers.n}`);
    assert.ok(h.env.ASTRO_HEAVY_LOCK);
    assert.equal(h.env.GOCACHE, process.env.GOCACHE, 'a suite leaves GOCACHE alone');
    assert.equal(h.cleaned, null);
    assert.equal(h.go_cache, null);
    assert.equal(h.lock.waited_ms, 0);
  } finally { h.leave(); }
});

test('a mutation run gets GOCACHE at <home>/gocache', () => {
  const home = mk('heavy-home-');
  const h = enterHeavy(mk('heavy-root-'), { kind: 'mutation', command: 'ac mutate 1', env: envOf(home) });
  try {
    assert.equal(h.env.GOCACHE, join(home, 'gocache'));
    assert.ok(existsSync(join(home, 'gocache')));
    assert.equal(h.go_cache.dir, join(home, 'gocache'));
  } finally { h.leave(); }
});

test('leave removes the run folder and releases the lock, and is idempotent', () => {
  const home = mk('heavy-home-');
  const root = mk('heavy-root-');
  const h = enterHeavy(root, { kind: 'suite', command: 'c', env: envOf(home) });
  assert.equal(runs(home).length, 1);
  assert.ok(existsSync(join(home, 'lock')));
  h.leave();
  h.leave();
  assert.equal(runs(home).length, 0);
  assert.equal(existsSync(join(home, 'lock')), false);
  const again = enterHeavy(root, { kind: 'suite', command: 'c', env: envOf(home), sleep: noSleep });
  again.leave();
});

test('a dead run folder is swept and reported in cleaned', () => {
  const home = mk('heavy-home-');
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  const dead = join(home, 'runs', `ac-run-${deadPid}-dead01`);
  mkdirSync(join(dead, 'tmp'), { recursive: true });
  writeFileSync(join(dead, 'owner.json'), JSON.stringify({ pid: deadPid, started_ms: 1 }));
  writeFileSync(join(dead, 'tmp', 'junk'), 'x'.repeat(50));
  const h = enterHeavy(mk('heavy-root-'), { kind: 'suite', command: 'c', env: envOf(home) });
  try {
    assert.equal(existsSync(dead), false);
    assert.equal(h.cleaned.count, 1);
    assert.ok(h.cleaned.bytes >= 50);
  } finally { h.leave(); }
});

test('SIGINT kills the live child group, removes the run folder, releases the lock and exits 130', async () => {
  const home = mk('heavy-home-');
  const src = `import { enterHeavy } from ${JSON.stringify(HEAVY)};
import { runCapped, liveGroups } from ${JSON.stringify(CAPRUN)};
const h = enterHeavy(${JSON.stringify(mk('heavy-root-'))}, { kind: 'mutation', command: 'x' });
runCapped(['sleep', '60'], { env: h.env, capMs: 0 });
console.log(JSON.stringify({ pid: liveGroups()[0] }));
setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], { env: envOf(home), stdio: ['ignore', 'pipe', 'inherit'] });
  const first = await new Promise((res) => child.stdout.once('data', (d) => res(JSON.parse(String(d)))));
  assert.equal(runs(home).length, 1);
  const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
  child.kill('SIGINT');
  const { code } = await exited;
  assert.equal(code, 130);
  assert.equal(runs(home).length, 0);
  assert.equal(existsSync(join(home, 'lock')), false);
  assert.ok(await until(() => !alive(first.pid)), 'the sleeping grandchild must be dead');
});

test('the exit hook cleans up after process.exit(1)', async () => {
  const home = mk('heavy-home-');
  const src = `import { enterHeavy } from ${JSON.stringify(HEAVY)};
enterHeavy(${JSON.stringify(mk('heavy-root-'))}, { kind: 'suite', command: 'x' });
process.exit(1);`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', src], { env: envOf(home) });
  assert.equal(r.status, 1);
  assert.equal(runs(home).length, 0);
  assert.equal(existsSync(join(home, 'lock')), false);
});
