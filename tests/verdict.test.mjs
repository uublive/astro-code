// Phase 45 t1 — saved verdicts, the narrowing decision and the verified gate (ADR-079).
// Real tmp dirs and real git; the module is reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '01-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const commitFile = (cwd, name, body = 'x') => {
  writeFileSync(join(cwd, name), body);
  sh(cwd, 'add', '-A');
  sh(cwd, 'commit', '-q', '-m', `add ${name}`);
  return head(cwd);
};

function sandbox(n = 9) {
  const root = mkdtempSync(join(tmpdir(), 'verdict-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  mkdirSync(dir, { recursive: true });
  const crit = Array.from({ length: n }, (_, i) => `### C${i + 1} — thing ${i + 1}\n- **Observe:** x\n`).join('\n');
  writeFileSync(join(dir, 'CRITERIA.md'), `# Criteria\n\n${crit}`);
  const a = commitFile(root, 'a.txt');
  return { root, dir, a, crit: join(dir, 'CRITERIA.md'), vfile: join(dir, 'VERDICT.json') };
}
const res = (ids, failed = [], extra = {}) => ({
  mode: 'full', criteria: ids.map((id) => ({ id, passed: !failed.includes(id) })), ...extra,
});
const ids9 = Array.from({ length: 9 }, (_, i) => `C${i + 1}`);
const done = (s) => rmSync(s.root, { recursive: true, force: true });

test('parseCriteriaIds returns unique heading ids in order and ignores prose mentions', async () => {
  const { parseCriteriaIds } = await import('../lib/verdict.mjs');
  const t = '### C2 — b\nsee C3 here\n## C1 — a\n### C2 — dup\nC9 plain\n';
  assert.deepEqual(parseCriteriaIds(t), ['C2', 'C1']);
});

test('criteriaHash is stable, sha256-prefixed, and changes on a one-character edit', async () => {
  const { criteriaHash } = await import('../lib/verdict.mjs');
  assert.equal(criteriaHash('abc'), criteriaHash('abc'));
  assert.match(criteriaHash('abc'), /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(criteriaHash('abc'), criteriaHash('abd'));
});

test('readVerdict is total: missing, bad json, wrong version and bad shape give null plus a reason', async () => {
  const { readVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    const r0 = readVerdict(s.vfile);
    assert.equal(r0.verdict, null); assert.ok(r0.reason);
    for (const body of ['{bad json', '{"version":2}', '{"version":1,"run":1,"mode":"full","criteria":"no"}']) {
      writeFileSync(s.vfile, body);
      const r = readVerdict(s.vfile);
      assert.equal(r.verdict, null); assert.ok(r.reason);
    }
  } finally { done(s); }
});

test('recordVerdict saves a committed, un-ignored verdict whose commit is the graded HEAD', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    const out = await recordVerdict(s.root, SLUG, res(ids9, ['C2', 'C5']));
    assert.equal(out.recorded, true); assert.equal(out.run, 1);
    assert.equal(out.passed, false); assert.deepEqual(out.failing, ['C2', 'C5']);
    assert.equal(out.committed, true);
    const v = JSON.parse(readFileSync(s.vfile, 'utf8'));
    assert.equal(v.version, 1); assert.equal(v.mode, 'full'); assert.equal(v.commit, s.a);
    assert.match(v.criteria_sha, /^sha256:/); assert.ok(v.at);
    assert.equal(v.criteria.length, 9);
    assert.equal(sh(s.root, 'check-ignore', '-q', s.vfile).status, 1);
    assert.match(sh(s.root, 'log', '-1', '--format=%s').stdout, /^chore\(verdict\): phase 01 run 1/);
    assert.doesNotMatch(sh(s.root, 'log', '-1', '--format=%s').stdout, /\(phase \d+ t\d+\)/);
    assert.equal(sh(s.root, 'status', '--porcelain', '--', s.vfile).stdout.trim(), '');
    assert.equal(sh(s.root, 'rev-parse', 'HEAD~1').stdout.trim(), v.commit);
  } finally { done(s); }
});

test('a full run records an unreported id as failed', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    const out = await recordVerdict(s.root, SLUG, res(ids9.slice(1)));
    assert.deepEqual(out.failing, ['C1']); assert.equal(out.passed, false);
  } finally { done(s); }
});

test('a narrowed run carries unreported ids from the prior run, and carried-of-carried keeps the original source', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C3', 'C7']));
    const out = await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C3', passed: false }, { id: 'C7', passed: true }] });
    assert.equal(out.mode, 'narrowed'); assert.equal(out.passed, false);
    const v = JSON.parse(readFileSync(s.vfile, 'utf8'));
    const c1 = v.criteria.find((c) => c.id === 'C1');
    assert.equal(c1.status, 'carried'); assert.equal(c1.last, 'passed');
    assert.deepEqual(c1.from, { run: 1, commit: s.a });
    assert.equal(out.carried, 7);
    // third run: C3 still failing, narrowed again — C1 keeps run 1
    await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C3', passed: false }] });
    const v3 = JSON.parse(readFileSync(s.vfile, 'utf8'));
    assert.equal(v3.run, 3);
    assert.deepEqual(v3.criteria.find((c) => c.id === 'C1').from, { run: 1, commit: s.a });
    assert.equal(v3.criteria.find((c) => c.id === 'C7').status, 'carried');
  } finally { done(s); }
});

test('failing includes a carried entry whose last outcome was failed', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C3', 'C7']));
    const out = await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C3', passed: false }] });
    assert.deepEqual(out.failing, ['C3', 'C7']);
  } finally { done(s); }
});

test('broad: true forces a recorded full mode', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    const out = await recordVerdict(s.root, SLUG, res(ids9, [], { mode: 'narrowed', broad: true }));
    assert.equal(out.mode, 'full'); assert.equal(out.passed, true);
  } finally { done(s); }
});

test('passed is false for every narrowed run even when every reported id passed', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C4']));
    const out = await recordVerdict(s.root, SLUG, res(ids9, [], { mode: 'narrowed' }));
    assert.equal(out.mode, 'narrowed'); assert.equal(out.passed, false);
  } finally { done(s); }
});

test('recordVerdict rejects when CRITERIA.md is absent, malformed input, and writes nothing', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await assert.rejects(recordVerdict(s.root, SLUG, { mode: 'x', criteria: [] }));
    await assert.rejects(recordVerdict(s.root, SLUG, { mode: 'full' }));
    rmSync(s.crit);
    await assert.rejects(recordVerdict(s.root, SLUG, res(ids9)));
    assert.equal(sh(s.root, 'ls-files', s.vfile).stdout.trim(), '');
  } finally { done(s); }
});

test('recordVerdict ignores ids that are not in CRITERIA.md', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    const out = await recordVerdict(s.root, SLUG, res([...ids9, 'C99']));
    assert.equal(out.ignored, 1); assert.equal(out.passed, true);
  } finally { done(s); }
});

// chooseMode — pure
const verdictOf = (failed, n = 9, extra = {}) => ({
  version: 1, run: 1, mode: 'full', commit: 'abc1234', criteria_sha: 'h',
  criteria: Array.from({ length: n }, (_, i) => ({ id: `C${i + 1}`, status: failed.includes(`C${i + 1}`) ? 'failed' : 'passed' })),
  ...extra,
});
const idsN = (n) => Array.from({ length: n }, (_, i) => `C${i + 1}`);
const base = (over = {}) => ({ full: false, ids: ids9, verdict: verdictOf(['C3', 'C7']), hash: 'h', ancestor: true, ...over });

test('chooseMode narrows to exactly the previously failed ids in the control case', async () => {
  const { chooseMode } = await import('../lib/verdict.mjs');
  const d = chooseMode(base());
  assert.equal(d.mode, 'narrowed'); assert.deepEqual(d.first, ['C3', 'C7']);
});

test('chooseMode falls back to full with a distinct reason for each rule', async () => {
  const { chooseMode } = await import('../lib/verdict.mjs');
  const cases = {
    nover: chooseMode(base({ verdict: null, verdictReason: 'no saved verdict' })),
    many: chooseMode(base({ ids: idsN(20), verdict: verdictOf(['C1', 'C2', 'C3', 'C4'], 20) })),
    third: chooseMode(base({ ids: idsN(5), verdict: verdictOf(['C1', 'C2'], 5) })),
    hash: chooseMode(base({ hash: 'other' })),
    anc: chooseMode(base({ ancestor: false })),
    full: chooseMode(base({ full: true })),
    passed: chooseMode(base({ verdict: verdictOf([]) })),
    gone: chooseMode(base({ ids: idsN(5), verdict: verdictOf(['C8'], 9) })),
    noids: chooseMode(base({ ids: [] })),
  };
  const reasons = new Set();
  for (const [k, d] of Object.entries(cases)) {
    assert.equal(d.mode, 'full', k); assert.ok(d.reason, k); reasons.add(d.reason);
  }
  assert.equal(reasons.size, 9);
});

test('chooseMode threshold: 3 of 20, 2 of 6 and 3 of 9 narrow; 4 of 20 and 2 of 5 go full', async () => {
  const { chooseMode } = await import('../lib/verdict.mjs');
  const at = (n, k) => chooseMode(base({ ids: idsN(n), verdict: verdictOf(idsN(k), n) })).mode;
  assert.equal(at(20, 3), 'narrowed'); assert.equal(at(6, 2), 'narrowed'); assert.equal(at(9, 3), 'narrowed');
  assert.equal(at(20, 4), 'full'); assert.equal(at(5, 2), 'full');
});

test('chooseMode counts a carried-failed entry as unmet', async () => {
  const { chooseMode } = await import('../lib/verdict.mjs');
  const v = verdictOf([]); v.criteria[1] = { id: 'C2', status: 'carried', last: 'failed', from: { run: 1, commit: 'x' } };
  assert.deepEqual(chooseMode(base({ verdict: v })).first, ['C2']);
});

// planReverify — real git
test('planReverify narrows on a descendant commit and returns saved/range', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C3', 'C7']));
    commitFile(s.root, 'b.txt');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'narrowed'); assert.deepEqual(p.first, ['C3', 'C7']);
    assert.equal(p.saved.commit, s.a); assert.equal(p.saved.run, 1);
    assert.equal(p.range, `${s.a}..HEAD`); assert.equal(p.total, 9); assert.deepEqual(p.ids, ids9);
    assert.equal(planReverify(s.root, SLUG, { full: true }).mode, 'full');
  } finally { done(s); }
});

test('planReverify goes full on a branch that does not contain the graded commit', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C3']));
    // an unrelated history: A is not reachable from here
    sh(s.root, 'checkout', '-q', '--orphan', 'orph');
    sh(s.root, 'rm', '-rf', '-q', '.');
    commitFile(s.root, 'z.txt');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'full');
  } finally { done(s); }
});

test('planReverify goes full for an unreachable commit and for a malformed verdict, without throwing', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9, ['C3']));
    const v = JSON.parse(readFileSync(s.vfile, 'utf8'));
    v.commit = '0'.repeat(40);
    writeFileSync(s.vfile, JSON.stringify(v));
    assert.equal(planReverify(s.root, SLUG).mode, 'full');
    writeFileSync(s.vfile, '{nope');
    const p = planReverify(s.root, SLUG);
    assert.equal(p.mode, 'full'); assert.ok(p.reason); assert.equal(p.saved, null);
  } finally { done(s); }
});

// verifiedGate
test('verifiedGate accepts a full all-passed verdict, also after the verdict commit', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    await recordVerdict(s.root, SLUG, res(ids9));
    assert.deepEqual(verifiedGate(s.root, SLUG), { ok: true, reason: null });
  } finally { done(s); }
});

test('verifiedGate refuses narrowed, carried, failed, missing, stale-hash, moved-code and absent verdicts', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    assert.equal(verifiedGate(s.root, SLUG).ok, false); // no verdict
    await recordVerdict(s.root, SLUG, res(ids9, ['C2']));
    assert.equal(verifiedGate(s.root, SLUG).ok, false); // failed id
    await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C2', passed: true }] });
    assert.equal(verifiedGate(s.root, SLUG).ok, false); // narrowed + carried
    await recordVerdict(s.root, SLUG, res(ids9));
    assert.equal(verifiedGate(s.root, SLUG).ok, true);
    // carried id / missing id in an otherwise full file
    const v = JSON.parse(readFileSync(s.vfile, 'utf8'));
    writeFileSync(s.vfile, JSON.stringify({ ...v, criteria: v.criteria.map((c) => (c.id === 'C1' ? { ...c, status: 'carried' } : c)) }));
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
    writeFileSync(s.vfile, JSON.stringify({ ...v, criteria: v.criteria.slice(1) }));
    assert.equal(verifiedGate(s.root, SLUG).ok, false);
    writeFileSync(s.vfile, JSON.stringify(v));
    assert.equal(verifiedGate(s.root, SLUG).ok, true);
    // later commit outside .astrocode
    commitFile(s.root, 'code.txt');
    const moved = verifiedGate(s.root, SLUG);
    assert.equal(moved.ok, false); assert.match(moved.reason, /code changed/);
    // stale hash
    writeFileSync(s.crit, readFileSync(s.crit, 'utf8') + 'x');
    assert.match(verifiedGate(s.root, SLUG).reason, /CRITERIA\.md changed/);
  } finally { done(s); }
});

test('verifiedGate passes when CRITERIA.md is absent (self-derived bar)', async () => {
  const { verifiedGate } = await import('../lib/verdict.mjs');
  const s = sandbox();
  try {
    rmSync(s.crit);
    assert.equal(verifiedGate(s.root, SLUG).ok, true);
  } finally { done(s); }
});

// ---- Phase 47 t1 — mutation evidence: marker, contract, C9 gate (ADR-083) ----
const surv = (o = {}) => ({ file: 'src/a.mjs', line: 3, mutator: 'ArithmeticOperator', status: 'survived', triage: 'equivalent', justification: 'dead branch', ...o });
const mut = (o = {}) => ({
  outcome: 'survivors', tool: 'stryker', version: '8.0.0', command: 'stryker run', head: 'abc1234', capped: false, complete: true,
  counts: { killed: 4, survived: 1, timeout: 0, 'no-coverage': 0, error: 0 }, survivors: [surv()], fallback: null, ...o,
});

test('testStrengthIds finds the [mutation] tag in headings only, in file order', async () => {
  const { testStrengthIds } = await import('../lib/verdict.mjs');
  const t = '### C4 [mutation] — x\nbody [mutation]\n## C2 [Mutation]\n### C3 — plain\n### C1 — mentions [mutation]?\n';
  assert.deepEqual(testStrengthIds(t), ['C4', 'C2', 'C1']);
  assert.deepEqual(testStrengthIds('### C3 — plain\nC9 [mutation] in prose\n'), []);
  assert.deepEqual(testStrengthIds(undefined), []);
});

test('mutationGate: control passes; each breach is refused with a reason', async () => {
  const { mutationGate } = await import('../lib/verdict.mjs');
  const g = (mutation, marked = true) => mutationGate({ marked, mutation });
  assert.equal(g(mut()).ok, true);
  assert.equal(g(mut({ outcome: 'clean', survivors: [], counts: { killed: 5, survived: 0, timeout: 1, 'no-coverage': 0, error: 0 } })).ok, true);
  const refuse = (m, re) => { const r = g(m); assert.equal(r.ok, false); assert.match(r.reason, re); };
  refuse(undefined, /no mutation evidence/);
  refuse(mut({ survivors: [surv({ triage: 'test-gap' })] }), /src\/a\.mjs:3 ArithmeticOperator.*test-gap/);
  refuse(mut({ survivors: [surv({ justification: '' })] }), /justification/);
  refuse(mut({ survivors: [surv({ justification: 'a\nb' })] }), /justification/);
  refuse(mut({ survivors: [surv({ triage: undefined })] }), /untriaged/);
  refuse(mut({ survivors: [] }), /survivors listed but counts say 1/);
  refuse(mut({ capped: true, complete: false }), /capped/);
  refuse(mut({ complete: false }), /not complete/);
  refuse(mut({ outcome: 'error' }), /outcome/);
  refuse(mut({ counts: { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 }, survivors: [] }), /zero mutants/);
});

test('mutationGate: a padded survivor list cannot hide an untriaged survivor (C9)', async () => {
  const { mutationGate } = await import('../lib/verdict.mjs');
  const g = (mutation) => mutationGate({ marked: true, mutation });
  const counts = { killed: 4, survived: 2, timeout: 0, 'no-coverage': 1, error: 0 };
  // the same survivor three times, the no-coverage one never triaged
  const padded = [surv({ id: '7' }), surv({ id: '7' }), surv({ id: '7' })];
  let r = g(mut({ counts, survivors: padded }));
  assert.equal(r.ok, false); assert.match(r.reason, /3 "survived" survivors listed but counts say 2/);
  // statuses add up, but one survivor is listed twice in place of another
  r = g(mut({ counts, survivors: [surv({ id: '7' }), surv({ id: '7' }), surv({ id: '9', status: 'no-coverage' })] }));
  assert.equal(r.ok, false); assert.match(r.reason, /#7 is listed twice/);
  // distinct mutants at the same file, line and mutator are fine: the tool id tells them apart
  r = g(mut({ counts, survivors: [surv({ id: '7' }), surv({ id: '8' }), surv({ id: '9', status: 'no-coverage' })] }));
  assert.equal(r.ok, true);
});

test('parsed mutants keep the tool mutant id, so survivors can be told apart', async () => {
  const { parseStryker } = await import('../lib/mutparse.mjs');
  const r = parseStryker(JSON.stringify({ files: { 'src/a.mjs': { mutants: [
    { id: '11', mutatorName: 'StringLiteral', status: 'Survived', location: { start: { line: 5, column: 1 } } },
    { id: '12', mutatorName: 'StringLiteral', status: 'Survived', location: { start: { line: 5, column: 9 } } },
  ] } } }), { scope: ['src/a.mjs'] });
  assert.deepEqual(r.mutants.map((m) => m.id), ['11', '12']);
});

test('mutationGate: fallback only for tool-missing/no-tool/no-scope with a one-line reason; unmarked bare is untouched', async () => {
  const { mutationGate } = await import('../lib/verdict.mjs');
  const fb = (outcome, reason) => mutationGate({ marked: true, mutation: mut({ outcome, fallback: { reason }, counts: { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 }, survivors: [] }) });
  for (const o of ['tool-missing', 'no-tool', 'no-scope']) assert.equal(fb(o, 'mutation tool not installed — AI mutants used').ok, true);
  assert.equal(fb('survivors', 'because').ok, false);
  assert.equal(fb('tool-missing', '').ok, false);
  assert.equal(fb('tool-missing', 'a\nb').ok, false);
  assert.equal(mutationGate({ marked: false, mutation: undefined }).ok, true);
});

test('recordVerdict keeps evidence, fails a breaching pass with refused, and carries prior evidence', async () => {
  const { recordVerdict, saveMutateRun } = await import('../lib/verdict.mjs');
  const s = sandbox(2);
  try {
    writeFileSync(s.crit, '### C1 [mutation] — strong\n### C2 — plain\n');
    saveMutateRun(s.root, SLUG, { ...mut(), tool: { id: 'stryker' } });
    const r = (m, passed = true) => ({ mode: 'full', criteria: [{ id: 'C1', passed, ...(m ? { mutation: m } : {}) }, { id: 'C2', passed: true }] });
    let out = await recordVerdict(s.root, SLUG, r(mut()));
    assert.equal(out.passed, true);
    assert.deepEqual(JSON.parse(readFileSync(s.vfile, 'utf8')).criteria[0].mutation, mut());
    out = await recordVerdict(s.root, SLUG, r(mut({ survivors: [surv({ triage: 'test-gap' })] })));
    assert.equal(out.passed, false); assert.equal(out.refused[0].id, 'C1');
    assert.match(JSON.parse(readFileSync(s.vfile, 'utf8')).criteria[0].refused, /test-gap/);
    out = await recordVerdict(s.root, SLUG, r(null));
    assert.equal(out.passed, false);
    await assert.rejects(recordVerdict(s.root, SLUG, r(mut({ counts: { ...mut().counts, killed: 'x' } }))), /counts\.killed/);
    await recordVerdict(s.root, SLUG, r(mut()));
    await recordVerdict(s.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C2', passed: true }] });
    assert.deepEqual(JSON.parse(readFileSync(s.vfile, 'utf8')).criteria[0].mutation, mut());
  } finally { done(s); }
});

test('mutationGate: a fallback beside real run counts or survivors is refused', async () => {
  const { mutationGate } = await import('../lib/verdict.mjs');
  const zero = { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 };
  const fb = { reason: 'mutation tool not installed — AI mutants used' };
  assert.equal(mutationGate({ marked: true, mutation: mut({ outcome: 'tool-missing', fallback: fb, counts: { ...zero, survived: 2 }, survivors: [surv({ triage: 'equivalent', justification: 'x' })] }) }).ok, false);
  assert.equal(mutationGate({ marked: true, mutation: mut({ outcome: 'tool-missing', fallback: fb, counts: zero, survivors: [] }) }).ok, true);
});

test('recordVerdict binds evidence to the kept ac mutate run: no run, or an edited survivor list, is refused (C9)', async () => {
  const { recordVerdict, saveMutateRun } = await import('../lib/verdict.mjs');
  const s = sandbox(2);
  try {
    writeFileSync(s.crit, '### C1 [mutation] — strong\n### C2 — plain\n');
    const r = (m) => ({ mode: 'full', criteria: [{ id: 'C1', passed: true, mutation: m }, { id: 'C2', passed: true }] });
    const counts = { killed: 4, survived: 2, timeout: 0, 'no-coverage': 1, error: 0 };
    const tool = [surv({ id: '2' }), surv({ id: '3' }), surv({ id: '5', line: 7, mutator: 'EqualityOperator', status: 'no-coverage' })];
    const ev = (survivors, o = {}) => mut({ counts, survivors, ...o });
    const refused = async (m, re) => { const out = await recordVerdict(s.root, SLUG, r(m)); assert.equal(out.passed, false); assert.match(out.refused[0].reason, re); };
    // no run kept on this machine
    await refused(ev(tool), /no `ac mutate` run on record/);
    saveMutateRun(s.root, SLUG, { ...ev(tool), tool: { id: 'stryker' } });
    assert.equal((await recordVerdict(s.root, SLUG, r(ev(tool)))).passed, true);
    // #3 replaced by #2 with its id dropped; by a respelled path; by an invented survivor
    const { id: _drop, ...noId } = surv({ id: '2' });
    await refused(ev([tool[0], noId, tool[2]]), /#3 from the `ac mutate` run is not triaged/);
    await refused(ev([tool[0], surv({ id: '2', file: './src/a.mjs' }), tool[2]]), /#3 .*not triaged/);
    await refused(ev([tool[0], surv({ id: '99' }), tool[2]]), /#3 .*not triaged/);
    // counts lowered to hide #3; another commit; another outcome
    await refused(ev([tool[0], tool[2]], { counts: { ...counts, survived: 1 } }), /counts 1 "survived"/);
    await refused(ev(tool, { head: 'fff0000' }), /last `ac mutate` run graded abc1234/);
    await refused(ev([], { outcome: 'tool-missing', fallback: { reason: 'mutation tool not installed — AI mutants used' }, counts: { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 } }), /outcome "tool-missing" but the `ac mutate` run says "survivors"/);
  } finally { done(s); }
});

// ---- Phase 48 t8 — run-file paths, the not-configured outcome ----
import { mkdtempSync as mk48, existsSync as ex48, readFileSync as rf48 } from 'node:fs';
import { tmpdir as td48 } from 'node:os';
import { join as j48 } from 'node:path';
import { spawnSync as sp48 } from 'node:child_process';

test('phase 48: mutateRunPaths names every file one run leaves beside the kept run', async () => {
  const { mutateRunPaths } = await import('../lib/verdict.mjs');
  const d = '/proj';
  const p = mutateRunPaths(d, '48-x');
  const dir = j48(d, '.astrocode', '.local', 'mutate-runs');
  assert.deepEqual(p, {
    dir, run: j48(dir, '48-x.json'), log: j48(dir, '48-x.log'), list: j48(dir, '48-x.mutants.jsonl'),
    strykerConfig: j48(dir, '48-x.stryker.config.mjs'), gremlinsReport: j48(dir, '48-x.gremlins.json'),
  });
});

test('phase 48: ensureLocalDir creates the directory and a gitignore that covers a log there', async () => {
  const { ensureLocalDir, mutateRunPaths } = await import('../lib/verdict.mjs');
  const d = mk48(j48(td48(), 'ac-vlocal-'));
  sp48('git', ['init', '-q'], { cwd: d });
  ensureLocalDir(d);
  const p = mutateRunPaths(d, '1-a');
  assert.ok(ex48(p.dir));
  assert.equal(rf48(j48(d, '.astrocode', '.local', '.gitignore'), 'utf8'), '*\n');
  ensureLocalDir(d); // idempotent
  assert.equal(sp48('git', ['check-ignore', '-q', p.log], { cwd: d }).status, 0);
});

test('phase 48: not-configured is a mutation outcome and not a fallback outcome', async () => {
  const { MUTATION_OUTCOMES, FALLBACK_OUTCOMES } = await import('../lib/verdict.mjs');
  assert.ok(MUTATION_OUTCOMES.includes('not-configured'));
  assert.deepEqual(FALLBACK_OUTCOMES, ['tool-missing', 'no-tool', 'no-scope']);
});
