**What happens.** `workflows/execute-phase.mjs` `strategy: auto` picks `parallel` for a plan that is a strictly serial chain (every task depends only on the one before) when Discover marks some tasks in the middle of the chain `done: true`. The run then reports a wrong integration result.

**Cause (v0.55.0).** `executableTasks = tasks.filter(t => !t.done)` (line ~650) and `buildWaves(executableTasks, preCompleted)` seeds `completed` with every done id (373-376). A pending task whose only dependency is a done task therefore counts as ready at once, even if that done task's own predecessors are still pending. So the dependents of a mid-chain done task become ready alongside the true head of the chain, the widest wave is 3, and the auto rule (line ~680: parallel unless `tasks.length <= 8` or `maxWidth < 2`) chooses `parallel`: "widest wave 3 > 1".

**Observed (retrogaming, 2026-11-03).** 38 tasks `rb1..rb38`, `depends_on` strictly `["rb(N-1)"]`, every id present. Discover marked `rb1, rb2, rb17, rb19` done (stamps out of order after a side-branch heal). Logged reason: "widest wave 3 > 1, 38 tasks > seqBudget 8". Passing `strategy: sequential` avoids it.

**Minimal reproduction (no agents; calls the real `buildWaves`, same call shape as lines 640-651).**
```js
const N = 38, doneIds = new Set(['rb1','rb2','rb17','rb19'])
const tasks = Array.from({length: N}, (_, i) => ({ id: `rb${i+1}`, file: `src/f${i+1}.mjs`,
  done: doneIds.has(`rb${i+1}`), depends_on: i ? [`rb${i}`] : [] }))
const pre = new Set(tasks.filter(t => t.done).map(t => t.id))
const { waves } = buildWaves(tasks.filter(t => !t.done), pre)
// widths [3,2,2,2,2,2,2,2,...]; first wave: rb3, rb18, rb20  -> auto => parallel
```
Control: only `rb1, rb2` done (a contiguous head) gives widest wave 1, `sequential`.

**Ask (any of).**
1. A task is ready only when every transitive predecessor is done or already completed; a done task whose predecessor is pending does not satisfy its dependents.
2. Auto does not choose `parallel` when a done task has a pending predecessor, and says so in `strategyReason`.
3. At minimum, Discover or the run logs "done tasks with pending predecessors: rb17, rb19" so the odd wave shape is explained.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HR7XdYwEe4sM5NydxVmby4


(GitHub #187 by @luigi-lauro, verbatim above.)

## Diagnosis

- **Symptom:** `strategy: auto` picks `parallel` for a strictly serial chain when Discover marks tasks in the
  middle of it done; waves are 3 wide.
- **Cause:** `buildWaves` seeds `completed` with every done id, so a pending task whose dependency is done is
  ready at once, even when that done task's own predecessors are still pending (rb18 next to rb3).
- **Ruled out:** the auto rule itself (it reads the wave width correctly); Discover's done check (the stamps
  really were out of order after a heal).

## Fix

- `lib/waves.mjs` `buildWaves(tasks, preCompleted, doneDeps)`: a done dependency is replaced by its own
  predecessors, transitively; a done task whose predecessors are all done still satisfies its dependents at
  once. Without `doneDeps` the behaviour is unchanged.
- `workflows/execute-phase.mjs`: the MIRROR copy is synced and the call passes the done tasks'
  `depends_on`; the run logs "done tasks with pending predecessors: …" (the issue's ask 3).

## Verification

- Repro `tests/fix_waves_done_mid_chain.test.mjs`: fails before, passes after; with `tests/waves.test.mjs` and
  `tests/workflows.test.mjs` (incl. the MIRROR drift guard): 226 pass, 0 fail.
- Full suite: 2,854 pass, 1 fail — `tests/fleet.test.mjs` "the hook queues, its detached flusher delivers to the
  fleet", a timing test unrelated to waves; it passes 36/36 run alone, twice.
