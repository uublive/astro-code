---
description: Plan a phase — fan out parallel researchers, then synthesize an executable PLAN.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Plan phase `$ARGUMENTS` by running the parallel planning workflow.

1. Resolve the project root (`ac path` is the framework; the project root is where
   `.astrocode/` lives — find it from the cwd). Resolve the phase slug from
   `ac roadmap list` (e.g. `03` → `03-payments`). Read the phase goal from
   `.astrocode/PROJECT.md` / the roadmap entry.
2. Read the discussion brief: `.astrocode/phases/<slug>/CONTEXT.md` (written by
   `/astro-discuss`). If it's **missing**, suggest running `/astro-discuss <phase>`
   first to surface decisions/edge cases — but proceed if the user declines.
   Then refresh the team canon (`ac canon pull` — best-effort) and gather inputs:
   workflow path (`ac path workflows`), model tiers (`ac config get models`), and the
   **project canon** (`ac canon`).
3. Run the planning fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):**
     ```
     Workflow({
       scriptPath: "<ac path workflows>/plan-phase.mjs",
       args: { root: "<project root>", phase: "<phase slug>", goal: "<phase goal>",
               models: <ac config get models>, canon: "<ac canon>",
               context: "<CONTEXT.md contents, or empty>" }
     })
     ```
     It runs in the background — tell the user to **watch `/workflows`** for live
     progress; you'll be notified on completion.
   - **No Workflow tool, but the Agent tool is available:** spawn the researchers
     yourself — issue the parallel `astro-researcher` (or Explore) calls in a single
     message (one per angle: codebase patterns, external best practices, risks), then
     spawn `astro-planner` to synthesize. Pass the canon, goal, and CONTEXT.md in each
     prompt.
   - **No subagents at all:** do it inline in this session — research the angles
     yourself, then write the plan. Slower, no parallelism, but it works.
   Either way the result is `.astrocode/phases/<slug>/PLAN.md` (+ `ACCEPTANCE.md`)
   with numbered, dependency-aware tasks conforming to the canon.
4. Summarize the plan and suggest `/astro-execute <phase>`.

Only fan out when the phase is worth parallel research — for a trivial phase, just
write PLAN.md directly.
