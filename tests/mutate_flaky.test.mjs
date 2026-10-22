// Phase 49 t8 — the flaky pre-check (D5, C7, C8): the phase's tests run twice on unchanged code,
// inside the ONE cap, before the tool. Stub tools and runners (tests/fixtures/mutate/stub.mjs);
// JS uses real `node --test` through a Stryker `command` runner. Modules by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeProject, installStub, installRunner, jsFlakyProject, restrictedEnv, commit, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });

test('classifyFlaky: one-run failures are flaky, two-run failures are baseline, unparseable failures name the command', async () => {
  const { classifyFlaky } = await import('../lib/mutate.mjs');
  const run = (names, failed = names.length > 0) => ({ names, failed, command: 'npm test' });
  assert.deepEqual(classifyFlaky(run(['A']), run([])), { tests: ['A'], baseline_failing: [] });
  assert.deepEqual(classifyFlaky(run([]), run(['A'])), { tests: ['A'], baseline_failing: [] });
  assert.deepEqual(classifyFlaky(run(['A']), run(['A'])), { tests: [], baseline_failing: ['A'] });
  assert.deepEqual(classifyFlaky(run(['A', 'B']), run(['A'])), { tests: ['B'], baseline_failing: ['A'] });
  assert.deepEqual(classifyFlaky(run([], true), run([])), { tests: [{ name: null, command: 'npm test' }], baseline_failing: [] });
  assert.deepEqual(classifyFlaky(run([], true), run([], true)), { tests: [], baseline_failing: [{ name: null, command: 'npm test' }] });
  assert.deepEqual(classifyFlaky(run([]), run([])), { tests: [], baseline_failing: [] });
});

// ---- JS: a real `node --test` through a Stryker command runner ----
async function jsRig({ flaky = true, mutate = (r) => r } = {}) {
  const p = await jsFlakyProject({ flaky });
  const bin = installStub(p.dir, 'stryker', 'node_modules/.bin');
  const rep = mutate(JSON.parse(readFileSync(join(FX, 'stryker-triage.json'), 'utf8')));
  const reportFile = join(p.dir, 'report.json');
  writeFileSync(reportFile, JSON.stringify(rep));
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: reportFile });
  return p;
}
const flakyKill = (rep) => {
  rep.testFiles['tests/a.test.mjs'].tests[0].name = 'flaky toggles'; // t1 killed mutant 2
  return rep;
};

test('JS: a flaky test is named, the kills it made are discounted by the report\'s attribution, and the counts reflect that', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await jsRig({ mutate: flakyKill });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.flaky.checked, true);
    assert.deepEqual(r.flaky.tests, ['flaky toggles']);
    assert.equal(r.flaky.kills, 'discounted');
    assert.equal(r.flaky.discounted, 1);
    assert.equal(r.flaky.runs, 2);
    assert.match(r.flaky.command, /node --test/);
    assert.equal(r.counts.killed, 1, 'one of the two kills was the flaky test\'s');
    assert.equal(r.counts.survived, 6);
    assert.equal(r.survivors.filter((m) => m.flaky_kill).length, 1);
    assert.equal(r.outcome, 'survivors');
  } finally { done(p); }
});

test('JS: kills with no attribution are unverified and the run is incomplete, never counted on trust', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await jsRig({ mutate: (rep) => { for (const m of rep.files['src/a.mjs'].mutants) { delete m.killedBy; } return rep; } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(r.flaky.tests, ['flaky toggles']);
    assert.equal(r.flaky.kills, 'unverified');
    assert.match(r.flaky.reason, /no per-test attribution/);
    assert.equal(r.outcome, 'incomplete');
    assert.equal(r.complete, false);
  } finally { done(p); }
});

test('JS: with the flaky test removed nothing is flaky and the counts are the stub report\'s', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await jsRig({ flaky: false, mutate: flakyKill });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.flaky.checked, true);
    assert.deepEqual(r.flaky.tests, []);
    assert.deepEqual(r.flaky.baseline_failing, []);
    assert.equal(r.flaky.kills, 'none');
    assert.equal(r.counts.killed, 2);
    assert.equal(r.counts.survived, 5);
    assert.equal(r.survivors.some((m) => m.flaky_kill), false);
  } finally { done(p); }
});

// ---- Go and Python: the runner stubs ----
async function runnerRig(kind, name, { report, version, extra = {} } = {}) {
  const p = await makeProject(kind);
  const tool = { go: 'gremlins', py: 'mutmut' }[kind];
  const bin = installStub(p.dir, tool, 'stubbin');
  installRunner(p.dir, name, 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv([bin], {
    MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: join(FX, report), ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra,
  });
  return p;
}

test('Go: go test -count=1 runs twice, the flaky test is skipped in the mutation run through GOFLAGS', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await runnerRig('go', 'go', { report: 'gremlins.json' });
  p.env.MUTATE_STUB_FLAKY = `${p.dir}/counter:TestFlaky`;
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(r.flaky.tests, ['TestFlaky']);
    assert.equal(r.flaky.kills, 'excluded');
    const log = logLines(p.log);
    const tests = log.filter((l) => l.tool === 'go');
    assert.equal(tests.length, 2);
    assert.ok(tests.every((l) => l.argv.includes('-count=1') && l.argv[0] === 'test'));
    const unleash = log.find((l) => l.argv[0] === 'unleash');
    assert.match(unleash.env.GOFLAGS, /-skip=\^\(TestFlaky\)\$/);
    assert.ok(unleash.at >= tests[1].at, 'the tool started after both test runs');
  } finally { done(p); }
});

test('Python: pytest runs twice, the flaky node id is deselected in the mutation run through PYTEST_ADDOPTS', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await runnerRig('py', 'pytest', { report: 'mutmut3-results.txt', version: 'mutmut, version 3.8.0' });
  p.env.MUTATE_STUB_FLAKY = `${p.dir}/counter:tests/test_a.py::test_flaky`;
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(r.flaky.tests, ['tests/test_a.py::test_flaky']);
    assert.equal(r.flaky.kills, 'excluded');
    const log = logLines(p.log);
    assert.equal(log.filter((l) => l.tool === 'pytest').length, 2);
    const run = log.find((l) => l.tool === 'mutmut' && l.argv[0] === 'run');
    assert.match(run.env.PYTEST_ADDOPTS, /--deselect tests\/test_a\.py::test_flaky/);
  } finally { done(p); }
});

test('a test failing in both runs is baseline_failing: the tool still runs', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await runnerRig('go', 'go', { report: 'gremlins.json', extra: { MUTATE_STUB_BROKEN: 'TestBroken' } });
  try {
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(r.flaky.tests, []);
    assert.deepEqual(r.flaky.baseline_failing, ['TestBroken']);
    assert.equal(r.flaky.kills, 'none');
    assert.ok(logLines(p.log).some((l) => l.argv[0] === 'unleash'));
  } finally { done(p); }
});

test('no runner reachable: checked is false with a reason, never silently skipped, and the tool runs', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  for (const [kind, tool, re] of [['go', 'gremlins', /go is not on PATH/], ['py', 'mutmut', /pytest was not found/]]) {
    const p = await makeProject(kind);
    try {
      const bin = installStub(p.dir, tool, 'stubbin');
      p.log = join(p.dir, 'stub.log');
      // restrictedEnv keeps node's and git's own directories on PATH, where a real go or pytest may sit:
      // a directory holding only symlinks to node and git makes "no runner" hold on any machine.
      const only = join(p.dir, 'onlybin');
      mkdirSync(only);
      symlinkSync(process.execPath, join(only, 'node'));
      symlinkSync(spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim(), join(only, 'git'));
      const env = { ...restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: join(FX, kind === 'go' ? 'gremlins.json' : 'mutmut2-junit.xml') }), PATH: `${bin}:${only}` };
      const r = await runMutate(p.dir, p.slug1, { env });
      assert.equal(r.flaky.checked, false, kind);
      assert.match(r.flaky.reason, re, kind);
      assert.ok(logLines(p.log).some((l) => l.argv[0] === 'run' || l.argv[0] === 'unleash'), kind);
    } finally { done(p); }
  }
});

// ---- C8: one cap ----
const withCap = async (p, seconds) => {
  const f = join(p.dir, '.astrocode', 'config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  cfg.mutation = { ...(cfg.mutation ?? {}), cap_seconds: seconds };
  writeFileSync(f, JSON.stringify(cfg, null, 2));
  commit(p.dir, 'chore: cap (no phase)');
};

test('C8: two 2s test runs against a 3s cap: capped inside the flaky check, in time, and the tool never starts', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await runnerRig('go', 'go', { report: 'gremlins.json', extra: { MUTATE_STUB_TEST_SLEEP: '2' } });
  try {
    await withCap(p, 3);
    const t0 = Date.now();
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    const wall = Date.now() - t0;
    assert.ok(wall <= 3000 + 1500 + 1500, `wall ${wall}ms`);
    assert.equal(r.capped, true);
    assert.equal(r.outcome, 'incomplete');
    assert.equal(r.cap.step, 'flaky check (tests run twice)');
    assert.equal(logLines(p.log).filter((l) => l.argv[0] === 'unleash').length, 0);
    assert.equal(r.flaky.checked, false);
    // and the human line names it
    const cli = spawnSync(process.execPath, [AC, 'mutate', '1'], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 60000 });
    assert.match(cli.stdout, /cap reached after 3s during flaky check \(tests run twice\)/);
  } finally { done(p); }
});

test('C8: with a generous cap the check completes and the tool starts after both runs, on the same deadline', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await runnerRig('go', 'go', { report: 'gremlins.json', extra: { MUTATE_STUB_TEST_SLEEP: '0.5' } });
  try {
    await withCap(p, 60);
    const r = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(r.capped, false);
    assert.equal(r.flaky.checked, true);
    assert.ok(r.flaky.duration_ms >= 1000);
    const log = logLines(p.log);
    const tests = log.filter((l) => l.tool === 'go');
    const unleash = log.find((l) => l.argv[0] === 'unleash');
    assert.ok(unleash.at - tests[0].at >= 900, 'the tool started after the check\'s two runs');
  } finally { done(p); }
});
