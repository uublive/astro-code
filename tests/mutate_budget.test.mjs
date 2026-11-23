// Phase 59 t11 — `ac mutate` under the worker budget: tool flags, env, machine lock, private Go cache and
// temp folder, cleanup on every ending (C1-C4, C8, C11-C14). Real tmp git projects; the tools are the
// recording stub (tests/fixtures/mutate/stub.mjs) on a restricted PATH. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, readdirSync, utimesSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { makeProject, installStub, restrictedEnv, FX } from './fixtures/mutate/project.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const LOCK = new URL('../lib/machinelock.mjs', import.meta.url).href;
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return fn(); };
const cfg = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => ({ ...c, ...patch(c) }));
};
const runsOf = (p) => { const d = join(p.env.ASTRO_HEAVY_DIR, 'runs'); return existsSync(d) ? readdirSync(d) : []; };

async function rig(kind, { report, version, extra = {}, nodeModules = false, workers } = {}) {
  const p = await makeProject(kind);
  const name = { js: 'stryker', go: 'gremlins', py: 'mutmut' }[kind];
  installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  if (kind === 'go') installStub(p.dir, 'go');
  p.log = join(p.dir, 'stub.log');
  p.pids = join(p.dir, 'stub.pids');
  p.env = restrictedEnv(nodeModules ? [] : [join(p.dir, 'stubbin')], {
    MUTATE_STUB_LOG: p.log, MUTATE_STUB_PIDS: p.pids,
    ...(report ? { MUTATE_STUB_REPORT: join(FX, report) } : {}), ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra,
  });
  if (workers) await cfg(p.dir, (c) => ({ heavy: { ...(c.heavy ?? {}), workers } }));
  return p;
}
const first = (p, pred) => logLines(p.log).find(pred);
const unleash = (p) => first(p, (l) => l.tool === 'gremlins' && l.argv[0] === 'unleash');
const put = (dir, f, b) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), b); };

test('Gremlins gets --workers N, GOMAXPROCS N and GOFLAGS -p=N (existing flags kept), and never --test-cpu', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', { report: 'gremlins.json', workers: 2, extra: { GOFLAGS: '-short' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    const c = unleash(p);
    assert.equal(c.argv[c.argv.indexOf('--workers') + 1], '2');
    assert.ok(!c.argv.some((a) => a.includes('test-cpu')));
    assert.equal(c.env.GOMAXPROCS, '2');
    assert.equal(c.env.GOFLAGS, '-short -p=2 -count=1');
    assert.equal(c.env.ASTRO_WORKERS, '2');
    assert.deepEqual(r.tool_workers, { flag: '--workers', value: 2, project: null, capped: false, note: null, source: 'setting' });
  } finally { done(p); }
});

test('a project .gremlins.yaml workers below the budget is respected; above it, capped and said so', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  for (const [yaml, want, capped] of [[1, '1', false], [8, '2', true]]) {
    const p = await rig('go', { report: 'gremlins.json', workers: 2 });
    try {
      put(p.dir, '.gremlins.yaml', `unleash:\n  workers: ${yaml}\n  timeout-coefficient: 3\n`);
      const r = await runMutate(p.dir, p.slug1, { env: p.env });
      const c = unleash(p);
      assert.equal(c.argv[c.argv.indexOf('--workers') + 1], want, `yaml ${yaml}`);
      assert.equal(r.tool_workers.capped, capped);
      if (capped) assert.match(r.tool_workers.note, /project value 8 capped to the budget 2/);
      assert.equal(c.env.GOMAXPROCS, '2', 'the go test processes stay at the budget either way');
    } finally { done(p); }
  }
});

test('mutmut 3 gets --max-children N; mutation.max_children wins and says so', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = await rig('py', { report: 'mutmut3-results.txt', version: 'mutmut, version 3.2.0', workers: 2 });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    const run = first(p, (l) => l.tool === 'mutmut' && l.argv[0] === 'run').argv;
    assert.equal(run[run.indexOf('--max-children') + 1], '2');
    assert.equal(r.tool_workers.value, 2);
    assert.equal(r.tool_workers.source, 'setting');
  } finally { done(p); }
  p = await rig('py', { report: 'mutmut3-results.txt', version: 'mutmut, version 3.2.0', workers: 2 });
  try {
    await cfg(p.dir, () => ({ mutation: { max_children: 1 } }));
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    const run = first(p, (l) => l.tool === 'mutmut' && l.argv[0] === 'run').argv;
    assert.equal(run[run.indexOf('--max-children') + 1], '1');
    assert.equal(r.tool_workers.source, 'mutation.max_children');
  } finally { done(p); }
});

test('Stryker gets --concurrency N; a lower project concurrency is kept, a higher one capped and said so', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  for (const [conc, want, capped] of [[undefined, '2', false], [1, '1', false], [16, '2', true]]) {
    const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true, workers: 2 });
    try {
      if (conc !== undefined) put(p.dir, 'stryker.config.json', JSON.stringify({ testRunner: 'command', commandRunner: { command: 'node --test' }, concurrency: conc }));
      const r = await runMutate(p.dir, p.slug1, { env: p.env });
      const c = first(p, (l) => l.tool === 'stryker' && l.argv[0] === 'run');
      assert.equal(c.argv[c.argv.indexOf('--concurrency') + 1], want, `concurrency ${conc}`);
      assert.equal(r.tool_workers.capped, capped);
      if (capped) assert.match(r.tool_workers.note, /capped to the budget 2/);
    } finally { done(p); }
  }
});

test('the result states the budget: adaptive when unset, the setting when set', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = await rig('go', { report: 'gremlins.json' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.workers.source, 'adaptive');
    assert.match(r.workers.reason, /^adaptive: \d+ CPUs, /);
    assert.ok(r.workers.n >= 1);
  } finally { done(p); }
  p = await rig('go', { report: 'gremlins.json', workers: 3 });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.workers.n, 3);
    assert.equal(r.workers.source, 'setting');
    assert.match(r.workers.reason, /heavy\.workers/);
  } finally { done(p); }
});

test('GOCACHE is a private folder under the heavy home, and an over-cap cache is trimmed oldest-first', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', { report: 'gremlins.json', workers: 1 });
  try {
    await cfg(p.dir, (c) => ({ heavy: { ...c.heavy, go_cache_max_mb: 1 } }));
    const cache = join(p.env.ASTRO_HEAVY_DIR, 'gocache');
    mkdirSync(join(cache, 'ab'), { recursive: true });
    const files = [];
    for (let i = 0; i < 5; i += 1) {
      const f = join(cache, i % 2 ? 'ab' : '.', `e${i}`);
      writeFileSync(f, Buffer.alloc(400 * 1024));
      utimesSync(f, 1000 + i, 1000 + i);
      files.push(f);
    }
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(unleash(p).env.GOCACHE, cache);
    assert.ok(r.go_cache.after_bytes <= 1024 * 1024, JSON.stringify(r.go_cache));
    assert.deepEqual(files.map((f) => existsSync(f)), [false, false, false, true, true], 'the oldest went first, the newest stayed');
  } finally { done(p); }
});

test('TMPDIR is a run-specific folder, shared with the tool, and gone after a clean run, a failing run and a capped run', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const seen = [];
  const cases = [
    ['exit 0', 'go', 'gremlins.json', {}, {}],
    ['exit 1', 'py', 'mutmut3-results.txt', { MUTATE_STUB_EXIT: '1', MUTATE_STUB_VERSION: 'mutmut, version 3.2.0' }, {}],
    ['capped', 'go', 'gremlins.json', { MUTATE_STUB_SLEEP: '30' }, { cap_seconds: 1 }],
  ];
  for (const [name, kind, report, extra, mutation] of cases) {
    const p = await rig(kind, { report, extra: { MUTATE_STUB_TMPWRITE: '1', ...extra } });
    try {
      if (mutation.cap_seconds) await cfg(p.dir, () => ({ mutation }));
      const r = await runMutate(p.dir, p.slug1, { env: p.env });
      const call = first(p, (l) => l.argv[0] === 'unleash' || l.argv[0] === 'run');
      assert.ok(call.env.TMPDIR.startsWith(join(p.env.ASTRO_HEAVY_DIR, 'runs', 'ac-run-')), `${name}: ${call.env.TMPDIR}`);
      assert.equal(call.tmpdir, call.env.TMPDIR, `${name}: the tool's os.tmpdir() is the run folder`);
      assert.equal(call.env.GOTMPDIR, call.env.TMPDIR);
      assert.equal(r.tmpdir, call.env.TMPDIR);
      assert.equal(existsSync(call.env.TMPDIR), false, `${name}: the temp folder must be removed`);
      assert.deepEqual(runsOf(p), [], `${name}: no run folder left`);
      if (name === 'capped') assert.equal(r.capped, true);
      seen.push(call.env.TMPDIR);
    } finally { done(p); }
  }
  assert.equal(new Set(seen).size, seen.length, 'two runs never share a folder');
});

test('Ctrl-C mid-run removes the temp folder and the tool group, and exits 130', async () => {
  const p = await rig('go', { report: 'gremlins.json', extra: { MUTATE_STUB_TMPWRITE: '1', MUTATE_STUB_SLEEP: '60', MUTATE_STUB_CHILD: '1' } });
  try {
    const child = spawn(process.execPath, [AC, 'mutate', '1', '--json'], { cwd: p.dir, env: p.env, stdio: ['ignore', 'ignore', 'ignore'] });
    const exited = new Promise((res) => child.on('exit', (code, sig) => res({ code, sig })));
    assert.ok(await until(() => existsSync(p.pids) && readFileSync(p.pids, 'utf8').trim().split(' ').length === 2), 'the stub started');
    const pids = readFileSync(p.pids, 'utf8').trim().split(' ').map(Number);
    const tmp = first(p, (l) => l.argv[0] === 'unleash').env.TMPDIR;
    assert.ok(existsSync(tmp));
    child.kill('SIGINT');
    const { code } = await exited;
    assert.equal(code, 130);
    assert.equal(existsSync(tmp), false);
    assert.deepEqual(runsOf(p), []);
    assert.ok(await until(() => pids.every((x) => !alive(x))), 'the stub and its child are dead');
  } finally { done(p); }
});

test('after a kill -9 the next run sweeps the dead run folder and reports it; a live run folder survives', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', { report: 'gremlins.json', extra: { MUTATE_STUB_TMPWRITE: '1', MUTATE_STUB_SLEEP: '60', MUTATE_STUB_CHILD: '1' } });
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const child = spawn(process.execPath, [AC, 'mutate', '1', '--json'], { cwd: p.dir, env: p.env, stdio: 'ignore' });
    const exited = new Promise((res) => child.on('exit', res));
    assert.ok(await until(() => existsSync(p.pids) && readFileSync(p.pids, 'utf8').trim().split(' ').length === 2));
    const pids = readFileSync(p.pids, 'utf8').trim().split(' ').map(Number);
    child.kill('SIGKILL');
    for (const x of pids) { try { process.kill(x, 'SIGKILL'); } catch { /* gone */ } }
    await exited;
    const dead = runsOf(p);
    assert.equal(dead.length, 1, 'kill -9 leaves its run folder behind');
    // A run whose owner is still alive: never swept.
    const live = join(p.env.ASTRO_HEAVY_DIR, 'runs', `ac-run-${sleeper.pid}-aaaaaa`);
    mkdirSync(join(live, 'tmp'), { recursive: true });
    writeFileSync(join(live, 'owner.json'), JSON.stringify({ pid: sleeper.pid, started_ms: Date.now() }));
    const fast = { ...p.env, MUTATE_STUB_SLEEP: '', MUTATE_STUB_CHILD: '' };
    const r = await runMutate(p.dir, p.slug1, { env: fast });
    assert.equal(r.cleaned.count, 1);
    assert.deepEqual(r.cleaned.names, dead);
    assert.deepEqual(runsOf(p), [`ac-run-${sleeper.pid}-aaaaaa`]);
    assert.ok(r.lock.took_over, 'the dead run also left the machine lock, which is taken over');
  } finally { sleeper.kill(); done(p); }
});

test('time spent waiting for the machine lock does not count against the cap', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', {});
  try {
    const report = join(p.dir, 'two.json');
    writeFileSync(report, JSON.stringify({ go_module: 'example.com/p', mutants_total: 2, files: [{ file_name: 'a.go', mutations: [
      { line: 3, column: 2, type: 'ARITHMETIC_BASE', status: 'LIVED' }, { line: 4, column: 2, type: 'ARITHMETIC_BASE', status: 'KILLED' }] }] }));
    p.env.MUTATE_STUB_REPORT = report;
    await cfg(p.dir, () => ({ mutation: { cap_seconds: 2 } }));
    const src = `import { acquireMachineLock } from ${JSON.stringify(LOCK)};
const l = acquireMachineLock({ project: 'other', command: 'held', onWait() {} });
console.log('held');
setTimeout(() => { l.release(); process.exit(0); }, 3000);`;
    const holder = spawn(process.execPath, ['--input-type=module', '-e', src], { env: { ...p.env, ASTRO_HEAVY_LOCK: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise((res) => holder.on('exit', res)); // before the synchronous wait: the loop is blocked while it runs
    await new Promise((res) => holder.stdout.once('data', res));
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.ok(r.lock.waited_ms >= 1500, `waited ${r.lock.waited_ms}`);
    assert.equal(r.capped, false);
    assert.notEqual(r.outcome, 'incomplete');
    assert.equal(r.complete, true);
    await exited;
  } finally { done(p); }
});

test('mutation always finishes: every survivor and a tested count equal to the total, with no early-stop flag', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', {});
  try {
    const status = ['LIVED', 'LIVED', 'KILLED', 'LIVED', 'KILLED', 'LIVED'];
    const report = join(p.dir, 'six.json');
    writeFileSync(report, JSON.stringify({
      go_module: 'example.com/p', mutants_total: 6,
      files: [{ file_name: 'a.go', mutations: status.map((s, i) => ({ line: 3 + i, column: 2, type: 'ARITHMETIC_BASE', status: s })) }],
    }));
    p.env.MUTATE_STUB_REPORT = report;
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.survivors.length, 4);
    assert.deepEqual(r.survivors.map((s) => s.line), [3, 4, 6, 8], 'including the very first mutants tested');
    assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 6);
    assert.equal(r.complete, true);
    assert.ok(!unleash(p).argv.filter((a) => a.startsWith('--')).some((a) => /stop|fail-fast|first|bail/i.test(a)));
  } finally { done(p); }
});

test('Gremlins always runs with -count=1 so a warm Go test cache cannot zero its timeout baseline', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('go', { report: 'gremlins.json' });
  try {
    await runMutate(p.dir, p.slug1, { env: p.env });
    assert.match(unleash(p).env.GOFLAGS, /(^|\s)-count=1(\s|$)/);
  } finally { done(p); }
});
