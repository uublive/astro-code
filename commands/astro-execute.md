---
description: Execute a phase wave-by-wave — parallel executors in isolated worktrees, then verify
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Execute phase `$ARGUMENTS`.

1. Resolve the project root (where `.planning/` lives) and the phase slug from
   `ac roadmap list`. Confirm `.planning/phases/<slug>/PLAN.md` exists — if not,
   tell the user to run `/astro-plan <phase>` first.
2. Mark the phase active: `ac state set active_phase <slug>`.
3. Get the workflow path (`ac path workflows`) and model tiers
   (`ac config get models`).
4. Invoke the **Workflow** tool:
   ```
   Workflow({
     scriptPath: "<ac path workflows>/execute-phase.mjs",
     args: { root: "<project root>", phase: "<phase slug>", models: <ac config get models> }
   })
   ```
   It discovers the plan's tasks + dependencies, groups them into waves, runs each
   wave's tasks **in parallel inside isolated git worktrees** (atomic commit per
   task), then verifies the phase goal.
5. Report the verdict. If PASS, suggest `/astro-verify` then the next phase. If
   FAIL, surface the reasons and stop.

After a green phase, mark it: `ac state set active_phase null` and update the
roadmap status as appropriate.
