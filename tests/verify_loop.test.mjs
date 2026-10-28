// Phase 54 t1 (C12): the verify -> remediate loop after a WITHDRAWN carried PASS.
//
// The bug (debt 2026-10-15): when the coverage guard or `ac verdict record` withdrew a verifier's
// PASS and left ZERO unmet criteria, the loop still spawned an executor with an empty unmet list
// (a wasted remediation cycle), and the round's summary kept the verifier's own pass text, so a
// non-PASS round read 'ok'.
//
// Contract: with nothing to remediate the loop spawns NO `remediate:` agent and runs one forced-full
// verify instead (the plan clerk is asked for `--full`); a withdrawn round's summary leads with
// `FAIL — verify PASS withdrawn: <reason>`; a withdrawal that DOES leave unmet ids still remediates.
//
// Driven like tests/execute_blocked_dependency.test.mjs: the script body wrapped in an AsyncFunction
// with recording stubs. No git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'execute-phase.mjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const TASKS = [{ id: 't1', title: 'T1', file: 'a.mjs', depends_on: [], done: true }];

// `verifiers`: queue of verifier results, one per verify spawn. `records`: queue of record-clerk results.
async function run({ verifiers, records, plans = [], cheaps = [], args = {} }) {
  const calls = [];
  const logs = [];
  const vq = [...verifiers];
  const rq = [...records];
  const pq = [...plans];
  const cq = [...cheaps];
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    const props = (opts.schema && opts.schema.properties) || {};
    if (opts.label === 'verify:cheap') return cq.length ? cq.shift() : { clean: true, unmet: [], unchecked: [] };
    if (opts.label === 'verdict:plan') return pq.length ? pq.shift() : { mode: 'full', first: [], reason: 'stub', ids: ['C1'] };
    if (opts.label === 'verdict:record') return rq.shift() || { recorded: true, run: 1, passed: false, failing: [] };
    if (opts.agentType === 'astro-verifier') return vq.shift();
    if ('tasks' in props) return { tasks: TASKS };
    if ('missing' in props) return { missing: [] };
    if ('integrated' in props) return { integrated: true, branches: [] };
    if ('headBefore' in props) return { headBefore: 'a', headAfter: 'a', summary: 'noop' };
    if ('ranSuite' in props) return { ranSuite: true, passed: true, testsRun: 3 };
    return { summary: 'done', branch: 'main', commit: 'sha' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  const src = readFileSync(WF_FILE, 'utf8').replace(/^export const meta/m, 'const meta');
  const result = await new AsyncFunction('phase', 'agent', 'parallel', 'log', 'args', src)(
    () => {}, agent, parallel, (m) => logs.push(String(m)),
    { root: '/tmp/proj', phase: '01-chain', effort: 'deep', ...args },
  );
  return { result, calls, logs };
}

const item = (id, extra = {}) => ({ id, passed: true, status: 'passed', ...extra });

test('a withdrawn PASS with zero unmet spawns no remediation, verifies full once more, and never reads ok', async () => {
  const { result, calls } = await run({
    verifiers: [
      // Round 1: PASS claimed, but C2 is carried -> the coverage guard withdraws it.
      { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1'), item('C2', { status: 'carried' })] },
      // Round 2 (forced full): a genuine full PASS.
      { passed: true, criteriaFound: true, summary: 'all good', mode: 'full', criteria: [item('C1'), item('C2')] },
    ],
    records: [{ recorded: true, run: 1, passed: false, failing: [] }, { recorded: true, run: 2, passed: true, failing: [] }],
  });
  assert.equal(calls.filter((c) => (c.opts.label || '').startsWith('remediate:')).length, 0, 'no executor on an empty unmet list');
  const plans = calls.filter((c) => c.opts.label === 'verdict:plan');
  assert.equal(plans.length, 2, 'a second verify followed');
  assert.match(plans[1].prompt, /--full/, 'the second plan clerk was asked for --full');
  assert.doesNotMatch(plans[0].prompt, /--full/);
  assert.equal(result.verdict.passed, true);
});

test('when the forced-full verify is still withdrawn, the summary states the withdrawal, not ok', async () => {
  const bad = { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1'), item('C2', { status: 'carried' })] };
  const { result, calls } = await run({
    verifiers: [bad, bad],
    records: [{ recorded: true, run: 1, passed: false, failing: [] }, { recorded: true, run: 2, passed: false, failing: [] }],
    args: { effort: 'standard' },
  });
  assert.equal(calls.filter((c) => (c.opts.label || '').startsWith('remediate:')).length, 0);
  assert.equal(result.verdict.passed, false);
  assert.match(result.verdict.summary, /^FAIL — verify PASS withdrawn: /);
  assert.notEqual(result.verdict.summary, 'ok');
  assert.doesNotMatch(result.verdict.summary, /^ok/);
});

test('a withdrawn PASS from ac verdict record that names failing ids still remediates them', async () => {
  const { calls } = await run({
    verifiers: [
      { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1'), item('C2')] },
    ],
    records: [{ recorded: true, run: 1, passed: false, failing: ['C2'] }],
    args: { effort: 'standard' },
  });
  const rem = calls.filter((c) => (c.opts.label || '').startsWith('remediate:'));
  assert.equal(rem.length, 1, 'C2 is still remediated');
  assert.match(rem[0].prompt, /- C2/);
});

// ── t17: the cheap stage, every gap, broad files, the record payload and summary lines ──────────

const verifierSpawns = (calls) => calls.filter((c) => c.opts.agentType === 'astro-verifier');
const recordPayload = (call) => JSON.parse(/--result '(.*)'\n/s.exec(call.prompt)[1]);

test('a cheap stage with unmet C2 and C3 ends the round as a FAIL listing both and spawns no verifier', async () => {
  const { result, calls, logs } = await run({
    verifiers: [],
    cheaps: [{ clean: false, unmet: ['C2', 'C3'], unchecked: [], ran: [{ id: 'C2', kind: 'cheap', passed: false, command: 'cmd2', output: 'out2' }, { id: 'C3', kind: 'cheap', passed: false, command: 'cmd3', output: 'out3' }] }],
    records: [],
    args: { effort: 'light' },
  });
  assert.equal(verifierSpawns(calls).length, 0, 'no expensive verifier after a cheap failure');
  assert.equal(result.verdict.passed, false);
  assert.match(result.verdict.summary, /cheap first pass/);
  assert.match(result.verdict.summary, /C2, C3/);
  assert.deepEqual(result.verdict.criteria.map((c) => c.id), ['C2', 'C3']);
  assert.equal(result.verdict.criteria[0].command, 'cmd2');
  assert.ok(logs.some((l) => /cheap first pass: 2 unmet/.test(l)));
  assert.equal(calls.filter((c) => c.opts.label === 'verdict:record').length, 0, 'ac verdict cheap already recorded it');
});

test('a clean cheap stage is followed by the expensive verifier, and the cheap clerk is told to run ac verdict cheap', async () => {
  const { calls } = await run({
    verifiers: [{ passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1')] }],
    records: [{ recorded: true, run: 1, passed: true, failing: [] }],
    args: { effort: 'light' },
  });
  const order = calls.map((c) => c.opts.label || c.opts.agentType).filter((l) => ['verify:cheap', 'verdict:plan', 'astro-verifier', 'verdict:record'].includes(l));
  assert.deepEqual(order, ['verify:cheap', 'verdict:plan', 'astro-verifier', 'verdict:record']);
  const cheap = calls.find((c) => c.opts.label === 'verify:cheap');
  assert.match(cheap.prompt, /ac verdict cheap 01-chain --json/);
});

test('the verifier prompt says to report every unmet criterion and never stop at the first', async () => {
  const { calls } = await run({
    verifiers: [{ passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1')] }],
    records: [{ recorded: true, run: 1, passed: true, failing: [] }],
    args: { effort: 'light' },
  });
  const p = verifierSpawns(calls)[0].prompt;
  assert.match(p, /never stop at the first failing criterion/);
  assert.match(p, /Report EVERY criterion you observed unmet/);
  assert.match(p, /never as carried/);
});

test('the narrowed and targeted prompts check a broad claim with ac verdict plan --broad-files and return broad_files', async () => {
  const narrowed = { mode: 'narrowed', first: ['C2'], ids: ['C1', 'C2'], saved: { run: 1, commit: 'aaa1111abc', mode: 'full' }, range: 'aaa1111abc..HEAD', reason: 'x' };
  const targeted = { mode: 'targeted', first: [], floor: ['C1'], carry: [], why: { C1: 'w' }, base: { run: 1, commit: 'aaa1111abc' }, ids: ['C1', 'C2'], range: 'aaa1111abc..HEAD', reason: 'x' };
  for (const plan of [narrowed, targeted]) {
    const { calls } = await run({
      verifiers: [{ passed: false, criteriaFound: true, summary: 'no', mode: plan.mode, criteria: [item('C1', { passed: false, status: 'failed' })] }],
      records: [{ recorded: true, run: 2, passed: false, failing: ['C1'] }],
      plans: [plan],
      args: { effort: 'light' },
    });
    const p = verifierSpawns(calls)[0].prompt;
    assert.match(p, /ac verdict plan 01-chain --broad-files <the changed files that make it broad> --json/, plan.mode);
    assert.match(p, /broad_files/, plan.mode);
  }
});

test('the record payload carries broad_files and each failed criterion\'s command and output, truncated to 1500', async () => {
  const long = 'x'.repeat(3000);
  const { calls } = await run({
    verifiers: [{ passed: false, criteriaFound: true, summary: 'no', mode: 'full', broad: true, broad_files: ['src/a.mjs'],
      criteria: [item('C1'), { id: 'C2', passed: false, status: 'failed', command: long, output: long }] }],
    records: [{ recorded: true, run: 1, passed: false, failing: ['C2'] }],
    plans: [{ mode: 'full', first: [], reason: 's', ids: ['C1', 'C2'] }],
    args: { effort: 'light' },
  });
  const payload = recordPayload(calls.find((c) => c.opts.label === 'verdict:record'));
  assert.deepEqual(payload.broad_files, ['src/a.mjs']);
  const c2 = payload.criteria.find((c) => c.id === 'C2');
  assert.equal(c2.command.length, 1500);
  assert.equal(c2.output.length, 1500);
  assert.equal('command' in payload.criteria.find((c) => c.id === 'C1'), false, 'a passed criterion carries no evidence');
});

test('the record\'s deferrable, flapping and broad_refused each add one summary line', async () => {
  const { result } = await run({
    verifiers: [{ passed: false, criteriaFound: true, summary: 'FAIL — C2 unmet', mode: 'full', criteria: [item('C1'), { id: 'C2', passed: false, status: 'failed' }] }],
    records: [{
      recorded: true, run: 3, passed: false, failing: ['C2'], deferrable: ['C2'],
      flapping: [{ id: 'C2', passed_run: 1, files_changed: false }], broad_refused: 'no files named',
    }],
    plans: [{ mode: 'full', first: [], reason: 's', ids: ['C1', 'C2'] }],
    args: { effort: 'light' },
  });
  const lines = result.verdict.summary.split('\n');
  assert.equal(lines.length, 4, result.verdict.summary);
  assert.match(lines[1], /^deferrable: C2 — a human may defer with `ac verdict defer 01 C2`$/);
  assert.match(lines[2], /^flapping: C2 passed in run 1, files unchanged$/);
  assert.match(lines[3], /^broad claim refused: no files named — recorded narrowed$/);
});
