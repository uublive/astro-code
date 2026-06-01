---
description: Execute a phase wave-by-wave on the working branch — sequential, or parallel worktrees+integrator, then verify
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Execute phase `$ARGUMENTS`.

1. Resolve the project root (where `.astrocode/` lives) and the phase slug from
   `ac roadmap list`. Confirm `.astrocode/phases/<slug>/PLAN.md` exists — if not,
   tell the user to run `/astro-plan <phase>` first.
2. Mark the phase active: `ac state set active_phase <slug>`.
3. Refresh the team canon best-effort (`ac canon pull`). The workflow's agents read
   the canon + CONTEXT.md from disk — you do NOT pass them as args.
4. Run the execution fan-out. Use the **best available** mechanism (graceful fallback):
   - **Workflow tool available (preferred):** keep `args` to small scalars only — pass
     it as a real JSON object, never a string:
     ```
     Workflow({
       scriptPath: "<ac path workflows>/execute-phase.mjs",   // from `ac path workflows`
       args: { root: "<project root>", phase: "<phase slug>",
               models: <the JSON object from `ac config get models`> }
     })
     ```
     It discovers the plan's tasks + dependencies, groups them into waves, and
     executes them **on the current working branch**, picking a strategy automatically:
     small phases (or any with no parallelizable wave) run **sequentially on-branch**
     — each atomic commit is visible to the next task and to the verifier; larger,
     wide phases run each wave's tasks **in parallel inside isolated worktrees** and
     then an **integrator agent folds the wave back onto the branch** before the next
     wave (so dependencies see prior changes and nothing is stranded). Override with
     `args.strategy: "sequential" | "parallel"`, or tune the cutover with
     `args.seqBudget` (default 8 tasks). The verifier runs against the integrated
     branch, never a pristine `main`. It runs in the background — tell the user to
     **watch `/workflows`** for live wave-by-wave progress; you'll be notified on
     completion. If the result has `integrationFailed`, surface its conflict/cleanup
     hint and stop (do not mark the phase verified).
   - **No Workflow tool, but the Agent tool is available:** read the plan's tasks +
     `depends_on`, group them into dependency waves yourself, and for each wave spawn
     the ready tasks as parallel `astro-executor` calls in a single message (each
     makes one atomic commit). Then spawn `astro-verifier`. Tell each agent to read the
     canon + CONTEXT.md.
   - **No subagents at all:** execute the tasks inline, in dependency order, one
     atomic commit each, then verify yourself.
5. Report the verdict.
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate),
     then tell the user to run **`/astro-accept <slug>`** for UAT sign-off, which is
     what actually closes the phase.
   - **FAIL** → surface the reasons and stop; leave the phase unverified.

Execution + the in-workflow verifier produce a **verified** phase at best — never
**complete**. Only human UAT (`/astro-accept`) closes a phase.
