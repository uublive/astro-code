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
4. Invoke the **Workflow** tool:
   ```
   Workflow({
     scriptPath: "<ac path workflows>/execute-phase.mjs",
     args: { root: "<project root>", phase: "<phase slug>",
             models: <ac config get models>, canon: "<ac canon>" }
   })
   ```
   It discovers the plan's tasks + dependencies, groups them into waves, runs each
   wave's tasks **in parallel inside isolated git worktrees** (atomic commit per
   task), then verifies the phase goal.
5. Report the verdict.
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate),
     then tell the user to run **`/astro-accept <slug>`** for UAT sign-off, which is
     what actually closes the phase.
   - **FAIL** → surface the reasons and stop; leave the phase unverified.

Execution + the in-workflow verifier produce a **verified** phase at best — never
**complete**. Only human UAT (`/astro-accept`) closes a phase.
