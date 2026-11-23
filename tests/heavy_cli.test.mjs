// Phase 59 t13 — the budget, the machine lock and the cleanup, through the real CLI (C1, C2, C6, C7, C8, C16).
// Two scratch projects A and B share one temp ASTRO_HEAVY_DIR and carry no ASTRO_HEAVY_LOCK, so only the
// machine lock (never a per-project one) can order them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, availableParallelism } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';
import { makeProject, installStub, restrictedEnv } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
// Under `node --test` a nested `node --test` inherits NODE_TEST_CONTEXT and misreports; a real `ac` run never has it.
const { NODE_TEST_CONTEXT, ...CLEAN } = process.env;
const heavyEnv = (heavy, extra = {}) => ({ ...CLEAN, ASTRO_HEAVY_DIR: heavy, ASTRO_HEAVY_LOCK: '', ASTRO_SIGNER_AGENT: '', ...extra });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(50); } return fn(); };
const stamp = (out, f) => Number(readFileSync(join(out, f), 'utf8'));

async function proj(name) {
  const dir = mkdtempSync(join(tmpdir(), `ac-heavy-${name}-`));
  sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name });
  await addPhase(dir, { number: 1, name: 'First' });
  put(dir, 'package.json', '{"type":"module"}\n');
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'tests/a.test.mjs', "import { test } from 'node:test';\nimport '../src/a.mjs';\ntest('a', () => {});\n");
  put(dir, '.astrocode/phases/1-first/CRITERIA.md', '### C1 — one\n- **Cheap:** `true`\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  put(dir, 'src/a.mjs', 'export const a = 2;\n');
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'feat: a (phase 1 t1)');
  return { dir, slug: findPhase(dir, '1').slug };
}
// A command that stamps its start, holds for `ms`, stamps its end: `<node> hold.mjs <name> <ms>`.
function holdScript() {
  const out = mkdtempSync(join(tmpdir(), 'ac-heavy-out-'));
  writeFileSync(join(out, 'hold.mjs'), `import { writeFileSync } from 'node:fs';
const [name, ms] = process.argv.slice(2);
writeFileSync(${JSON.stringify(out)} + '/' + name + '.start', String(Date.now()));
await new Promise((r) => setTimeout(r, Number(ms)));
writeFileSync(${JSON.stringify(out)} + '/' + name + '.end', String(Date.now()));
`);
  return { out, cmd: (name, ms) => `${process.execPath} ${join(out, 'hold.mjs')} ${name} ${ms}` };
}
const run = (cwd, env, args) => spawnSync(process.execPath, [AC, ...args], { cwd, env, encoding: 'utf8', input: '', timeout: 120000 });
const bg = (cwd, env, args) => {
  const child = spawn(process.execPath, [AC, ...args], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = { stdout: '', stderr: '' };
  child.stdout.on('data', (d) => { out.stdout += d; });
  child.stderr.on('data', (d) => { out.stderr += d; });
  const exited = new Promise((res) => child.on('exit', (code) => res(code)));
  return { child, out, exited };
};

test('C6: a second suite waits for the first, names its project, command and age, and runs after it ends', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const A = await proj('a');
  const B = await proj('b');
  const { out, cmd } = holdScript();
  const a = bg(A.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('a', 3000), '--json']);
  assert.ok(await until(() => existsSync(join(out, 'a.start'))), 'A started');
  const b = bg(B.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('b', 0), '--json']);
  assert.equal(await b.exited, 0, b.out.stderr);
  await a.exited;
  assert.match(b.out.stderr, /⊡ waiting for the machine lock: .*ac-heavy-a-.* `.*hold\.mjs a 3000` \(held \d+s, pid \d+\) — starts when it ends/);
  assert.ok(stamp(out, 'b.start') >= stamp(out, 'a.end'), 'B did not overlap A');
  assert.equal(JSON.parse(b.out.stdout).exit, 0);
});

test('C6: a mutation holder and a suite waiter are serialized, and the reverse', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const { out, cmd } = holdScript();
  // mutation holds, suite waits
  const M = await makeProject('go');
  installStub(M.dir, 'gremlins'); installStub(M.dir, 'go');
  const log = join(M.dir, 'stub.log');
  const menv = restrictedEnv([join(M.dir, 'stubbin')], { ASTRO_HEAVY_DIR: heavy, MUTATE_STUB_LOG: log, MUTATE_STUB_SLEEP: '3' });
  const S = await proj('s');
  const m = bg(M.dir, menv, ['mutate', '1', '--json']);
  assert.ok(await until(() => existsSync(log) && readFileSync(log, 'utf8').includes('unleash')), 'the mutation tool started');
  const started = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').find((l) => l.includes('unleash'))).at;
  const s = bg(S.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('s', 0), '--json']);
  assert.equal(await s.exited, 0, s.out.stderr);
  await m.exited;
  assert.match(s.out.stderr, /waiting for the machine lock: .*`ac mutate 1`/);
  assert.ok(stamp(out, 's.start') >= started + 2900, 'the suite started only after the mutation tool ended');
  // suite holds, mutation waits
  const M2 = await makeProject('go');
  installStub(M2.dir, 'gremlins'); installStub(M2.dir, 'go');
  const log2 = join(M2.dir, 'stub.log');
  const menv2 = restrictedEnv([join(M2.dir, 'stubbin')], { ASTRO_HEAVY_DIR: heavy, MUTATE_STUB_LOG: log2 });
  const s2 = bg(S.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('t', 3000), '--json']);
  assert.ok(await until(() => existsSync(join(out, 't.start'))));
  const m2 = bg(M2.dir, menv2, ['mutate', '1', '--json']);
  await m2.exited;
  await s2.exited;
  const at = JSON.parse(readFileSync(log2, 'utf8').trim().split('\n').find((l) => l.includes('unleash'))).at;
  assert.ok(at >= stamp(out, 't.end') - 50, 'the mutation tool started only after the suite ended');
});

test('C7: a lock left by a kill -9 holder is taken over within seconds', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const A = await proj('a');
  const B = await proj('b');
  const { out, cmd } = holdScript();
  const a = bg(A.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('a', 30000)]);
  assert.ok(await until(() => existsSync(join(out, 'a.start'))));
  process.kill(-a.child.pid, 'SIGKILL');
  await a.exited;
  const t0 = Date.now();
  const b = run(B.dir, heavyEnv(heavy), ['suite', 'run', '--command', 'true', '--json']);
  assert.equal(b.status, 0, b.stderr);
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.equal(JSON.parse(b.stdout).lock.took_over.project, A.dir.replace(/^\/private/, ''));
});

test('C8: the wait for the lock does not count against a mutation cap, through the CLI', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const A = await proj('a');
  const { out, cmd } = holdScript();
  const M = await makeProject('go');
  installStub(M.dir, 'gremlins'); installStub(M.dir, 'go');
  const report = join(M.dir, 'six.json');
  writeFileSync(report, JSON.stringify({ go_module: 'example.com/p', mutants_total: 6, files: [{ file_name: 'a.go', mutations: ['LIVED', 'LIVED', 'KILLED', 'LIVED', 'KILLED', 'LIVED'].map((s, i) => ({ line: 3 + i, column: 2, type: 'ARITHMETIC_BASE', status: s })) }] }));
  const env = restrictedEnv([join(M.dir, 'stubbin')], { ASTRO_HEAVY_DIR: heavy, MUTATE_STUB_REPORT: report });
  assert.equal(run(M.dir, env, ['config', 'set', 'mutation.cap_seconds', '2']).status, 0);
  const a = bg(A.dir, heavyEnv(heavy), ['suite', 'run', '--command', cmd('a', 3000), '--json']);
  assert.ok(await until(() => existsSync(join(out, 'a.start'))));
  const b = bg(M.dir, env, ['mutate', '1', '--json']);
  assert.equal(await b.exited, 0, b.out.stderr);
  await a.exited;
  const res = JSON.parse(b.out.stdout);
  assert.equal(res.capped, false);
  assert.equal(Object.values(res.counts).reduce((x, y) => x + y, 0), 6);
  assert.ok(res.lock.waited_ms >= 1500);
});

test('C1: ac suite run states the budget in --json and in one text line', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const P = await proj('p');
  const j = JSON.parse(run(P.dir, heavyEnv(heavy), ['suite', 'run', '--command', 'node --test', '--json']).stdout);
  assert.ok(j.workers.n >= 1 && j.workers.n <= Math.ceil(availableParallelism() / 4), JSON.stringify(j.workers));
  assert.match(j.workers.reason, /^adaptive: \d+ CPUs/);
  assert.equal(j.shaped, 'node --test');
  assert.equal(j.exit, 0);
  const t = run(P.dir, heavyEnv(heavy), ['suite', 'run', '--command', 'node --test']);
  assert.equal(t.stdout.split('\n').filter((l) => l.startsWith('• workers:')).length, 1, t.stdout);
  assert.equal(t.stdout.split('\n').filter((l) => l.includes('cleaned')).length, 0, 'nothing was swept: nothing is said');
});

test('C2: ac config set heavy.workers makes the budget the setting, and says so', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const P = await proj('p');
  assert.equal(run(P.dir, heavyEnv(heavy), ['config', 'set', 'heavy.workers', '2']).status, 0);
  const j = JSON.parse(run(P.dir, heavyEnv(heavy), ['suite', 'run', '--command', 'true', '--json']).stdout);
  assert.deepEqual([j.workers.n, j.workers.source], [2, 'setting']);
  assert.match(j.workers.reason, /heavy\.workers/);
});

test('C1: ac verdict cheap --json carries the budget of the suite run it made, and prints one line', async () => {
  const heavy = mkdtempSync(join(tmpdir(), 'ac-heavy-home-'));
  const P = await proj('p');
  const r = run(P.dir, heavyEnv(heavy), ['verdict', 'cheap', '1', '--json']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(JSON.parse(r.stdout).workers.n >= 1);
  const P2 = await proj('p2');
  const t = run(P2.dir, heavyEnv(heavy), ['verdict', 'cheap', '1']);
  assert.equal(t.stdout.split('\n').filter((l) => l.startsWith('• workers:')).length, 1, t.stdout);
});

test('ac suite targeted prints the gate plan fields, and refuses a stray flag', async () => {
  const P = await proj('p');
  const j = JSON.parse(run(P.dir, heavyEnv(mkdtempSync(join(tmpdir(), 'ac-heavy-home-'))), ['suite', 'targeted', '1', '--json']).stdout);
  assert.equal(j.mode, 'targeted');
  assert.deepEqual(j.tests, ['tests/a.test.mjs']);
  assert.equal(j.command, "node --test 'tests/a.test.mjs'");
  const bad = run(P.dir, heavyEnv(mkdtempSync(join(tmpdir(), 'ac-heavy-home-'))), ['suite', 'targeted', '1', '--bogus']);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /unknown flag/);
  assert.notEqual(run(P.dir, heavyEnv(mkdtempSync(join(tmpdir(), 'ac-heavy-home-'))), ['suite', 'targeted']).status, 0);
});

test('C16: a free lock is taken without any wait', async () => {
  const P = await proj('p');
  const t0 = Date.now();
  const j = JSON.parse(run(P.dir, heavyEnv(mkdtempSync(join(tmpdir(), 'ac-heavy-home-'))), ['suite', 'run', '--command', 'true', '--json']).stdout);
  assert.equal(j.lock.waited_ms, 0);
  assert.ok(Date.now() - t0 < 5000);
  rmSync(P.dir, { recursive: true, force: true });
});
