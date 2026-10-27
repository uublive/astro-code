// Phase 51 t1 — the full mutant list carries each mutant's exact change (P1), so `ac verify
// calibrate` can plant a mutant without re-running the tool. Real tmp git projects with the stub
// tools of tests/fixtures/mutate; modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, installStub, restrictedEnv, commit, FX } from './fixtures/mutate/project.mjs';

const REAL = join(FX, 'real');
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const readList = (p, r) => readFileSync(join(p.dir, r.full_list), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

async function mutmutRig({ withGenerated = true } = {}) {
  const { addPhase, findPhase } = await import('../lib/roadmap.mjs');
  const src = readFileSync(join(REAL, 'mutmut3-src-mod.py.txt'), 'utf8');
  const p = await makeProject('py');
  await addPhase(p.dir, { number: 5, name: 'Lines' });
  mkdirSync(join(p.dir, 'pkg'), { recursive: true });
  writeFileSync(join(p.dir, 'pkg', 'mod.py'), src.replace('return x * 2', 'return x * 3').replace('return x + self.v', 'return x + self.v + 1'));
  commit(p.dir, 'baseline');
  writeFileSync(join(p.dir, 'pkg', 'mod.py'), src);
  commit(p.dir, 'work (phase 5 t1)');
  const show = join(p.dir, 'show'); mkdirSync(show);
  copyFileSync(join(REAL, 'mutmut3-show-b-1.txt'), join(show, 'pkg.mod.x_b__mutmut_1.diff'));
  copyFileSync(join(REAL, 'mutmut3-show-b-N.txt'), join(show, 'pkg.mod.x_b__mutmut_4.diff'));
  copyFileSync(join(REAL, 'mutmut3-show-Km.txt'), join(show, 'pkg.mod.xǁKǁm__mutmut_1.diff'));
  const gen = join(p.dir, 'gen', 'pkg'); mkdirSync(gen, { recursive: true });
  copyFileSync(join(REAL, 'mutmut3-mutants-mod.py.txt'), join(gen, 'mod.py'));
  const bin = installStub(p.dir, 'mutmut', 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.env = restrictedEnv([bin], {
    MUTATE_STUB_LOG: p.log, MUTATE_STUB_VERSION: 'mutmut, version 3.8.0', MUTATE_STUB_REPORT: join(REAL, 'mutmut3-results-methods.txt'),
    MUTATE_STUB_SHOW: show, ...(withGenerated ? { MUTATE_STUB_MUTANTS: join(p.dir, 'gen') } : {}),
  });
  p.slug = findPhase(p.dir, '5').slug;
  p.src = src;
  return p;
}

test('mutantsFileChanges reports a multi-line mutant in `multi` and leaves `changes` entries unchanged', async () => {
  const { mutantsFileChanges } = await import('../lib/mutparse.mjs');
  const gen = [
    'def x_f__mutmut_orig(x):',
    '    a = x + 1',
    '    return a',
    'def x_f__mutmut_1(x):',
    '    a = x - 1',
    '    return a',
    'def x_f__mutmut_2(x):',
    '    a = x - 1',
    '    return a + 1',
    'def x_f__mutmut_3(x):',
    '    a = x + 1',
    '    b = 2',
    '    return a',
    '',
  ].join('\n');
  const r = mutantsFileChanges(gen);
  assert.deepEqual(r.multi, { x_f__mutmut_2: true, x_f__mutmut_3: true });
  assert.deepEqual(r.changes.x_f__mutmut_1, { line_text: '    a = x + 1', replacement_line: '    a = x - 1' });
  assert.equal(r.offsets.x_f__mutmut_1, 1);
});

test('a mutmut 3 run\'s list gives every in-scope killed and survived mutant its key, fn, kind, raw line_text, replacement_line and exact:true', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await mutmutRig();
  try {
    const r = await runMutate(p.dir, p.slug, { env: p.env });
    const inScope = readList(p, r).filter((m) => m.scope === 'in' && ['killed', 'survived'].includes(m.status));
    assert.ok(inScope.length >= 4, `${inScope.length} in-scope mutants`);
    for (const m of inScope) {
      assert.match(m.key, /^s:[0-9a-f]{12}$/);
      assert.equal(typeof m.fn, 'string');
      assert.equal(typeof m.kind, 'string');
      assert.equal(typeof m.line_text, 'string');
      assert.equal(typeof m.replacement_line, 'string');
      assert.equal(m.exact, true, m.mutator);
    }
    const b4 = inScope.find((m) => m.mutator === 'x_b__mutmut_4');
    assert.equal(b4.line_text, '        return x - 10', 'the raw line keeps its indentation');
    assert.equal(b4.replacement_line, '        return x - 11');
    assert.equal(b4.line_text, p.src.split('\n')[b4.line - 1]);
  } finally { done(p); }
});

test('a mutmut mutant described only by `mutmut show` is exact:false', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await mutmutRig({ withGenerated: false });
  try {
    const r = await runMutate(p.dir, p.slug, { env: p.env });
    const shown = readList(p, r).filter((m) => m.scope === 'in' && m.status === 'survived' && typeof m.replacement_line === 'string');
    assert.ok(shown.length >= 1);
    assert.ok(shown.every((m) => m.exact === false));
  } finally { done(p); }
});

test('the list key equals the survivor key the kept run records for the same mutant', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const p = await mutmutRig();
  try {
    const r = await runMutate(p.dir, p.slug, { env: p.env });
    const list = readList(p, r);
    assert.ok(r.survivors.length >= 2);
    for (const s of r.survivors) {
      const l = list.find((m) => m.scope === 'in' && m.mutator === s.mutator && m.file === s.file);
      assert.equal(l.key, s.key, s.mutator);
    }
  } finally { done(p); }
});

test('a Stryker run\'s list gives every in-scope mutant its key, replacement and loc as reported', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { findPhase } = await import('../lib/roadmap.mjs');
  const rep = JSON.parse(readFileSync(join(FX, 'stryker-triage.json'), 'utf8'));
  const p = await makeProject('js');
  try {
    writeFileSync(join(p.dir, 'src', 'a.mjs'), rep.files['src/a.mjs'].source);
    commit(p.dir, 'feat: real source (phase 1 t2)');
    installStub(p.dir, 'stryker', 'node_modules/.bin');
    const reportFile = join(p.dir, 'rep.json');
    writeFileSync(reportFile, JSON.stringify(rep));
    const env = restrictedEnv([], { MUTATE_STUB_REPORT: reportFile });
    const r = await runMutate(p.dir, findPhase(p.dir, '1').slug, { env });
    const list = readList(p, r).filter((m) => m.scope === 'in');
    assert.equal(list.length, rep.files['src/a.mjs'].mutants.length);
    for (const m of list) {
      const o = rep.files['src/a.mjs'].mutants.find((x) => String(x.id) === String(m.id));
      assert.match(m.key, /^s:[0-9a-f]{12}$/);
      assert.equal(m.replacement, o.replacement);
      assert.deepEqual(m.loc, o.location);
    }
    for (const s of r.survivors) assert.equal(list.find((m) => m.id === s.id).key, s.key);
  } finally { done(p); }
});

test('a Gremlins list is unchanged', async () => {
  const { runMutate } = await import('../lib/mutate.mjs');
  const { findPhase } = await import('../lib/roadmap.mjs');
  const p = await makeProject('go');
  try {
    const bin = installStub(p.dir, 'gremlins', 'stubbin');
    const env = restrictedEnv([bin], { MUTATE_STUB_REPORT: join(FX, 'gremlins.json') });
    const r = await runMutate(p.dir, findPhase(p.dir, '1').slug, { env });
    const list = readList(p, r).filter((m) => m.scope === 'in');
    assert.ok(list.length > 0);
    for (const m of list) {
      assert.deepEqual(Object.keys(m).filter((k) => !['file', 'line', 'mutator', 'status', 'id', 'scope', 'key', 'fn', 'kind'].includes(k)), [], 'no patch fields');
    }
  } finally { done(p); }
});
