# Plan — Phase 07: Idempotent re-execution (done-detection via task-id commit stamps)

> Goal: make `/astro-execute` resumable (ADR-017). Executors + heals stamp commit
> subjects with `(phase NN tK)`; the Discover agent greps the branch log per task
> (exact pattern incl. closing paren) and returns a required `done:boolean`; done
> tasks are skipped with narration and reported as `skipped:[ids]`; `buildWaves`
> pre-seeds the completed set so dependents stay ready; an all-done run
> short-circuits straight to Verify. Governed by CONTEXT.md + ADR-017.

## File-ownership map (one owner per wave)

- `lib/waves.mjs` — t1 only
- `workflows/execute-phase.mjs` — t2 (MIRROR sync) then t4, t5, t6, t7 serialized after it
- `tests/waves.test.mjs` — t3 only
- `tests/workflows.test.mjs` — t8 only
- `commands/astro-execute.md` — t9 only

Because t4–t7 all touch `workflows/execute-phase.mjs`, they are serialized in a
chain (t2 → t4 → t5 → t6 → t7). t1, t3, t8, t9 are independent and run in wave 1.

---

## Tasks

### t1 — buildWaves accepts a preCompleted set (pure lib change)
- **id:** t1
- **title:** Add `preCompleted` param to `buildWaves(tasks, preCompleted = new Set())` in `lib/waves.mjs`: seed `completed = new Set(preCompleted)` AND filter pre-done ids out of `remaining` at init (`remaining = tasks.filter((t) => !completed.has(t.id))`), so a pre-seeded id satisfies dependents' `depends_on` in wave 1 yet the done task itself never appears in a wave. Update the JSDoc to name the phase-07 resumability WHY. Default param keeps every existing caller compatible.
- **file:** `lib/waves.mjs`
- **depends_on:** []

### t2 — Sync the MIRROR block to the new buildWaves signature
- **id:** t2
- **title:** Mirror the t1 change into the `// >>> MIRROR of lib/waves.mjs >>>` region of `workflows/execute-phase.mjs` (semicolon-free, no `export`) so the drift guard stays green. Only the `buildWaves` body + JSDoc change; the sentinel comments and all other mirrored functions stay byte-identical (normalized).
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t1]

### t3 — Unit tests for buildWaves pre-seeding
- **id:** t3
- **title:** Add `node:test` cases to `tests/waves.test.mjs` proving: (a) a pre-seeded id NOT in `tasks` is harmless (no effect on waves); (b) a pre-seeded id that IS in `tasks` is filtered out of every wave; (c) a dependent whose only `depends_on` is a pre-seeded id lands in wave 1; (d) the no-arg call (`buildWaves(tasks)`) still behaves exactly as before (default-empty Set). Follow the existing test naming + `mkdtemp`-free pure-function style already in the file.
- **file:** `tests/waves.test.mjs`
- **depends_on:** [t1]

### t4 — Derive phaseNum + extend TASK_SCHEMA with required `done`
- **id:** t4
- **title:** In `workflows/execute-phase.mjs`: (1) after the `phaseSlug` destructure, add `const phaseNum = (phaseSlug.match(/^(\d+)/) || [])[1] || phaseSlug` (string extraction preserves the zero-padded `07` — never `parseInt`); (2) extend `TASK_SCHEMA` items: add `done: { type: 'boolean' }` to `properties` and `'done'` to the `required` array, keeping `additionalProperties: false` at every level. Add a high-density comment naming ADR-017 / the phase-04 re-run cause.
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t2]

### t5 — Extend the Discover prompt with the per-task stamp grep
- **id:** t5
- **title:** Rewrite the Discover `agent(...)` prompt in `workflows/execute-phase.mjs` to instruct, per task, a DEAD-SIMPLE mechanical check: run `git log --oneline --fixed-strings --grep "(phase ${phaseNum} <taskId>)"` on the current branch and set `done: true` iff it returns any line, else `done: false`. Spell the EXACT pattern including the closing paren (the t1/t14 trap — `t1` must never match `t14`); state `--fixed-strings` so parens are literal. Keep the instruction one-grep-per-task, no pattern reasoning (Discover may run on haiku tier). NN is interpolated from `phaseNum`, never invented by the agent.
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t4]

### t6 — Skip wiring: filter done tasks, pre-seed buildWaves, narrate, all-done short-circuit
- **id:** t6
- **title:** At the `buildWaves` call site in `workflows/execute-phase.mjs`: compute `const skippedTaskIds = tasks.filter((t) => t.done).map((t) => t.id)`, `const preCompleted = new Set(skippedTaskIds)`, `const executableTasks = tasks.filter((t) => !t.done)`, then call `buildWaves(executableTasks, preCompleted)`. Narrate each skip via `log('• task ' + id + ' already on branch (stamp found) — skipping')` (skips at discovery time ONLY — never re-grep mid-run). Wrap the Execute wave loop so it is skipped when `executableTasks.length === 0` (all-done) but Verify still runs — do NOT early-return before `phase('Verify')`. Add `skipped: skippedTaskIds` to the final return object alongside `healed`; leave `executed: results.length` untouched (skipped tasks never push to `results`).
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t5]

### t7 — Add the stamp instruction to execPrompt AND healPrompt
- **id:** t7
- **title:** Append one sentence to both `execPrompt` and `healPrompt` in `workflows/execute-phase.mjs`: end the single atomic commit's subject line with ` (phase ${phaseNum} ${t.id})` — space-separated, zero-padded NN, no hyphen — so re-runs are detectable (ADR-017). Keep the existing prompt wording otherwise intact.
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t6]

### t8 — Contract guards in workflows.test.mjs
- **id:** t8
- **title:** Add static source-contract `node:test` guards to `tests/workflows.test.mjs` (readFileSync + regex/`runInNewContext`, matching existing guards): (a) `TASK_SCHEMA` items carry `done` in `required` and a boolean `done` property; (b) the Discover prompt contains `--fixed-strings` and a closing-paren stamp pattern (e.g. asserts the prompt mentions `(phase ` and `--fixed-strings`, closing the t1/t14 trap); (c) both `execPrompt` and `healPrompt` contain the `(phase ` stamp instruction; (d) the return object includes `skipped:`; (e) an all-done short-circuit guard (the Execute wave loop is conditioned on executable tasks remaining). Do not duplicate the MIRROR drift guard — it already exists.
- **file:** `tests/workflows.test.mjs`
- **depends_on:** [t2]

### t9 — Sequential-fallback stamp instruction in astro-execute.md
- **id:** t9
- **title:** Add one line to the Agent-tool sequential-fallback bullet (step 4) of `commands/astro-execute.md`: tell each `astro-executor` to end its commit subject with `(phase NN tK)` (NN from the slug's leading number, tK from the task id) so fallback runs are equally resumable. Keep the command spec thin — one sentence.
- **file:** `commands/astro-execute.md`
- **depends_on:** []

---

## Wave shape

- **Wave 1 (parallel):** t1, t3, t8, t9 — distinct files, no deps.
- **Then serialized on `workflows/execute-phase.mjs`:** t2 → t4 → t5 → t6 → t7.
- t3 depends on t1 (logically, same lib contract) but touches a different file, so it
  may run as soon as t1 lands. t8 depends on t2 (guards the synced workflow) but
  touches `tests/workflows.test.mjs`, so it integrates cleanly after t2.

Notes: out of scope per CONTEXT.md — planner-side task-split safeguards (phase 8),
stamp enforcement, reverted-commit archaeology. The ADR-014/015/016 heal ladder is
unchanged; done-detection composes with it, never alters it.
