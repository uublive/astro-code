// astro-code · plan-phase workflow (Claude Code 4.8 Workflow tool)
//
// Fan out parallel researchers over a phase, then synthesize one executable
// PLAN.md. Invoked by the /astro-plan command via:
//   Workflow({ scriptPath: "<astro-code>/workflows/plan-phase.mjs",
//              args: { root, phase, goal } })
export const meta = {
  name: 'astro-plan-phase',
  description: 'Research a phase from several angles in parallel, then synthesize an executable PLAN.md',
  phases: [
    { title: 'Research', detail: 'parallel researchers gather approaches, patterns, risks' },
    { title: 'Synthesize', detail: 'merge findings into a single task-broken plan' },
  ],
}

const { root, phase, goal = '(see PROJECT.md)', models = {}, canon = '' } = args || {}
if (!root || !phase) throw new Error('plan-phase requires args { root, phase, goal }')
// models: per-role tier from .astrocode/config.json (opus|sonnet|haiku); undefined = inherit
// canon: project conventions + decisions (from `ac canon`) — every agent must obey it
const CANON = canon ? `\n\nPROJECT CANON — obey it (conventions + past decisions):\n${canon}` : ''

phase('Research')
const ANGLES = [
  'existing codebase patterns to reuse and conventions to match',
  'external best practices and library/API choices',
  'risks, edge cases, and the cheapest way to de-risk them',
]
const findings = await parallel(
  ANGLES.map((angle, i) => () =>
    agent(
      `You are researcher ${i + 1} for phase "${phase}" of the project at ${root}.\n` +
        `Phase goal: ${goal}\n` +
        `Your angle: ${angle}\n` +
        `Read the relevant files under ${root} and ${root}/.astrocode/. ` +
        `Return concise, concrete findings (no preamble).` +
        CANON,
      { label: `research:${i + 1}`, phase: 'Research', agentType: 'Explore', model: models.researcher },
    ),
  ),
)

phase('Synthesize')
const summary = await agent(
  `Synthesize an executable plan for phase "${phase}" (goal: ${goal}).\n\n` +
    `Researcher findings:\n${findings.filter(Boolean).join('\n\n---\n\n')}\n\n` +
    `Write ${root}/.astrocode/phases/${phase}/PLAN.md as numbered tasks. Each task MUST declare:\n` +
    `  id, title, the files it touches, and depends_on (ids of tasks that must finish first).\n` +
    `Keep tasks small and independently committable so execution can parallelize. ` +
    `Also write ${root}/.astrocode/phases/${phase}/ACCEPTANCE.md — a short, user-facing ` +
    `UAT checklist of "the user can …" statements a human will confirm before the phase ` +
    `closes (acceptance, not unit tests). ` +
    `The plan MUST conform to the project canon below (stack, naming, patterns, prior decisions). ` +
    `Return a one-line summary of the plan.` +
    CANON,
  { phase: 'Synthesize', agentType: 'astro-planner', model: models.planner },
)

return { phase, plan: summary }
