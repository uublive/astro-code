<!-- astro-discuss: captured -->
# Phase 13 — Warm batched sequential executor

## Goal
Cut the "N cold subagents" tax: when a phase runs sequentially, hand the whole
dependency-ordered task list to ONE warm `astro-executor` (reads canon once, one atomic
stamped commit per task) instead of spawning a fresh executor per task. Small phases then
run about as lean as plain Claude Code.

## The problem (grounded in the code)
`workflows/execute-phase.mjs`, sequential branch (~lines 741–746):
```js
if (strategy === 'sequential' || wave.length === 1 || worktreesUnavailable) {
  for (const t of wave) { const out = await runOnBranch(t); if (out) results.push(out) }
  continue
}
```
`runOnBranch(t)` (~line 473) spawns one `astro-executor` per task — each cold-starts and
re-reads canon + CONTEXT + PLAN + repo via `execPrompt` + `OBEY`. N tasks = N cold starts.

## Decisions (settled with the developer)
1. **Trigger: `strategy === 'sequential'` AND `executableTasks.length >= 2`.** Flatten all
   waves (`waves.flat()` — already a valid topological order) into one dependency-ordered
   list and hand it to ONE executor. A single-task phase keeps `runOnBranch` (no benefit).
   Per-wave batching was rejected (waves don't isolate anything in sequential mode).
2. **Partial-failure = per-task fallback.** The batch returns a structured
   `{ committed: string[], summary }`; the script computes `missing = executableTasks not
   in committed` and re-runs exactly those via the existing `runOnBranch(t)` (mirrors the
   parallel `missingFromWave` recovery). No work lost, no full restart, no silent drop.
3. **Config `lean_execution`, default true** (opt-out). Escape hatch: `args.execMode:
   'per-task'` or `lean_execution=false` restores today's per-task behavior.
4. **The batch executor contract** = `execPrompt`'s contract, iterated over an ordered
   list: **one atomic commit per task, in order, DO NOT squash**, each subject ending with
   the stamp `(phase <NN> <taskId>)` (ADR-017), test-first per task, obey canon.

## Scope
In:
- `workflows/execute-phase.mjs`: add `runBatchOnBranch(orderedTasks)` + `BATCH_SCHEMA`;
  restructure so `strategy === 'sequential' && executableTasks.length >= 2` calls it once
  over `waves.flat()`, then goes to Verify; per-task fallback for `missing`.
- `lib/config.mjs`: new `lean_execution` key (default true) surfaced via `ac config`.
- `commands/astro-execute.md`: one note on lean mode + the `execMode`/`lean_execution`
  escape hatch.
- Tests in `tests/workflows.test.mjs` (extract-and-eval pattern — the Workflow script has
  no importable JS symbol).

Out (untouched):
- The parallel worktree path, the per-wave integrator, and the heal ladder — those are
  phase 14 / unchanged here.
- The worktree-hostile **downgrade** path (`worktreesUnavailable`) keeps per-task —
  it's a rare fallback and mixing it with batching adds no value.
- The verify gate and the effort verify→remediate loop (remediation is already a single
  scoped agent — unaffected). Verify model tier is NOT downgraded (Change 3 rejected).

## Invariants to preserve
- **ADR-017** — per-task stamps still land, so re-run Discover skips done tasks;
  batching that dies mid-run loses nothing.
- **ADR-021** — verifier stays plan-blind and independent.
- **ADR-005 / ADR-008** — the script still runs no git; no parallel writers in one tree
  (the batch is a single serial writer on-branch).
- **ADR-022** — the effort remediate loop is unchanged.
- The `buildWaves` MIRROR / drift-guard region is NOT touched (`waves.flat()` needs no new
  pure helper).

## Verification (what phase CRITERIA should assert, behaviorally)
- A sequential phase with ≥2 executable tasks drives ONE executor call carrying all tasks
  in dependency order with the per-task stamp + no-squash contract — not one call per task.
- A single-task or `execMode:'per-task'`/`lean_execution=false` run still uses per-task.
- Tasks already stamped (`done`) are excluded before batching (resumability preserved).
- A batch that under-reports `committed` triggers per-task re-run of exactly the missing
  ids (no task dropped).
