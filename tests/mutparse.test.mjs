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
      assert.ok(m.file && m.mutator && Number.isInteger(m.line), JSON.stringify(m));
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
