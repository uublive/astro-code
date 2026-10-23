// Phase 49 remediate-c1: --survivors on Stryker re-runs exactly the open survivors (a crafted
// incremental file reuses every other result), and mutmut 3 survivors are described from the
// generated mutants/ source, never from a time-capped `mutmut show` (C1, C3, C5).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const report = () => ({ schemaVersion: '1', files: { 'src/a.mjs': { language: 'javascript', source: 'x', mutants: [
  { id: '0', mutatorName: 'EqualityOperator', replacement: 'n >= 1', status: 'Survived', location: { start: { line: 7, column: 10 }, end: { line: 7, column: 15 } } },
  { id: '1', mutatorName: 'EqualityOperator', replacement: 'n <= 1', status: 'Killed', location: { start: { line: 7, column: 10 }, end: { line: 7, column: 15 } } },
  { id: '2', mutatorName: 'EqualityOperator', replacement: 'x >= 100', status: 'Survived', location: { start: { line: 2, column: 7 }, end: { line: 2, column: 14 } } },
] } } });

test('the crafted incremental file holds every mutant except the open survivors', async () => {
  const { craftStrykerIncremental } = await import('../lib/mutate.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ac-inc-'));
  try {
    const runFiles = { strykerReport: join(root, 'r.json'), strykerIncremental: join(root, 'inc.json') };
    writeFileSync(runFiles.strykerReport, JSON.stringify(report()));
    const open = [{ file: 'src/a.mjs', mutator: 'EqualityOperator', replacement: 'n >= 1', loc: { start: { line: 7, column: 10 }, end: { line: 7, column: 15 } } }];
    assert.equal(craftStrykerIncremental(root, runFiles, open), 'inc.json');
    const ids = JSON.parse(readFileSync(runFiles.strykerIncremental, 'utf8')).files['src/a.mjs'].mutants.map((m) => m.id);
    assert.deepEqual(ids, ['1', '2'], 'the killed one and the equivalent-judged one are reused; only the open one runs');
    assert.equal(craftStrykerIncremental(root, { ...runFiles, strykerReport: join(root, 'none.json') }, open), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Stryker --survivors passes the crafted file, or says it is narrower-than-ideal without one', async () => {
  const { MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const row = MUTATION_TOOLS.find((r) => r.id === 'stryker');
  const open = [{ file: 'src/a.mjs', loc: { start: { line: 7, column: 10 }, end: { line: 7, column: 15 } } }];
  const ctx = { root: '/r', bin: 'stryker', config: null };
  const exact = row.buildSurvivors({ ...ctx, incrementalFile: 'x/inc.json' }, open);
  assert.deepEqual(exact.argv.slice(-3), ['--incremental', '--incrementalFile', 'x/inc.json']);
  assert.equal(exact.narrowing.narrowed, 'mutants');
  const loose = row.buildSurvivors(ctx, open);
  assert.ok(!loose.argv.includes('--incremental'));
  assert.match(loose.narrowing.why, /narrower-than-ideal/);
});

test('Gremlins --survivors names the equivalent-judged and killed mutants it cannot avoid re-running', async () => {
  const { MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  const row = MUTATION_TOOLS.find((r) => r.id === 'gremlins');
  const p = row.buildSurvivors({ root: '/r', bin: 'gremlins', reportFile: '/r/g.json', otherGoFiles: [], excluded: [], base: 'abc', diffMode: true }, [{ file: 'a.go', kind: 'CONDITIONALS_BOUNDARY' }]);
  assert.match(p.narrowing.why, /narrower-than-ideal/);
  assert.match(p.narrowing.why, /equivalent-judged/);
});

test('mutmut 3 changes come from the generated source alone: original and replacement line, deterministic', async () => {
  const { mutantsFileChanges } = await import('../lib/mutparse.mjs');
  const gen = [
    'def x_msg__mutmut_orig(x):',
    '    if x < 0:',
    '        log.warning("negative input")',
    '    return x',
    'def x_msg__mutmut_1(x):',
    '    if x < 0:',
    '        log.warning("XXnegative inputXX")',
    '    return x',
    'def x_msg__mutmut_2(x):',
    '    if x <= 0:',
    '        log.warning("negative input")',
    '    return x',
    '',
  ].join('\n');
  const a = mutantsFileChanges(gen);
  const b = mutantsFileChanges(gen);
  assert.deepEqual(a, b);
  assert.equal(a.offsets.x_msg__mutmut_1, 2);
  assert.deepEqual(a.changes.x_msg__mutmut_1, { line_text: '        log.warning("negative input")', replacement_line: '        log.warning("XXnegative inputXX")' });
  assert.deepEqual(a.changes.x_msg__mutmut_2, { line_text: '    if x < 0:', replacement_line: '    if x <= 0:' });
});
