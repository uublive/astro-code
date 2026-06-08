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
2. **Discuss gate (substance, not mere presence).** Run `ac phase context <number>` —
   it prints `missing | stub | ready`. A `ready` CONTEXT.md was genuinely produced by
   `/astro-discuss` (it carries the provenance marker); `stub` means a CONTEXT.md exists
   but was never discussed (a placeholder, or pre-marker). On **`missing` or `stub`**,
   strongly suggest running `/astro-discuss <number>` first to surface decisions/edge
   cases — but proceed if the user declines (trivial phases can skip). **Never create or
   seed `CONTEXT.md` yourself** — only `/astro-discuss` writes it; seeding a stub here is
   exactly what defeats this gate. Refresh the team canon best-effort (`ac canon pull`) so
   the agents read the latest. The workflow's agents read the canon + CONTEXT.md from disk
   — you do NOT pass them as args.
3. Mark the live status so the statusline/banner show it: `ac activity '⚙ researching · plan'`.
   Run the planning fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):** keep `args` to small scalars only — pass
     it as a real JSON object, never a string:
     ```
     Workflow({
       scriptPath: "<ac path workflows>/plan-phase.mjs",   // from `ac path workflows`
       args: { root: "<project root>", phase: "<phase slug>", goal: "<phase goal>",
               models: <the JSON object from `ac config get models`> }
     })
     ```
     **Speed override:** if the user passed `--fast`, use the JSON from
     `ac models fast --preview` as the `models` arg instead (a one-off fast preset,
     not persisted). `ac models fast` makes it the project default.
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
4. Clear the live status (`ac activity clear`), then summarize the plan and suggest
   `/astro-execute <number>` (reference the phase by its number, e.g. `/astro-execute 1`).
   Clear it too if planning fails or you stop early.

Only fan out when the phase is worth parallel research — for a trivial phase, just
write PLAN.md directly.
