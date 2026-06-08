---
description: Execute a phase wave-by-wave on the working branch — sequential, or parallel worktrees+integrator, then verify
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Write, Workflow
---

Execute phase `$ARGUMENTS`.

1. Resolve the project root (where `.astrocode/` lives) and the phase slug from
   `ac roadmap list`. Confirm `.astrocode/phases/<slug>/PLAN.md` exists — if not,
   tell the user to run `/astro-plan <number>` first (reference the phase by its
   number, e.g. `/astro-plan 3`).
2. Mark the phase active and surface the live status: `ac state set active_phase <slug>`
   then `ac activity '⚙ executing'` (the statusline/banner pick it up).
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
     **Speed override:** if the user passed `--fast`, use the JSON from
     `ac models fast --preview` as the `models` arg instead (a one-off fast preset —
     sonnet everywhere except the opus verify gate — that is NOT persisted to config).
     To make it the project default instead, they'd run `ac models fast` once.
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
   - **No Workflow tool, but the Agent tool is available:** without the Workflow tool
     there is no worktree isolation or integrator, so tasks run sequentially — never
     spawn parallel executors that commit to the same working tree (ADR-008). Read the
     plan's tasks + `depends_on`, produce a valid topological order, then spawn one
     `astro-executor` call at a time (NOT parallel, NOT batched in a single message) —
     each makes one atomic commit so the next task and the verifier can see prior
     changes. After all tasks complete, spawn `astro-verifier`. Tell each agent to read
     the canon + CONTEXT.md.
   - **No subagents at all:** execute the tasks inline, in dependency order, one
     atomic commit each, then verify yourself.
5. Clear the live status (`ac activity clear` — also clear it on any early stop or
   `integrationFailed`), then report the verdict (the workflow has returned by now — safe to suggest `/clear`).
   - **PASS** → run `ac phase verify <slug>` (marks it **verified** — the AI gate),
     then tell the user to run **`/astro-accept <number>`** (by number, e.g. `/astro-accept 3`) for UAT sign-off, which is
     what actually closes the phase. Optionally add: state is saved to `.astrocode/`,
     so `/clear` before `/astro-accept` (or the next phase) keeps context lean and
     loses nothing — a suggestion, not a requirement.
   - **FAIL** → surface the reasons and stop; leave the phase unverified.

Execution + the in-workflow verifier produce a **verified** phase at best — never
**complete**. Only human UAT (`/astro-accept`) closes a phase.
