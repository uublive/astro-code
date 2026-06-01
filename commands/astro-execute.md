---
description: Execute a phase wave-by-wave — parallel executors in isolated worktrees, then verify
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Execute phase `$ARGUMENTS`.

1. Resolve the project root (where `.astrocode/` lives) and the phase slug from
   `ac roadmap list`. Confirm `.astrocode/phases/<slug>/PLAN.md` exists — if not,
   tell the user to run `/astro-plan <phase>` first.
2. Mark the phase active: `ac state set active_phase <slug>`.
3. Refresh the team canon (`ac canon pull` — best-effort). Then gather inputs:
   workflow path (`ac path workflows`), model tiers (`ac config get models`), and the
   **project canon** (`ac canon`).
4. Run the execution fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):**
     ```
     Workflow({
       scriptPath: "<ac path workflows>/execute-phase.mjs",
       args: { root: "<project root>", phase: "<phase slug>",
               models: <ac config get models>, canon: "<ac canon>" }
     })
     ```
     It discovers the plan's tasks + dependencies, groups them into waves, runs each
     wave's tasks **in parallel inside isolated git worktrees** (atomic commit per
     task), then verifies. It runs in the background — tell the user to **watch
     `/workflows`** for live wave-by-wave progress; you'll be notified on completion.
   - **No Workflow tool, but the Agent tool is available:** read the plan's tasks +
     `depends_on`, group them into dependency waves yourself, and for each wave spawn
     the ready tasks as parallel `astro-executor` calls in a single message (each
     makes one atomic commit). Then spawn `astro-verifier`. Pass the canon in prompts.
   - **No subagents at all:** execute the tasks inline, in dependency order, one
     atomic commit each, then verify yourself.
5. Report the verdict.
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate),
     then tell the user to run **`/astro-accept <slug>`** for UAT sign-off, which is
     what actually closes the phase.
   - **FAIL** → surface the reasons and stop; leave the phase unverified.

Execution + the in-workflow verifier produce a **verified** phase at best — never
**complete**. Only human UAT (`/astro-accept`) closes a phase.
