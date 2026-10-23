// Phase 49 t10 — `ac mutate`: survivors grouped by function and kind with text-only changes apart,
// judgements carried from the committed SURVIVORS.json, and `ac mutate judge` (D3, D6; C1-C4).
// Stub Stryker reading tests/fixtures/mutate/stryker-triage.json; real tmp git repos. ADR-018.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, cpSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeProject, installStub, restrictedEnv, commit, sh, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (p, args, o = {}) => spawnSync(process.execPath, [AC, ...args], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 60000, ...o });
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const fixture = () => JSON.parse(readFileSync(join(FX, 'stryker-triage.json'), 'utf8'));
const SOURCE = fixture().files['src/a.mjs'].source;
const survivorFile = (p) => join(p.dir, '.astrocode', 'phases', p.slug1, 'SURVIVORS.json');

// A JS project whose phase 1 wrote src/a.mjs as the fixture's real source, so the fixture's lines
// are real lines. `report(rep)` may reshape the report; `source` the file.
async function rig({ source = SOURCE, report = (r) => r } = {}) {
  const p = await makeProject('js');
  writeFileSync(join(p.dir, 'src', 'a.mjs'), source);
  commit(p.dir, 'feat: real source (phase 1 t2)');
  installStub(p.dir, 'stryker', 'node_modules/.bin');
  const rep = report(fixture());
  p.reportFile = join(p.dir, 'triage-report.json');
  writeFileSync(p.reportFile, JSON.stringify(rep));
  p.env = restrictedEnv([], { MUTATE_STUB_REPORT: p.reportFile });
  return p;
}
const run = (p, ...a) => JSON.parse(ac(p, ['mutate', '1', '--json', ...a]).stdout);
const text = (j) => j.survivors.filter((s) => s.text_only);

test('C1: survivors carry key/fn/kind/text_only/group; groups put both string-literal survivors in g:text-only and add up', async () => {
  const p = await rig();
  try {
    const j = run(p);
    assert.equal(j.survivors.length, 5);
    for (const s of j.survivors) {
      for (const k of ['key', 'fn', 'kind', 'text_only', 'group']) assert.ok(s[k] !== undefined, k);
      assert.match(s.key, /^s:[0-9a-f]{12}$/);
    }
    assert.deepEqual(text(j).map((s) => s.line).sort((a, b) => a - b), [5, 10]);
    assert.deepEqual(text(j).map((s) => s.fn).sort(), ['add', 'log'], 'different functions, one text-only group');
    assert.equal(j.groups.filter((g) => g.text_only).length, 1);
    const g = j.groups.find((x) => x.id === 'g:text-only');
    assert.equal(g.count, 2);
    assert.ok(j.groups.filter((x) => !x.text_only).every((x) => x.keys.every((k) => !text(j).some((s) => s.key === k))));
    assert.equal(j.groups.reduce((n, x) => n + x.count, 0), j.survivors.length);
    assert.deepEqual(j.groups.filter((x) => !x.text_only).map((x) => [x.fn, x.kind]).sort(), [['add', 'EqualityOperator'], ['log', 'ConditionalExpression'], ['log', 'EqualityOperator']]);
    assert.ok(j.survivors.filter((s) => !s.text_only).every((s) => j.groups.some((x) => x.id === s.group)));
    // the kept run holds the keys too (the gate's binding fields are unchanged)
    const kept = JSON.parse(readFileSync(join(p.dir, '.astrocode', '.local', 'mutate-runs', `${p.slug1}.json`), 'utf8'));
    assert.ok(kept.survivors.every((s) => s.key && s.group && s.id));
  } finally { done(p); }
});

test('C1: the human output prints group headers, not a flat list; 30 groups print 20 and "+10 more groups"', async () => {
  const lines = Array.from({ length: 30 }, (_, i) => `export function f${i}() { return ${i} + 1; }`);
  const p = await rig({
    source: `${lines.join('\n')}\n`,
    report: (rep) => {
      rep.files['src/a.mjs'].mutants = lines.map((_, i) => ({ id: String(i + 1), mutatorName: 'ArithmeticOperator', replacement: `${i} - 1`, location: { start: { line: i + 1, column: 33 }, end: { line: i + 1, column: 38 } }, status: 'Survived' }));
      return rep;
    },
  });
  try {
    const h = ac(p, ['mutate', '1']).stdout;
    assert.match(h, /^survivors: 30 in 30 groups — 0 judged, 30 open$/m);
    assert.equal(h.split('\n').filter((l) => /^⚠ src\/a\.mjs · f\d+ · ArithmeticOperator — 1 open \[g:/.test(l)).length, 20);
    assert.match(h, /^\+10 more groups — ac mutate 1 --json$/m);
    assert.doesNotMatch(h, /survived$/m, 'no flat per-survivor line');
  } finally { done(p); }
});

test('C2: nothing is judged before a note; one note covers exactly the text-only group; a later string survivor stays open; bad notes are refused', async () => {
  const p = await rig();
  try {
    const before = run(p);
    assert.equal(before.triage.judged, 0);
    assert.ok(before.survivors.every((s) => !s.judged && s.triage === undefined));
    // refusals write nothing
    const bad = (...a) => { const r = ac(p, ['mutate', 'judge', '1', ...a]); assert.notEqual(r.status, 0, a.join(' ')); assert.equal(existsSync(survivorFile(p)), false); return r; };
    bad('g:text-only', '--equivalent', '');
    bad('g:text-only', '--equivalent=');
    bad('s:ffffffffffff', '--equivalent', 'why');
    bad('g:text-only');
    bad('g:text-only', '--equivalent', 'why', '--test-gap');
    bad('--equivalent', 'why');
    const ok = ac(p, ['mutate', 'judge', '1', 'g:text-only', '--equivalent', 'user-facing text only; not asserted by design']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /written, not committed/);
    const j = run(p);
    assert.deepEqual(text(j).map((s) => [s.triage, s.judged, s.justification]), Array(2).fill(['equivalent', true, 'user-facing text only; not asserted by design']));
    assert.ok(j.survivors.filter((s) => !s.text_only).every((s) => s.triage === undefined && !s.judged), 'logic survivors stay open');
    assert.deepEqual([j.triage.judged, j.triage.open, j.triage.untriaged], [2, 3, 3]);
    // a string-literal survivor that did not exist when the note was written is open, not inherited
    const p2 = fixture();
    p2.files['src/a.mjs'].mutants.push({ id: '8', mutatorName: 'StringLiteral', replacement: '"Stryker was here!"', location: { start: { line: 10, column: 17 }, end: { line: 10, column: 29 } }, status: 'Survived', coveredBy: ['t1'] });
    writeFileSync(p.reportFile, JSON.stringify(p2));
    const k = run(p);
    assert.equal(text(k).length, 3);
    assert.equal(text(k).filter((s) => s.judged).length, 2);
    assert.equal(text(k).filter((s) => !s.judged && s.triage === undefined).length, 1);
    assert.equal(k.groups.find((g) => g.id === 'g:text-only').open, 1);
  } finally { done(p); }
});

test('C3: SURVIVORS.json is in the phase folder, not ignored, and a fresh clone sees the same triage; the human output separates judged from open', async () => {
  const p = await rig();
  let clone;
  try {
    const j0 = run(p);
    const logic = j0.survivors.filter((s) => !s.text_only);
    assert.equal(ac(p, ['mutate', 'judge', '1', 'g:text-only', '--equivalent', 'text only']).status, 0);
    assert.equal(ac(p, ['mutate', 'judge', '1', logic[0].key, '--test-gap', 'needs a boundary test']).status, 0);
    const f = survivorFile(p);
    assert.notEqual(sh(p.dir, 'check-ignore', '-q', f).status, 0);
    assert.match(sh(p.dir, 'status', '--porcelain', '--', f).stdout, /SURVIVORS\.json/);
    sh(p.dir, 'add', '--', '.astrocode/phases'); sh(p.dir, 'commit', '-q', '-m', 'chore: judgements');
    const dir = join(p.dir, '..', `clone-${Date.now()}`);
    assert.equal(spawnSync('git', ['clone', '-q', p.dir, dir], { encoding: 'utf8' }).status, 0);
    clone = { dir, slug1: p.slug1, env: p.env };
    installStub(dir, 'stryker', 'node_modules/.bin');
    const a = run(p);
    const b = run(clone);
    const pick = (j) => j.survivors.map((s) => [s.key, s.triage, s.justification, s.judged]).sort();
    assert.deepEqual(pick(b), pick(a));
    assert.equal(b.triage.judged, 2);
    assert.equal(b.triage.test_gap, 1);
    assert.equal(b.triage.open, b.survivors.length - 2, 'open = total - judged (a test-gap is recorded but open)');
    const h = ac(clone, ['mutate', '1']).stdout;
    assert.match(h, /^judged \(SURVIVORS\.json\): 2 equivalent$/m);
    assert.match(h, /^open: 3 \(1 test-gap, 2 untriaged\)$/m);
    assert.match(h, /\(test-gap\)/);
  } finally { done(p); if (clone) done(clone); }
});

test('C4: lines inserted above keep every judgement; editing one judged line re-opens only that survivor', async () => {
  const p = await rig();
  try {
    const j0 = run(p);
    const eqs = j0.survivors.filter((s) => s.kind === 'EqualityOperator');
    assert.equal(eqs.length, 2);
    assert.equal(ac(p, ['mutate', 'judge', '1', ...eqs.map((s) => s.key), '--equivalent', 'both comparisons are guards']).status, 0);
    // (a) three lines inserted above: the stub report shifts to match
    const shifted = fixture();
    for (const m of shifted.files['src/a.mjs'].mutants) { m.location.start.line += 3; m.location.end.line += 3; }
    writeFileSync(p.reportFile, JSON.stringify(shifted));
    writeFileSync(join(p.dir, 'src', 'a.mjs'), `// one\n// two\n// three\n${SOURCE}`);
    commit(p.dir, 'refactor: shift (phase 1 t3)');
    const j1 = run(p);
    assert.deepEqual(j1.survivors.filter((s) => s.kind === 'EqualityOperator').map((s) => [s.key, s.judged]).sort(), eqs.map((s) => [s.key, true]).sort());
    assert.equal(j1.triage.stale, 0);
    assert.equal(j1.triage.judged, 2);
    // (b) the judged line of add() is edited: that one re-opens, the other keeps its judgement
    writeFileSync(join(p.dir, 'src', 'a.mjs'), `// one\n// two\n// three\n${SOURCE.replace('if (a > b) {', 'if (a > b + 0) {')}`);
    commit(p.dir, 'fix: edit (phase 1 t4)');
    const j2 = run(p);
    const add = j2.survivors.find((s) => s.fn === 'add' && s.kind === 'EqualityOperator');
    const lg = j2.survivors.find((s) => s.fn === 'log' && s.kind === 'EqualityOperator');
    assert.equal(add.judged, undefined);
    assert.equal(add.triage, undefined);
    assert.equal(lg.judged, true);
    assert.equal(j2.triage.stale, 1, 'the old judgement is kept in the file, not pruned');
    assert.equal(JSON.parse(readFileSync(survivorFile(p), 'utf8')).judgements.length, 2);
  } finally { done(p); }
});

test('mutmut 3: the show diff\'s + line is kept as replacement_line; kind and text_only come from it', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const REAL = join(FX, 'real');
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
    const env = restrictedEnv([bin], { MUTATE_STUB_VERSION: 'mutmut, version 3.8.0', MUTATE_STUB_REPORT: join(REAL, 'mutmut3-results-methods.txt'), MUTATE_STUB_SHOW: show, MUTATE_STUB_MUTANTS: join(p.dir, 'gen') });
    const r = await runMutate(p.dir, findPhase(p.dir, '5').slug, { env });
    const b1 = r.survivors.find((s) => s.name === 'pkg.mod.x_b__mutmut_1');
    assert.match(b1.replacement_line, /if x >= 10:/);
    assert.match(b1.line_text, /if x > 10:/);
    assert.equal(b1.kind, '`>` → `>=`');
    assert.equal(b1.text_only, false);
    assert.equal(b1.fn, 'b');
    assert.ok(r.survivors.every((s) => /^s:[0-9a-f]{12}$/.test(s.key)));
    assert.equal(new Set(r.survivors.map((s) => s.key)).size, r.survivors.length);
  } finally { done(p); }
});

test('the phase-47/48 binding is untouched: the kept run still matches the evidence fields, and the gate reads only them', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const p = await rig();
  try {
    const j = run(p);
    writeFileSync(join(p.dir, '.astrocode', 'phases', p.slug1, 'CRITERIA.md'), '### C1 [mutation] — strong\n');
    const sv = j.survivors.map(({ file, line, mutator, status, id }) => ({ file, line, mutator, status, id, triage: 'equivalent', justification: 'ok' }));
    const ev = { outcome: j.outcome, tool: 'stryker', head: j.head, capped: false, complete: true, counts: j.counts, survivors: sv, fallback: null };
    const out = await recordVerdict(p.dir, p.slug1, { mode: 'full', criteria: [{ id: 'C1', passed: true, mutation: ev }] });
    assert.equal(out.passed, true, JSON.stringify(out.refused));
  } finally { done(p); }
});
