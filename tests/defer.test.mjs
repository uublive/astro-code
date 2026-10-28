// Phase 54 t9 (C3d, C4, C5, C13): deferral in the engine plus `deferCriteria`.
// Scratch project, real git; CRITERIA.md has C1 (core by silence), C2 [edge], C3 [core], C4 untagged
// and C5 [suite]; PLAN.md is committed after it. Dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '54-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); };

const CRIT = [
  '# Criteria', '',
  '### C1 — plain claim', '- **Files:** `src/a.mjs`', '',
  '### C2 [edge] — an edge claim', '- **Files:** `src/b.mjs`', '',
  '### C3 [core] — a core claim', '- **Files:** `src/c.mjs`', '',
  '### C4 — untagged claim', '- **Files:** `src/d.mjs`', '',
  '### C5 [suite] [edge] — the suite, wrongly tagged edge', '- **Observe:** `npm test`', '',
].join('\n');
const ids = ['C1', 'C2', 'C3', 'C4', 'C5'];

function fixture(crit = CRIT, { plan = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'defer-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  put(root, `.astrocode/phases/${SLUG}/CRITERIA.md`, crit);
  for (const f of 'abcd') put(root, `src/${f}.mjs`);
  commit(root, 'criteria');
  if (plan) { put(root, `.astrocode/phases/${SLUG}/PLAN.md`, '# plan'); commit(root, 'plan'); }
  return {
    root, dir, vfile: join(dir, 'VERDICT.json'), fixes: join(root, '.astrocode', 'fixes.json'),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
const res = (failed = [], extra = {}) => ({
  mode: 'full',
  criteria: ids.filter((id) => !(extra.omit ?? []).includes(id)).map((id) => failed.includes(id)
    ? { id, passed: false, command: `check-${id}`, output: `${id} output: boom token=ghp_${'a'.repeat(36)}` }
    : { id, passed: true }),
});
const snap = (f) => [readFileSync(f.vfile, 'utf8'), (() => { try { return readFileSync(f.fixes, 'utf8'); } catch { return ''; } })()];

test('canDefer: only a heading-tagged, pre-registered, non-suite edge criterion is deferrable', async () => {
  const { canDefer } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    assert.equal(canDefer(f.root, SLUG, 'C2', CRIT).ok, true);
    for (const id of ['C1', 'C3', 'C4']) assert.match(canDefer(f.root, SLUG, id, CRIT).reason, /core criterion — never deferrable/);
    assert.match(canDefer(f.root, SLUG, 'C5', CRIT).reason, /suite criterion — never deferrable/);
    assert.match(canDefer(f.root, SLUG, 'C9', CRIT).reason, /not a criterion/);
  } finally { f.done(); }
});

test('a FAIL with C2 to C5 unmet lists exactly C2 as deferrable', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, res(['C2', 'C3', 'C4', 'C5']));
    assert.equal(out.passed, false);
    assert.deepEqual(out.deferrable, ['C2']);
    const e = JSON.parse(readFileSync(f.vfile, 'utf8')).criteria.find((c) => c.id === 'C2');
    assert.equal(e.command, 'check-C2');
    assert.ok(!e.output.includes('ghp_' + 'a'.repeat(36)), 'evidence is redacted');
  } finally { f.done(); }
});

test('deferCriteria opens a fix pre-filled with the failing command and output and marks C2 deferred', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const { loadFixes } = await import('../lib/fixes.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res(['C2', 'C3', 'C4', 'C5']));
    const r = await deferCriteria(f.root, SLUG, ['C2'], { by: 'matteo' });
    assert.equal(r.deferred.length, 1);
    const fix = loadFixes(f.root).fixes.find((x) => x.id === r.deferred[0].fix_id);
    assert.match(fix.repro, /check-C2/);
    assert.match(fix.repro, /C2 output: boom/);
    assert.equal(fix.deferred_from.phase, SLUG);
    assert.equal(fix.deferred_from.criterion, 'C2');
    assert.equal(fix.deferred_from.run, 1);
    assert.match(fix.title, /^deferred: phase 54 C2 — an edge claim$/);
    const v = JSON.parse(readFileSync(f.vfile, 'utf8'));
    const e = v.criteria.find((c) => c.id === 'C2');
    assert.equal(e.status, 'deferred');
    assert.equal(e.fix_id, fix.id);
    assert.equal(sh(f.root, 'log', '-1', '--format=%s').stdout.trim(), `chore(verdict): phase 54 defer C2 → ${fix.id}`);
  } finally { f.done(); }
});

test('refusals: C3, C4, C5, a mixed list, a late tag, an empty list - each throws and changes nothing', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res(['C2', 'C3', 'C4', 'C5']));
    const before = snap(f);
    for (const list of [['C3'], ['C4'], ['C5'], ['C2', 'C3'], ['C1'], [], ['C9']]) {
      await assert.rejects(deferCriteria(f.root, SLUG, list, {}), /./, JSON.stringify(list));
      assert.deepEqual(snap(f), before, `unchanged after ${JSON.stringify(list)}`);
    }
    await assert.rejects(deferCriteria(f.root, SLUG, ['C3'], {}), /C3: C3 is a core criterion/);
  } finally { f.done(); }
  // an [edge] tag added AFTER PLAN.md was committed
  const g = fixture(CRIT.replace('### C2 [edge]', '### C2'));
  try {
    put(g.root, `.astrocode/phases/${SLUG}/CRITERIA.md`, CRIT);
    commit(g.root, 'late tag');
    await recordVerdict(g.root, SLUG, res(['C2']));
    const before = snap(g);
    const out = JSON.parse(readFileSync(g.vfile, 'utf8'));
    assert.equal(out.criteria.find((c) => c.id === 'C2').status, 'failed');
    await assert.rejects(deferCriteria(g.root, SLUG, ['C2'], {}), /after the plan existed/);
    assert.deepEqual(snap(g), before);
  } finally { g.done(); }
});

test('a verifier cannot defer: status deferred, deferred, or fix_id in a result throws and nothing is recorded', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    for (const bad of [
      { mode: 'full', criteria: [{ id: 'C2', status: 'deferred', passed: false }] },
      { mode: 'full', criteria: [{ id: 'C2', passed: false, deferred: true }] },
      { mode: 'full', criteria: [{ id: 'C2', passed: false, fix_id: 'x' }] },
      { mode: 'full', deferred: ['C2'], criteria: [{ id: 'C2', passed: false }] },
    ]) {
      await assert.rejects(recordVerdict(f.root, SLUG, bad), /a verifier cannot defer/);
    }
    assert.throws(() => readFileSync(f.vfile), /ENOENT/);
  } finally { f.done(); }
});

test('deferring the only failed criterion of a full verdict lets the phase verify at once', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res(['C2']));
    assert.equal(verifiedGate(f.root, SLUG).ok, false);
    await deferCriteria(f.root, SLUG, ['C2'], {});
    assert.deepEqual(verifiedGate(f.root, SLUG), { ok: true, reason: null });
  } finally { f.done(); }
});

test('deferral then a passing full record: gate ok; the same with C4 unmet: refused', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const a = fixture();
  try {
    await recordVerdict(a.root, SLUG, res(['C2', 'C3']));
    await deferCriteria(a.root, SLUG, ['C2'], {});
    const out = await recordVerdict(a.root, SLUG, res([], { omit: ['C2'] }));
    assert.equal(out.passed, true);
    assert.equal(out.mode, 'full');
    const v = JSON.parse(readFileSync(a.vfile, 'utf8'));
    assert.equal(v.criteria.find((c) => c.id === 'C2').status, 'deferred', 'carried forward, not re-reported');
    assert.deepEqual(verifiedGate(a.root, SLUG), { ok: true, reason: null });
  } finally { a.done(); }
  const b = fixture();
  try {
    await recordVerdict(b.root, SLUG, res(['C2', 'C4']));
    await deferCriteria(b.root, SLUG, ['C2'], {});
    const out = await recordVerdict(b.root, SLUG, res(['C4'], { omit: ['C2'] }));
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C4']);
    assert.equal(verifiedGate(b.root, SLUG).ok, false);
  } finally { b.done(); }
});

test('a later narrowed record keeps C2 deferred; a pass of C2 turns it passed; the failed one stays deferred', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res(['C2', 'C3']));
    await deferCriteria(f.root, SLUG, ['C2'], {});
    await recordVerdict(f.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C3', passed: false }] });
    const st = (id) => JSON.parse(readFileSync(f.vfile, 'utf8')).criteria.find((c) => c.id === id).status;
    assert.equal(st('C2'), 'deferred');
    await recordVerdict(f.root, SLUG, res(['C3', 'C2']));
    assert.equal(st('C2'), 'deferred', 'reported failed again: still deferred, same fix');
    await recordVerdict(f.root, SLUG, res());
    assert.equal(st('C2'), 'passed', 'reported passed: becomes passed');
  } finally { f.done(); }
});

test('hand-written verdicts that defer C3, C4 or C5 (or a missing fix) are refused by verifiedGate', async () => {
  const { recordVerdict, verifiedGate, criteriaHash } = await import('../lib/verdict.mjs');
  const { deferCriteria } = await import('../lib/defer.mjs');
  const { loadFixes } = await import('../lib/fixes.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res(['C2']));
    const r = await deferCriteria(f.root, SLUG, ['C2'], {});
    const fixId = r.deferred[0].fix_id;
    assert.ok(loadFixes(f.root).fixes.length === 1);
    await recordVerdict(f.root, SLUG, res([], { omit: ['C2'] }));
    assert.equal(verifiedGate(f.root, SLUG).ok, true, 'the legitimate one passes');
    const good = JSON.parse(readFileSync(f.vfile, 'utf8'));
    const head = sh(f.root, 'rev-parse', 'HEAD').stdout.trim();
    for (const [id, re] of [['C3', /C3 is marked deferred but .*core criterion/], ['C4', /C4 is marked deferred but .*core criterion/], ['C5', /C5 is marked deferred but .*suite criterion/], ['C1', /core criterion/]]) {
      const v = { ...good, commit: head, criteria: good.criteria.map((c) => (c.id === id ? { id, status: 'deferred', fix_id: fixId, evidence: 'observed' } : c)) };
      writeFileSync(f.vfile, JSON.stringify(v));
      const g = verifiedGate(f.root, SLUG);
      assert.equal(g.ok, false, id);
      assert.match(g.reason, re, id);
    }
    const missing = { ...good, commit: head, criteria: good.criteria.map((c) => (c.id === 'C2' ? { ...c, fix_id: 'nope' } : c)) };
    writeFileSync(f.vfile, JSON.stringify(missing));
    assert.match(verifiedGate(f.root, SLUG).reason, /fix nope, which does not exist/);
    assert.ok(criteriaHash);
  } finally { f.done(); }
});
