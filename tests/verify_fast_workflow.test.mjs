// Phase 57 t5 (ADR-094, C1/C2/C6): fast mode in the workflow tier's verifier and remediation prompts.
// Driven like tests/verify_loop.test.mjs: the script body in an AsyncFunction with recording stubs. No git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'execute-phase.mjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const TASKS = [{ id: 't1', title: 'T1', file: 'a.mjs', depends_on: [], done: true }];

async function run({ verifiers = [], records = [], plans = [], cheaps = [], args = {}, moved = false }) {
  const calls = [];
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
    if ('headBefore' in props) return { headBefore: 'a', headAfter: moved ? 'b' : 'a', summary: 'noop' };
    if ('ranSuite' in props) return { ranSuite: true, passed: true, testsRun: 3 };
    return { summary: 'done', branch: 'main', commit: 'sha' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  const src = readFileSync(WF_FILE, 'utf8').replace(/^export const meta/m, 'const meta');
  const result = await new AsyncFunction('phase', 'agent', 'parallel', 'log', 'args', src)(
    () => {}, agent, parallel, () => {},
    { root: '/tmp/proj', phase: '01-chain', effort: 'deep', ...args },
  );
  return { result, calls };
}

const item = (id, extra = {}) => ({ id, passed: true, status: 'passed', ...extra });
const CMD = "node --test 'tests/a.test.mjs'";
const verifierOf = (calls) => calls.filter((c) => c.opts.agentType === 'astro-verifier');
const PASS = { passed: true, criteriaFound: true, summary: 'ok', mode: 'full', criteria: [item('C1'), item('C9')] };

test('(a) fast mode, clean set: the verifier is told no full suite, names the targeted command and carries the suite id', async () => {
  const { calls } = await run({
    cheaps: [{ clean: true, unmet: [], fast: { mode: 'milestone', tests: ['tests/a.test.mjs'], command: CMD, passed: true, milestone: ['C9'] } }],
    verifiers: [PASS],
    records: [{ recorded: true, run: 1, passed: true, failing: [] }],
  });
  const [v] = verifierOf(calls);
  assert.match(v.prompt, /never run the full suite/);
  assert.ok(v.prompt.includes(CMD));
  assert.ok(v.prompt.includes('tests/a.test.mjs'));
  assert.match(v.prompt, /Suite criterion C9 is left out of your report: ac carries it to the milestone full check/);
  assert.doesNotMatch(v.prompt, /Run the full test suite/i);
  assert.doesNotMatch(v.prompt, /ac suite (run|receipt)/);
});

test('(b) no linked tests: the prompt says so and that no tests are run', async () => {
  const { calls } = await run({
    cheaps: [{ clean: true, unmet: [], fast: { mode: 'milestone', tests: [], reason: 'no linked tests', milestone: [] } }],
    verifiers: [PASS],
    records: [{ recorded: true, run: 1, passed: true, failing: [] }],
  });
  const [v] = verifierOf(calls);
  assert.match(v.prompt, /no linked tests/);
  assert.match(v.prompt, /run no tests/);
  assert.doesNotMatch(v.prompt, /ac suite (run|receipt)/);
});

test('(c) a red targeted set ends the round as a FAIL with no verifier, and remediation runs only the targeted tests', async () => {
  const { result, calls } = await run({
    cheaps: [{ clean: false, unmet: [], fast: { mode: 'milestone', tests: ['tests/a.test.mjs'], command: CMD, passed: false, failing: ['tests/a.test.mjs'], milestone: [] } }],
    moved: false,
  });
  assert.equal(verifierOf(calls).length, 0);
  assert.equal(result.verdict.passed, false);
  assert.match(result.verdict.summary, /^FAIL — targeted tests red \(tests\/a\.test\.mjs\)/);
  assert.deepEqual(result.verdict.criteria, []);
  const rem = calls.filter((c) => (c.opts.label || '').startsWith('remediate:'));
  assert.equal(rem.length, 1);
  assert.match(rem[0].prompt, /targeted-tests/);
  assert.ok(rem[0].prompt.includes('failing: tests/a.test.mjs'));
  assert.ok(rem[0].prompt.includes(CMD));
  assert.match(rem[0].prompt, /never the full suite/);
});

test('(d) a fast-mode FAIL on C2 sends a remediation prompt naming the targeted command, not the full suite', async () => {
  const { calls } = await run({
    cheaps: [{ clean: false, unmet: ['C2'], ran: [{ id: 'C2', kind: 'cheap', passed: false, command: 'cmd2', output: 'out2' }], fast: { mode: 'milestone', tests: ['tests/a.test.mjs'], command: CMD, passed: true, milestone: [] } }],
  });
  const rem = calls.filter((c) => (c.opts.label || '').startsWith('remediate:'));
  assert.equal(rem.length, 1);
  assert.ok(rem[0].prompt.includes(CMD));
  assert.match(rem[0].prompt, /never the full suite/);
  assert.match(rem[0].prompt, /- C2/);
});

test('(e) in per-phase mode (mode: phase) the verifier and remediation prompts carry no fast wording', async () => {
  const { calls } = await run({
    cheaps: [{ clean: true, unmet: [], mode: 'phase' }],
    verifiers: [PASS],
    records: [{ recorded: true, run: 1, passed: true, failing: [] }],
  });
  const [v] = verifierOf(calls);
  assert.doesNotMatch(v.prompt, /FAST MODE|ADR-094/);
  assert.match(v.prompt, /Run the full test suite\. Flag any project-canon violation/);
  const r2 = await run({ cheaps: [{ clean: false, unmet: ['C2'], ran: [], mode: 'phase' }] });
  const rem = r2.calls.filter((c) => (c.opts.label || '').startsWith('remediate:'));
  assert.doesNotMatch(rem[0].prompt, /FAST MODE/);
});

// Phase 57 verify C1: a cheap result that lost its `fast` object (no mode, or an empty note) must NOT send the
// verifier to the full suite; only an explicit mode 'phase' does.
test('(f) a cheap result with no fast object and no phase mode keeps fast mode: never the full suite', async () => {
  for (const cheap of [{ clean: true, unmet: [], unchecked: [], ran: [{ id: 'C1', kind: 'cheap', passed: true }] }, { clean: true, note: '' }, { clean: true, unmet: [], mode: 'milestone' }]) {
    const { calls } = await run({
      cheaps: [cheap],
      verifiers: [PASS],
      records: [{ recorded: true, run: 1, passed: true, failing: [] }],
    });
    const [v] = verifierOf(calls);
    assert.match(v.prompt, /FAST MODE/, JSON.stringify(cheap));
    assert.doesNotMatch(v.prompt, /Run the full test suite/, JSON.stringify(cheap));
  }
});

test('(c1) cheap pass unavailable (null or note-only): fast mode is assumed, the verifier is never told to run the full suite', async () => {
  for (const cheap of [null, { clean: true, unmet: [], note: 'boom' }]) {
    const { calls } = await run({ cheaps: [cheap], verifiers: [PASS, PASS, PASS, PASS] });
    const v = verifierOf(calls);
    assert.ok(v.length >= 1);
    assert.match(v[0].prompt, /never run the full suite|no test beyond the targeted set/i);
    assert.doesNotMatch(v[0].prompt, /Run the full test suite/);
  }
});
