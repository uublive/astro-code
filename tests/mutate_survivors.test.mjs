// Phase 49 t11 — `ac mutate <n> --survivors`: re-test only the open survivors of the last full run,
// on every tool, and never as a recordable verdict (D4, C5, C6). Stub tools; argv from MUTATE_STUB_LOG.
// The Stryker `--mutate` span form is transcribed, not captured (Stryker is not installed here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeProject, installStub, installRunner, restrictedEnv, commit, sh, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const REAL = join(FX, 'real');
const ac = (p, args) => spawnSync(process.execPath, [AC, ...args], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 60000 });
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const runs = (p, name) => logLines(p.log).filter((l) => l.tool === name && (l.argv[0] === 'run' || l.argv[0] === 'unleash'));
const json = (p, ...a) => JSON.parse(ac(p, ['mutate', '1', '--json', ...a]).stdout);
const judge = (p, ids, flag, note) => {
  const r = ac(p, ['mutate', 'judge', '1', ...ids, ...(note !== undefined ? [flag, note] : [flag])]);
  assert.equal(r.status, 0, r.stderr);
};
const runFile = (p) => join(p.dir, '.astrocode', '.local', 'mutate-runs', `${p.slug1}.json`);
const partialFile = (p) => join(p.dir, '.astrocode', '.local', 'mutate-runs', `${p.slug1}.survivors.json`);
const rep = (obj, p, name = 'rerun-report.json') => { const f = join(p.dir, name); writeFileSync(f, JSON.stringify(obj)); return f; };
const triage = JSON.parse(readFileSync(join(FX, 'stryker-triage.json'), 'utf8'));
const SOURCE = triage.files['src/a.mjs'].source;

// ---- Stryker ----
async function strykerRig() {
  const p = await makeProject('js');
  writeFileSync(join(p.dir, 'src', 'a.mjs'), SOURCE);
  commit(p.dir, 'feat: real source (phase 1 t2)');
  installStub(p.dir, 'stryker', 'node_modules/.bin');
  p.log = join(p.dir, 'stub.log');
  p.full = rep(triage, p, 'full-report.json');
  p.env = restrictedEnv([], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: p.full });
  return p;
}

// Full run; id 4 (x === 0) equivalent, id 1 (a > b) test-gap; ids 3, 5, 7 untriaged. Id 7 shares id 4's span.
async function judgedStryker() {
  const p = await strykerRig();
  const j = json(p);
  const at = (line, kind) => j.survivors.find((s) => s.line === line && s.kind === kind).key;
  judge(p, [at(9, 'EqualityOperator')], '--equivalent', 'the guard is unreachable');
  judge(p, [at(2, 'EqualityOperator')], '--test-gap');
  return { p, j, at };
}
const rerunReport = (p, keepIds, killIds) => {
  const r = JSON.parse(JSON.stringify(triage));
  r.files['src/a.mjs'].mutants = r.files['src/a.mjs'].mutants.filter((m) => keepIds.includes(m.id)).map((m) => (killIds.includes(m.id) ? { ...m, status: 'Killed', killedBy: ['add subtracts'] } : { ...m, status: 'Survived', killedBy: undefined }));
  return rep(r, p);
};

test('C5 Stryker: --mutate holds exactly the open survivors\' spans; the rest of the report is not re-run and extra_executed is reported', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { p } = await judgedStryker();
  try {
    const full = json(p);
    const fullCount = Object.values(full.counts).reduce((a, b) => a + b, 0);
    p.env.MUTATE_STUB_REPORT = rerunReport(p, ['1', '3', '4', '5', '7'], ['3']);
    const r = await runMutate(p.dir, p.slug1, { env: p.env, survivors: true });
    const call = runs(p, 'stryker').at(-1).argv;
    assert.deepEqual(call[call.indexOf('--mutate') + 1].split(',').sort(), ['src/a.mjs:10:17-10:29', 'src/a.mjs:2:7-2:12', 'src/a.mjs:5:22-5:40', 'src/a.mjs:9:7-9:14']);
    assert.equal(r.partial, true);
    assert.equal(r.rerun.open, 4);
    assert.equal(r.rerun.executed, 5);
    assert.ok(r.rerun.executed < fullCount, 'fewer mutant executions than the full run');
    assert.equal(r.rerun.killed_now, 1);
    assert.equal(r.rerun.still_open, 3);
    assert.equal(r.rerun.extra_executed, 1, 'the equivalent mutant sharing a span re-ran, and it is said');
    assert.equal(r.rerun.narrowing.narrowed, 'mutant spans');
    assert.ok(r.rerun.narrowing.why);
    // the display is the full run's groups with the re-test overlaid: the killed survivor is gone
    assert.equal(r.survivors.length, 4);
    assert.equal(r.triage.judged, 1);
    assert.ok(r.survivors.some((s) => s.retest === 'survived'));
    assert.ok(readFileSync(join(p.dir, r.full_list), 'utf8').trim().split('\n').length === 5, 'the per-mutant list of what ran');
  } finally { done(p); }
});

test('C6: the kept full run is byte-identical after --survivors; the human output leads with the partial line; the partial evidence is refused; a fresh full run records', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const { p, j, at } = await judgedStryker();
  try {
    const before = readFileSync(runFile(p), 'utf8');
    assert.equal(existsSync(partialFile(p)), false);
    p.env.MUTATE_STUB_REPORT = rerunReport(p, ['1', '3', '4', '5', '7'], ['3']);
    const part = json(p, '--survivors');
    assert.equal(part.partial, true);
    assert.equal(readFileSync(runFile(p), 'utf8'), before, '.run is never touched');
    assert.equal(JSON.parse(readFileSync(partialFile(p), 'utf8')).partial, true);
    const h = ac(p, ['mutate', '1', '--survivors']).stdout;
    const sha = j.head.slice(0, 7);
    assert.match(h.split('\n')[0], new RegExp(`^partial re-run on top of the full run ${sha} \\(.+\\) — not a recordable verdict; final: ac mutate 1$`));
    assert.match(h, /^re-ran 4 open survivor\(s\): 1 killed now · 3 still open — the tool ran 5 mutants \(1 beyond the open ones\)$/m);
    assert.match(h, /^narrowed: mutant spans — /m);

    // the partial output as evidence on a test-strength criterion is refused
    writeFileSync(join(p.dir, '.astrocode', 'phases', p.slug1, 'CRITERIA.md'), '### C1 [mutation] — strong\n');
    const ev = (r, o = {}) => ({
      outcome: r.outcome, tool: 'stryker', head: r.head, capped: false, complete: true, counts: r.counts, fallback: null, partial: r.partial,
      survivors: r.survivors.map(({ file, line, mutator, status, id, triage: t, justification }) => ({ file, line, mutator, status, id, triage: t ?? 'equivalent', justification: justification ?? 'ok' })), ...o,
    });
    let out = await recordVerdict(p.dir, p.slug1, { mode: 'full', criteria: [{ id: 'C1', passed: true, mutation: ev(part) }] });
    assert.equal(out.passed, false); assert.match(out.refused[0].reason, /partial re-test/);

    // a fresh full run (the survivor is now killed), every other survivor judged: accepted
    const killed = JSON.parse(JSON.stringify(triage));
    killed.files['src/a.mjs'].mutants.find((m) => m.id === '3').status = 'Killed';
    p.env.MUTATE_STUB_REPORT = rep(killed, p, 'full2.json');
    const fresh = json(p);
    assert.equal(existsSync(partialFile(p)), false, 'a full run deletes the stale partial file');
    judge(p, fresh.survivors.filter((s) => s.triage !== 'equivalent').map((s) => s.key), '--equivalent', 'accepted as equivalent');
    const f2 = json(p);
    out = await recordVerdict(p.dir, p.slug1, { mode: 'full', criteria: [{ id: 'C1', passed: true, mutation: ev(f2, { partial: undefined }) }] });
    assert.equal(out.passed, true, JSON.stringify(out.refused));
    void at;
  } finally { done(p); }
});

test('--survivors with no kept full run is an error naming ac mutate <n>, with nothing saved and no tool spawned', async () => {
  const p = await strykerRig();
  try {
    const r = JSON.parse(ac(p, ['mutate', '1', '--survivors', '--json']).stdout);
    assert.equal(r.outcome, 'error');
    assert.match(r.error, /run `ac mutate 1` first/);
    assert.equal(existsSync(partialFile(p)), false);
    assert.equal(existsSync(runFile(p)), false);
    assert.equal(runs(p, 'stryker').length, 0);
    const h = ac(p, ['mutate', '1', '--survivors']);
    assert.match(h.stdout, /^⚠ --survivors needs a full `ac mutate 1` run/m);
  } finally { done(p); }
});

test('zero open survivors: no tool is spawned and the output says to record against the last full run', async () => {
  const { p, j } = await judgedStryker();
  try {
    judge(p, json(p).survivors.filter((s) => !(s.triage === 'equivalent')).map((s) => s.key), '--equivalent', 'all fine');
    const n = runs(p, 'stryker').length;
    const h = ac(p, ['mutate', '1', '--survivors']).stdout;
    assert.equal(runs(p, 'stryker').length, n, 'no tool spawn');
    assert.match(h, /^• no open survivors — record against the last full run$/m);
    const r = JSON.parse(ac(p, ['mutate', '1', '--survivors', '--json']).stdout);
    assert.equal(r.rerun.open, 0); assert.equal(r.partial, true);
    void j;
  } finally { done(p); }
});

// ---- mutmut ----
test('C5 mutmut 3: run plus exactly the open names; the equivalent one is not re-run', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const src = readFileSync(join(REAL, 'mutmut3-src-mod.py.txt'), 'utf8');
  const p = await makeProject('py');
  try {
    await addPhase(p.dir, { number: 5, name: 'Lines' });
    mkdirSync(join(p.dir, 'pkg'), { recursive: true });
    writeFileSync(join(p.dir, 'pkg', 'mod.py'), src.replace('return x * 2', 'return x * 3').replace('return x + self.v', 'return x + self.v + 1'));
    commit(p.dir, 'baseline');
    writeFileSync(join(p.dir, 'pkg', 'mod.py'), src);
    commit(p.dir, 'work (phase 5 t1)');
    const show = join(p.dir, 'show'); mkdirSync(show);
    copyFileSync(join(REAL, 'mutmut3-show-b-1.txt'), join(show, 'pkg.mod.x_b__mutmut_1.diff'));
    copyFileSync(join(REAL, 'mutmut3-show-Km.txt'), join(show, 'pkg.mod.xǁKǁm__mutmut_1.diff'));
    const gen = join(p.dir, 'gen', 'pkg'); mkdirSync(gen, { recursive: true });
    copyFileSync(join(REAL, 'mutmut3-mutants-mod.py.txt'), join(gen, 'mod.py'));
    const bin = installStub(p.dir, 'mutmut', 'stubbin');
    p.log = join(p.dir, 'stub.log');
    p.env = restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_VERSION: 'mutmut, version 3.8.0', MUTATE_STUB_REPORT: join(REAL, 'mutmut3-results-methods.txt'), MUTATE_STUB_SHOW: show, MUTATE_STUB_MUTANTS: join(p.dir, 'gen') });
    p.slug1 = findPhase(p.dir, '5').slug;
    const full = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.deepEqual(full.survivors.map((s) => s.name).sort(), ['pkg.mod.x_b__mutmut_1', 'pkg.mod.xǁKǁm__mutmut_1']);
    const b = full.survivors.find((s) => s.name === 'pkg.mod.x_b__mutmut_1');
    const { recordJudgements } = await import('../lib/survivors.mjs');
    await recordJudgements(p.dir, p.slug1, { ids: [b.key], triage: 'equivalent', justification: 'b boundary is irrelevant' });
    const results = readFileSync(join(REAL, 'mutmut3-results-methods.txt'), 'utf8').replace('xǁKǁm__mutmut_1: survived', 'xǁKǁm__mutmut_1: killed');
    p.env.MUTATE_STUB_REPORT = join(p.dir, 'results2.txt'); writeFileSync(p.env.MUTATE_STUB_REPORT, results);
    const r = await runMutate(p.dir, p.slug1, { env: p.env, survivors: true });
    const call = runs(p, 'mutmut').at(-1).argv;
    assert.deepEqual(call, ['run', 'pkg.mod.xǁKǁm__mutmut_1']);
    assert.equal(r.rerun.narrowing.narrowed, 'mutants');
    assert.deepEqual([r.rerun.open, r.rerun.executed, r.rerun.killed_now, r.rerun.still_open, r.rerun.extra_executed], [1, 1, 1, 0, 0]);
    assert.ok(r.rerun.executed < 13);
    assert.equal(r.survivors.length, 1, 'only the judged one is left');
    assert.equal(r.survivors[0].triage, 'equivalent');
  } finally { done(p); }
});

test('C5 mutmut 2: --paths-to-mutate holds only the files with open survivors, narrowed: files with its why', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await makeProject('py');
  try {
    const bin = installStub(p.dir, 'mutmut', 'stubbin');
    p.log = join(p.dir, 'stub.log');
    p.env = restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: join(FX, 'mutmut2-junit.xml') });
    const full = await runMutate(p.dir, p.slug1, { env: p.env });
    assert.equal(full.survivors.length, 1);
    const r = await runMutate(p.dir, p.slug1, { env: p.env, survivors: true });
    assert.equal(runs(p, 'mutmut').at(-1).argv.join(' '), 'run --paths-to-mutate src/a.py');
    assert.equal(r.rerun.narrowing.narrowed, 'files');
    assert.match(r.rerun.narrowing.why, /whole files/);
    assert.equal(r.rerun.open, 1);
    assert.equal(r.rerun.still_open, 1);
    assert.equal(r.rerun.extra_executed >= 0, true);
  } finally { done(p); }
});

// ---- Gremlins ----
const GO_SOURCE = ['package a', '', 'func Cmp(a, b int) int {', '\tif a > b {', '\t\treturn a - b', '\t}', '\treturn 0', '}', '',
  'func Inc(x int) int {', '\tif x >= 10 {', '\t\tx++', '\t}', '\treturn x + 1', '}', ''].join('\n');

test('C5 Gremlins: narrowed by files and kinds (a dangling --diff base is not honoured by 0.6), the repo is untouched, and the why says killed mutants re-ran', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await makeProject('go');
  try {
    writeFileSync(join(p.dir, 'a.go'), GO_SOURCE);
    commit(p.dir, 'feat: real go (phase 1 t2)');
    const bin = installStub(p.dir, 'gremlins', 'stubbin');
    p.log = join(p.dir, 'stub.log');
    p.env = restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: join(FX, 'gremlins-triage.json'), MUTATE_STUB_VERSION: 'gremlins version 0.6.0' });
    const full = await runMutate(p.dir, p.slug1, { env: p.env });
    const by = (l) => full.survivors.find((s) => s.line === l);
    const { recordJudgements } = await import('../lib/survivors.mjs');
    await recordJudgements(p.dir, p.slug1, { ids: [by(10).key], triage: 'equivalent', justification: 'x >= 10 and x > 10 agree here' });
    await recordJudgements(p.dir, p.slug1, { ids: [by(4).key], triage: 'test-gap' });
    // line 11 (INCREMENT_DECREMENT) and 13 (ARITHMETIC_BASE) stay untriaged
    const rr = JSON.parse(readFileSync(join(FX, 'gremlins-triage.json'), 'utf8'));
    rr.files[0].mutations = rr.files[0].mutations.filter((m) => m.line !== 5).map((m) => (m.line === 11 ? { ...m, status: 'KILLED' } : m));
    p.env.MUTATE_STUB_REPORT = rep(rr, p);
    const snap = () => ({
      head: sh(p.dir, 'rev-parse', 'HEAD').stdout, status: sh(p.dir, 'status', '--porcelain').stdout,
      index: readFileSync(join(p.dir, '.git', 'index')).toString('hex'), refs: sh(p.dir, 'for-each-ref').stdout,
    });
    const before = snap();
    const r = await runMutate(p.dir, p.slug1, { env: p.env, survivors: true });
    assert.deepEqual(snap(), before, 'no ref, index, HEAD or working-tree change');
    const argv = runs(p, 'gremlins').at(-1).argv;
    const ex = argv.flatMap((a, i) => (a === '--exclude-files' ? [argv[i + 1]] : []));
    assert.ok(ex.includes('^c\\.go$'), 'every other .go file is excluded');
    assert.ok(argv.includes('--conditionals-negation=false') && argv.includes('--invert-negatives=false'), 'kinds with no open survivor are off');
    assert.ok(!argv.some((a) => a === '--arithmetic-base=false' || a === '--increment-decrement=false' || a === '--conditionals-boundary=false'));
    assert.equal(r.rerun.narrowing.narrowed, 'files+kinds');
    assert.match(r.rerun.narrowing.why, /killed mutants .* re-ran too/);
    assert.deepEqual([r.rerun.open, r.rerun.executed, r.rerun.killed_now, r.rerun.still_open, r.rerun.extra_executed], [3, 4, 1, 2, 1]);
    assert.ok(r.rerun.executed < Object.values(full.counts).reduce((a, b) => a + b, 0));
  } finally { done(p); }
});

test('the Gremlins re-run flags are all in the captured `unleash --help`', () => {
  const help = readFileSync(join(REAL, 'gremlins-unleash-help.txt'), 'utf8');
  for (const f of ['--exclude-files', '--arithmetic-base', '--conditionals-boundary', '--conditionals-negation', '--increment-decrement', '--invert-negatives', '--invert-assignments', '--invert-bitwise', '--invert-bwassign', '--invert-logical', '--invert-loopctrl', '--remove-self-assignments']) {
    assert.ok(help.includes(f), f);
  }
});

test('the flaky check runs before the re-test', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await makeProject('go');
  try {
    writeFileSync(join(p.dir, 'a.go'), GO_SOURCE);
    commit(p.dir, 'feat: real go (phase 1 t2)');
    const bin = installStub(p.dir, 'gremlins', 'stubbin');
    installRunner(p.dir, 'go', 'stubbin');
    p.log = join(p.dir, 'stub.log');
    p.env = restrictedEnv([bin], { MUTATE_STUB_LOG: p.log, MUTATE_STUB_REPORT: join(FX, 'gremlins-triage.json') });
    await runMutate(p.dir, p.slug1, { env: p.env });
    const mark = logLines(p.log).length;
    const r = await runMutate(p.dir, p.slug1, { env: p.env, survivors: true });
    const after = logLines(p.log).slice(mark).filter((l) => l.argv[0] === 'test' || l.argv[0] === 'unleash');
    assert.deepEqual(after.map((l) => l.argv[0]), ['test', 'test', 'unleash']);
    assert.equal(r.flaky.checked, true);
  } finally { done(p); }
});
