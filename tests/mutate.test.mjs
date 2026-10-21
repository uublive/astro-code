// Phase 47 t8 — lib/mutate.mjs: tool table, detection, scope, run under the cap, classify,
// check, setup. Real tmp git projects with ac phases; the tools are the stub (no real
// Stryker/Gremlins/mutmut is ever needed). Modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, sh, FX } from './fixtures/mutate/project.mjs';

const fx = (n) => join(FX, n);
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// A project plus a stub installed the way the tool would be found, and the env to run it in.
async function rig(kind, { report, version, extra = {}, nodeModules = false } = {}) {
  const p = await makeProject(kind);
  const name = { js: 'stryker', go: 'gremlins', py: 'mutmut' }[kind];
  const bin = installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.pids = join(p.dir, 'stub.pids');
  p.env = restrictedEnv(nodeModules ? [] : [bin], {
    MUTATE_STUB_LOG: p.log, MUTATE_STUB_PIDS: p.pids,
    ...(report ? { MUTATE_STUB_REPORT: fx(report) } : {}), ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra,
  });
  return p;
}

test('classifyRun covers every outcome; capped and zero mutants are never clean', async () => {
  const { classifyRun } = await import('../lib/mutate.mjs');
  const c = (o = {}) => ({ killed: 3, survived: 0, timeout: 1, 'no-coverage': 0, error: 0, ...o });
  assert.equal(classifyRun({ capped: false, complete: true, counts: c() }), 'clean');
  assert.equal(classifyRun({ capped: false, complete: true, counts: c({ survived: 1 }) }), 'survivors');
  assert.equal(classifyRun({ capped: false, complete: true, counts: c({ 'no-coverage': 1 }) }), 'survivors');
  assert.equal(classifyRun({ capped: true, complete: false, counts: c() }), 'incomplete');
  assert.equal(classifyRun({ capped: true, complete: true, counts: c() }), 'incomplete');
  assert.equal(classifyRun({ capped: false, complete: false, counts: c() }), 'incomplete');
  assert.equal(classifyRun({ capped: false, complete: true, counts: c({ killed: 0, timeout: 0 }) }), 'incomplete');
  for (const state of ['no-scope', 'tool-missing', 'no-tool', 'error']) {
    assert.equal(classifyRun({ state, capped: false, complete: true, counts: c() }), state);
  }
});

test('the tool table carries the exact install strings and the 600s default cap', async () => {
  const { MUTATION_TOOLS, DEFAULT_CAP_SECONDS } = await import('../lib/mutate.mjs');
  assert.equal(DEFAULT_CAP_SECONDS, 600);
  assert.deepEqual(Object.fromEntries(MUTATION_TOOLS.map((r) => [r.id, r.install])), {
    stryker: 'npm i -D @stryker-mutator/core',
    gremlins: 'go install github.com/go-gremlins/gremlins/cmd/gremlins@latest',
    mutmut: 'pip install mutmut',
  });
});

test('C2 scope: only the phase\'s own stamped, existing, non-test source files', async () => {
  const { phaseScope, pickTool } = await import('../lib/mutate.mjs');
  for (const [kind, a, b] of [['js', 'src/a.mjs', 'src/b.mjs'], ['go', 'a.go', 'b.go'], ['py', 'src/a.py', 'src/b.py']]) {
    const p = await makeProject(kind);
    try {
      const row = pickTool(p.dir).row;
      assert.deepEqual(phaseScope(p.dir, '1', row), [a], kind);
      assert.deepEqual(phaseScope(p.dir, '2', row), [b], kind);
      // a deleted file and a .astrocode file drop out
      sh(p.dir, 'rm', '-q', a);
      commit(p.dir, 'chore: drop (phase 1 t2)');
      assert.deepEqual(phaseScope(p.dir, '1', row), [], kind);
    } finally { done(p); }
  }
});

test('C2 scope: the phase\'s own remediation commits (phase NN remediate-cK) are in scope too', async () => {
  const { phaseScope, pickTool } = await import('../lib/mutate.mjs');
  const p = await makeProject('js');
  try {
    writeFileSync(join(p.dir, 'src', 'd.mjs'), '// d\n');
    commit(p.dir, 'fix: add d (phase 1 remediate-c0)');
    assert.deepEqual(phaseScope(p.dir, '1', pickTool(p.dir).row).sort(), ['src/a.mjs', 'src/d.mjs']);
  } finally { done(p); }
});

test('mutmut 3 globs a package __init__.py as the package itself (its mutants are named pkg.x_f__mutmut_N)', async () => {
  const { MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const row = MUTATION_TOOLS.find((r) => r.id === 'mutmut');
  const { argv } = row.build({ major: 3, bin: 'mutmut', scope: ['src/pkg/__init__.py', 'src/pkg/a.py'] });
  assert.deepEqual(argv, ['mutmut', 'run', 'pkg.*', 'pkg.a.*']);
});

test('C3 detection: manifest picks the tool and says why; mutation.tool overrides; no manifest is no-tool', async () => {
  const { pickTool } = await import('../lib/mutate.mjs');
  const cases = [['js', 'stryker', 'package.json → stryker'], ['go', 'gremlins', 'go.mod → gremlins'], ['py', 'mutmut', 'pyproject.toml → mutmut']];
  for (const [kind, id, why] of cases) {
    const p = await makeProject(kind);
    try {
      const r = pickTool(p.dir);
      assert.equal(r.row.id, id); assert.equal(r.why, why); assert.equal(r.source, 'detected');
      writeFileSync(join(p.dir, '.astrocode', 'config.json'), JSON.stringify({ mutation: { tool: 'mutmut' } }));
      const o = pickTool(p.dir);
      assert.equal(o.row.id, 'mutmut'); assert.equal(o.source, 'config'); assert.match(o.why, /config mutation\.tool/);
      writeFileSync(join(p.dir, '.astrocode', 'config.json'), JSON.stringify({ mutation: { tool: 'nope' } }));
      assert.match(pickTool(p.dir).error, /unknown mutation\.tool/);
    } finally { done(p); }
  }
  const p = await makeProject('js');
  try {
    rmSync(join(p.dir, 'package.json'));
    assert.equal(pickTool(p.dir).row, null);
    const { runMutate } = await import('../lib/mutate.mjs');
    const r = await runMutate(p.dir, p.slug1, { env: restrictedEnv([]) });
    assert.equal(r.outcome, 'no-tool'); assert.ok(r.fallback.reason);
  } finally { done(p); }
});

test('C1/C2 runMutate (stryker): every mutant present, statuses counted, argv carries exactly the scope', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'survivors');
    assert.equal(r.tool.id, 'stryker'); assert.equal(r.tool.version, '8.2.6'); assert.equal(r.tool.why, 'package.json → stryker');
    assert.deepEqual(r.scope, ['src/a.mjs']);
    assert.deepEqual(r.counts, { killed: 2, survived: 1, timeout: 1, 'no-coverage': 1, error: 2 });
    assert.equal(r.mutants.length, 7); assert.equal(r.ignored.length, 1);
    assert.deepEqual(r.survivors.map((m) => m.status), ['survived', 'no-coverage']);
    assert.equal(r.complete, true); assert.equal(r.capped, false); assert.equal(r.cap_seconds, 600);
    assert.equal(r.reproduce, 'ac mutate 1 --json');
    assert.equal(r.head, sh(p.dir, 'rev-parse', 'HEAD').stdout.trim());
    const [call] = logLines(p.log).filter((l) => l.argv[0] === 'run');
    assert.equal(call.argv[call.argv.indexOf('--mutate') + 1], 'src/a.mjs');
    assert.equal(r.command, 'stryker run --mutate src/a.mjs --reporters json');
    const again = await runMutate(p.dir, p.slug1, { env: p.env });
    const strip = ({ started_at, duration_ms, log, ...rest }) => rest;
    assert.deepEqual(strip(again), strip(r));
  } finally { done(p); }
});

test('C2 gremlins excludes every other tracked .go file; mutmut 2.x gets --paths-to-mutate; mutmut 3.x gets globs', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = await rig('go', { report: 'gremlins.json' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.tool.id, 'gremlins'); assert.deepEqual(r.scope, ['a.go']);
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 1, 'no-coverage': 1, error: 1 });
    const argv = logLines(p.log).find((l) => l.argv[0] === 'unleash').argv;
    const ex = argv.filter((a, i) => argv[i - 1] === '--exclude-files');
    assert.deepEqual(ex.sort(), ['^b\\.go$', '^c\\.go$']);
  } finally { done(p); }
  p = await rig('py', { report: 'mutmut2-junit.xml' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.tool.id, 'mutmut'); assert.deepEqual(r.scope, ['src/a.py']);
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 2, 'no-coverage': 0, error: 0 });
    const run = logLines(p.log).find((l) => l.argv[0] === 'run').argv;
    assert.deepEqual(run, ['run', '--paths-to-mutate', 'src/a.py']);
  } finally { done(p); }
  p = await rig('py', { report: 'mutmut3-results.txt', version: 'mutmut, version 3.2.0' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(logLines(p.log).find((l) => l.argv[0] === 'run').argv, ['run', 'a.*']);
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 2, 'no-coverage': 1, error: 1 });
    assert.equal(r.complete, false, 'a "not checked" mutant means the run is not complete');
    assert.equal(r.not_run.length, 1);
    assert.equal(r.outcome, 'incomplete');
  } finally { done(p); }
});

test('mutmut 2 collects with untested/suspicious policy failure: an untested mutant is not run, never killed', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  // A run that stopped (crash or cap) after registering mutants it never tested.
  const p = await rig('py', { report: 'mutmut2-junit-untested.xml' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    const collect = logLines(p.log).find((l) => l.argv[0] === 'junitxml').argv;
    assert.deepEqual(collect, ['junitxml', '--untested-policy', 'failure', '--suspicious-policy', 'failure']);
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 1, 'no-coverage': 0, error: 0 });
    assert.equal(r.not_run.length, 2);
    assert.equal(r.complete, false);
    assert.equal(r.outcome, 'incomplete', 'untested mutants never make a run clean');
  } finally { done(p); }
});

test('mutmut 2 fatal exit (bit 1) is an error even when junitxml prints an old all-killed cache', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { report: 'mutmut2-junit.xml', extra: { MUTATE_STUB_EXIT: '1' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'error');
    assert.match(r.error, /fatal error \(exit 1: RuntimeError/);
  } finally { done(p); }
  // survivors set bit 2 only: that is a normal finished run, not fatal
  const q = await rig('py', { report: 'mutmut2-junit.xml', extra: { MUTATE_STUB_EXIT: '2' } });
  try {
    assert.notEqual((await runMutate(q.dir, q.slug1, { env: q.env })).outcome, 'error');
  } finally { done(q); }
});

test('mutmut 2 mutants a pre_mutation hook skipped are ignored, never killed', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { report: 'mutmut2-junit-untested.xml', extra: { MUTATE_STUB_SKIPPED: '1\n' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(logLines(p.log).find((l) => l.argv[0] === 'result-ids').argv, ['result-ids', 'skipped']);
    assert.equal(r.counts.killed, 0);
    assert.deepEqual(r.ignored.map((m) => m.line), [1]);
  } finally { done(p); }
});

test('mutmut 2.x is detected through `mutmut version` (it has no --version flag)', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { report: 'mutmut2-junit.xml', extra: { MUTATE_STUB_V2_REAL: '1', MUTATE_STUB_VERSION: '2.4.5' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.notEqual(r.outcome, 'tool-missing');
    assert.equal(r.tool.version, '2.4.5');
    assert.deepEqual(logLines(p.log).find((l) => l.argv[0] === 'run').argv, ['run', '--paths-to-mutate', 'src/a.py']);
  } finally { done(p); }
});

test('an unknown mutmut major version is an error naming the version, and nothing runs', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { report: 'mutmut2-junit.xml', version: 'mutmut, version 9.1.0' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'error'); assert.match(r.error, /9\.1\.0/);
    assert.equal(logLines(p.log).filter((l) => l.argv[0] === 'run').length, 0);
  } finally { done(p); }
});

test('C4 a cap returns capped/incomplete with not-run listed, and kills the stub and its child', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { report: 'stryker-partial.json', nodeModules: true, extra: { MUTATE_STUB_SLEEP: '60', MUTATE_STUB_CHILD: '1' } });
  try {
    writeFileSync(join(p.dir, '.astrocode', 'config.json'), JSON.stringify({ mutation: { cap_seconds: 2 } }));
    const t0 = Date.now();
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.ok(Date.now() - t0 < 9000, `took ${Date.now() - t0}ms`);
    assert.equal(r.cap_seconds, 2); assert.equal(r.capped, true); assert.equal(r.complete, false);
    assert.equal(r.outcome, 'incomplete');
    assert.equal(r.not_run.length, 1);
    const pids = readFileSync(p.pids, 'utf8').split(' ').map(Number);
    await new Promise((res) => setTimeout(res, 300));
    for (const pid of pids) assert.equal(alive(pid), false, `pid ${pid} still alive`);
  } finally { done(p); }
});

test('a cap with no partial report lists the whole scope and says it will not guess', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { nodeModules: true, extra: { MUTATE_STUB_SLEEP: '60' } });
  try {
    writeFileSync(join(p.dir, '.astrocode', 'config.json'), JSON.stringify({ mutation: { cap_seconds: 1 } }));
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'incomplete'); assert.equal(r.capped, true);
    assert.deepEqual(r.not_run_files, ['src/a.mjs']);
    assert.match(r.not_run_note, /no partial report/);
  } finally { done(p); }
});

test('an invalid cap falls back to the default with a warning', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    writeFileSync(join(p.dir, '.astrocode', 'config.json'), JSON.stringify({ mutation: { cap_seconds: -5 } }));
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.cap_seconds, 600); assert.match(r.warnings.join(' '), /cap_seconds/);
  } finally { done(p); }
});

test('all-Timeout fixture and not capped is clean (timeouts count as killed)', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { nodeModules: true });
  try {
    const body = { files: { 'src/a.mjs': { mutants: [1, 2].map((i) => ({ id: String(i), mutatorName: 'X', location: { start: { line: i } }, status: 'Timeout' })) } } };
    writeFileSync(join(p.dir, 'rep.json'), JSON.stringify(body));
    const r = await runMutate(p.dir, p.slug1, { env: { ...p.env, MUTATE_STUB_REPORT: join(p.dir, 'rep.json') } });
    assert.equal(r.outcome, 'clean'); assert.equal(r.counts.timeout, 2); assert.equal(r.survivors.length, 0);
  } finally { done(p); }
});

test('hygiene: a created report is removed, a pre-existing one kept; a dirty scope errors without spawning', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(existsSync(join(p.dir, 'reports')), false, 'created artifacts are removed');
    mkdirSync(join(p.dir, 'reports', 'mutation'), { recursive: true });
    writeFileSync(join(p.dir, 'reports', 'mutation', 'mutation.json'), '{"keep":true}');
    await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(existsSync(join(p.dir, 'reports', 'mutation', 'mutation.json')), true, 'pre-existing artifacts are left alone');
    writeFileSync(join(p.dir, 'src', 'a.mjs'), '// dirty\n');
    writeFileSync(p.log, '');
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'error'); assert.match(r.error, /uncommitted/); assert.match(r.error, /src\/a\.mjs/);
    assert.equal(logLines(p.log).filter((l) => l.argv[0] === 'run').length, 0);
  } finally { done(p); }
  p = await rig('js', { nodeModules: true });
  try {
    rmSync(join(p.dir, 'src', 'a.mjs'));
    sh(p.dir, 'rm', '-q', '--cached', 'src/a.mjs');
    commit(p.dir, 'chore: drop a (phase 1 t2)');
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'no-scope'); assert.ok(r.fallback.reason);
  } finally { done(p); }
});

test('a missing tool: tool-missing with a reason, full notice once then reminder, nothing spawned', async () => {
  const { runMutate, checkMutate } = await import('../lib/mutate.mjs');
  const p = await makeProject('js');
  try {
    const spy = installStub(p.dir, 'npm', 'spybin');
    for (const n of ['npx', 'yarn', 'pnpm']) installStub(p.dir, n, 'spybin');
    const env = restrictedEnv([spy], { MUTATE_STUB_LOG: join(p.dir, 'spy.log') });
    const a = await runMutate(p.dir, p.slug1, { env });
    assert.equal(a.outcome, 'tool-missing'); assert.ok(a.fallback.reason);
    assert.equal(a.notice, 'full'); assert.equal(a.suggestion.install, 'npm i -D @stryker-mutator/core');
    const b = await runMutate(p.dir, p.slug1, { env });
    assert.equal(b.notice, 'reminder'); assert.equal(b.suggestion, undefined);
    assert.equal(b.fallback.reason, 'mutation tool not installed — AI mutants used');
    const chk = await checkMutate(p.dir, null, { env });
    assert.equal(chk.outcome, 'tool-missing'); assert.equal(chk.notice, 'full'); assert.equal(chk.suggestion.install, 'npm i -D @stryker-mutator/core');
    assert.equal(existsSync(join(p.dir, 'spy.log')), false, 'no package manager was invoked');
  } finally { done(p); }
});

test('required lists the [mutation] criterion ids', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    writeFileSync(join(p.dir, '.astrocode', 'phases', p.slug1, 'CRITERIA.md'), '### C1 — plain\n### C2 [mutation] — strong\n');
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(r.required, ['C2']);
  } finally { done(p); }
});

test('setupFor returns parseable content per tool and exists:true when a config is present', async () => {
  const { setupFor, dismissTool } = await import('../lib/mutate.mjs');
  const p = await makeProject('js');
  try {
    mkdirSync(join(p.dir, 'src'), { recursive: true });
    const s = setupFor(p.dir);
    assert.equal(s.file, 'stryker.config.json'); assert.equal(s.exists, false);
    const cfg = JSON.parse(s.content);
    assert.equal(cfg.testRunner, 'command'); assert.ok(cfg.mutate.some((g) => g.startsWith('src/')));
    writeFileSync(join(p.dir, 'stryker.config.json'), '{}');
    assert.equal(setupFor(p.dir).exists, true);
    const g = setupFor(p.dir, 'gremlins');
    assert.equal(g.file, '.gremlins.yaml');
    for (const l of g.content.split('\n').filter((x) => x && !x.startsWith('#'))) assert.match(l, /^\s*[\w-]+:( .+)?$/);
    const m = setupFor(p.dir, 'mutmut');
    assert.match(m.content, /^\[mutmut\]\npaths_to_mutate=.+\ntests_dir=.+\n$/);
    assert.match(setupFor(p.dir, 'nope').error, /unknown/);
    assert.deepEqual(await dismissTool(p.dir), { tool: 'stryker' });
  } finally { done(p); }
});

test('a stale report left by an earlier run is never this run\'s result', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js'); // the stub writes no report
  try {
    mkdirSync(join(p.dir, 'reports', 'mutation'), { recursive: true });
    const stale = join(p.dir, 'reports', 'mutation', 'mutation.json');
    writeFileSync(stale, readFileSync(fx('stryker-mutation.json')));
    const old = new Date(Date.now() - 3600_000);
    utimesSync(stale, old, old);
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'error'); assert.match(r.error, /no report/);
  } finally { done(p); }
});
