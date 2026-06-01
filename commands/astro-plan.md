---
description: Plan a phase — fan out parallel researchers, then synthesize an executable PLAN.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Plan phase `$ARGUMENTS` by running the parallel planning workflow.

1. Resolve the project root (`ac path` is the framework; the project root is where
   `.planning/` lives — find it from the cwd). Resolve the phase slug from
   `ac roadmap list` (e.g. `03` → `03-payments`). Read the phase goal from
   `.planning/PROJECT.md` / the roadmap entry.
2. Get the workflow path (`ac path workflows`) and the model tiers
   (`ac config get models`).
3. Invoke the **Workflow** tool:
   ```
   Workflow({
     scriptPath: "<ac path workflows>/plan-phase.mjs",
     args: { root: "<project root>", phase: "<phase slug>", goal: "<phase goal>",
             models: <ac config get models> }
   })
   ```
   This spawns researchers in parallel (codebase patterns, external best practices,
   risks) and synthesizes `.planning/phases/<slug>/PLAN.md` with numbered,
   dependency-aware tasks.
4. Summarize the plan and suggest `/astro-execute <phase>`.

Only opt into the Workflow when this is a real phase worth parallel research — for a
trivial phase, just write PLAN.md directly.
