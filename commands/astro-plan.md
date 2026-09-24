---
description: Plan a phase — fan out parallel researchers, then synthesize an executable PLAN.md
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow, ToolSearch
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
   the agents read the latest. A refusal or collision warning is **not** a failure to retry
   or force — report it in the run summary and continue, **in one line** naming the file and
   the two escapes (retry or force), never the diff; never pass `--force` from an agent. Then
   run ONE `ac principles ask "<question built from the phase goal>"` call. This fires here,
   in the command body, so it runs in every tier (Workflow, Agent-fallback, inline) — not
   only via the `PRINCIPLES_RESEARCH`/`PRINCIPLES_PLAN` instructions the workflow's own agents
   run for themselves (`workflows/plan-phase.mjs`). The result is **not** passed as a
   `Workflow` arg — `args` stay small JSON scalars only (step 3) — state in one line what it
   returned ("a personal principle already settled X — not re-asking") so the plan does not
   relitigate it. The workflow's agents read the canon + CONTEXT.md from disk — you do NOT
   pass them as args.
3. Mark the live status so the statusline/banner show it: `ac activity '⚙ researching · plan'`.
   Run the planning fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):** keep `args` to small scalars only — pass
     it as a real JSON object, never a string:
     ```
     Workflow({
       scriptPath: "<ac path workflows>/plan-phase.mjs",   // from `ac path workflows`
       args: { root: "<project root>", phase: "<phase slug>", goal: "<phase goal>",
               models: <the JSON object from `ac config get models`>,
               reasoning: <the JSON object from `ac config get reasoning`> }
     })
     ```
     **Speed override:** if the user passed `--fast`, use the JSON from
     `ac models fast --preview` as the `models` arg instead (a one-off fast preset,
     not persisted). `ac models fast` makes it the project default.
     It runs in the background — say so **in one line**: it runs in the background, watch
     `/workflows`; you'll be notified on completion.
   - **No Workflow tool, but the Agent tool is available:** spawn the researchers
     yourself — parallel `astro-researcher` (or Explore) calls in one message (codebase
     patterns, external best practices, risks), then `astro-planner` to synthesize.
     Tell each agent to read the canon + `.astrocode/phases/<slug>/CONTEXT.md`.
   - **No subagents at all:** do it inline in this session — research the angles
     yourself, then write the plan. Slower, no parallelism, but it works.
   Either way the workflow first pre-registers `.astrocode/phases/<slug>/CRITERIA.md` —
   a **plan-blind, goal-derived** bar written *before* the researchers run (the verifier
   checks the result against it, so it must not be shaped by the plan) — then the result
   is `.astrocode/phases/<slug>/PLAN.md` (+ `ACCEPTANCE.md`) with numbered,
   dependency-aware tasks conforming to the canon and aimed at every criterion.
3b. **Commit the plan artifacts (ADR-035).** `plan-phase.mjs` writes `CRITERIA.md`,
   `PLAN.md` and `ACCEPTANCE.md` and leaves them UNTRACKED. Untracked files in the shared
   working tree are one `git stash -u` / `git clean` away from gone — that is exactly how a
   completed plan was destroyed in benchmark #2, with every downstream step still reporting
   success. Commit them now — **unless an `/astro-execute` run is in flight on this working
   branch** (the pipelined plan of `/astro-execute` step 4b): then leave them untracked and
   commit right after that run returns. A commit mid-wave moves the base every running
   branch forked from (#22); the integrator's ban on unscoped `git stash`/`git clean`
   (ADR-035) covers the untracked window. Otherwise, commit now:

   ```
   git add .astrocode/phases/<slug>/ && git commit -m "plan(<slug>): pre-registered criteria + executable plan"
   ```

   Do this BEFORE suggesting `/astro-execute`. It also means the pre-registered bar is in
   git history before any implementation exists, which is what makes ADR-021's plan-blind
   claim auditable after the fact rather than merely asserted. Report the commit **in one
   line** — or say nothing at all when the commit is a no-op (nothing to commit).

4. Clear the live status (`ac activity clear`), then report the plan summary in **at most
   three lines**: the task count and wave shape, the single next command
   (`/astro-execute <number>`, referencing the phase by its number, e.g. `/astro-execute 1`),
   and where the detail lives (`PLAN.md` / `CRITERIA.md`). If the result's `criteria.removed`
   is non-empty (a re-plan dropped criteria from the registered bar), name each removed id
   and its reason in one extra line and ask the user to confirm before `/astro-execute` —
   the verifier grades against this file. Do not restate the task list in
   chat — `PLAN.md` is the artifact and it stays dense. Clear the live status too if planning
   fails or you stop early.

Only fan out when the phase is worth parallel research — for a trivial phase, just
write PLAN.md directly.
