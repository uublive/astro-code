// Phase 47 t6 — the report parsers and status maps, over committed fixtures (P6).
// Modules are reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mutate');
const fx = (n) => readFileSync(join(FX, n), 'utf8');
const all = (r) => [...r.mutants, ...r.not_run, ...r.ignored];
const statuses = (r) => r.mutants.map((m) => m.status);

// Each case: parser name, fixture, in-scope scope, expected counts, buckets, out-of-scope total.
const CASES = [
  { fn: 'parseStryker', file: 'stryker-mutation.json', scope: ['src/a.mjs'], total: 9,
    counts: { killed: 2, survived: 1, timeout: 1, 'no-coverage': 1, error: 2 }, not_run: 0, ignored: 1 },
  { fn: 'parseStryker', file: 'stryker-partial.json', scope: ['src/a.mjs'], total: 9,
    counts: { killed: 1, survived: 1, timeout: 1, 'no-coverage': 1, error: 2 }, not_run: 1, ignored: 1 },
  { fn: 'parseGremlins', file: 'gremlins.json', scope: ['a.go'], total: 8,
    counts: { killed: 1, survived: 1, timeout: 1, 'no-coverage': 1, error: 1 }, not_run: 1, ignored: 1 },
  { fn: 'parseMutmutJunit', file: 'mutmut2-junit.xml', scope: ['src/a.py'], total: 7,
    counts: { killed: 1, survived: 1, timeout: 2, 'no-coverage': 0, error: 0 }, not_run: 1, ignored: 1 },
  { fn: 'parseMutmutResults', file: 'mutmut3-results.txt', scope: ['src/a.py'], total: 9,
    counts: { killed: 1, survived: 1, timeout: 2, 'no-coverage': 1, error: 1 }, not_run: 1, ignored: 1 },
];

for (const c of CASES) {
  test(`${c.fn}(${c.file}): every mutant exactly once, statuses mapped, scope filter drops the other file`, async () => {
    const mp = await import('../lib/mutparse.mjs');
    const { MUTANT_STATUSES } = await import('../lib/verdict.mjs');
    const whole = mp[c.fn](fx(c.file));
    assert.equal(all(whole).length, c.total, 'every fixture mutant present once (no scope)');
    const r = mp[c.fn](fx(c.file), { scope: c.scope });
    assert.equal(all(r).length, c.total - 1, 'the out-of-scope mutant is dropped');
    assert.deepEqual(mp.countStatuses(r.mutants), c.counts);
    assert.equal(r.not_run.length, c.not_run);
    assert.equal(r.ignored.length, c.ignored);
    for (const m of r.mutants) {
      assert.ok(MUTANT_STATUSES.includes(m.status));
      // mutmut 3 names carry no line (phase 48: null, never 0); every other tool has an integer line
      assert.ok(m.file && m.mutator && (Number.isInteger(m.line) || (c.fn === 'parseMutmutResults' && m.line === null)), JSON.stringify(m));
    }
    assert.deepEqual(r, mp[c.fn](fx(c.file), { scope: c.scope }), 'deterministic');
    const keys = r.mutants.map((m) => `${m.file}\0${String(m.line).padStart(6, '0')}\0${m.mutator}`);
    assert.deepEqual(keys, [...keys].sort(), 'sorted by file, line, mutator');
  });
}

test('Stryker statuses map one by one (NoCoverage is not killed, Timeout is not survived)', async () => {
  const { parseStryker } = await import('../lib/mutparse.mjs');
  const r = parseStryker(fx('stryker-mutation.json'), { scope: ['src/a.mjs'] });
  const by = Object.fromEntries(r.mutants.map((m) => [m.mutator, m.status]));
  assert.equal(by.ArithmeticOperator, 'survived');
  assert.equal(by.BooleanLiteral, 'timeout');
  assert.equal(by.ConditionalExpression, 'no-coverage');
  assert.equal(by.ObjectLiteral, 'error');
  assert.equal(by.BlockStatement, 'error');
  assert.deepEqual(statuses(r).filter((s) => s === 'killed').length, 2);
});

test('mutmut mutants without an operator carry the tool mutant name, never empty', async () => {
  const { parseMutmutJunit, parseMutmutResults } = await import('../lib/mutparse.mjs');
  for (const r of [parseMutmutJunit(fx('mutmut2-junit.xml')), parseMutmutResults(fx('mutmut3-results.txt'))]) {
    for (const m of all(r)) assert.match(m.mutator, /mutmut/);
  }
  const r3 = parseMutmutResults(fx('mutmut3-results.txt'), { scope: ['src/a.py'] });
  assert.equal(r3.mutants[0].file, 'src/a.py');
});

test('a module-relative report path matches the one scope entry that ends with it', async () => {
  const { parseMutmutResults } = await import('../lib/mutparse.mjs');
  const r = parseMutmutResults(fx('mutmut3-results.txt'), { scope: ['app/src/a.py'] });
  assert.equal(r.mutants[0].file, 'app/src/a.py');
  assert.equal(all(r).length, 8);
});

test('garbage input returns { error } and never throws', async () => {
  const mp = await import('../lib/mutparse.mjs');
  for (const fn of ['parseStryker', 'parseGremlins', 'parseMutmutJunit', 'parseMutmutResults']) {
    for (const bad of ['', 'not json <<<', '{}', '[]', null, undefined]) {
      const r = mp[fn](bad);
      assert.ok(typeof r.error === 'string', `${fn}(${String(bad)})`);
    }
  }
});

test('an unknown tool status is an error mutant, never dropped or killed', async () => {
  const { parseStryker } = await import('../lib/mutparse.mjs');
  const rep = { files: { 'a.js': { mutants: [{ id: '1', mutatorName: 'X', location: { start: { line: 1 } }, status: 'Weird' }] } } };
  assert.deepEqual(parseStryker(JSON.stringify(rep)).mutants.map((m) => m.status), ['error']);
});

test('real junit_xml shape: message beats type; mutmut 3 names with class bars parse', async () => {
  const { parseMutmutJunit, parseMutmutResults } = await import('../lib/mutparse.mjs');
  const xml = '<testsuite><testcase classname="src/a.py" file="src/a.py" line="3" name="m 1"><failure type="failure" message="bad_survived">--- diff</failure><system-out>x = 1</system-out></testcase>'
    + '<testcase classname="src/a.py" file="src/a.py" line="4" name="m 2"><failure type="failure" message="bad_timeout">d</failure></testcase></testsuite>';
  const j = parseMutmutJunit(xml, { scope: ['src/a.py'] });
  assert.deepEqual(j.mutants.map((m) => m.status), ['survived', 'timeout']);
  const r = parseMutmutResults('    a.xǁCalcǁmul__mutmut_1: survived\n    a.x_add__mutmut_1: killed\n', { scope: ['src/a.py'] });
  assert.deepEqual(r.mutants.map((m) => m.status).sort(), ['killed', 'survived']);
});

test('mutmut 2.x real shape: every testcase carries <system-out>, killed ones included', async () => {
  const { parseMutmutJunit } = await import('../lib/mutparse.mjs');
  // junit_xml 1.9 as mutmut 2.4.5 writes it (cache.py: TestCase(..., stdout=mutant.line.line)).
  const xml = '<testsuites><testsuite name="mutmut" tests="4">'
    + '<testcase classname="" file="src/pkg/a.py" line="3" name="Mutant #1"><system-out>    return a + b</system-out></testcase>'
    + '<testcase classname="" file="src/pkg/a.py" line="4" name="Mutant #2"><failure type="failure" message="bad_survived"/><system-out>x</system-out></testcase>'
    + '<testcase classname="" file="src/pkg/a.py" line="5" name="Mutant #3"><failure type="failure" message="bad_timeout"/><system-out>y</system-out></testcase>'
    + '<testcase classname="" file="src/pkg/a.py" line="6" name="Mutant #4"><system-out>    return 0</system-out></testcase>'
    + '</testsuite></testsuites>';
  const r = parseMutmutJunit(xml, { scope: ['src/pkg/a.py'] });
  assert.deepEqual(r.mutants.map((m) => m.status), ['killed', 'survived', 'timeout', 'killed']);
});

test('mutmut 3: a package __init__.py mutant (pkg.x_f__mutmut_N) maps to pkg/__init__.py, never dropped', async () => {
  const { parseMutmutResults } = await import('../lib/mutparse.mjs');
  const text = '    pkg.x_f__mutmut_1: survived\n    pkg.a.x_g__mutmut_1: killed\n';
  const r = parseMutmutResults(text, { scope: ['src/pkg/__init__.py', 'src/pkg/a.py'] });
  assert.deepEqual(r.mutants.map((m) => [m.file, m.status]),
    [['src/pkg/__init__.py', 'survived'], ['src/pkg/a.py', 'killed']]);
  // a real module pkg.py still wins over pkg/__init__.py
  const m = parseMutmutResults('    pkg.x_f__mutmut_1: killed\n', { scope: ['src/pkg.py'] });
  assert.equal(m.mutants[0].file, 'src/pkg.py');
});

// ---- Phase 48 t9 — range/function filtering, per-file counts, mutmut 3 line mapping ----
const REAL = join(FX, 'real');
const real = (n) => readFileSync(join(REAL, n), 'utf8');

test('phase 48: normalize keeps in-range lines, puts the rest in outside, and a whole-file entry keeps everything', async () => {
  const { parseStryker } = await import('../lib/mutparse.mjs');
  const rep = { files: {
    'src/a.mjs': { mutants: [44, 50].map((line, i) => ({ id: String(i), mutatorName: 'X', location: { start: { line } }, status: 'Survived' })) },
    'src/b.mjs': { mutants: [{ id: '9', mutatorName: 'X', location: { start: { line: 1 } }, status: 'Killed' }] },
    'src/z.mjs': { mutants: [{ id: '8', mutatorName: 'X', location: { start: { line: 1 } }, status: 'Killed' }] },
  } };
  const r = parseStryker(JSON.stringify(rep), { scope: ['src/a.mjs', 'src/b.mjs'], ranges: { 'src/a.mjs': [[40, 45]] } });
  assert.deepEqual(r.mutants.map((m) => `${m.file}:${m.line}`), ['src/a.mjs:44', 'src/b.mjs:1']);
  assert.deepEqual(r.outside.map((m) => `${m.file}:${m.line}`).sort(), ['src/a.mjs:50', 'src/z.mjs:1']);
  assert.equal(parseStryker(JSON.stringify(rep), { scope: ['src/a.mjs'] }).outside.length, 2, 'files the scope excludes are counted too');
});

test('phase 48: mutmut funcs keep the named functions and methods and move the rest to outside', async () => {
  const { parseMutmutResults } = await import('../lib/mutparse.mjs');
  const r = parseMutmutResults(real('mutmut3-results-methods.txt'), { scope: ['pkg/mod.py'], funcs: { 'pkg/mod.py': ['b', 'K.m'] } });
  assert.deepEqual([...new Set(r.mutants.map((m) => m.func))].sort(), ['K.m', 'b']);
  assert.deepEqual([...new Set(r.outside.map((m) => m.func))].sort(), ['K.__init__', 'a', 'c']);
  assert.equal(r.mutants.length + r.outside.length, 13);
  for (const m of r.mutants) assert.ok(m.func);
});

test('phase 48: mutmut lines come from the lines map; an unmapped mutant is null (never 0) and sorts last', async () => {
  const { parseMutmutResults } = await import('../lib/mutparse.mjs');
  const r = parseMutmutResults(real('mutmut3-results-methods.txt'), {
    scope: ['pkg/mod.py'], lines: { 'pkg.mod.x_b__mutmut_1': 6, 'pkg.mod.x_a__mutmut_1': 2 },
  });
  const lines = r.mutants.map((m) => m.line);
  assert.deepEqual(lines.slice(0, 2), [2, 6]);
  assert.ok(lines.slice(2).every((l) => l === null));
  assert.ok(!lines.includes(0));
});

test('phase 48: mutmutShowLine finds the real line for the first and a later mutant of b and for K.m', async () => {
  const { mutmutShowLine } = await import('../lib/mutparse.mjs');
  const { pythonFunctions } = await import('../lib/pyscan.mjs');
  const src = real('mutmut3-src-mod.py.txt');
  const fns = Object.fromEntries(pythonFunctions(src).map((f) => [f.qual, f]));
  const at = (n) => src.split('\n')[n - 1];
  const l1 = mutmutShowLine(real('mutmut3-show-b-1.txt'), src, fns.b);
  const lN = mutmutShowLine(real('mutmut3-show-b-N.txt'), src, fns.b);
  const lK = mutmutShowLine(real('mutmut3-show-Km.txt'), src, fns['K.m']);
  assert.match(at(l1), /if x > 10/);
  assert.match(at(lN), /return x - 10/);
  assert.notEqual(l1, lN);
  assert.notEqual(lN, fns.b.def);
  assert.match(at(lK), /return x \+ self\.v/);
  assert.equal(mutmutShowLine('no diff here', src, fns.b), null);
});

test('phase 48: two identical expressions in one function resolve by the hunk offset; a shifted guess falls back to the text', async () => {
  const { mutmutShowLine } = await import('../lib/mutparse.mjs');
  const { pythonFunctions } = await import('../lib/pyscan.mjs');
  const src = 'def f(x):\n    y = x + 1\n    z = 0\n    w = x + 1\n    return y + w\n';
  const f = pythonFunctions(src)[0];
  const diff = '# n: survived\n--- m.py\n+++ m.py\n@@ -1,5 +1,5 @@\n def f(x):\n     y = x + 1\n     z = 0\n-    w = x + 1\n+    w = x - 1\n     return y + w\n';
  assert.equal(mutmutShowLine(diff, src, f), 4);
  // a decorator shifts the def line: the offset guess misses, the text search inside the span finds it
  const dsrc = '@deco\ndef f(x):\n    y = x + 1\n    return y\n';
  const df = pythonFunctions(dsrc)[0];
  const d2 = '@@ -1,3 +1,3 @@\n def f(x):\n-    y = x + 1\n+    y = x - 1\n     return y\n';
  assert.equal(mutmutShowLine(d2, dsrc, df), 3);
});

test('phase 48: mutantsFileOffsets + the source def line give the same lines as show for the captured mutants', async () => {
  const { mutantsFileOffsets, mutmutShowLine } = await import('../lib/mutparse.mjs');
  const { pythonFunctions } = await import('../lib/pyscan.mjs');
  const src = real('mutmut3-src-mod.py.txt');
  const fns = Object.fromEntries(pythonFunctions(src).map((f) => [f.qual, f]));
  const off = mutantsFileOffsets(real('mutmut3-mutants-mod.py.txt'));
  assert.equal(Object.keys(off).length, 13);
  assert.equal(fns.b.def + off.x_b__mutmut_1, mutmutShowLine(real('mutmut3-show-b-1.txt'), src, fns.b));
  assert.equal(fns.b.def + off.x_b__mutmut_4, mutmutShowLine(real('mutmut3-show-b-N.txt'), src, fns.b));
  assert.equal(fns['K.m'].def + off['xǁKǁm__mutmut_1'], mutmutShowLine(real('mutmut3-show-Km.txt'), src, fns['K.m']));
  assert.equal(fns.a.def + off.x_a__mutmut_1, 2);
});

test('phase 48: perFileCounts is zero-filled and its grand total equals the input lists', async () => {
  const { parseMutmutResults, perFileCounts } = await import('../lib/mutparse.mjs');
  const r = parseMutmutResults(`${real('mutmut3-results-methods.txt')}    pkg.mod.x_a__mutmut_9: not checked\n    pkg.mod.x_a__mutmut_10: skipped\n`, { scope: ['pkg/mod.py'] });
  const pf = perFileCounts(r);
  assert.deepEqual(Object.keys(pf), ['pkg/mod.py']);
  const row = pf['pkg/mod.py'];
  assert.deepEqual(Object.keys(row), ['killed', 'survived', 'timeout', 'no-coverage', 'error', 'not_run', 'ignored']);
  assert.equal(Object.values(row).reduce((a, b) => a + b, 0), r.mutants.length + r.not_run.length + r.ignored.length);
  assert.equal(row.not_run, 1);
  assert.equal(row.ignored, 1);
  assert.deepEqual(perFileCounts({ mutants: [], not_run: [], ignored: [] }), {});
});

// ---- phase 49 t2: replacement, location, column and killedBy ----
test('parseStryker(stryker-triage.json): replacement, loc, col and killedBy names', async () => {
  const { parseStryker } = await import('../lib/mutparse.mjs');
  const r = parseStryker(fx('stryker-triage.json'), { scope: ['src/a.mjs'] });
  assert.equal(r.mutants.length, 7);
  const byId = Object.fromEntries(r.mutants.map((m) => [m.id, m]));
  assert.equal(byId['1'].replacement, 'a >= b');
  assert.deepEqual(byId['1'].loc, { start: { line: 2, column: 7 }, end: { line: 2, column: 12 } });
  assert.equal(byId['1'].col, 7);
  assert.equal(byId['1'].killedBy, undefined);
  assert.deepEqual(byId['2'].killedBy, ['add subtracts']);
  assert.deepEqual(byId['6'].killedBy, ['log increments']);
  const strings = r.mutants.filter((m) => m.mutator === 'StringLiteral' && m.status === 'survived');
  assert.equal(strings.length, 2);
});

test('parseGremlins(gremlins-triage.json): carries col', async () => {
  const { parseGremlins } = await import('../lib/mutparse.mjs');
  const r = parseGremlins(fx('gremlins-triage.json'), { scope: ['a.go'] });
  assert.deepEqual(r.mutants.map((m) => [m.line, m.col]), [[4, 5], [5, 12], [10, 5], [11, 3], [13, 11]]);
});

test('existing fixtures: old fields unchanged; new fields appear only when the tool gave them', async () => {
  const { parseGremlins, parseMutmutResults, normalize } = await import('../lib/mutparse.mjs');
  const g = parseGremlins(fx('gremlins.json'), { scope: ['a.go'] });
  assert.ok(g.mutants.every((m) => m.replacement === undefined && m.killedBy === undefined));
  const m3 = parseMutmutResults(fx('mutmut3-results.txt'), { scope: ['src/a.py'] });
  assert.ok(m3.mutants.every((m) => m.col === undefined && m.loc === undefined && m.replacement === undefined));
  const n = normalize([{ file: 'a', line: 1, mutator: 'x', status: 'survived', id: '1', col: 3, replacement: 'r' }]);
  assert.equal(n.mutants[0].col, 3);
  assert.equal(n.mutants[0].replacement, 'r');
  const bare = normalize([{ file: 'a', line: 1, mutator: 'x', status: 'survived', id: '1' }]);
  assert.deepEqual(Object.keys(bare.mutants[0]).sort(), ['file', 'id', 'line', 'mutator', 'status']);
});
