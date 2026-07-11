---
description: Run one phase end-to-end — discuss → plan → execute → verify — then stop for your inspection
argument-hint: <phase number or slug> [--fast]
allowed-tools: Bash, Read, Write, Workflow, AskUserQuestion
---

Run phase `$ARGUMENTS` through the **whole pipeline in one go** — discuss → plan →
execute → verify — so you don't re-type four commands per phase. It deliberately
**stops after this one phase** for your inspection; it does NOT auto-advance to the
next phase. Re-run `/astro-autonomous` to do the next one.

If `$ARGUMENTS` names no phase, pick the **lowest-numbered phase that isn't `complete`**
from `ac roadmap list` (skip `rejected` unless the user asked for it). If everything is
complete, say so and suggest `/astro-milestone`. Resolve the project root (where
`.astrocode/` lives) and the phase slug up front.

**Pass-through:** if the user included `--fast`, carry it into the plan and execute steps
below (one-off fast preset; see those commands). Otherwise use the configured tiers.

## Pipeline (stop at the first hard failure — never push past a broken gate)

1. **Discuss gate.** Run `ac phase context <number>`. If it prints `ready`, skip to
   planning. If `missing` or `stub`, run the **`/astro-discuss <number>`** flow now —
   its adaptive `AskUserQuestion` rounds are interactive by design; that human input is
   the point, so don't fake it. Capture to `CONTEXT.md` (with the provenance marker), then
   continue. The user may decline discussion for a trivial phase — honor that and proceed.

2. **Plan.** Run the **`/astro-plan <number>`** flow (the plan-phase Workflow, or its
   graceful fallback). It writes a plan-blind, goal-derived `CRITERIA.md` first (the
   verifier's bar), then `PLAN.md` + `ACCEPTANCE.md`. If planning fails or produces
   no tasks, stop and report — do not execute an empty plan.

3. **Execute + verify.** Run the **`/astro-execute <number>`** flow. The execute-phase
   workflow already runs the verifier against the integrated branch at the end, so this
   step yields a PASS/FAIL verdict — you do not verify separately. If it returns
   `integrationFailed`, surface the conflict/cleanup hint and stop.

4. **Report and STOP.**
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate), then
     stop. Tell the user this phase is done and waiting for human UAT: **`/astro-accept
     <number>`** closes it, and re-running `/astro-autonomous` starts the next phase.
     State is on disk, so `/clear` first loses nothing.
   - **FAIL** (verify failed, plan empty, or integration conflict) → surface the reasons,
     leave the phase unverified, and stop. Do not advance.

## Guardrails

- **One phase per run.** This is the "pause after every phase" contract — the most
  cautious autonomous mode. You inspect (and `/astro-accept`) before anything proceeds.
- **Never auto-accept.** The pipeline produces a **verified** phase at best; only human
  `/astro-accept` makes it **complete**. The AI never closes its own work.
- **Stop loud, not silent.** Any failed gate halts the run with the reason — never paper
  over a failure to "keep the pipeline moving."
- Clear the live status (`ac activity clear`) on any stop, success or failure.
