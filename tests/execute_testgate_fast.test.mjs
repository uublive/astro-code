// Phase 59 t8 — the healed-wave test gate runs the phase's targeted set in fast mode, the full suite
// otherwise, and still fails closed (ADR-066/028; debt healed-wave-test-gate-still-runs-the).
// The workflow is driven the way tests/workflows.test.mjs drives it: injected hooks, recorded agent() calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const WF_FILE = new URL('../workflows/execute-phase.mjs', import.meta.url)
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SLUG = '59-resource-safe-verify-and-mutation'
const tasks = [
  { id: 't1', title: 'Task 1', file: 'a.mjs', depends_on: [], done: false },
  { id: 't2', title: 'Task 2', file: 'b.mjs', depends_on: [], done: false },
]
const HEALED = { integrated: false, branches: ['worktree-t1'], conflicts: [{ branch: 'worktree-t2', taskId: 't2' }], tornDown: ['worktree-t1'] }
const TARGETED = { mode: 'targeted', command: "node --test 'tests/a.test.mjs'", tests: ['tests/a.test.mjs'], reason: '' }

// plan: what the `testgate-plan` agent returns (undefined -> the stub's default no-fingerprint reply).
async function run({ plan, gate } = {}) {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    const props = (opts.schema && opts.schema.properties) || {}
    if (opts.label === 'testgate-plan') return plan
    if ('clean' in props && 'unmet' in props) return { clean: true, unmet: [], unchecked: [], mode: 'phase' }
    if ('tasks' in props) return { tasks }
    if ('committed' in props) return { committed: [], summary: '' }
    if ('missing' in props) return { missing: [] }
    if ('branch' in props && 'commit' in props) return { summary: 'done', branch: opts.isolation === 'worktree' ? null : 'main', commit: opts.isolation === 'worktree' ? null : 'sha' }
    if ('integrated' in props) return HEALED
    if ('criteriaFound' in props) return { passed: true, criteriaFound: true, summary: 'ok', criteria: [] }
    if ('ranSuite' in props) return gate || { ranSuite: true, passed: true, testsRun: 12 }
    return { summary: 'done' }
  }
  const src = readFileSync(WF_FILE, 'utf8').replace(/^export const meta/m, 'const meta')
  const fn = new AsyncFunction('phase', 'agent', 'parallel', 'log', 'args', src)
  const logs = []
  const result = await fn(() => {}, agent, async (ts) => Promise.all(ts.map((t) => t())), (m) => logs.push(String(m)), {
    root: '/tmp/proj', phase: SLUG, strategy: 'parallel', models: { executor: 'sonnet' },
  })
  return { calls, logs, result, gatePrompt: calls.find((c) => c.opts && c.opts.label === 'testgate')?.prompt, planCall: calls.find((c) => c.opts && c.opts.label === 'testgate-plan') }
}

test('(a) a targeted plan makes the gate run exactly that command through ac suite run, never the full suite', async () => {
  const { gatePrompt, planCall } = await run({ plan: TARGETED })
  assert.ok(planCall.prompt.includes(`ac suite targeted ${SLUG} --json`))
  assert.equal(planCall.opts.model, 'sonnet')
  assert.ok(gatePrompt.includes("node --test 'tests/a.test.mjs'"))
  assert.ok(gatePrompt.includes('tests/a.test.mjs'))
  assert.ok(gatePrompt.includes('ac suite run'))
  assert.ok(!/Run the full test suite/i.test(gatePrompt))
  assert.ok(!/all tests/i.test(gatePrompt))
  assert.ok(gatePrompt.includes('Do NOT run the full suite'))
})

test('(b) a full plan keeps the full-suite prompt, routed through ac suite run', async () => {
  const { gatePrompt } = await run({ plan: { mode: 'full', command: 'npm test', tests: [], reason: 'verify.full_suite: phase' } })
  assert.match(gatePrompt, /Run the full test suite/)
  assert.ok(gatePrompt.includes('ac suite run --command'))
  assert.ok(gatePrompt.includes('machine lock'))
})

test('(c) a failed plan agent falls back to the full suite', async () => {
  for (const plan of [null, undefined, { summary: 'done' }, { mode: 'targeted', command: '', tests: [], reason: '' }]) {
    const { gatePrompt } = await run({ plan })
    assert.match(gatePrompt, /Run the full test suite/, JSON.stringify(plan))
  }
})

test('(d) in targeted mode a zero-test or failed gate stops the phase; no suite in full mode stays unproven', async () => {
  const zero = await run({ plan: TARGETED, gate: { ranSuite: true, passed: true, testsRun: 0 } })
  assert.ok(zero.result.integrationFailed, 'testsRun 0 must stop the phase')
  const red = await run({ plan: TARGETED, gate: { ranSuite: true, passed: false, testsRun: 3, output: 'boom' } })
  assert.ok(red.result.integrationFailed, 'a failed gate must stop the phase')
  const none = await run({ plan: { mode: 'full', command: '', tests: [], reason: 'no linked tests' }, gate: { ranSuite: false, passed: true, testsRun: 0 } })
  assert.ok(!none.result.integrationFailed, 'no runner in full mode keeps the unproven path (ADR-028)')
  assert.ok(none.logs.some((l) => l.includes('UNPROVEN')))
})
