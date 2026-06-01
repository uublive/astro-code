// astro-code · plan-phase workflow (Claude Code 4.8 Workflow tool)
//
// Fan out parallel researchers over a phase, then synthesize one executable
// PLAN.md (+ ACCEPTANCE.md). Invoked by the /astro-plan command via:
//   Workflow({ scriptPath: "<astro-code>/workflows/plan-phase.mjs",
//              args: { root, phase, goal, models } })
//
// Args stay SMALL (scalars + a tiny models map) so they're always valid JSON — we do
// NOT pass canon/CONTEXT text here; the spawned agents read those from disk, which
// also keeps the args from being accidentally serialized to a string.
//
// `phase` is a Workflow HOOK (phase('Research')), so we read the slug as `phaseSlug`.
export const meta = {
  name: 'astro-plan-phase',
  description: 'Research a phase from several angles in parallel, then synthesize an executable PLAN.md',
  phases: [
    { title: 'Research', detail: 'parallel researchers gather approaches, patterns, risks' },
    { title: 'Synthesize', detail: 'merge findings into a single task-broken plan' },
  ],
}

// Defensive: accept args as an object, or as a JSON string if the caller stringified it.
const input = typeof args === 'string' ? JSON.parse(args) : args || {}
const { root, phase: phaseSlug, goal = '(see PROJECT.md)', models = {} } = input
if (!root || !phaseSlug) throw new Error('plan-phase requires args { root, phase }')

// Agents read the canon + discussion brief from disk themselves.
const OBEY =
  `\n\nRead and OBEY before answering:\n` +
  `  - ${root}/.astrocode/CONVENTIONS.md and ${root}/.astrocode/DECISIONS.md (project canon)\n` +
  `  - ${root}/.astrocode/phases/${phaseSlug}/CONTEXT.md (this phase's /astro-discuss decisions, if present)`

phase('Research')
const ANGLES = [
  'existing codebase patterns to reuse and conventions to match',
  'external best practices and library/API choices',
  'risks, edge cases, and the cheapest way to de-risk them',
]
log(`planning "${phaseSlug}" — ${ANGLES.length} researchers in parallel`)
const findings = await parallel(
  ANGLES.map((angle, i) => () =>
    agent(
      `You are researcher ${i + 1} for phase "${phaseSlug}" of the project at ${root}.\n` +
        `Phase goal: ${goal}\n` +
        `Your angle: ${angle}\n` +
        `Read the relevant files under ${root} and ${root}/.astrocode/. ` +
        `Return concise, concrete findings (no preamble).` +
        OBEY,
      { label: `research:${i + 1}`, phase: 'Research', agentType: 'Explore', model: models.researcher },
    ),
  ),
)

phase('Synthesize')
log(`research done (${findings.filter(Boolean).length}/${ANGLES.length}) — synthesizing PLAN.md + ACCEPTANCE.md`)
const summary = await agent(
  `Synthesize an executable plan for phase "${phaseSlug}" (goal: ${goal}).\n\n` +
    `Researcher findings:\n${findings.filter(Boolean).join('\n\n---\n\n')}\n\n` +
    `Write ${root}/.astrocode/phases/${phaseSlug}/PLAN.md as numbered tasks. Each task MUST declare:\n` +
    `  id, title, the files it touches, and depends_on (ids of tasks that must finish first).\n` +
    `Keep tasks small and independently committable so execution can parallelize. ` +
    `Also write ${root}/.astrocode/phases/${phaseSlug}/ACCEPTANCE.md — a short, user-facing ` +
    `UAT checklist of "the user can …" statements a human will confirm before the phase ` +
    `closes (acceptance, not unit tests). ` +
    `The plan MUST conform to the canon and this phase's CONTEXT.md. ` +
    `Return a one-line summary of the plan.` +
    OBEY,
  { phase: 'Synthesize', agentType: 'astro-planner', model: models.planner },
)

return { phase: phaseSlug, plan: summary }
