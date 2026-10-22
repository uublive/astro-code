// lib/survivors.mjs (phase 49 t7): identity key, text-only detection, groups, the judgements file.
// Real tmp dirs and real git; modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SRC = ['export function add(a, b) {', '  if (a > b) {', '    return a - b;', '  }', "  throw new Error('negative result');", '}', ''].join('\n');
const mut = (o = {}) => ({ file: 'src/a.mjs', line: 2, mutator: 'EqualityOperator', status: 'survived', id: '1', replacement: 'a >= b', col: 7, ...o });
const lineOf = (text, n) => text.split('\n')[n - 1];
const desc = async (m, text, o = {}) => {
  const { describeMutant } = await import('../lib/survivors.mjs');
  const { enclosingFunction } = await import('../lib/funcscan.mjs');
  return describeMutant(m, { lineText: lineOf(text, m.line), fn: enclosingFunction(m.file, text, m.line), textKinds: ['StringLiteral'], tool: 'stryker', ...o });
};

test('key: a line shift above the function and a re-indent keep it; an edit of the line or another function changes it', async () => {
  const base = await desc(mut(), SRC);
  assert.match(base.key, /^s:[0-9a-f]{12}$/);
  assert.equal(base.fn, 'add');
  const shifted = `// 1\n// 2\n// 3\n// 4\n// 5\n${SRC}`;
  assert.equal((await desc(mut({ line: 7 }), shifted)).key, base.key, 'the line number is in no key input');
  const reindented = SRC.replace('  if (a > b) {', '    if (a > b) {');
  assert.equal((await desc(mut({ col: 9 }), reindented)).key, base.key, 're-indenting keeps it (line trimmed, column relative)');
  const edited = SRC.replace('if (a > b)', 'if (a > b + 1)');
  assert.notEqual((await desc(mut(), edited)).key, base.key, 'editing the mutated line re-opens it');
  const inOther = SRC.replace('export function add', 'export function plus');
  assert.notEqual((await desc(mut(), inOther)).key, base.key, 'moving to another function changes it');
  assert.notEqual((await desc(mut({ col: 12 }), SRC)).key, base.key, 'two columns on one line are two mutants');
  assert.notEqual((await desc(mut({ replacement: 'true' }), SRC)).key, base.key, 'two replacements are two mutants');
});

test('key: a tool with neither column nor replacement uses the all-mutants ordinal; a killed sibling does not shift it', async () => {
  const { describeAll } = await import('../lib/survivors.mjs');
  const mk = (id, status) => ({ file: 'src/a.mjs', line: 2, mutator: 'mutmut_x', status, id });
  const sources = { 'src/a.mjs': SRC };
  const all = [mk('1', 'killed'), mk('2', 'survived'), mk('3', 'survived')];
  const a = describeAll(all, { tool: 'mutmut', sources });
  const keys = a.map((d) => d.key);
  assert.equal(new Set(keys).size, 3, 'same line, no column, no replacement: the ordinal tells them apart');
  // the first sibling is now a survivor instead of killed: the others keep their keys
  const b = describeAll([mk('1', 'survived'), mk('2', 'survived'), mk('3', 'survived')], { tool: 'mutmut', sources });
  assert.deepEqual(b.map((d) => d.key), keys);
  assert.equal(a[0].kind, 'unknown');
});

test('isTextOnly: StringLiteral and a literal-only mutmut change are; a code change, a literal swapped for code and Gremlins are not', async () => {
  const { isTextOnly, literalOnlyChange } = await import('../lib/survivors.mjs');
  assert.equal(isTextOnly({ mutator: 'StringLiteral' }, ['StringLiteral']), true);
  assert.equal(isTextOnly({ mutator: 'EqualityOperator' }, ['StringLiteral']), false);
  assert.equal(isTextOnly({ mutator: 'x', line_text: '    return "bad"', replacement_line: '    return "XXbadXX"' }), true);
  assert.equal(isTextOnly({ mutator: 'x', line_text: '    if x > "a":', replacement_line: '    if x >= "a":' }), false);
  assert.equal(isTextOnly({ mutator: 'x', line_text: '    raise ValueError("bad")', replacement_line: '    raise ValueError(None)' }), false);
  assert.equal(isTextOnly({ mutator: 'CONDITIONALS_BOUNDARY', line: 4 }, []), false);
  assert.equal(literalOnlyChange('log("a", 1)', 'log("b", 1)'), true);
  assert.equal(literalOnlyChange('log("a", 1)', 'log("a", 2)'), false);
  assert.equal(literalOnlyChange('log("a")', 'log("a")'), false);
});

test('diffKind: the minimal differing token pair', async () => {
  const { diffKind } = await import('../lib/survivors.mjs');
  assert.equal(diffKind('    if x > 10:', '    if x >= 10:'), '`>` → `>=`');
  assert.equal(diffKind('return x - 10', 'return x + 10'), '`-` → `+`');
  assert.equal(diffKind('a = 1', 'a = 1'), 'unknown');
  assert.equal(diffKind(undefined, 'a'), 'unknown');
});

const surv = (o = {}) => ({ file: 'src/a.mjs', fn: 'add', kind: 'EqualityOperator', text_only: false, key: 's:000000000001', ...o });

test('groupSurvivors: one g:text-only group across functions; logic by (file, fn, kind); counts add up; ids deterministic', async () => {
  const { groupSurvivors, describeMutant } = await import('../lib/survivors.mjs');
  const a = describeMutant(mut(), { lineText: lineOf(SRC, 2), fn: 'add', textKinds: ['StringLiteral'], tool: 'stryker' });
  const b = describeMutant(mut({ mutator: 'ArithmeticOperator', line: 3 }), { lineText: lineOf(SRC, 3), fn: 'add', tool: 'stryker' });
  const t1 = describeMutant(mut({ mutator: 'StringLiteral', line: 5 }), { lineText: lineOf(SRC, 5), fn: 'add', textKinds: ['StringLiteral'], tool: 'stryker' });
  const t2 = describeMutant(mut({ mutator: 'StringLiteral', line: 9 }), { lineText: 'log("zero")', fn: 'log', textKinds: ['StringLiteral'], tool: 'stryker' });
  assert.equal(t1.group, 'g:text-only'); assert.equal(t2.group, 'g:text-only');
  const list = [
    { ...mut(), ...a }, { ...mut({ line: 3 }), ...b },
    { ...mut({ line: 5 }), ...t1 }, { ...mut({ line: 9 }), ...t2 },
  ];
  const groups = groupSurvivors(list);
  assert.equal(groups.length, 3);
  assert.equal(groups.at(-1).id, 'g:text-only');
  assert.equal(groups.at(-1).count, 2);
  assert.deepEqual(groups.at(-1).keys.sort(), [t1.key, t2.key].sort());
  assert.equal(groups.reduce((n, g) => n + g.count, 0), list.length);
  assert.ok(groups.slice(0, -1).every((g) => !g.text_only && !g.keys.includes(t1.key) && !g.keys.includes(t2.key)));
  assert.deepEqual(groupSurvivors([...list].reverse()).map((g) => g.id), groups.map((g) => g.id));
  assert.ok(groups.some((g) => g.id === a.group && g.kind === 'EqualityOperator'));
});

test('groupSurvivors: open counts are untriaged + test-gap, equivalent needs a justification', async () => {
  const { groupSurvivors } = await import('../lib/survivors.mjs');
  const g = groupSurvivors([
    surv({ key: 's:1' }), surv({ key: 's:2', triage: 'equivalent', justification: 'dead branch' }),
    surv({ key: 's:3', triage: 'test-gap' }), surv({ key: 's:4', triage: 'equivalent', justification: '' }),
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].count, g[0].open, g[0].equivalent, g[0].test_gap], [4, 3, 1, 1]);
});

// ---- the judgements file ----
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
async function repo() {
  const { initPlanning } = await import('../lib/planning.mjs');
  const root = mkdtempSync(join(tmpdir(), 'surv-'));
  sh(root, 'init', '-q'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't');
  initPlanning(root, { name: 'p' });
  mkdirSync(join(root, '.astrocode', 'phases', '49-x'), { recursive: true });
  return root;
}
const keptRun = async (root, survivors) => {
  const { saveMutateRun } = await import('../lib/verdict.mjs');
  saveMutateRun(root, '49-x', { head: 'h', tool: { id: 'stryker' }, outcome: 'survivors', complete: true, counts: { killed: 1, survived: survivors.length, timeout: 0, 'no-coverage': 0, error: 0 }, survivors });
};
const ks = (n, o = {}) => ({ file: 'src/a.mjs', line: n, mutator: 'EqualityOperator', status: 'survived', id: String(n), key: `s:00000000000${n}`, fn: 'add', kind: 'EqualityOperator', line_text: `x${n}`, group: 'g:aaa', ...o });
const done = (r) => rmSync(r, { recursive: true, force: true });

test('recordJudgements: a group id expands to explicit per-key entries; unknown ids and bad justifications are refused', async () => {
  const { recordJudgements, readJudgements, survivorsFile } = await import('../lib/survivors.mjs');
  const root = await repo();
  try {
    await keptRun(root, [ks(1), ks(2), ks(3, { group: 'g:text-only', text_only: true }), ks(4, { group: 'g:text-only', text_only: true })]);
    const w = await recordJudgements(root, '49-x', { ids: ['g:text-only'], triage: 'equivalent', justification: 'user-facing text only' });
    assert.equal(w.written, 2);
    const { judgements } = readJudgements(survivorsFile(root, '49-x'));
    assert.deepEqual(judgements.map((j) => j.key), ['s:000000000003', 's:000000000004']);
    assert.ok(judgements.every((j) => j.group === 'g:text-only' && j.triage === 'equivalent' && j.justification && j.at));
    const before = readFileSync(survivorsFile(root, '49-x'), 'utf8');
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['s:ffffffffffff'], triage: 'equivalent', justification: 'x' }), /unknown survivor/);
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['g:nope'], triage: 'equivalent', justification: 'x' }), /unknown group/);
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['s:000000000001'], triage: 'equivalent', justification: '' }), /justification/);
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['s:000000000001'], triage: 'equivalent', justification: 'a\nb' }), /justification/);
    assert.equal(readFileSync(survivorsFile(root, '49-x'), 'utf8'), before, 'a refused judgement writes nothing');
    // a test-gap note is optional; the file sorts by key and holds no untriaged entry
    await recordJudgements(root, '49-x', { ids: ['s:000000000002', 's:000000000001'], triage: 'test-gap' });
    const all = readJudgements(survivorsFile(root, '49-x')).judgements;
    assert.deepEqual(all.map((j) => j.key), [...all.map((j) => j.key)].sort());
    assert.equal(all.length, 4);
    assert.equal(all.find((j) => j.key === 's:000000000001').justification, undefined);
  } finally { done(root); }
});

test('recordJudgements: no kept run, or one from before this phase with no keys, says to run ac mutate first', async () => {
  const { recordJudgements } = await import('../lib/survivors.mjs');
  const root = await repo();
  try {
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['s:1'], triage: 'test-gap' }), /ac mutate <n>/);
    await keptRun(root, [{ file: 'a', line: 1, mutator: 'm', status: 'survived', id: '1' }]);
    await assert.rejects(recordJudgements(root, '49-x', { ids: ['s:1'], triage: 'test-gap' }), /ac mutate <n>/);
  } finally { done(root); }
});

test('readJudgements is total: hand-edited invalid entries are reported and never applied; a corrupt file gives a reason', async () => {
  const { readJudgements, applyJudgements, survivorsFile } = await import('../lib/survivors.mjs');
  const root = await repo();
  try {
    const f = survivorsFile(root, '49-x');
    assert.deepEqual(readJudgements(f), { judgements: [], invalid: [], reason: null });
    writeFileSync(f, JSON.stringify({ version: 1, judgements: [
      { key: 's:1', triage: 'equivalent', justification: 'ok' },
      { key: 's:2', triage: 'equivalent' }, { key: 's:3', triage: 'fine', justification: 'x' }, { key: 's:4', triage: 'equivalent', justification: 'a\nb' }, 7,
    ] }));
    const r = readJudgements(f);
    assert.equal(r.judgements.length, 1);
    assert.equal(r.invalid.length, 4);
    const applied = applyJudgements([{ key: 's:2' }, { key: 's:1' }], r.judgements);
    assert.equal(applied.survivors[0].triage, undefined, 'an invalid entry is never applied');
    assert.equal(applied.survivors[1].triage, 'equivalent');
    for (const body of ['{bad', '{"version":2,"judgements":[]}', '[]']) {
      writeFileSync(f, body);
      const bad = readJudgements(f);
      assert.deepEqual(bad.judgements, []); assert.ok(bad.reason);
    }
  } finally { done(root); }
});

test('applyJudgements: a survivor added after a group note stays open; stale entries are counted, never pruned; test-gap is recorded but open', async () => {
  const { applyJudgements, groupSurvivors, recordJudgements, readJudgements, survivorsFile } = await import('../lib/survivors.mjs');
  const root = await repo();
  try {
    await keptRun(root, [ks(1, { group: 'g:text-only', text_only: true }), ks(2, { group: 'g:text-only', text_only: true }), ks(3)]);
    await recordJudgements(root, '49-x', { ids: ['g:text-only'], triage: 'equivalent', justification: 'text' });
    await recordJudgements(root, '49-x', { ids: ['s:000000000003'], triage: 'test-gap', justification: 'needs a test' });
    const { judgements } = readJudgements(survivorsFile(root, '49-x'));
    const fresh = ks(9, { group: 'g:text-only', text_only: true, key: 's:00000000009f' });
    const { survivors, stale } = applyJudgements([ks(2, { group: 'g:text-only', text_only: true }), ks(3), fresh], judgements);
    assert.equal(stale, 1, 'the judged mutant that no longer exists');
    assert.equal(survivors[0].triage, 'equivalent'); assert.equal(survivors[0].judged, true);
    assert.equal(survivors[1].triage, 'test-gap'); assert.equal(survivors[1].judged, true);
    assert.equal(survivors[2].triage, undefined, 'the new survivor is not covered by the older group note');
    assert.equal(survivors[2].judged, undefined);
    const g = groupSurvivors(survivors.map((s) => ({ ...s })));
    assert.equal(g.find((x) => x.id === 'g:text-only').open, 1);
    assert.equal(readJudgements(survivorsFile(root, '49-x')).judgements.length, 3, 'nothing pruned');
  } finally { done(root); }
});

test('the judgements file is inside the phase folder and git does not ignore it', async () => {
  const { survivorsFile, recordJudgements } = await import('../lib/survivors.mjs');
  const root = await repo();
  try {
    const f = survivorsFile(root, '49-x');
    assert.equal(f, join(root, '.astrocode', 'phases', '49-x', 'SURVIVORS.json'));
    await keptRun(root, [ks(1)]);
    await recordJudgements(root, '49-x', { ids: ['s:000000000001'], triage: 'equivalent', justification: 'x' });
    assert.notEqual(sh(root, 'check-ignore', '-q', f).status, 0);
    assert.match(sh(root, 'status', '--porcelain', '--', f).stdout, /SURVIVORS\.json/);
  } finally { done(root); }
});
