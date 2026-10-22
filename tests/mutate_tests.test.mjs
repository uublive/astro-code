// Phase 48 t13 — a run uses the phase's OWN tests by default (D2, C5), with a project/phase override,
// handed to each tool its own native way; a tool that cannot narrow is reported as not narrowed.
// The stub logs argv, env (GOFLAGS, PYTEST_ADDOPTS) and the generated config's text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, writeLines, FX } from './fixtures/mutate/project.mjs';

const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const cfgSet = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => { c.mutation = { ...(c.mutation ?? {}), ...patch }; return c; });
};
const put = (dir, f, body) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); };
const runCall = (p, first) => logLines(p.log).find((l) => l.argv[0] === first);

function rigWith(p, name, { version, nodeModules = false, extra = {} } = {}) {
  const bin = installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv(nodeModules ? [] : [bin], { MUTATE_STUB_LOG: p.log, ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra });
  return p;
}

// A phase 5 that wrote src + one test file, while an untouched test file also exists.
async function history(kind, { withTest = true } = {}) {
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject(kind);
  await addPhase(p.dir, { number: 5, name: 'Tests' });
  const T = { js: ['tests/b.test.mjs', 'tests/other.test.mjs', 'src/s.mjs'], py: ['tests/test_b.py', 'tests/test_other.py', 'pkg/s.py'], go: ['b_test.go', 'other_test.go', 's.go'] }[kind];
  const goTest = (n) => `package p\n\nimport "testing"\n\nfunc Test${n}(t *testing.T) {}\n`;
  put(p.dir, T[1], kind === 'go' ? goTest('Other') : '// untouched test\n');
  commit(p.dir, 'untouched tests');
  put(p.dir, T[2], kind === 'py' ? 'def f(x):\n    return x + 1\n' : kind === 'go' ? 'package p\n\nfunc F() int { return 1 }\n' : 'export const f = 1;\n');
  if (withTest) put(p.dir, T[0], kind === 'go' ? goTest('B') : '// phase test\n');
  commit(p.dir, 'work (phase 5 t1)');
  p.slug5 = findPhase(p.dir, '5').slug;
  p.T = T;
  return p;
}

test('C5 (Stryker command runner): the phase\'s test file reaches the generated config, and the result names it', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await history('js'), 'stryker', { nodeModules: true });
  try {
    writeFileSync(join(p.dir, 'stryker.config.json'), JSON.stringify({ testRunner: 'command', commandRunner: { command: 'npm test' }, mutate: ['src/**/*.mjs'] }));
    commit(p.dir, 'config');
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    const call = runCall(p, 'run');
    assert.equal(call.argv[1], `.astrocode/.local/mutate-runs/${p.slug5}.stryker.config.mjs`);
    assert.match(call.configText, /command: "npm test -- tests\/b\.test\.mjs"/);
    assert.match(call.configText, /import base from "file:\/\/.*stryker\.config\.json" with \{ type: 'json' \}/);
    assert.doesNotMatch(call.configText, /other\.test/);
    assert.deepEqual(r.tests, { source: 'phase-commits', files: ['tests/b.test.mjs'], mechanism: 'generated Stryker config: commandRunner.command' });
  } finally { done(p); }
});

test('C5 (Stryker mocha / jest / vitest): the matching option is set; vitest is reported as not narrowed, never claimed', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  for (const [runner, re, mech] of [['mocha', /mochaOptions: \{ \.\.\.base\.mochaOptions, spec: \["tests\/b\.test\.mjs"\] \}/, /mochaOptions\.spec/],
    ['jest', /testMatch: \[".*tests\/b\.test\.mjs"\]/, /jest\.config\.testMatch/], ['vitest', null, /^none$/]]) {
    const p = rigWith(await history('js'), 'stryker', { nodeModules: true });
    try {
      writeFileSync(join(p.dir, 'stryker.config.json'), JSON.stringify({ testRunner: runner }));
      commit(p.dir, 'config');
      const r = await runMutate(p.dir, p.slug5, { env: p.env });
      const call = runCall(p, 'run');
      assert.match(r.tests.mechanism, mech, runner);
      if (re) assert.match(call.configText, re, runner);
      else {
        assert.equal(call.argv[1], 'stryker.config.json', 'the project\'s own config, no generated one, for an unnarrowable runner');
        assert.match(r.tests.note, /vitest.*not narrowed/);
      }
    } finally { done(p); }
  }
});

test('C5 (Gremlins): GOFLAGS -run holds the phase\'s Test functions; an existing GOFLAGS is preserved', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await history('go'), 'gremlins', { extra: { GOFLAGS: '-mod=mod' } });
  try {
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(runCall(p, 'unleash').env.GOFLAGS, '-mod=mod -run=^(TestB)$');
    assert.deepEqual(r.tests, { source: 'phase-commits', files: ['b_test.go'], mechanism: 'GOFLAGS -run=^(TestB)$' });
  } finally { done(p); }
});

test('C5 (mutmut 3): PYTEST_ADDOPTS holds the phase\'s test only; with a project test selection the others are --ignored; an existing value is preserved', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  let p = rigWith(await history('py'), 'mutmut', { version: 'mutmut, version 3.8.0', extra: { PYTEST_ADDOPTS: '-q' } });
  try {
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(runCall(p, 'run').env.PYTEST_ADDOPTS, 'tests/test_b.py -q');
    assert.deepEqual(r.tests, { source: 'phase-commits', files: ['tests/test_b.py'], mechanism: 'PYTEST_ADDOPTS test files' });
  } finally { done(p); }
  p = rigWith(await history('py'), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    writeFileSync(join(p.dir, 'setup.cfg'), '[mutmut]\nsource_paths=pkg/\npytest_add_cli_args_test_selection=tests/\n');
    commit(p.dir, 'cfg');
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    const add = runCall(p, 'run').env.PYTEST_ADDOPTS;
    assert.match(add, /--ignore=tests\/test_other\.py/);
    assert.match(add, /--ignore=tests\/test_a\.py/);
    assert.doesNotMatch(add, /--ignore=tests\/test_b\.py/);
    assert.match(r.tests.mechanism, /--ignore/);
  } finally { done(p); }
});

test('C5 override: mutation.tests then the phase key name the files the tool is given; phase beats project', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await history('py'), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    await cfgSet(p.dir, { tests: ['tests/test_other.py'] });
    let r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(r.tests.source, 'mutation.tests');
    assert.deepEqual(r.tests.files, ['tests/test_other.py']);
    assert.equal(logLines(p.log).filter((l) => l.argv[0] === 'run').pop().env.PYTEST_ADDOPTS, 'tests/test_other.py');
    await cfgSet(p.dir, { phases: { 5: { tests: ['tests/test_a.py'] } } });
    r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(r.tests.source, 'mutation.phases.5.tests');
    assert.deepEqual(r.tests.files, ['tests/test_a.py']);
    await cfgSet(p.dir, { tests: ['tests/missing.py'], phases: {} });
    r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(r.tests.source, 'phase-commits', 'a missing override file is ignored with a warning');
    assert.ok(r.warnings.some((w) => /missing\.py/.test(w)));
  } finally { done(p); }
});

test('C5 fallback: a phase that changed no test file says so, uses the full suite and restricts nothing', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  for (const [kind, name, nm] of [['js', 'stryker', true], ['go', 'gremlins', false], ['py', 'mutmut', false]]) {
    const p = rigWith(await history(kind, { withTest: false }), name, { nodeModules: nm, version: kind === 'py' ? 'mutmut, version 3.8.0' : undefined });
    try {
      const r = await runMutate(p.dir, p.slug5, { env: p.env });
      assert.equal(r.tests.source, 'full-suite', kind);
      assert.match(r.tests.note, /changed no test files — full suite/);
      assert.deepEqual(r.tests.files, []);
      const call = logLines(p.log).find((l) => l.argv[0] === (kind === 'go' ? 'unleash' : 'run'));
      assert.equal(call.configText, undefined);
      assert.equal(call.env.GOFLAGS, null); assert.equal(call.env.PYTEST_ADDOPTS, null);
      assert.ok(!call.argv.some((a) => /stryker\.config\.mjs/.test(a)));
    } finally { done(p); }
  }
});
