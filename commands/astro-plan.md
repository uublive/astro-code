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
2. If `.astrocode/phases/<slug>/CONTEXT.md` is **missing**, suggest running
   `/astro-discuss <phase>` first to surface decisions/edge cases — but proceed if the
   user declines. Refresh the team canon best-effort (`ac canon pull`) so the agents
   read the latest. The workflow's agents read the canon + CONTEXT.md from disk — you
   do NOT pass them as args.
3. Run the planning fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):** keep `args` to small scalars only — pass
     it as a real JSON object, never a string:
     ```
     Workflow({
       scriptPath: "<ac path workflows>/plan-phase.mjs",   // from `ac path workflows`
       args: { root: "<project root>", phase: "<phase slug>", goal: "<phase goal>",
               models: <the JSON object from `ac config get models`> }
     })
     ```
     It runs in the background — tell the user to **watch `/workflows`** for live
     progress; you'll be notified on completion.
   - **No Workflow tool, but the Agent tool is available:** spawn the researchers
     yourself — parallel `astro-researcher` (or Explore) calls in one message (codebase
     patterns, external best practices, risks), then `astro-planner` to synthesize.
     Tell each agent to read the canon + `.astrocode/phases/<slug>/CONTEXT.md`.
   - **No subagents at all:** do it inline in this session — research the angles
     yourself, then write the plan. Slower, no parallelism, but it works.
   Either way the result is `.astrocode/phases/<slug>/PLAN.md` (+ `ACCEPTANCE.md`)
   with numbered, dependency-aware tasks conforming to the canon.
4. Summarize the plan and suggest `/astro-execute <phase>`.

Only fan out when the phase is worth parallel research — for a trivial phase, just
write PLAN.md directly.
