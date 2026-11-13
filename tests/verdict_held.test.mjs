// ADR-094: this file pins per-phase verify; fast mode is covered by verify_fast*.test.mjs
// Phase 56 t2 — a slow suite held back is recorded as carried/unobserved, never passed or failed, and
// the plan reports the order (ADR-093). Real tmp git; dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '01-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const CRIT = ['# Criteria', '',
  '### C1 [suite] — suite passes', '- **Files:** `src/c1.mjs`', '',
  ...[2, 3, 4].flatMap((n) => [`### C${n} — claim ${n}`, `- **Files:** \`src/c${n}.mjs\``, '']),
].join('\n');

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vheld-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, '.astrocode'), { recursive: true });
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ verify: { full_suite: 'phase' } }));
  put(root, `.astrocode/phases/${SLUG}/CRITERIA.md`, CRIT);
  for (const n of [1, 2, 3, 4]) put(root, `src/c${n}.mjs`);
  sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'init');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  return { root, vfile: join(dir, 'VERDICT.json'), hfile: join(dir, 'VERDICTS.jsonl'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const held = { id: 'C1', held: true, suite: true };
const res = (rest, mode = 'full', extra = []) => ({ mode, criteria: [held, ...rest, ...extra] });
const P = (id) => ({ id, passed: true });
const F = (id) => ({ id, passed: false });

test('a full round with C2 and C3 failed and C1 held: FAIL, C1 unobserved, not failing, not flapping', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    // an earlier history line where C1 passed: a held C1 must not flap
    writeFileSync(f.hfile, JSON.stringify({ run: 0, passed: false, mode: 'full', unmet: [], criteria: [{ id: 'C1', status: 'passed' }] }) + '\n');
    const out = await recordVerdict(f.root, SLUG, res([F('C2'), F('C3'), P('C4')]));
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2', 'C3']);
    assert.deepEqual(out.held, ['C1']);
    assert.ok(!(out.deferrable ?? []).includes('C1'));
    assert.ok(!(out.flapping ?? []).includes('C1'));
    const c1 = JSON.parse(readFileSync(f.vfile, 'utf8')).criteria.find((c) => c.id === 'C1');
    assert.equal(c1.status, 'carried');
    assert.equal(c1.last, 'unobserved');
    assert.equal(c1.held, 'slow suite');
    assert.equal(c1.suite, true);
    const h = JSON.parse(readFileSync(f.hfile, 'utf8').split('\n').filter(Boolean).pop());
    assert.deepEqual(h.unmet, ['C2', 'C3']);
    assert.deepEqual(h.held, ['C1']);
    assert.equal(verifiedGate(f.root, SLUG).ok, false);
  } finally { f.done(); }
});

test('every non-suite passed and C1 held is no PASS; recording C1 passed is', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, res([P('C2'), P('C3'), P('C4')]));
    assert.equal(out.passed, false);
    assert.equal(verifiedGate(f.root, SLUG).ok, false);
    const ok = await recordVerdict(f.root, SLUG, { mode: 'full', criteria: ['C1', 'C2', 'C3', 'C4'].map(P) });
    assert.equal(ok.passed, true);
    assert.equal(verifiedGate(f.root, SLUG).ok, true);
  } finally { f.done(); }
});

test('held on a criterion that is not a suite criterion is saved failed with the refusal', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, { mode: 'full', criteria: [P('C1'), { id: 'C2', held: true }, P('C3'), P('C4')] });
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2']);
    const c2 = JSON.parse(readFileSync(f.vfile, 'utf8')).criteria.find((c) => c.id === 'C2');
    assert.equal(c2.status, 'failed');
    assert.equal(c2.refused, 'only a suite criterion can be held back');
  } finally { f.done(); }
});

test('a targeted result holding C1 never passes', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, { mode: 'full', criteria: ['C1', 'C2', 'C3', 'C4'].map(P) });
    const out = await recordVerdict(f.root, SLUG, res([P('C2'), P('C3'), P('C4')], 'targeted'));
    assert.equal(out.passed, false);
  } finally { f.done(); }
});

test('planReverify reports the order: failing non-suite first, suite last; first/floor/mode unchanged', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, res([F('C2'), F('C3'), P('C4')]));
    const plan = planReverify(f.root, SLUG);
    assert.deepEqual(plan.order, { first: ['C2', 'C3'], last: ['C1'] });
    // unchanged by ADR-093: a failed full verdict re-plans as full, with no narrowed first/floor set
    assert.equal(plan.mode, 'full');
    assert.deepEqual(plan.first, []);
    assert.deepEqual(plan.floor, []);
  } finally { f.done(); }
});
