// Phase 45 t3 — `ac verdict plan|record` and the `ac phase verify` gate (ADR-079), driven
// through the real CLI in a real tmp git project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';
import { saveMutateRun } from '../lib/verdict.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8' });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const head = (cwd) => sh(cwd, 'rev-parse', 'HEAD').stdout.trim();
const ids = (n) => Array.from({ length: n }, (_, i) => `C${i + 1}`);
const res = (all, failed = [], extra = {}) => JSON.stringify({
  mode: 'full', criteria: all.map((id) => ({ id, passed: !failed.includes(id) })), ...extra,
});

async function project(n = 9, withCriteria = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-verdict-cli-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'vproj' });
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  const crit = join(dir, '.astrocode', 'phases', ph.slug, 'CRITERIA.md');
  if (withCriteria) writeFileSync(crit, ids(n).map((id) => `### ${id} — x\n- **Observe:** y\n`).join('\n'));
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  return { dir, slug: ph.slug, crit, vfile: join(dir, '.astrocode', 'phases', ph.slug, 'VERDICT.json'), a: head(dir) };
}
const commitCode = (dir, name = 'b.txt') => { writeFileSync(join(dir, name), 'x'); sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', name); };
const phaseStatus = (dir) => JSON.parse(ac(dir, 'phase', 'show', '1').stdout).status;
const done = (p) => rmSync(p.dir, { recursive: true, force: true });

test('C1: ac verdict record saves, commits and fingerprints a verdict', async () => {
  const p = await project(6);
  try {
    const r = ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(6), ['C2', 'C5']));
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.recorded, true); assert.equal(out.run, 1); assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2', 'C5']); assert.equal(out.committed, true);
    assert.equal(sh(p.dir, 'check-ignore', '-q', p.vfile).status, 1);
    assert.equal(sh(p.dir, 'status', '--porcelain', '--', p.vfile).stdout.trim(), '');
    const v1 = JSON.parse(readFileSync(p.vfile, 'utf8'));
    assert.equal(v1.commit, p.a);
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(6), ['C2', 'C5']));
    assert.equal(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria_sha, v1.criteria_sha, 'no edit, same fingerprint');
    writeFileSync(p.crit, readFileSync(p.crit, 'utf8') + ' ');
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(6), ['C2', 'C5']));
    assert.notEqual(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria_sha, v1.criteria_sha);
  } finally { done(p); }
});

test('C2: plan narrows to exactly the failed ids after a later commit; prints one line without --json', async () => {
  const p = await project(9);
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(9), ['C3', 'C7']));
    commitCode(p.dir);
    const plan = JSON.parse(ac(p.dir, 'verdict', 'plan', '1', '--json').stdout);
    assert.equal(plan.mode, 'narrowed'); assert.deepEqual(plan.first, ['C3', 'C7']);
    assert.equal(plan.saved.run, 1); assert.equal(plan.saved.commit, p.a); assert.equal(plan.range, `${p.a}..HEAD`);
    const line = ac(p.dir, 'verdict', 'plan', '1').stdout.trim();
    assert.equal(line, `• narrowed: re-check C3, C7 first (run 1 @ ${p.a.slice(0, 7)})`);
  } finally { done(p); }
});

test('C3: every fallback and --full give mode full; a typo flag is refused; garbage is not fatal', async () => {
  const mode = (p, ...extra) => {
    const r = ac(p.dir, 'verdict', 'plan', '1', '--json', ...extra);
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  // (a) no verdict
  let p = await project(9);
  try { assert.equal(mode(p).mode, 'full'); } finally { done(p); }
  // (b) 4 of 20, (c) 2 of 5
  p = await project(20);
  try { ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(20), ['C1', 'C2', 'C3', 'C4'])); commitCode(p.dir); assert.equal(mode(p).mode, 'full'); } finally { done(p); }
  p = await project(5);
  try { ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(5), ['C1', 'C2'])); commitCode(p.dir); assert.equal(mode(p).mode, 'full'); } finally { done(p); }
  // control + (d) hash + (e) unreachable + (f) --full + garbage
  p = await project(9);
  try {
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(9), ['C3', 'C7']));
    commitCode(p.dir);
    assert.equal(mode(p).mode, 'narrowed');
    assert.equal(mode(p, '--full').mode, 'full');
    const bad = ac(p.dir, 'verdict', 'plan', '1', '--fulll');
    assert.notEqual(bad.status, 0); assert.match(bad.stderr, /unknown flag/);
    const v = JSON.parse(readFileSync(p.vfile, 'utf8'));
    writeFileSync(p.vfile, JSON.stringify({ ...v, commit: '0'.repeat(40) }));
    assert.equal(mode(p).mode, 'full');
    writeFileSync(p.vfile, '{garbage');
    assert.equal(mode(p).mode, 'full');
    writeFileSync(p.vfile, JSON.stringify(v));
    writeFileSync(p.crit, readFileSync(p.crit, 'utf8') + ' ');
    assert.equal(mode(p).mode, 'full');
    assert.match(ac(p.dir, 'verdict', 'plan', '1').stdout, /^• full: /);
  } finally { done(p); }
});

test('C4: ac phase verify refuses a narrowed, failed, carried or missing verdict and accepts a full pass', async () => {
  const refused = (p) => {
    const r = ac(p.dir, 'phase', 'verify', '1');
    assert.notEqual(r.status, 0); assert.match(r.stderr, /astro-verify 1/);
    assert.notEqual(phaseStatus(p.dir), 'verified');
  };
  let p = await project(9);
  try {
    refused(p); // missing
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(9), ['C2']));
    refused(p); // failed
    ac(p.dir, 'verdict', 'record', '1', '--result', JSON.stringify({ mode: 'narrowed', criteria: [{ id: 'C2', passed: true }] }));
    refused(p); // narrowed + carried
    ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(9)));
    const ok = ac(p.dir, 'phase', 'verify', '1');
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(phaseStatus(p.dir), 'verified');
  } finally { done(p); }
  p = await project(9);
  try {
    assert.notEqual(ac(p.dir, 'phase', 'verify', '1').status, 0);
    assert.equal(ac(p.dir, 'phase', 'verify', '1', '--force').status, 0);
    assert.equal(phaseStatus(p.dir), 'verified');
  } finally { done(p); }
  p = await project(0, false);
  try {
    assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0, 'no CRITERIA.md: unchanged');
  } finally { done(p); }
});

test('record refuses without CRITERIA.md or with malformed --result, and writes nothing', async () => {
  let p = await project(0, false);
  try {
    const r = ac(p.dir, 'verdict', 'record', '1', '--result', res(ids(3)));
    assert.notEqual(r.status, 0);
    assert.equal(sh(p.dir, 'ls-files', p.vfile).stdout.trim(), '');
  } finally { done(p); }
  p = await project(3);
  try {
    assert.notEqual(ac(p.dir, 'verdict', 'record', '1', '--result', '{nope').status, 0);
    assert.notEqual(ac(p.dir, 'verdict', 'record', '1', '--result', '{"mode":"full"}').status, 0);
    assert.notEqual(ac(p.dir, 'verdict', 'record', '1').status, 0);
    assert.equal(sh(p.dir, 'ls-files', p.vfile).stdout.trim(), '');
  } finally { done(p); }
});

// ---- Phase 47 t1 — mutation evidence through the real CLI (C8, C9) ----
const surv47 = (o = {}) => ({ file: 'src/a.mjs', line: 3, mutator: 'ArithmeticOperator', status: 'survived', triage: 'equivalent', justification: 'dead branch', ...o });
const mut47 = (o = {}) => ({
  outcome: 'survivors', tool: 'stryker', version: '8.0.0', command: 'stryker run --mutate src/a.mjs', reproduce: 'ac mutate 1 --json',
  head: 'abc', scope: ['src/a.mjs'], cap_seconds: 600, capped: false, complete: true,
  counts: { killed: 4, survived: 1, timeout: 0, 'no-coverage': 0, error: 0 }, survivors: [surv47()], fallback: null, ...o,
});
const rec47 = (p, m) => ac(p.dir, 'verdict', 'record', '1', '--result',
  JSON.stringify({ mode: 'full', criteria: [{ id: 'C1', passed: true, ...(m ? { mutation: m } : {}) }] }));
// The `ac mutate` run the evidence is bound to (C9): the same facts, as the tool produced them.
const keep47 = (p, m) => saveMutateRun(p.dir, p.slug, { ...m, tool: { id: m.tool } });

test('phase 47 C8: evidence round-trips field for field; a fallback keeps its reason', async () => {
  const p = await project(1);
  try {
    writeFileSync(p.crit, '### C1 [mutation] — strong tests\n- **Observe:** y\n');
    keep47(p, mut47());
    let r = rec47(p, mut47());
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria[0].mutation, mut47());
    const fb = mut47({ outcome: 'tool-missing', fallback: { reason: 'mutation tool not installed — AI mutants used' }, counts: { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 }, survivors: [] });
    keep47(p, fb);
    r = rec47(p, fb);
    assert.equal(JSON.parse(r.stdout).passed, true);
    assert.equal(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria[0].mutation.fallback.reason, 'mutation tool not installed — AI mutants used');
  } finally { done(p); }
});

test('phase 47 C9: breaches are saved failed with refused; the justified control passes', async () => {
  const p = await project(1);
  try {
    writeFileSync(p.crit, '### C1 [mutation] — strong tests\n- **Observe:** y\n');
    const cases = [
      ['a', mut47({ survivors: [surv47({ triage: 'test-gap' })] }), /src\/a\.mjs:3 ArithmeticOperator/],
      ['b', mut47({ survivors: [surv47({ justification: '' })] }), /src\/a\.mjs:3 ArithmeticOperator/],
      ['c', mut47({ counts: { killed: 4, survived: 2, timeout: 0, 'no-coverage': 0, error: 0 } }), /counts say 2/],
      ['e', mut47({ capped: true, complete: false, outcome: 'incomplete' }), /capped/],
    ];
    for (const [name, m, re] of cases) {
      keep47(p, m);
      const out = JSON.parse(rec47(p, m).stdout);
      assert.equal(out.passed, false, name);
      assert.match(out.refused[0].reason, re, name);
      assert.equal(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria[0].status, 'failed', name);
    }
    keep47(p, mut47());
    const out = JSON.parse(rec47(p, mut47()).stdout);
    assert.equal(out.passed, true);
    // an edited survivor list no longer matches the kept run
    assert.match(JSON.parse(rec47(p, mut47({ survivors: [surv47({ line: 9 })] })).stdout).refused[0].reason, /not triaged/);
    assert.equal(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria[0].mutation.survivors[0].justification, 'dead branch');
    // marked, no evidence -> failed
    assert.equal(JSON.parse(rec47(p, null).stdout).passed, false);
    // structurally bad -> non-zero
    const bad = rec47(p, mut47({ counts: { killed: 'x', survived: 0, timeout: 0, 'no-coverage': 0, error: 0 } }));
    assert.notEqual(bad.status, 0);
  } finally { done(p); }
});

// ---- Phase 48 t8 — only the [mutation] tag is a code gate (ADR-084) ----
test('phase 48: untagged criteria keep mutation evidence verbatim and are never gated by it', async () => {
  const p = await project(1);
  try {
    writeFileSync(p.crit, '### C1 — plain claim\n- **Observe:** y\n');
    // a capped, incomplete run with an untriaged survivor would fail a tagged criterion; here it is supporting evidence
    const weak = mut47({ capped: true, complete: false, outcome: 'incomplete', survivors: [surv47({ triage: undefined })] });
    let out = JSON.parse(rec47(p, weak).stdout);
    assert.equal(out.passed, true);
    assert.deepEqual(JSON.parse(readFileSync(p.vfile, 'utf8')).criteria[0].mutation, JSON.parse(JSON.stringify(weak)));
    // no evidence at all passes too
    assert.equal(JSON.parse(rec47(p, null).stdout).passed, true);
    // structural junk is still refused outright
    const bad = rec47(p, mut47({ counts: { killed: 'x', survived: 0, timeout: 0, 'no-coverage': 0, error: 0 } }));
    assert.notEqual(bad.status, 0);
  } finally { done(p); }
});

test('phase 48: a tagged criterion is still gated, and not-configured evidence is refused rather than crashing', async () => {
  const p = await project(1);
  try {
    writeFileSync(p.crit, '### C1 [mutation] — strong tests\n- **Observe:** y\n');
    const nc = mut47({ outcome: 'not-configured', complete: true, survivors: [], counts: { killed: 0, survived: 0, timeout: 0, 'no-coverage': 0, error: 0 } });
    keep47(p, nc);
    const r = rec47(p, nc);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.passed, false);
    assert.match(out.refused[0].reason, /not-configured/);
    assert.equal(JSON.parse(rec47(p, null).stdout).passed, false, 'marked without evidence still fails');
  } finally { done(p); }
});
