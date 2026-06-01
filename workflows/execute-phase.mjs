// astro-code · execute-phase workflow (Claude Code 4.8 Workflow tool)
//
// Execute a phase wave-by-wave: discover tasks + dependencies, run each wave's
// tasks in parallel inside isolated git worktrees, then verify the phase goal.
// Invoked by the /astro-execute command via:
//   Workflow({ scriptPath: "<astro-code>/workflows/execute-phase.mjs",
//              args: { root, phase } })
export const meta = {
  name: 'astro-execute-phase',
  description: 'Execute a phase wave-by-wave: parallel executors in isolated worktrees, then verify',
  phases: [
    { title: 'Discover', detail: 'parse plan tasks + dependencies into waves' },
    { title: 'Execute', detail: 'run each dependency wave in parallel' },
    { title: 'Verify', detail: 'confirm the phase goal is met' },
  ],
}

const { root, phase, models = {}, canon = '' } = args || {}
if (!root || !phase) throw new Error('execute-phase requires args { root, phase }')
// models: per-role tier from .planning/config.json (opus|sonnet|haiku); undefined = inherit
// canon: project conventions + decisions (from `ac canon`) — executors/verifier must obey it
const CANON = canon ? `\n\nPROJECT CANON — obey it (conventions + past decisions):\n${canon}` : ''

const TASK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          file: { type: 'string' },
          depends_on: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'title', 'depends_on'],
      },
    },
  },
  required: ['tasks'],
}

phase('Discover')
const disc = await agent(
  `Read every plan/task file under ${root}/.planning/phases/${phase}/ (PLAN.md and any NN-*.md). ` +
    `Return the full task list with explicit dependencies — depends_on lists the ids of tasks ` +
    `that must complete before this one. Use the ids exactly as written in the plan.`,
  { schema: TASK_SCHEMA, phase: 'Discover', model: models.discover },
)

// Kahn-style layering into dependency waves.
const tasks = disc.tasks
const completed = new Set()
const waves = []
let remaining = tasks.slice()
while (remaining.length) {
  const ready = remaining.filter((t) => t.depends_on.every((d) => completed.has(d)))
  if (!ready.length) {
    log(`⚠ dependency cycle or unknown id — running ${remaining.length} remaining task(s) together`)
    waves.push(remaining)
    break
  }
  waves.push(ready)
  ready.forEach((t) => completed.add(t.id))
  remaining = remaining.filter((t) => !ready.includes(t))
}
log(`${tasks.length} task(s) in ${waves.length} wave(s)`)

phase('Execute')
const results = []
for (let w = 0; w < waves.length; w++) {
  const wave = waves[w]
  log(`wave ${w + 1}/${waves.length}: ${wave.map((t) => t.id).join(', ')}`)
  const out = await parallel(
    wave.map((t) => () =>
      agent(
        `Implement task ${t.id} — "${t.title}" — of phase ${phase} in project ${root}.\n` +
          `Plan/task file: ${t.file || `${root}/.planning/phases/${phase}/PLAN.md`}\n` +
          `Make the change test-first where it adds behavior, run the tests, and make ONE atomic ` +
          `commit with a clear message. Match the project canon exactly (stack, naming, patterns). ` +
          `Return a short summary of what you changed.` +
          CANON,
        { label: `exec:${t.id}`, phase: 'Execute', isolation: 'worktree', agentType: 'astro-executor', model: models.executor },
      ),
    ),
  )
  results.push(...out.filter(Boolean))
}

phase('Verify')
const verdict = await agent(
  `Verify phase "${phase}" of the project at ${root}. Read its goal in ` +
    `${root}/.planning/phases/${phase}/ and confirm the implemented code actually delivers it ` +
    `(goal-backward, not just "tasks ran"). Run the test suite. Also flag any violation of the ` +
    `project canon (naming, patterns, prior decisions). Report PASS or FAIL with reasons.` +
    CANON,
  { phase: 'Verify', agentType: 'astro-verifier', model: models.verifier },
)

return { phase, tasks: tasks.length, waves: waves.length, executed: results.length, verdict }
