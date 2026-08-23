# CRITERIA — 13-warm-batched-sequential-executor

> Pre-registered, goal-derived bar. The verifier checks ONLY the goal + these criteria +
> evidence it gathers itself. It must not trust PLAN.md, task summaries, or commit messages.
>
> **Harness note (shared by C1–C5).** `workflows/execute-phase.mjs` is a Workflow-tool
> script: a top-level-`await` body that ends in `return {…}` and reaches the outside world
> ONLY through the injected hooks `phase`, `agent`, `parallel`, `log`. So its behavior is
> directly drivable: read the source, strip the leading `export ` from the `meta` line, wrap
> the body in an `AsyncFunction(phase, agent, parallel, log, args)`, and inject stubs — a
> recording `agent` that returns a shape keyed off the passed `schema`/label (Discover → a
> chosen `{tasks:[…]}`; the verifier agent → `{passed:true,criteriaFound:true,summary:'',criteria:[]}`;
> a task-executor call → the `committed`/summary you choose), a `parallel` that records and
> resolves each thunk, and no-op `phase`/`log`. Run it with `args={root, phase, strategy, …}`
> and inspect the recorded `agent()` calls (prompt text + options) and the returned object.
> "A task-implementation executor call" = an `agent()` call in phase `Execute`, agentType
> `astro-executor`, whose prompt implements phase task(s) (not the integrator/testgate/
> teardown/remediation calls, which don't fire on a clean sequential+PASS run).

### C1 — By default, a sequential phase with ≥2 executable tasks is implemented by ONE warm executor pass over all tasks (dependency order), not one executor per task
- **Observe:** Drive the harness with a Discover result of ≥2 not-done tasks in a known
  dependency order and `args={root, phase:'13-…', strategy:'sequential'}` and NO opt-out.
  Have the executor stub report every task as committed. Record the `agent()` calls. Expect
  **exactly one** task-implementation executor call, and its prompt must enumerate **all**
  executable task ids in `waves.flat()` (dependency-respecting) order.
- **Fails if:** two or more separate executor calls are made each carrying a single task (the
  per-task path is still taken); OR the single call omits, reorders, or duplicates task ids
  vs. the dependency order; OR no executor call is made at all.

### C2 — A documented escape hatch restores the original one-executor-per-task behavior
- **Observe:** Same ≥2 not-done Discover result. Drive it (a) with `args.execMode:'per-task'`,
  and (b) with the `lean_execution`-disabled signal the workflow actually consumes (identify
  it by Reading how the script reads its opt-out; e.g. an arg derived from
  `lean_execution=false`). In BOTH runs, expect **N** task-implementation executor calls for N
  executable tasks, each carrying exactly one task id — never a single call carrying all tasks.
- **Fails if:** either opt-out still yields the single batched call; OR an opt-out is ignored
  and batching happens anyway; OR fewer than N implementation calls occur (a task is dropped).

### C3 — Batching preserves ADR-017 resumability: already-done tasks are excluded and each batched task keeps its own stamped commit (no squash)
- **Observe:** Discover returns e.g. 4 tasks (a dependency chain) with exactly one marked
  `done:true` and three `done:false`. Run sequential default. Inspect the single batch
  executor call: its ordered task set must be **exactly the three not-done ids** (the done id
  absent), in dependency order, and its prompt must require a **separate atomic commit per
  task**, each commit subject ending with the stamp `(phase 13 <taskId>)`.
- **Fails if:** the `done` task appears in the batch; OR any not-done task is missing; OR the
  contract asks for a single squashed/combined commit or omits the per-task `(phase 13 <taskId>)`
  stamp for any task (either would break skip-on-re-run resumability if the batch dies midway).

### C4 — A batch that under-reports its commits triggers a per-task re-run of exactly the missing tasks — no task dropped, none redone
- **Observe:** Discover returns three executable tasks `[t1,t2,t3]`; make the batch executor
  stub return `committed:['t1','t3']` (t2 absent). Run sequential default and record calls.
  Expect the single batch call followed by **exactly one** additional per-task executor call
  carrying **t2**, and none for t1/t3.
- **Fails if:** no recovery call is made for t2 (silent drop); OR t1/t3 are re-run
  (already-committed work redone); OR the entire batch is restarted; OR any task outside the
  missing set is re-run.

### C5 — The change is surgical: the parallel/worktree path, heal ladder, integrator, verify tier, and the wave-building MIRROR region are unchanged, and the script still runs no git itself
- **Observe:** (a) Run `node --test tests/workflows.test.mjs` (via `host` if the sandbox lacks
  node) — every pre-existing guard (MIRROR-drift, integrator prompt, heal ladder, verify) still
  passes. (b) In the harness, drive with `strategy:'parallel'` and a wave of width ≥2: the
  `parallel()` stub is invoked (worktree-isolation path) and NO single batch executor call is
  made. (c) The full harness run for C1 completes using only the injected stubs — the script
  body never spawns a subprocess or runs git directly.
- **Fails if:** any pre-existing workflows test fails; OR `strategy:'parallel'` now routes
  through the batch path; OR the MIRROR region no longer matches `lib/waves.mjs`; OR the
  script attempts to run git/`child_process` itself rather than through an agent.

### C6 — The astro-execute command doc tells users that multi-task sequential phases run as one warm batched executor by default, and how to turn it off
- **Observe:** Read `commands/astro-execute.md`. In actionable prose it must state that a
  sequential phase with multiple tasks is executed by a single warm/batched executor by
  default, AND name the concrete opt-out (`execMode:'per-task'` and/or `lean_execution=false`)
  that returns to per-task execution.
- **Fails if:** the doc never mentions the batched/lean default; OR it describes the batching
  but offers no way to disable it; OR the opt-out it names does not match the switch the
  workflow actually honors (as exercised in C2).
