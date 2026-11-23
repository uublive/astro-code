// Phase 59 t2 — the machine-wide heavy lock: waited for, said aloud, dead holders taken over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { acquireMachineLock, heavyHome } from '../lib/machinelock.mjs';

const LIB = new URL('../lib/machinelock.mjs', import.meta.url).href;
const home = () => mkdtempSync(join(tmpdir(), 'mlock-'));
const envOf = (dir) => ({ ASTRO_HEAVY_DIR: dir });
const lockDirOf = (dir) => join(dir, 'lock');
const holderOf = (dir) => JSON.parse(readFileSync(join(lockDirOf(dir), 'holder.json'), 'utf8'));
const noSleep = () => assert.fail('sleep must not be called');
const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// A child that takes the lock, prints its token, and holds it until stdin closes (or `holdMs`).
function holderChild(dir, { project = 'projA', command = 'ac suite run', holdMs = 60000 } = {}) {
  const src = `import { acquireMachineLock } from ${JSON.stringify(LIB)};
const l = acquireMachineLock({ project: ${JSON.stringify(project)}, command: ${JSON.stringify(command)}, onWait() {} });
console.log(l.token);
const t = setTimeout(() => { l.release(); process.exit(0); }, ${holdMs});
process.stdin.on('end', () => { clearTimeout(t); l.release(); process.exit(0); });
process.stdin.resume();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', src], {
    env: { ...process.env, ...envOf(dir), ASTRO_HEAVY_LOCK: '' }, stdio: ['pipe', 'pipe', 'inherit'],
  });
  const token = new Promise((res) => child.stdout.once('data', (d) => res(String(d).trim())));
  const exited = new Promise((res) => child.on('exit', res));
  return { child, token, exited };
}

const deadPid = () => spawnSync(process.execPath, ['-e', '']).pid;

test('a free lock is taken on the first attempt without any sleep', () => {
  const dir = home();
  const l = acquireMachineLock({ project: 'p', command: 'c', env: envOf(dir), sleep: noSleep });
  assert.equal(l.reentrant, false);
  assert.equal(l.waited_ms, 0);
  assert.equal(holderOf(dir).project, 'p');
  l.release();
  assert.equal(existsSync(lockDirOf(dir)), false);
});

test('heavyHome honours ASTRO_HEAVY_DIR and defaults under ~/.astro/heavy', () => {
  assert.equal(heavyHome({ ASTRO_HEAVY_DIR: '/x/y' }), '/x/y');
  assert.equal(heavyHome({ HOME: '/h' }), '/h/.astro/heavy');
});

test('a second process waits, names the holder, and gets the lock only after release', async () => {
  const dir = home();
  const a = holderChild(dir, { project: 'projA', command: 'ac mutate 7', holdMs: 1500 });
  await a.token;
  const lines = [];
  const t0 = Date.now();
  const l = acquireMachineLock({ project: 'projB', command: 'ac suite run', env: envOf(dir), onWait: (x) => lines.push(x) });
  const waited = Date.now() - t0;
  l.release();
  assert.ok(waited >= 500, `waited ${waited} ms`);
  assert.ok(lines.length >= 1);
  assert.match(lines[0], /waiting for the machine lock: projA `ac mutate 7` \(held \d+s, pid \d+\)/);
  assert.ok(l.waited_ms >= 500);
  await a.exited;
});

test('a kill -9 holder is taken over within a few seconds', async () => {
  const dir = home();
  const a = holderChild(dir, { project: 'dead', command: 'ac mutate 1' });
  await a.token;
  a.child.kill('SIGKILL');
  await a.exited;
  const t0 = Date.now();
  const l = acquireMachineLock({ project: 'B', command: 'c', env: envOf(dir), onWait() {} });
  assert.ok(Date.now() - t0 < 5000);
  assert.equal(l.took_over.project, 'dead');
  assert.equal(l.took_over.command, 'ac mutate 1');
  l.release();
});

test('a live holder is never taken over, however long it has held (injected clock)', async () => {
  const dir = home();
  const a = holderChild(dir);
  const token = await a.token;
  let calls = 0;
  assert.throws(() => acquireMachineLock({
    project: 'B', command: 'c', env: envOf(dir), onWait() {}, now: () => Date.now() + 120000,
    sleep: () => { calls += 1; if (calls >= 4) throw new Error('stop waiting'); },
  }), /stop waiting/);
  assert.equal(holderOf(dir).token, token);
  a.child.stdin.end();
  await a.exited;
});

test('a holder whose pid is alive but whose start time is wrong counts as dead (pid reuse)', () => {
  const dir = home();
  mkdirSync(lockDirOf(dir), { recursive: true });
  writeFileSync(join(lockDirOf(dir), 'holder.json'), JSON.stringify({ pid: process.pid, started_ms: 1000, project: 'old', command: 'x', token: 'zz' }));
  const l = acquireMachineLock({ project: 'B', command: 'c', env: envOf(dir), sleep: noSleep });
  assert.equal(l.took_over.project, 'old');
  l.release();
});

test('a lock directory with no holder.json is taken over only once it is older than 30 s', () => {
  const dir = home();
  mkdirSync(lockDirOf(dir), { recursive: true });
  let calls = 0;
  assert.throws(() => acquireMachineLock({ env: envOf(dir), onWait() {}, sleep: () => { calls += 1; if (calls > 1) throw new Error('waiting'); } }), /waiting/);
  const l = acquireMachineLock({ env: envOf(dir), onWait() {}, sleep: noSleep, now: () => Date.now() + 60000 });
  assert.ok(l.took_over);
  l.release();
});

test('the lock is reentrant in-process, and release of the inner one keeps it held', () => {
  const dir = home();
  const outer = acquireMachineLock({ env: envOf(dir), sleep: noSleep });
  const inner = acquireMachineLock({ env: envOf(dir), sleep: noSleep });
  assert.equal(inner.reentrant, true);
  inner.release();
  assert.ok(existsSync(lockDirOf(dir)));
  outer.release();
  assert.equal(existsSync(lockDirOf(dir)), false);
});

test('ASTRO_HEAVY_LOCK with the holder token is reentrant; a foreign token waits', async () => {
  const dir = home();
  const a = holderChild(dir);
  const token = await a.token;
  const l = acquireMachineLock({ env: { ...envOf(dir), ASTRO_HEAVY_LOCK: token }, sleep: noSleep });
  assert.equal(l.reentrant, true);
  l.release();
  assert.ok(existsSync(lockDirOf(dir)), 'a reentrant release leaves the holder lock alone');
  assert.throws(() => acquireMachineLock({ env: { ...envOf(dir), ASTRO_HEAVY_LOCK: 'foreign' }, onWait() {}, sleep: () => { throw new Error('waits'); } }), /waits/);
  a.child.stdin.end();
  await a.exited;
});

test('release is idempotent and never removes another holder lock', () => {
  const dir = home();
  const l = acquireMachineLock({ env: envOf(dir), sleep: noSleep });
  l.release();
  mkdirSync(lockDirOf(dir));
  writeFileSync(join(lockDirOf(dir), 'holder.json'), JSON.stringify({ pid: process.pid, token: 'someone-else' }));
  l.release();
  assert.ok(existsSync(lockDirOf(dir)));
});

test('two racing takeovers of a dead holder yield exactly one holder at a time', async () => {
  const dir = home();
  mkdirSync(lockDirOf(dir), { recursive: true });
  writeFileSync(join(lockDirOf(dir), 'holder.json'), JSON.stringify({ pid: deadPid(), started_ms: 1, project: 'gone', command: 'x', token: 'dd' }));
  const out = join(dir, 'spans');
  mkdirSync(out);
  const src = (id) => `import { acquireMachineLock } from ${JSON.stringify(LIB)};
import { writeFileSync } from 'node:fs';
const l = acquireMachineLock({ onWait() {} });
const start = Date.now();
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
writeFileSync(${JSON.stringify(join(out, id))}, JSON.stringify({ start, end: Date.now() }));
l.release();`;
  const run = (id) => new Promise((res) => spawn(process.execPath, ['--input-type=module', '-e', src(id)], { env: { ...process.env, ...envOf(dir), ASTRO_HEAVY_LOCK: '' }, stdio: 'inherit' }).on('exit', res));
  const codes = await Promise.all([run('a'), run('b')]);
  assert.deepEqual(codes, [0, 0]);
  const [x, y] = readdirSync(out).sort().map((f) => JSON.parse(readFileSync(join(out, f), 'utf8')));
  const [first, second] = x.start <= y.start ? [x, y] : [y, x];
  assert.ok(second.start >= first.end - 5, 'the two holds must not overlap');
});
