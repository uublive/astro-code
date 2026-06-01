// astro-code · plan-phase workflow (Claude Code 4.8 Workflow tool)
//
// Fan out parallel researchers over a phase, then synthesize one executable
// PLAN.md (+ ACCEPTANCE.md). Invoked by the /astro-plan command via:
//   Workflow({ scriptPath: "<astro-code>/workflows/plan-phase.mjs",
//              args: { root, phase, goal, models, canon } })
//
// NOTE: `phase` is a Workflow HOOK (phase('Research') starts a phase group), so we
// must NOT destructure an arg named `phase` — it would shadow the hook. We read the
// phase slug as `phaseSlug`.
export const meta = {
  name: 'astro-plan-phase',
  description: 'Research a phase from several angles in parallel, then synthesize an executable PLAN.md',
  phases: [
    { title: 'Research', detail: 'parallel researchers gather approaches, patterns, risks' },
    { title: 'Synthesize', detail: 'merge findings into a single task-broken plan' },
  ],
}

const { root, phase: phaseSlug, goal = '(see PROJECT.md)', models = {}, canon = '', context = '' } = args || {}
if (!root || !phaseSlug) throw new Error('plan-phase requires args { root, phase, goal }')
// canon: project conventions + decisions (from `ac canon`) — every agent must obey it
const CANON = canon ? `\n\nPROJECT CANON — obey it (conventions + past decisions):\n${canon}` : ''
// context: answers captured by /astro-discuss (CONTEXT.md) — decisions for THIS phase
const CONTEXT = context ? `\n\nDISCUSSION CONTEXT for this phase (honor these decisions):\n${context}` : ''

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
        CONTEXT +
        CANON,
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
    `The plan MUST conform to the project canon AND the discussion context below ` +
    `(stack, naming, patterns, prior decisions, and the decisions made for this phase). ` +
    `Return a one-line summary of the plan.` +
    CONTEXT +
    CANON,
  { phase: 'Synthesize', agentType: 'astro-planner', model: models.planner },
)

return { phase: phaseSlug, plan: summary }
