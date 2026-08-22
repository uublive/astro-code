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
               models: <the JSON object from `ac config get models`>,
               effort: <the level from `ac phase effort <slug>` (see the --effort note below)>,
               useWorktrees: <the boolean from `ac config get use_worktrees`>,
               leanExecution: <the boolean from `ac config get lean_execution`> }
     })
     ```
     `useWorktrees` honors `config.use_worktrees`: set it `false` (e.g. `ac config set
     use_worktrees false`) on a worktree-hostile machine — where parallel agents fail
     with "Cannot create agent worktree: not in a git repository" — and the workflow
     runs sequentially on-branch instead of fighting the harness. (Even when `true`,
     the workflow auto-downgrades a run to sequential after the first wave where a
     majority of worktree creations fail, so the noise happens at most once.)
     `leanExecution` honors `config.lean_execution` (default **true**): a sequential
     phase with 2+ executable tasks runs as **ONE warm/batched `astro-executor`** over
     all tasks in dependency order (reads canon once, still one atomic stamped commit
     per task) instead of a cold executor per task — small phases then run about as lean
     as plain Claude Code. Turn it off with a persisted `ac config set lean_execution
     false`, or a one-off `args.execMode: "per-task"` on this call, to restore the
     original one-executor-per-task behavior.
     **Speed override:** if the user passed `--fast`, use the JSON from
     `ac models fast --preview` as the `models` arg instead (a one-off fast preset —
     sonnet everywhere except the opus verify gate — that is NOT persisted to config).
     To make it the project default instead, they'd run `ac models fast` once.
     **Effort override:** resolve the effective effort level and pass it as `args.effort`.
     Default = `ac phase effort <slug>` (the phase's stored level, or the hardcoded
     `standard` when it carries none). If the user passed `--effort <light|standard|deep>`,
     resolve `ac phase effort <slug> --effort <level>` instead — a one-off, run-scoped
     override that is NEVER written back to `roadmap.json` (mirrors `--fast`). Do NOT
     recompute model tiers here: the workflow applies `deep`→opus (executor + verifier,
     in-memory only) and the level→cycle budget itself. The level sets an **automated
     verify→remediate loop**: on a mid-phase verify FAIL the workflow re-runs the
     `astro-executor` scoped to only the unmet criteria (up to `light`=0 / `standard`=1 /
     `deep`=3 cycles) and re-verifies, **bailing early to a human-facing FAIL on
     no-progress** (HEAD didn't move, or the failing-criteria set didn't shrink). It
     reaches `verified` at best — never auto-accepts (REQ-006).
     It discovers the plan's tasks + dependencies, groups them into waves, and
     executes them **on the current working branch**, picking a strategy automatically:
     small phases (or any with no parallelizable wave) run **sequentially on-branch**
     — each atomic commit is visible to the next task and to the verifier; larger,
     wide phases run each wave's tasks **in parallel inside isolated worktrees** and
     then an **integrator agent folds the wave back onto the branch** before the next
     wave (so dependencies see prior changes and nothing is stranded). The integrator
     runs at the cheap `models.integrator` tier — **haiku by default, even when the
     project config never mentions the role** (override with `ac config set
     models.integrator sonnet`, or the `max` profile, which carries it as `sonnet`).
     Its job is mechanical git (a stamp-mapped cherry-pick), so the bail a user
     actually sees stays per-branch, not per-wave: a stale, peer-colliding, or
     conflicted branch is **preserved and reported** while its clean peers still land
     in the same pass, and only that branch's task is re-run through the heal ladder
     at the full `models.executor` tier — heal, the post-heal test gate, and teardown
     are never cheapened. Override with
     `args.strategy: "sequential" | "parallel"`, or tune the cutover with
     `args.seqBudget` (default 8 tasks). The verifier runs against the integrated
     branch, never a pristine `main`. It runs in the background — tell the user to
     **watch `/workflows`** for live wave-by-wave progress; you'll be notified on
     completion. If the result has `integrationFailed`, surface its conflict/cleanup
     hint and stop (do not mark the phase verified) — this also fires when the
     integrator claims a teardown outside the branches it cleanly cherry-picked in
     this run, which the script catches as a plain data check before trusting the
     agent's report.
   - **No Workflow tool, but the Agent tool is available:** without the Workflow tool
     there is no worktree isolation or integrator, so tasks run sequentially — never
     spawn parallel executors that commit to the same working tree (ADR-008). Read the
     plan's tasks + `depends_on`, produce a valid topological order, then spawn one
     `astro-executor` call at a time (NOT parallel, NOT batched in a single message) —
     each makes one atomic commit so the next task and the verifier can see prior
     changes. After all tasks complete, spawn `astro-verifier`. Tell each agent to read
     the canon + CONTEXT.md. Tell each `astro-executor` to end its commit subject with
     `(phase NN tK)` — NN is the leading number from the phase slug, tK is the task id —
     so the run is resumable if re-executed (ADR-017).
     Honor the effort dial here too: resolve the level (`ac phase effort <slug>`, or
     `ac phase effort <slug> --effort <level>` for a `--effort` one-off) and, for `deep`,
     use the opus tier for both the `astro-executor` and `astro-verifier` calls (in-memory
     only — never persisted). On a verify FAIL, run the same bounded verify→remediate loop:
     re-spawn the existing `astro-executor` scoped to ONLY the unmet criteria (with the
     verifier's failing command + output as evidence, plan-blind — never a new agent type),
     one atomic commit, then re-verify — up to the level's budget (`light`=0 / `standard`=1
     / `deep`=3 cycles) and **bailing early to FAIL on no-progress** (HEAD unchanged, or the
     failing-criteria set didn't shrink).
     The warm/batched executor described above is a **Workflow-tool optimization only** — at
     this tier every task is already spawned one-at-a-time by construction (ADR-008), so
     there's no per-task cold-start to eliminate and no `leanExecution` equivalent here.
   - **No subagents at all:** execute the tasks inline, in dependency order, one
     atomic commit each, then verify yourself.
5. Clear the live status (`ac activity clear` — also clear it on any early stop or
   `integrationFailed`), then report the verdict. `verdict` is now a **structured object**
   — read `verdict.passed` (boolean) for PASS/FAIL and `verdict.summary` for the
   human-facing reason text (the workflow has returned by now — safe to suggest `/clear`).
   - **`verdict.passed` true** → run `ac phase verify <slug>` (marks it **verified** — the
     AI gate), then tell the user to run **`/astro-accept <number>`** (by number, e.g.
     `/astro-accept 3`) for UAT sign-off, which is what actually closes the phase.
     Optionally add: state is saved to `.astrocode/`, so `/clear` before `/astro-accept`
     (or the next phase) keeps context lean and loses nothing — a suggestion, not a
     requirement.
   - **`verdict.passed` false** → surface `verdict.summary` (and, when present,
     `stoppedReason: 'no-progress' | 'max-cycles'` from the verify→remediate loop) and
     stop; leave the phase unverified.

Execution + the in-workflow verifier produce a **verified** phase at best — never
**complete**. Only human UAT (`/astro-accept`) closes a phase.
