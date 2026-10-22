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
  const { MUTATION_TOOLS, DEFAULT_CAP_SECONDS, DEFAULT_ENV } = await import('../lib/mutate.mjs');
  assert.equal(DEFAULT_CAP_SECONDS, 600);
  assert.deepEqual(Object.fromEntries(MUTATION_TOOLS.map((r) => [r.id, r.install(DEFAULT_ENV)])), {
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

test('mutmut 3 runs exactly the globs it is given (naming lives in lib/pyscan.mjs; tests/mutate_scope.test.mjs covers a package __init__.py)', async () => {
  const { MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const row = MUTATION_TOOLS.find((r) => r.id === 'mutmut');
  const { argv } = row.build({ major: 3, bin: 'mutmut', scope: ['src/pkg/a.py'], mutantGlobs: ['pkg.a.x_f__mutmut_*'] });
  assert.deepEqual(argv, ['mutmut', 'run', 'pkg.a.x_f__mutmut_*']);
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
    assert.equal(call.argv[call.argv.indexOf('--mutate') + 1], 'src/a.mjs:1-30');
    // phase 1 wrote tests/a.test.mjs, so the run goes through the generated config (D2)
    assert.equal(r.command, `stryker run .astrocode/.local/mutate-runs/${p.slug1}.stryker.config.mjs --mutate src/a.mjs:1-30 --reporters json`);
    const again = await runMutate(p.dir, p.slug1, { env: p.env });
    const strip = ({ started_at, duration_ms, log, ...rest }) => rest;
    assert.deepEqual(strip(again), strip(r));
  } finally { done(p); }
});

test('C2 gremlins gets --diff against the phase base; mutmut 2.x gets --paths-to-mutate; mutmut 3.x gets function globs', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = await rig('go', { report: 'gremlins.json' });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.tool.id, 'gremlins'); assert.deepEqual(r.scope, ['a.go']);
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 1, 'no-coverage': 1, error: 1 });
    const argv = logLines(p.log).find((l) => l.argv[0] === 'unleash').argv;
    assert.equal(argv[argv.indexOf('--diff') + 1], sh(p.dir, 'rev-parse', `${sh(p.dir, 'log', '--format=%H', '--grep', '(phase 1 t1)', '--fixed-strings').stdout.trim()}^`).stdout.trim());
    assert.equal(argv.includes('--exclude-files'), false, 'no blanket exclusion list');
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
    assert.deepEqual(logLines(p.log).find((l) => l.argv[0] === 'run').argv, ['run', 'a.x_add__mutmut_*', 'a.x_mul__mutmut_*', 'a.x_sub__mutmut_*']);
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
    const env = restrictedEnv([]); // no mutmut on the PATH: the major is assumed
    const s = await setupFor(p.dir, null, { env });
    assert.equal(s.file, 'stryker.config.json'); assert.equal(s.exists, false);
    const cfg = JSON.parse(s.content);
    assert.equal(cfg.testRunner, 'command'); assert.ok(cfg.mutate.some((g) => g.startsWith('src/')));
    writeFileSync(join(p.dir, 'stryker.config.json'), '{}');
    assert.equal((await setupFor(p.dir, null, { env })).exists, true);
    const g = await setupFor(p.dir, 'gremlins', { env });
    assert.equal(g.file, '.gremlins.yaml');
    for (const l of g.content.split('\n').filter((x) => x && !x.startsWith('#'))) assert.match(l, /^\s*[\w-]+:( .+)?$/);
    const m = await setupFor(p.dir, 'mutmut', { env });
    assert.match(m.content, /^\[mutmut\]\nsource_paths=.+\npytest_add_cli_args_test_selection=.+\n$/);
    assert.match(m.assumed, /not installed/);
    assert.match((await setupFor(p.dir, 'nope', { env })).error, /unknown/);
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

// ---- Phase 48 t10 — install hints match the project (C10), not-configured (C11), setup (C12) ----
import { mkdtempSync as mk10, mkdirSync as md10, writeFileSync as wf10 } from 'node:fs';
import { tmpdir as td10 } from 'node:os';

const tmp10 = (files = {}) => {
  const d = mk10(join(td10(), 'ac-hint-'));
  for (const [f, body] of Object.entries(files)) { md10(join(d, f, '..'), { recursive: true }); wf10(join(d, f), body); }
  return d;
};

test('C10: installHint follows the lockfile and the venv layout; the default variants are the phase-47 strings', async () => {
  const { installHint, MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const row = (id) => MUTATION_TOOLS.find((r) => r.id === id);
  assert.equal(installHint(tmp10({ '.venv/bin/python': '' }), row('mutmut')).install, 'uv pip install --python .venv/bin/python mutmut');
  assert.equal(installHint(tmp10({ '.venv/bin/python': '', '.venv/bin/pip': '' }), row('mutmut')).install, 'pip install mutmut');
  assert.equal(installHint(tmp10({ 'pnpm-lock.yaml': '' }), row('stryker')).install, 'pnpm add -D @stryker-mutator/core');
  assert.equal(installHint(tmp10({ 'yarn.lock': '' }), row('stryker')).install, 'yarn add -D @stryker-mutator/core');
  assert.equal(installHint(tmp10({ 'package-lock.json': '{}' }), row('stryker')).install, 'npm i -D @stryker-mutator/core');
  assert.equal(installHint(tmp10(), row('stryker')).install, 'npm i -D @stryker-mutator/core');
  assert.equal(installHint(tmp10({ 'go.mod': 'module x\n' }), row('gremlins')).install, 'go install github.com/go-gremlins/gremlins/cmd/gremlins@latest');
  assert.equal(installHint(tmp10(), row('stryker')).warning, undefined, 'a plain project warns about nothing');
  assert.match(installHint(tmp10({ 'pnpm-lock.yaml': '' }), row('stryker')).why, /pnpm-lock\.yaml/);
});

test('C10: a pinned package or a lock-managed Python environment adds a warning naming the file', async () => {
  const { installHint, MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const mutmut = MUTATION_TOOLS.find((r) => r.id === 'mutmut');
  assert.match(installHint(tmp10({ 'requirements.txt': 'mutmut==2.4.4\n' }), mutmut).warning, /requirements\.txt/);
  assert.match(installHint(tmp10({ 'uv.lock': '[[package]]\nname = "mutmut"\n' }), mutmut).warning, /uv\.lock/);
  assert.match(installHint(tmp10({ 'uv.lock': '# no mutmut\n' }), mutmut).warning, /uv\.lock/, 'a lock-managed environment warns even when the tool is not in it');
});

test('C11: an installed mutmut 3 that crashes on --version for lack of config is not-configured, never missing', async () => {
  const { runMutate, checkMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { extra: { MUTATE_STUB_VERSION_CRASH: '1' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'not-configured');
    assert.equal(r.hint, 'ac mutate setup');
    assert.equal(r.fallback, null);
    assert.equal(r.suggestion, undefined);
    assert.equal(existsSync(join(p.dir, '.astrocode', '.local', 'mutate-notices.json')), false, 'no notice memory');
    const c = await checkMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(c.outcome, 'not-configured');
    assert.equal(c.suggestion, undefined);
  } finally { done(p); }
});

test('C11: a mutmut whose version command fails without the signature is still tool-missing, with the failure in warnings', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('py', { extra: { MUTATE_STUB_V2_REAL: '1', MUTATE_STUB_VERSION: 'x' } });
  try {
    // 2.x answers `version`, so make both fail: a stub copy that always exits 1
    wf10(join(p.dir, 'stubbin', 'mutmut'), '#!/bin/sh\necho boom >&2\nexit 1\n');
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.outcome, 'tool-missing');
    assert.ok(r.warnings.some((w) => /failed/.test(w)));
  } finally { done(p); }
});

test('C12: setupFor writes the keys the installed mutmut major accepts, names deprecated ones, and respects [tool.mutmut]', async () => {
  const { setupFor } = await import('../lib/mutate.mjs');
  for (const [version, wantNew] of [['3.8.0', true], ['2.4.4', false]]) {
    const p = await rig('py', { version, extra: { MUTATE_STUB_V2_REAL: version.startsWith('2') ? '1' : '0' } });
    try {
      md10(join(p.dir, 'src'), { recursive: true });
      const s = await setupFor(p.dir, 'mutmut', { env: p.env });
      assert.equal(s.file, 'setup.cfg');
      if (wantNew) {
        assert.match(s.content, /^\[mutmut\]\nsource_paths=src\/\npytest_add_cli_args_test_selection=tests\/\n$/);
        assert.doesNotMatch(s.content, /paths_to_mutate|tests_dir/);
      } else {
        assert.match(s.content, /paths_to_mutate=src\/\ntests_dir=tests\/\n$/);
        assert.doesNotMatch(s.content, /source_paths/);
      }
      if (wantNew) {
        wf10(join(p.dir, 'setup.cfg'), '[mutmut]\npaths_to_mutate=src/\ntests_dir=tests/\n');
        const old = await setupFor(p.dir, 'mutmut', { env: p.env });
        assert.equal(old.exists, true);
        assert.deepEqual(old.deprecated.map((d) => d.key), ['paths_to_mutate', 'tests_dir']);
        wf10(join(p.dir, 'pyproject.toml'), '[tool.mutmut]\nsource_paths = ["x"]\n');
        const py = await setupFor(p.dir, 'mutmut', { env: p.env });
        assert.equal(py.file, 'pyproject.toml');
        assert.equal(py.exists, true);
        assert.match(py.content, /\[tool\.mutmut\]/);
      }
    } finally { done(p); }
  }
});

// ---- Phase 48 t11 — the log beside the run (C7), the per-phase cap and the step a cap hit (C6) ----
import { readdirSync as rd11, mkdtempSync as mk11 } from 'node:fs';
import { tmpdir as td11 } from 'node:os';

const cfgSet = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => { c.mutation = { ...(c.mutation ?? {}), ...patch }; return c; });
};
const runDirOf = (p) => join(p.dir, '.astrocode', '.local', 'mutate-runs');

test('C7: the log sits beside the run, holds both streams, is never committed and is replaced by a rerun', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const before = new Set(rd11(td11()).filter((n) => n.startsWith('ac-mutate-')));
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true, extra: { MUTATE_STUB_OUT: 'MARK-1\n', MUTATE_STUB_ERR: 'MARK-E\n' } });
  try {
    const res = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(res.log, `.astrocode/.local/mutate-runs/${p.slug1}.log`);
    const text = readFileSync(join(p.dir, res.log), 'utf8');
    assert.match(text, /MARK-1/); assert.match(text, /MARK-E/);
    assert.equal(sh(p.dir, 'status', '--porcelain', '--untracked-files=all').stdout.includes('mutate-runs'), false);
    assert.equal(sh(p.dir, 'check-ignore', '-q', res.log).status, 0);
    // a rerun with another marker replaces, never accumulates
    const env2 = { ...p.env, MUTATE_STUB_OUT: 'MARK-2\n', MUTATE_STUB_ERR: '' };
    await runMutate(p.dir, p.slug1, { env: env2 });
    const again = readFileSync(join(p.dir, res.log), 'utf8');
    assert.match(again, /MARK-2/); assert.doesNotMatch(again, /MARK-1/);
    assert.equal(rd11(runDirOf(p)).filter((n) => n.endsWith('.log')).length, 1);
    // another phase leaves this log alone
    await runMutate(p.dir, p.slug2, { env: p.env });
    assert.match(readFileSync(join(p.dir, res.log), 'utf8'), /MARK-2/);
    assert.equal(rd11(runDirOf(p)).filter((n) => n.endsWith('.log')).length, 2);
    const after = rd11(td11()).filter((n) => n.startsWith('ac-mutate-') && !before.has(n) && !n.startsWith('ac-mutate-proj-') && !n.startsWith('ac-mutate-home-'));
    assert.deepEqual(after, [], 'nothing lands only in the system temp dir');
  } finally { done(p); }
});

// Per tool: a marker the real tool prints (tests/fixtures/mutate/real), then a long sleep.
const CAP_RIGS = [
  ['js', 'stryker', 'Starting initial test run (command test runner with "off" coverage analysis).\n', /initial test run/, 'Mutation testing  30% (elapsed: <1m, remaining: ~1m) 120/400 Mutants tested (3 survived, 0 timed out)\n', 'mutation testing'],
  ['go', 'gremlins', 'Gathering files diff...\nGathering coverage... ', /gathering coverage/, null, null],
  ['py', 'mutmut', '⠋ Running stats\n    done\n', /stats run/, '⠙ 120/400  \u{1F389} 100 \u{1FAE5} 0 ⏰ 0 \u{1F914} 0 \u{1F641} 20 \u{1F507} 0 \u{1F9D9} 0\n', 'mutation testing'],
];

for (const [kind, tool, marker, stepRe, progress, progressStep] of CAP_RIGS) {
  test(`C6 (${tool}): a capped run returns promptly, kills the tool, and names the step, the counts and the keys to raise`, async () => {
    const { runMutate } = await import('../lib/mutate.mjs');
    const p = await rig(kind, { nodeModules: kind === 'js', version: kind === 'py' ? '3.8.0' : undefined,
      extra: { MUTATE_STUB_SLEEP: '30', MUTATE_STUB_CHILD: '1', MUTATE_STUB_OUT: marker } });
    try {
      await cfgSet(p.dir, { cap_seconds: 2 });
      const t0 = Date.now();
      const res = await runMutate(p.dir, p.slug1, { env: p.env });
      assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0}ms`);
      assert.equal(res.capped, true); assert.equal(res.outcome, 'incomplete');
      assert.match(res.cap.step, stepRe);
      assert.equal(res.cap.tested, 0);
      assert.deepEqual(res.cap.keys, [`mutation.phases.1.cap_seconds`, 'mutation.cap_seconds']);
      assert.equal(res.cap.source, 'project');
      await new Promise((x) => setTimeout(x, 300));
      for (const pid of readFileSync(p.pids, 'utf8').split(' ').map(Number)) assert.equal(alive(pid), false);
      if (progress) {
        const p2 = await rig(kind, { nodeModules: kind === 'js', version: kind === 'py' ? '3.8.0' : undefined,
          extra: { MUTATE_STUB_SLEEP: '30', MUTATE_STUB_OUT: marker + progress } });
        try {
          await cfgSet(p2.dir, { cap_seconds: 2 });
          const r2 = await runMutate(p2.dir, p2.slug1, { env: p2.env });
          assert.equal(r2.cap.step, progressStep);
          assert.equal(r2.cap.tested, 120); assert.equal(r2.cap.total, 400);
        } finally { done(p2); }
      }
    } finally { done(p); }
  });
}

test('C6: a run that prints nothing reports step null', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await rig('js', { nodeModules: true, extra: { MUTATE_STUB_SLEEP: '30' } });
  try {
    await cfgSet(p.dir, { cap_seconds: 1 });
    const res = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(res.cap.step, null);
  } finally { done(p); }
});

test('C6: the phase cap beats the project cap for that phase only; with no setting the cap is 600 s from the default', async () => {
  const { runMutate, mutationSettings } = await import('../lib/mutate.mjs');
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    assert.deepEqual(mutationSettings(p.dir, 1).cap, { seconds: 600, source: 'default', keys: ['mutation.phases.1.cap_seconds', 'mutation.cap_seconds'] });
    await cfgSet(p.dir, { cap_seconds: 100, phases: { 1: { cap_seconds: 60 } } });
    const one = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(one.cap.source, 'phase'); assert.equal(one.cap_seconds, 60);
    assert.equal(one.capped, false); assert.equal(one.outcome, 'survivors');
    const two = await runMutate(p.dir, p.slug2, { env: p.env });
    assert.equal(two.cap.source, 'project'); assert.equal(two.cap_seconds, 100);
    const w = [];
    await cfgSet(p.dir, { cap_seconds: 'soon', phases: { 1: { cap_seconds: -1 } } });
    assert.equal(mutationSettings(p.dir, '01', w).cap.source, 'default');
    assert.equal(w.length, 2);
  } finally { done(p); }
});
