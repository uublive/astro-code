// Phase 48 t15 (test-after, by choice: it exercises t10-t14's finished invocations) — every flag,
// subcommand and config key `ac mutate` builds must exist in the tool's real CLI as captured or
// transcribed in tests/fixtures/mutate/real/ (C14). A tool that is not installed here (Stryker,
// mutmut 2) is compared against its transcription and recorded as "not run" in VERSIONS.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, writeLines, FX } from './fixtures/mutate/project.mjs';

const REAL = join(FX, 'real');
const cap = (n) => readFileSync(join(REAL, n), 'utf8');
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const put = (dir, f, body) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); };
const cfgSet = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => { c.mutation = { ...(c.mutation ?? {}), ...patch }; return c; });
};

// Every `--flag` and every non-flag word that is a subcommand (the first word, or `results`' value
// flag operand's owner). Positionals (files, globs, ranges, values) are not CLI vocabulary.
// The version probe is not a run invocation.
const runCalls = (p, tool) => logLines(p.log).filter((l) => l.tool === tool && l.argv[0] !== '--version' && l.argv[0] !== 'version');
const flagsOf = (argv) => argv.filter((a) => /^--[a-z][\w-]*$/.test(a));

async function run(kind, name, { version, nodeModules = false, extra = {}, setup } = {}) {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject(kind);
  await addPhase(p.dir, { number: 5, name: 'Flags' });
  setup?.(p);
  const bin = installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  void bin;
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv(nodeModules ? [] : [join(p.dir, 'stubbin')], { MUTATE_STUB_LOG: p.log, ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra });
  const slug = findPhase(p.dir, '5').slug;
  return { p, slug, runMutate };
}

test('Stryker: every flag, subcommand and generated-config key is in the transcribed Stryker CLI', async () => {
  const doc = cap('stryker-cli-documented.txt');
  const { p, slug, runMutate } = await run('js', 'stryker', { nodeModules: true, setup: (q) => {
    writeLines(q.dir, 'src/s.mjs', 30); put(q.dir, 'tests/s.test.mjs', '// t\n'); commit(q.dir, 'work (phase 5 t1)');
  } });
  try {
    for (const runner of ['command', 'mocha', 'jest', 'tap']) {
      put(p.dir, 'stryker.config.json', JSON.stringify({ testRunner: runner })); commit(p.dir, `cfg ${runner}`);
      await runMutate(p.dir, slug, { env: p.env });
    }
    await cfgSet(p.dir, { files: ['src/s.mjs'] });
    await runMutate(p.dir, slug, { env: p.env });
    const calls = runCalls(p, 'stryker');
    assert.ok(calls.length >= 4);
    for (const c of calls) {
      assert.ok(doc.includes(`stryker ${c.argv[0]}`), `subcommand ${c.argv[0]}`);
      for (const f of flagsOf(c.argv)) assert.ok(doc.includes(f), `flag ${f}`);
      if (c.configText) for (const k of ['commandRunner', 'command', 'mochaOptions', 'spec', 'jest', 'testMatch', 'tap', 'testFiles']) {
        if (c.configText.includes(k)) assert.ok(doc.includes(k), `config key ${k}`);
      }
    }
    assert.ok(calls.some((c) => c.configText?.includes('mochaOptions')) && calls.some((c) => c.configText?.includes('testFiles')));
  } finally { done(p); }
});

test('Gremlins: every flag and subcommand of the diff and fallback runs is in `unleash --help`', async () => {
  const help = cap('gremlins-unleash-help.txt');
  const { p, slug, runMutate } = await run('go', 'gremlins', { setup: (q) => {
    writeLines(q.dir, 'p1/p1.go', 20); writeLines(q.dir, 'p2/p2.go', 20); commit(q.dir, 'base');
    writeLines(q.dir, 'p2/p2.go', 20, [[2, 3, 'x']]); put(q.dir, 'p2/p2_test.go', 'package p2\n\nfunc TestX(t *testing.T) {}\n'); commit(q.dir, 'work (phase 5 t1)');
  } });
  try {
    await cfgSet(p.dir, { exclude: ['p1/p1.go'] });
    await runMutate(p.dir, slug, { env: p.env });
    await cfgSet(p.dir, { exclude: [], files: ['p1/p1.go'] }); // the fallback mode
    await runMutate(p.dir, slug, { env: p.env });
    const calls = runCalls(p, 'gremlins');
    assert.equal(calls.length, 2);
    const seen = new Set();
    for (const c of calls) {
      assert.equal(c.argv[0], 'unleash'); assert.match(help, /gremlins unleash/);
      for (const f of flagsOf(c.argv)) { assert.ok(help.includes(f), `flag ${f}`); seen.add(f); }
    }
    for (const f of ['--output', '--diff', '--exclude-files']) assert.ok(seen.has(f), `${f} was exercised`);
    // GOFLAGS is a Go toolchain variable, not a gremlins flag
    assert.ok(calls.some((c) => /-run=/.test(c.env.GOFLAGS ?? '')));
  } finally { done(p); }
});

test('mutmut 3: every subcommand and flag is in the captured help; setup writes only keys 3.8 reads', async () => {
  const help = cap('mutmut3-help.txt');
  const versions = JSON.parse(cap('VERSIONS.json'));
  const { p, slug, runMutate } = await run('py', 'mutmut', { version: 'mutmut, version 3.8.0', setup: (q) => {
    put(q.dir, 'pkg/mod.py', 'def f(x):\n    return x + 1\n'); put(q.dir, 'tests/test_m.py', '# t\n'); commit(q.dir, 'work (phase 5 t1)');
  } });
  try {
    await runMutate(p.dir, slug, { env: p.env });
    const calls = runCalls(p, 'mutmut');
    const subs = new Set(calls.map((c) => c.argv[0]));
    assert.ok(subs.has('run') && subs.has('results'));
    for (const c of calls) {
      assert.match(help, new RegExp(`^  ${c.argv[0]}$`, 'm'), `subcommand ${c.argv[0]}`);
      for (const f of flagsOf(c.argv)) assert.ok(help.includes(f), `flag ${f}`);
    }
    const setup = (await import('../lib/mutate.mjs')).MUTATION_TOOLS.find((r) => r.id === 'mutmut').setup(p.dir, { major: 3 });
    const keys = [...setup.content.matchAll(/^([a-z_]+)\s*=/gm)].map((m) => m[1]);
    assert.ok(keys.length >= 2);
    for (const k of keys) assert.ok(versions.mutmut3_config_keys.includes(k), `setup key ${k}`);
    for (const dep of ['paths_to_mutate', 'tests_dir']) assert.ok(!keys.includes(dep), `${dep} is deprecated in 3.x`);
  } finally { done(p); }
});

test('mutmut 2: every flag and subcommand is in the transcribed 2.x CLI', async () => {
  const doc = cap('mutmut2-cli-documented.txt');
  const { p, slug, runMutate } = await run('py', 'mutmut', { version: '2.4.4', extra: { MUTATE_STUB_V2_REAL: '1', MUTATE_STUB_REPORT: join(FX, 'mutmut2-junit.xml') }, setup: (q) => {
    put(q.dir, 'pkg/mod.py', 'def f(x):\n    return x + 1\n'); commit(q.dir, 'work (phase 5 t1)');
  } });
  try {
    await runMutate(p.dir, slug, { env: p.env });
    const calls = runCalls(p, 'mutmut');
    assert.ok(calls.length >= 3);
    for (const c of calls) {
      assert.match(doc, new RegExp(`mutmut ${c.argv[0]}\\b`), `subcommand ${c.argv[0]}`);
      for (const f of flagsOf(c.argv)) assert.ok(doc.includes(f), `flag ${f}`);
    }
  } finally { done(p); }
});
