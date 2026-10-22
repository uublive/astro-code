// Phase 48 t12 — the scope of a run is the LINES the phase changed (D1, C1-C4): Stryker line
// ranges, Gremlins --diff against the phase base, mutmut 3 functions, mutmut 2 files, and the
// mutation.files / mutation.exclude settings. Real tmp git repos with stamped history; the tools
// are the stub, whose argv is read back from MUTATE_STUB_LOG.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, sh, writeLines, FX } from './fixtures/mutate/project.mjs';

const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const cfgSet = async (dir, patch) => {
  const { updateConfig } = await import('../lib/config.mjs');
  await updateConfig(dir, (c) => { c.mutation = { ...(c.mutation ?? {}), ...patch }; return c; });
};
const argvOf = (p, first) => logLines(p.log).find((l) => l.argv[0] === first).argv;

function rigWith(p, name, { report, version, nodeModules = false, extra = {} } = {}) {
  const bin = installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv(nodeModules ? [] : [bin], {
    MUTATE_STUB_LOG: p.log, ...(report ? { MUTATE_STUB_REPORT: join(FX, report) } : {}), ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra,
  });
  return p;
}

// C1's history: an unstamped edit of 200-210, the phase's 40-45, its remediate's 90-91, then a later
// unstamped edit of another file. Phase 5 is added to the roadmap by the caller.
async function jsHistory() {
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject('js');
  await addPhase(p.dir, { number: 5, name: 'Big' });
  writeLines(p.dir, 'src/big.js', 300);
  writeLines(p.dir, 'src/other.js', 20);
  writeLines(p.dir, 'src/extra.js', 12);
  commit(p.dir, 'baseline');
  writeLines(p.dir, 'src/big.js', 300, [[200, 210, 'unstamped']]);
  commit(p.dir, 'unstamped edit');
  writeLines(p.dir, 'src/big.js', 300, [[40, 45, 'p5']]);
  commit(p.dir, 'task (phase 5 t1)');
  writeLines(p.dir, 'src/big.js', 300, [[90, 91, 'rem']]);
  commit(p.dir, 'fix (phase 5 remediate-c2)');
  writeLines(p.dir, 'src/other.js', 20, [[3, 4, 'later']]);
  commit(p.dir, 'later unstamped');
  p.slug5 = findPhase(p.dir, '5').slug;
  return p;
}

test('C1 (Stryker): only the line ranges the stamped commits wrote reach --mutate, and the result says so', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await jsHistory(), 'stryker', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    const a = argvOf(p, 'run');
    assert.equal(a[a.indexOf('--mutate') + 1], 'src/big.js:40-45,src/big.js:90-91');
    assert.deepEqual(r.scope, ['src/big.js']);
    assert.equal(r.scope_detail.source, 'changed-lines');
    assert.equal(r.scope_detail.narrowed, 'lines');
    assert.deepEqual(r.scope_detail.ranges, { 'src/big.js': [[40, 45], [90, 91]] });
    assert.match(r.scope_detail.why, /line ranges/);
  } finally { done(p); }
});

test('C2 (Gremlins): --diff names the commit before the phase; no blanket exclusion; survivors outside the phase\'s lines are not reported', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject('go');
  try {
    await addPhase(p.dir, { number: 5, name: 'Pkgs' });
    writeLines(p.dir, 'p1/p1.go', 30); writeLines(p.dir, 'p2/p2.go', 30);
    commit(p.dir, 'two packages');
    const baseSha = sh(p.dir, 'rev-parse', 'HEAD').stdout.trim();
    writeLines(p.dir, 'p2/p2.go', 30, [[3, 4, 'phase']]);
    commit(p.dir, 'phase work (phase 5 t1)');
    writeLines(p.dir, 'p1/p1.go', 30, [[3, 4, 'later']]);
    commit(p.dir, 'later, unstamped');
    rigWith(p, 'gremlins', { report: 'gremlins.json' });
    // the fixture's mutants are in a.go; point them at the phase's package by rewriting the report path
    const rep = JSON.parse(readFileSync(join(FX, 'gremlins.json'), 'utf8'));
    rep.files[0].file_name = 'p2/p2.go';
    rep.files.push({ file_name: 'p1/p1.go', mutations: [{ type: 'CONDITIONALS_BOUNDARY', status: 'LIVED', line: 3, column: 5 }] });
    writeFileSync(join(p.dir, 'rep.json'), JSON.stringify(rep));
    p.env.MUTATE_STUB_REPORT = join(p.dir, 'rep.json');
    const slug = findPhase(p.dir, '5').slug;
    const r = await runMutate(p.dir, slug, { env: p.env });
    const argv = argvOf(p, 'unleash');
    assert.equal(argv[argv.indexOf('--diff') + 1], baseSha);
    assert.equal(argv.includes('--exclude-files'), false);
    assert.equal(r.scope_detail.narrowed, 'diff');
    assert.deepEqual(r.scope, ['p2/p2.go']);
    assert.ok(r.survivors.every((s) => s.file === 'p2/p2.go'), 'the post-phase package\'s survivor is not reported');
    assert.ok(r.out_of_scope_count === undefined || r.out_of_scope_count >= 1);
  } finally { done(p); }
});

async function pyHistory() {
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject('py');
  await addPhase(p.dir, { number: 5, name: 'Funcs' });
  const src = (tag) => `X = 1\n\ndef a(x):\n    return x + 1\n\ndef b(x):\n    return x * 2 ${tag}\n\ndef c(x):\n    return x // 2\n\nclass K:\n    def m(self, x):\n        return x + 1 ${tag}\n`;
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(p.dir, 'pkg'), { recursive: true });
  writeFileSync(join(p.dir, 'pkg', 'mod.py'), src('v0'));
  writeFileSync(join(p.dir, 'pkg', '__init__.py'), 'VERSION = 1\n');
  commit(p.dir, 'baseline');
  writeFileSync(join(p.dir, 'pkg', 'mod.py'), src('v1'));
  commit(p.dir, 'edit b and K.m (phase 5 t1)');
  p.slug5 = findPhase(p.dir, '5').slug;
  return p;
}

test('C3 (mutmut 3): only the functions holding changed lines are selected, by exact mutant-name glob', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await pyHistory(), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.deepEqual(argvOf(p, 'run'), ['run', 'pkg.mod.xǁKǁm__mutmut_*', 'pkg.mod.x_b__mutmut_*']);
    assert.equal(r.scope_detail.narrowed, 'functions');
    assert.deepEqual(r.scope_detail.functions, { 'pkg/mod.py': ['K.m', 'b'] });
  } finally { done(p); }
});

test('C3 (mutmut 3): a changed line outside any function is counted and warned about; with none inside a function the outcome is no-scope', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await pyHistory(), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    const mod = readFileSync(join(p.dir, 'pkg', 'mod.py'), 'utf8').replace('X = 1', 'X = 2');
    writeFileSync(join(p.dir, 'pkg', 'mod.py'), mod);
    commit(p.dir, 'module-level change (phase 5 t2)');
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(r.scope_detail.outside_functions, 1);
    assert.ok(r.warnings.some((w) => /outside any function/.test(w)));
    // a phase that only touched a module-level line
    const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
    await addPhase(p.dir, { number: 6, name: 'Module' });
    writeFileSync(join(p.dir, 'pkg', 'mod.py'), mod.replace('X = 2', 'X = 3'));
    commit(p.dir, 'module only (phase 6 t1)');
    const r6 = await runMutate(p.dir, findPhase(p.dir, '6').slug, { env: p.env });
    assert.equal(r6.outcome, 'no-scope');
    assert.match(r6.fallback.reason, /inside a function/);
  } finally { done(p); }
});

test('C3 (mutmut 2): --paths-to-mutate with the file, and the result states the file-level narrowing and why', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await pyHistory(), 'mutmut', { report: 'mutmut2-junit.xml', version: '2.4.4', extra: { MUTATE_STUB_V2_REAL: '1' } });
  try {
    const r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.deepEqual(argvOf(p, 'run'), ['run', '--paths-to-mutate', 'pkg/mod.py']);
    assert.equal(r.scope_detail.narrowed, 'files');
    assert.match(r.scope_detail.why, /whole files only/);
  } finally { done(p); }
});

test('C3: a package __init__.py added by mutation.files is globbed as the package itself', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await pyHistory(), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    await cfgSet(p.dir, { files: ['pkg/__init__.py'] });
    await runMutate(p.dir, p.slug5, { env: p.env });
    assert.deepEqual(argvOf(p, 'run'), ['run', 'pkg.mod.xǁKǁm__mutmut_*', 'pkg.mod.x_b__mutmut_*', 'pkg.*']);
  } finally { done(p); }
});

test('C4: mutation.exclude drops a target and mutation.files adds a whole file, for Stryker; the result names the setting', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = rigWith(await jsHistory(), 'stryker', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    await cfgSet(p.dir, { exclude: ['src/big.js'] });
    let r = await runMutate(p.dir, p.slug5, { env: p.env });
    assert.equal(r.outcome, 'no-scope');
    assert.deepEqual(r.scope_detail.excluded, ['src/big.js']);
    assert.match(r.scope_detail.source, /mutation\.exclude/);
    await cfgSet(p.dir, { exclude: [], files: ['src/extra.js'] });
    r = await runMutate(p.dir, p.slug5, { env: p.env });
    const a = logLines(p.log).filter((l) => l.argv[0] === 'run').pop().argv;
    assert.equal(a[a.indexOf('--mutate') + 1], 'src/big.js:40-45,src/big.js:90-91,src/extra.js');
    assert.equal(r.scope_detail.source, 'changed-lines + mutation.files');
    assert.deepEqual(r.scope_detail.added, ['src/extra.js']);
    await cfgSet(p.dir, { exclude: ['src/'], files: [] });
    assert.equal((await runMutate(p.dir, p.slug5, { env: p.env })).outcome, 'no-scope', 'a trailing slash excludes a directory');
  } finally { done(p); }
});

test('C4: the same settings apply to mutmut 3, and Gremlins falls back to excluding other files when files are added', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const m = rigWith(await pyHistory(), 'mutmut', { version: 'mutmut, version 3.8.0' });
  try {
    await cfgSet(m.dir, { exclude: ['pkg/mod.py'] });
    assert.equal((await runMutate(m.dir, m.slug5, { env: m.env })).outcome, 'no-scope');
    await cfgSet(m.dir, { exclude: [], files: ['pkg/__init__.py'] });
    const r = await runMutate(m.dir, m.slug5, { env: m.env });
    assert.match(r.scope_detail.source, /mutation\.files/);
  } finally { done(m); }
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const g = await makeProject('go');
  try {
    await addPhase(g.dir, { number: 5, name: 'Go' });
    writeLines(g.dir, 'p1/p1.go', 20); writeLines(g.dir, 'p2/p2.go', 20);
    commit(g.dir, 'baseline');
    writeLines(g.dir, 'p2/p2.go', 20, [[2, 3, 'x']]);
    commit(g.dir, 'work (phase 5 t1)');
    rigWith(g, 'gremlins', { report: 'gremlins.json' });
    const slug = findPhase(g.dir, '5').slug;
    await cfgSet(g.dir, { exclude: ['p1/p1.go'] });
    await runMutate(g.dir, slug, { env: g.env });
    let argv = argvOf(g, 'unleash');
    assert.ok(argv.includes('--diff'));
    assert.deepEqual(argv.filter((a, i) => argv[i - 1] === '--exclude-files'), ['^p1/p1\\.go$']);
    await cfgSet(g.dir, { exclude: [], files: ['p1/p1.go'] });
    const r = await runMutate(g.dir, slug, { env: g.env });
    argv = logLines(g.log).filter((l) => l.argv[0] === 'unleash').pop().argv;
    assert.equal(argv.includes('--diff'), false);
    assert.match(r.scope_detail.why, /cannot express/);
  } finally { done(g); }
});

test('settings of the wrong type are ignored with a warning', async () => {
  const { mutationSettings } = await import('../lib/mutate.mjs');
  const p = await makeProject('js');
  try {
    await cfgSet(p.dir, { files: 'src/a.mjs', exclude: [1] });
    const w = [];
    const s = mutationSettings(p.dir, 1, w);
    assert.deepEqual([s.files, s.exclude], [[], []]);
    assert.equal(w.length, 2);
  } finally { done(p); }
});
