// Phase 56 t5 (C10, C11): a slow suite is held back, never unmet and never remediated; every round
// observes the non-suite criteria first. Same AsyncFunction harness as tests/verify_loop.test.mjs.
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
    if ('headBefore' in props) return { headBefore: 'a', headAfter: 'b', summary: 'fixed' };
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

const item = (id, extra = {}) => ({ id, passed: true, status: 'passed', ...extra })
const heldItem = (id = 'C1') => ({ id, held: true, suite: true })
const failed = (id) => ({ id, passed: false, status: 'failed', command: `cmd-${id}`, output: `out-${id}` })
const heldCheap = { clean: true, unmet: [], unchecked: [], held: [{ id: 'C1', command: 'slow', seconds: 900, threshold_seconds: 600, reason: 'last run 900s > 600s threshold' }] }
const IDS = ['C1', 'C2', 'C3', 'C4']
const plan = { mode: 'full', first: [], reason: 'stub', ids: IDS }
const verifierSpawns = (calls) => calls.filter((c) => c.opts.agentType === 'astro-verifier')
const remediations = (calls) => calls.filter((c) => (c.opts.label || '').startsWith('remediate:'))
const recordPayload = (call) => JSON.parse(/--result '(.*)'\n/s.exec(call.prompt)[1])

test('a cheap stage that holds C1 back while C2 is unmet ends as a FAIL naming both, runs no verifier', async () => {
  const { result, calls } = await run({
    verifiers: [],
    cheaps: [{ ...heldCheap, clean: false, unmet: ['C2'], ran: [{ id: 'C2', kind: 'cheap', passed: false, command: 'c2', output: 'o2' }] }],
    records: [],
    args: { effort: 'light' },
  })
  assert.equal(verifierSpawns(calls).length, 0)
  assert.match(result.verdict.summary, /^FAIL — cheap first pass/)
  assert.match(result.verdict.summary, /held back: slow suite \(C1\)/)
})

test('C10: a clean cheap pass with C1 held: the verifier runs non-suite first, C1 last; FAIL lists C2 C3, held C1, remediates only C2 C3', async () => {
  const { result, calls } = await run({
    verifiers: [
      { passed: false, criteriaFound: true, summary: 'C2 and C3 broke; ok otherwise', mode: 'full', criteria: [failed('C2'), failed('C3'), item('C4'), heldItem()] },
      { passed: false, criteriaFound: true, summary: 'x', mode: 'full', criteria: [item('C2'), item('C3'), item('C4'), heldItem()] },
      { passed: false, criteriaFound: true, summary: 'x', mode: 'full', criteria: [item('C2'), item('C3'), item('C4'), heldItem()] },
    ],
    cheaps: [heldCheap, heldCheap, heldCheap],
    plans: [plan, plan, plan],
    records: [{ recorded: true, run: 1, passed: false, failing: ['C2', 'C3'] }, { recorded: true, run: 2, passed: false, failing: [] }],
    args: { effort: 'standard', useWorktrees: true },
  })
  const v1 = verifierSpawns(calls)[0]
  assert.match(v1.prompt, /observe EVERY non-suite criterion first/)
  assert.match(v1.prompt, /ONLY\s+after every non-suite criterion passed/)
  assert.match(v1.prompt, /ac suite run/)
  assert.match(v1.prompt, /"held":true/)
  assert.doesNotMatch(v1.prompt, /GROUP \d OF/, 'not split into overlapped groups')
  const rec1 = calls.filter((c) => c.opts.label === 'verdict:record')[0]
  assert.ok(recordPayload(rec1).criteria.some((c) => c.id === 'C1' && c.held === true && c.suite === true))
  assert.ok(!recordPayload(rec1).criteria.some((c) => c.id === 'C1' && 'passed' in c))
  const rem = remediations(calls)
  assert.ok(rem.length >= 1)
  assert.match(rem[0].prompt, /- C2/)
  assert.match(rem[0].prompt, /- C3/)
  assert.doesNotMatch(rem[0].prompt, /- C1/)
  assert.match(verifierSpawns(calls)[1].prompt, /SLOW SUITE IS HELD BACK/, 'the next verify is ordered the same way')
  assert.ok(result.verdict.summary.length > 0)
})

test('C10: the first round summary starts FAIL, names every unmet id, says held back, and never ok or C1 failed', async () => {
  const { result } = await run({
    verifiers: [{ passed: false, criteriaFound: true, summary: 'all ok except', mode: 'full', criteria: [failed('C2'), failed('C3'), item('C4'), heldItem()] }],
    cheaps: [heldCheap],
    plans: [plan],
    records: [{ recorded: true, run: 1, passed: false, failing: ['C2', 'C3'] }],
    args: { effort: 'light' },
  })
  assert.match(result.verdict.summary, /^FAIL — 2 unmet \(C2, C3\); held back: slow suite \(C1\), not run this round/)
  assert.doesNotMatch(result.verdict.summary, /\bok\b/)
  assert.doesNotMatch(result.verdict.summary, /C1 failed/)
})

test('C11: every non-suite criterion passed and C1 held: no remediation, one forced verify that runs the suite, then verified', async () => {
  const { result, calls } = await run({
    verifiers: [
      { passed: false, criteriaFound: true, summary: 'suite held', mode: 'full', criteria: [item('C2'), item('C3'), item('C4'), heldItem()] },
      { passed: true, criteriaFound: true, summary: 'all good', mode: 'full', criteria: [item('C1', { suite: true }), item('C2'), item('C3'), item('C4')] },
    ],
    cheaps: [heldCheap, heldCheap],
    plans: [plan, plan],
    records: [{ recorded: true, run: 1, passed: false, failing: [] }, { recorded: true, run: 2, passed: true, failing: [] }],
    args: { effort: 'standard' },
  })
  assert.equal(remediations(calls).length, 0)
  const vs = verifierSpawns(calls)
  assert.equal(vs.length, 2)
  assert.match(vs[1].prompt, /MUST now be run/)
  assert.match(vs[1].prompt, /ac suite run/)
  assert.equal(result.verdict.passed, true)
})

test('C11: when the suite is held again the loop ends a FAIL within budget and never passes', async () => {
  const held = { passed: false, criteriaFound: true, summary: 'held', mode: 'full', criteria: [item('C2'), item('C3'), item('C4'), heldItem()] }
  const { result, calls } = await run({
    verifiers: [held, held, held, held, held],
    cheaps: [heldCheap, heldCheap, heldCheap, heldCheap, heldCheap],
    plans: [plan, plan, plan, plan, plan],
    records: [],
    args: { effort: 'standard' },
  })
  assert.equal(remediations(calls).length, 0)
  assert.equal(result.verdict.passed, false)
  assert.match(result.verdict.summary, /^FAIL — /)
  assert.ok(verifierSpawns(calls).length <= 5)
})
