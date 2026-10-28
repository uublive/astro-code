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
async function run({ verifiers, records, args = {} }) {
  const calls = [];
  const logs = [];
  const vq = [...verifiers];
  const rq = [...records];
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts });
    const props = (opts.schema && opts.schema.properties) || {};
    if (opts.label === 'verdict:plan') return { mode: 'full', first: [], reason: 'stub', ids: ['C1'] };
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
