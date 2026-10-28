// Phase 54 t18 (C8, D7): remediation overlaps the verify in its own worktree, and the fix lands only
// after the verdict. Stubs record spawn order, label, isolation and resolution timing; the two verifier
// groups resolve at different ticks. No git (the script runs none, ADR-005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'execute-phase.mjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TASKS = [{ id: 't1', title: 'T1', file: 'a.mjs', depends_on: [], done: true }];
const IDS = ['C1', 'C2', 'C3', 'C4'];
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (id) => ({ id, passed: true, status: 'passed' });
const bad = (id) => ({ id, passed: false, status: 'failed', command: `cmd-${id}`, output: `out-${id}` });

// `verifiers(prompt, n)` -> { delay, result }; `remediate` -> the worktree remediation result (or null).
async function run({ useWorktrees = true, verifiers, remediate, integ, plans, effort = 'standard', record }) {
  const events = [];
  const calls = [];
  let nVerify = 0, nPlan = 0, nRecord = 0;
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || opts.agentType;
    calls.push({ prompt, opts, label });
    events.push(`start ${label}`);
    try {
      if (opts.label === 'verify:cheap') return { clean: true, unmet: [], unchecked: [] };
      if (opts.label === 'verdict:plan') return (plans && plans[nPlan++]) || { mode: 'full', first: [], reason: 'stub', ids: IDS };
      if (opts.label === 'verdict:record') { nRecord++; return record ? record(nRecord) : nRecord === 1 ? { recorded: true, run: 1, passed: false, failing: ['C1'] } : { recorded: true, run: nRecord, passed: true, failing: [] }; }
      if (opts.agentType === 'astro-verifier') {
        const g = /GROUP (\d) OF 2/.exec(prompt);
        const spec = verifiers(g ? Number(g[1]) : 0, nVerify++);
        await tick(spec.delay);
        return spec.result;
      }
      if (String(opts.label).startsWith('remediate:')) { await tick(1); return opts.isolation === 'worktree' ? remediate : { headBefore: 'a', headAfter: 'b', summary: 'on-branch' }; }
      if (String(opts.label).startsWith('integrate:')) return integ || { integrated: true, branches: ['worktree-r'] };
      const props = (opts.schema && opts.schema.properties) || {};
      if ('tasks' in props) return { tasks: TASKS };
      if ('missing' in props) return { missing: [] };
      return { summary: 'done' };
    } finally { events.push(`end ${label}`); }
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  const logs = [];
  const src = readFileSync(WF_FILE, 'utf8').replace(/^export const meta/m, 'const meta');
  const result = await new AsyncFunction('phase', 'agent', 'parallel', 'log', 'args', src)(
    () => {}, agent, parallel, (m) => logs.push(String(m)),
    { root: '/tmp/proj', phase: '07-ov', effort, strategy: 'sequential', useWorktrees },
  );
  return { result, calls, events, logs };
}

// Round 1: group 1 fails C1 at once, group 2 is slow and passes. Round 2 (single verifier): everything passes.
const splitVerifiers = (g, n) => {
  if (n < 2) return g === 1 ? { delay: 2, result: { passed: false, criteriaFound: true, summary: 'g1', mode: 'full', criteria: [bad('C1'), ok('C2')] } }
    : { delay: 40, result: { passed: true, criteriaFound: true, summary: 'g2', mode: 'full', criteria: [ok('C3'), ok('C4')] } };
  return { delay: 1, result: { passed: true, criteriaFound: true, summary: 'all good', mode: 'full', criteria: IDS.map(ok) } };
};
const WT_OK = { headBefore: 'a', headAfter: 'b', summary: 'fixed C1', branch: 'worktree-r', commit: 'sha-r' };

test('with worktrees on: two verifier groups, remediation starts in a worktree before the slow group returns, the fix lands after the verdict, then the next verify', async () => {
  const { result, calls, events } = await run({ verifiers: splitVerifiers, remediate: WT_OK });
  const verifiers = calls.filter((c) => c.opts.agentType === 'astro-verifier');
  assert.equal(verifiers.length, 3, 'two groups in round 1, one verifier in round 2');
  assert.match(verifiers[0].prompt, /GROUP 1 OF 2/);
  assert.match(verifiers[1].prompt, /GROUP 2 OF 2/);
  assert.match(verifiers[0].prompt, /ALSO run the structural checks/);
  assert.match(verifiers[1].prompt, /SKIP the structural checks/);
  assert.doesNotMatch(verifiers[1].prompt, /Run the full test suite/);
  assert.doesNotMatch(verifiers[2].prompt, /GROUP/);
  assert.ok(verifiers.every((v) => v.opts.isolation === undefined), 'a verifier never runs on a worktree');

  const rem = calls.find((c) => c.label === 'remediate:c0');
  assert.equal(rem.opts.isolation, 'worktree');
  assert.match(rem.prompt, /SYNC FIRST/);
  assert.match(rem.prompt, /phase 07 remediate-c0/);
  assert.match(rem.prompt, /- C1/);
  assert.doesNotMatch(rem.prompt, /- C3/, 'only the failing group\'s unmet ids');

  const at = (e) => events.indexOf(e);
  const g2End = events.findIndex((e, i) => e === 'end astro-verifier' && i > at('start remediate:c0'));
  assert.ok(at('start remediate:c0') !== -1 && g2End !== -1 && at('start remediate:c0') < g2End, 'remediation started before the slow group resolved');
  assert.ok(at('start verdict:record') > g2End, 'the record waits for both groups');
  assert.ok(at('start integrate:remediate-c0') > at('end verdict:record'), 'the integrator runs only after the verdict is recorded');
  const verifierStarts = events.map((e, i) => (e === 'start astro-verifier' ? i : -1)).filter((i) => i >= 0);
  assert.ok(verifierStarts[2] > at('end integrate:remediate-c0'), 'the next verify comes after the integration');
  assert.equal(result.verdict.passed, true);
  assert.equal(result.stoppedReason, 'passed');
  assert.equal(calls.filter((c) => c.label === 'remediate:c0').length, 1, 'exactly one remediation');
});

test('with useWorktrees off: ONE verifier spawn, and remediate: only after verdict:record, with no isolation', async () => {
  const { calls, events } = await run({ useWorktrees: false, verifiers: (g, n) => (n === 0
    ? { delay: 1, result: { passed: false, criteriaFound: true, summary: 'no', mode: 'full', criteria: [bad('C1'), ok('C2'), ok('C3'), ok('C4')] } }
    : { delay: 1, result: { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: IDS.map(ok) } }) });
  const verifiers = calls.filter((c) => c.opts.agentType === 'astro-verifier');
  assert.equal(verifiers.length, 2, 'one per round, never split');
  assert.ok(verifiers.every((v) => !/GROUP/.test(v.prompt)));
  const rem = calls.find((c) => c.label === 'remediate:c0');
  assert.equal(rem.opts.isolation, undefined);
  assert.ok(events.indexOf('start remediate:c0') > events.indexOf('end verdict:record'));
  assert.equal(calls.filter((c) => String(c.label).startsWith('integrate:')).length, 0);
});

test('a null worktree remediation re-runs on-branch after the verdict, and the next round uses no groups', async () => {
  const { calls, events, logs } = await run({ effort: 'deep', verifiers: (g, n) => {
    if (n < 2) return splitVerifiers(g, n);
    return { delay: 1, result: { passed: false, criteriaFound: true, summary: 'still', mode: 'full', criteria: [bad('C1'), ok('C2'), ok('C3'), ok('C4')] } };
  }, remediate: null });
  const rems = calls.filter((c) => c.label === 'remediate:c0');
  assert.equal(rems.length, 2, 'the worktree attempt, then the on-branch re-run');
  assert.equal(rems[0].opts.isolation, 'worktree');
  assert.equal(rems[1].opts.isolation, undefined);
  assert.ok(events.lastIndexOf('start remediate:c0') > events.indexOf('end verdict:record'), 'the re-run is after the verdict');
  assert.ok(logs.some((l) => /^⚠ the overlapped worktree remediation returned no commit/.test(l)));
  const verifiers = calls.filter((c) => c.opts.agentType === 'astro-verifier');
  assert.ok(verifiers.slice(2).every((v) => !/GROUP/.test(v.prompt)), 'the overlap is latched off for the rest of the run');
  assert.equal(calls.filter((c) => String(c.label).startsWith('integrate:')).length, 0, 'nothing to integrate');
});

test('an integration failure of the remediation branch stops the loop with stoppedReason integration-failed', async () => {
  const { result, calls } = await run({ verifiers: splitVerifiers, remediate: WT_OK, integ: { integrated: false, branches: [], conflicts: [{ branch: 'worktree-r', taskId: 'remediate-c0' }] } });
  assert.equal(result.stoppedReason, 'integration-failed');
  assert.equal(result.verdict.passed, false);
  assert.equal(calls.filter((c) => c.opts.agentType === 'astro-verifier').length, 2, 'no next round verified a tree without the fix');
});

test('fewer than four criteria never split, whatever the worktree setting', async () => {
  const { calls } = await run({ plans: [{ mode: 'full', first: [], reason: 's', ids: ['C1', 'C2', 'C3'] }],
    record: () => ({ recorded: true, run: 1, passed: true, failing: [] }),
    verifiers: () => ({ delay: 1, result: { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: ['C1', 'C2', 'C3'].map(ok) } }) });
  assert.equal(calls.filter((c) => c.opts.agentType === 'astro-verifier').length, 1);
});

test('the executor contract states that during an overlapped verify it works on its own branch, syncs first and never writes ac state', () => {
  const md = readFileSync(join(dirname(WF_FILE), '..', 'agents', 'astro-executor.md'), 'utf8');
  assert.match(md, /overlapped verify/);
  assert.match(md, /own worktree branch/);
  assert.match(md, /sync first/);
  assert.match(md, /exactly ONE stamped commit/);
  assert.match(md, /Never run\s+`ac verdict`, `ac state` or any `ac phase` write/);
});
