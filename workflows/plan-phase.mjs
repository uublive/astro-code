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
    { title: 'Criteria', detail: 'plan-blind: pre-register goal-derived success criteria (CRITERIA.md)' },
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

// ADR-021 — the Criteria stage runs FIRST, before any research or plan exists, so the
// verifier's bar is pre-registered from the GOAL and can never be shaped by the
// implementation (the Terminal-Bench 2.0 false-PASS this closes: a plan-derived bar
// grades the work against its own claims). It's a single sequential agent (NOT in the
// researcher parallel() array) so CRITERIA.md is written before the fan-out — the
// researchers/planner may then aim the plan at the bar. The criteria author is plan-blind
// by contract (agents/astro-criteria-author.md); the prompt restates it as defense-in-depth.
phase('Criteria')
log(`pre-registering the bar for "${phaseSlug}" — plan-blind, goal-derived CRITERIA.md`)
await agent(
  `Author the pre-registered success criteria for phase "${phaseSlug}" (goal: ${goal}).\n` +
    `You are PLAN-BLIND: derive the criteria from the GOAL + CONTEXT + canon ONLY. No plan exists ` +
    `yet — do NOT read PLAN.md / ACCEPTANCE.md / SPEC.md even if one is present from a prior attempt.\n` +
    `Write ${root}/.astrocode/phases/${phaseSlug}/CRITERIA.md as falsifiable, goal-level/behavioral ` +
    `criteria — each exactly:\n` +
    `  ### C<n> — <one-line observable claim about the finished system>\n` +
    `  - **Observe:** <command to run + expected observable result, OR artifact/behavior to inspect ` +
    `— independently runnable with only Read/Bash/Grep/Glob>\n` +
    `  - **Fails if:** <the failure mode that makes it FAIL>\n` +
    `Ban structural/existence checks (file-exists, grep-for-a-string, "function defined") — a ` +
    `different valid implementation of the goal must still satisfy every criterion. Return a one-line count.` +
    OBEY,
  { phase: 'Criteria', agentType: 'astro-criteria-author', model: models.planner },
)

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
// ADR-018 + phase-04 t5 safeguard: the Synthesize prompt carries the dynamic-import
// rule inline so the planner has it in direct context when writing tasks — not just in
// agents/astro-planner.md which it reads from disk but may skim under token pressure.
// The closing self-verification instruction is defense-in-depth at the point where
// plans are actually written; it prevents the phase-04 t5 trap (static import of a
// missing symbol crashes the whole test file at load, forcing executors to implement
// the missing export and overflow their declared file).
const summary = await agent(
  `Synthesize an executable plan for phase "${phaseSlug}" (goal: ${goal}).\n\n` +
    `Researcher findings:\n${findings.filter(Boolean).join('\n\n---\n\n')}\n\n` +
    `Write ${root}/.astrocode/phases/${phaseSlug}/PLAN.md as numbered tasks. Each task MUST declare:\n` +
    `  id, title, the files it touches, and depends_on (ids of tasks that must finish first).\n` +
    `Keep tasks small and independently committable so execution can parallelize. ` +
    `Also write ${root}/.astrocode/phases/${phaseSlug}/ACCEPTANCE.md — a short, user-facing ` +
    `UAT checklist of "the user can …" statements a human will confirm before the phase ` +
    `closes (acceptance, not unit tests). ` +
    `The plan MUST conform to the canon and this phase's CONTEXT.md, and MUST aim at every ` +
    `criterion in ${root}/.astrocode/phases/${phaseSlug}/CRITERIA.md — that pre-registered, ` +
    `goal-derived bar is what the verifier will check the result against (the plan does not get ` +
    `to define its own bar).\n\n` +
    `TEST-FIRST RULE (ADR-018 — prevents the phase-04 t5 trap): a RED-test task must ` +
    `NEVER statically import a symbol that does not yet exist on the branch — a static import ` +
    `of a missing export crashes the whole test file at module load, pushing executors to ` +
    `implement the missing export and overflow their declared file. Instead use ` +
    "`const { fn } = await import('../lib/x.mjs')`" + ` inside async test bodies so a missing ` +
    `export fails ONLY the new tests at call time. Test-after serialization (depends_on the ` +
    `impl task) stays allowed when explicitly chosen — the plan must say which it chose.\n\n` +
    `WAVE-GREEN RULE (ADR-020 — every wave boundary must compile): each task must leave the ` +
    `build green ON ITS OWN, because the wave model integrates and gates at every boundary. A ` +
    `destructive edit (deleting/renaming a module or symbol) and the updates to EVERY consumer ` +
    `it breaks (barrel/index re-exports, importers, type references) are ONE atomic task that ` +
    `declares ALL those files. NEVER split a deletion from the barrel/import fixups it forces — ` +
    `the files are disjoint so the wave builder will NOT couple them, and the resulting ` +
    `non-compiling boundary bails the gate. Do NOT use depends_on ordering for this; fold it ` +
    `into one task.\n\n` +
    `Before writing PLAN.md, check EVERY task against these rules — red-test import rule, ` +
    `wave-green rule (no task leaves the build broken; deletions carry their consumer fixups), ` +
    `two same-file tasks never both have empty depends_on, every task declares its file(s) ` +
    `— and fix any violation.\n\n` +
    `Return a one-line summary of the plan.` +
    OBEY,
  { phase: 'Synthesize', agentType: 'astro-planner', model: models.planner },
)

return { phase: phaseSlug, plan: summary }
