# Phase 2 — Harden the parallel-execution fallback path

**Goal:** close the integration-conflict gap at its root. The no-Workflow **Agent-tool
fallback** in `commands/astro-execute.md` currently tells the orchestrator to "spawn the
ready tasks as parallel `astro-executor` calls in a single message (each makes one atomic
commit)" — with **no worktree isolation and no integrator**. Parallel agents committing
to the same working tree is exactly what produced the conflicts that forced a manual
revert. Per **ADR-008**, when the Workflow tool is unavailable, execution must degrade to
**sequential** — never parallel-without-isolation.

## Design decision (settled — see ADR-008)

The Workflow path (`workflows/execute-phase.mjs`) is the only place parallel-safe
execution is done *deterministically* (worktree isolation + a sole-git-actor integrator
that aborts on conflict). Re-implementing that integrator orchestration in markdown prose
is fragile — the model would have to reliably wave-group, spawn worktree agents, run an
integrator, and stop on conflict, every time. So the fallback **degrades to sequential**:
run ready tasks one at a time in dependency order, one atomic commit each, so each task
(and the verifier) sees prior commits and no two agents ever touch the same tree.
Rejected: full worktree+integrator parity in prose; hybrid auto-strategy.

## Tasks

### t1 — Rewrite the Agent-tool fallback tier to force sequential
- **file:** `commands/astro-execute.md`
- **depends_on:** []
- Replace the "**No Workflow tool, but the Agent tool is available**" bullet
  (currently lines ~40-44) so it instructs: read the plan's tasks + `depends_on`, order
  them into a valid dependency (topological) order, then spawn `astro-executor` **one
  task at a time** (NOT parallel, NOT batched in a single message) — each makes one
  atomic commit that the next task and the verifier can see. After all tasks, spawn
  `astro-verifier`. Tell each agent to read the canon + CONTEXT.md.
- State the invariant explicitly and cite the ADR: *without the Workflow tool there is
  no worktree isolation or integrator, so tasks run sequentially — never spawn parallel
  executors that commit to the same working tree (ADR-008).*
- Leave the two safe tiers intact: the **Workflow** tier (worktree+integrator, the only
  parallel path) above it, and the **No subagents at all** inline tier below it. The
  fallback now mirrors the inline tier's ordering, just using `astro-executor` agents so
  heavy work still runs in isolated contexts and the main session stays lean.
- Keep the command's voice, numbered structure, and frontmatter accurate (the
  `description` already says "sequential, or parallel worktrees+integrator" — still true).

### t2 — Regression guard: the fallback tier must mandate sequential
- **file:** `tests/commands.test.mjs`
- **depends_on:** [t1]
- New `node:test` suite reading `commands/astro-execute.md`. Isolate the
  "No Workflow tool, but the Agent tool is available" tier (the text between that bullet
  and the "No subagents at all" bullet) and assert the safety invariant robustly:
  1. the tier requires sequential execution — it contains `sequential` and/or
     `one at a time` / `one task at a time`;
  2. the tier does NOT re-introduce the unsafe pattern — it must not instruct parallel
     executors in the same tree (e.g. must not contain `parallel` + `astro-executor`
     together, nor `in a single message`, within that tier).
- Test against the real file (read from disk via `import.meta.url` + `node:fs`), match
  the canon's `tests/<area>.test.mjs` naming and sentence-form test names. Keep the
  assertions invariant-focused (presence/absence of the safety phrasing) so a benign
  reword doesn't break it, but a regression to parallel-no-isolation does.

## Wave shape

- Wave 1: t1
- Wave 2: t2 (depends on t1)

(Two tasks, two distinct files — trivially collision-free. ≤ seqBudget, so `/astro-execute`
will run this sequentially on-branch.)

## Out of scope

- The Workflow tier and the integrator agent (already safe — ADR-005).
- The `astro-executor` agent definition (its one-atomic-commit contract is unchanged).
- Adding parallelism to the fallback (explicitly rejected — ADR-008).
