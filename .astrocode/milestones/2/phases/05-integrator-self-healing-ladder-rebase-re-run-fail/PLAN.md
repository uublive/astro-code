# Plan — Phase 05: Integrator self-healing ladder (drop & re-run, then fail)

Goal: in `workflows/execute-phase.mjs`, on a wave cherry-pick conflict the integrator
drops the conflicted branch (preserved until healed) and the SCRIPT re-runs that task
sequentially on-branch at the integrated tip via `runOnBranch(t)` — NO rebase rung
(ADR-014). The integrator maps branch→task from the wave task list in its prompt;
healed waves get a full test-suite gate (an agent runs it) before the next wave;
a re-run failure fails the phase immediately with exact task/branch blame.

Binding canon: ADR-005 (integrator is the sole git actor), ADR-008 (re-runs are
sequential on-branch, never parallel-without-isolation), ADR-014 (drop-and-rerun,
never rebase). Workflow-tool style: no semicolons; only `phase()`/`agent()`/
`parallel()`/`log()` hooks; args stay small JSON scalars; the script cannot run git
or fs (all git work lives in the integrator prompt). Every schema object keeps
`additionalProperties: false`. Comments name the bug each choice prevents and
reference the phase-04 wave-2 incident.

## Ordering note (one file, one owner per wave)

`workflows/execute-phase.mjs` is edited by several tasks. Worktree-isolated parallel
tasks may not co-edit the same file, so every task that touches `execute-phase.mjs` is
serialized into a single dependency chain: t3 → t4 → t5 → t6 → t7. The pure-helper
lift (t1) and its unit test (t2) are independent and run in the first wave alongside
t3. The contract-guard test (t8) runs last, after the workflow source is final.

## Tasks

### t1 — Create `lib/heal.mjs`: pure branch→task heal-list resolver
- **id:** t1
- **title:** Add `lib/heal.mjs` with `resolveHealList(wave, conflicts, integratedBranches, branchForTask)` — given a wave's task list, the integrator's conflict objects `{branch, taskId}` (taskId nullable), and the set of branches the integrator confirmed integrated, return the ordered (plan-order) list of tasks to re-run on-branch: every conflict with a non-null taskId, PLUS — when a conflict's taskId is null — every wave task the integrator did not explicitly confirm integrated. Deduplicate by task id; preserve wave (plan) order. High-density "why" header naming the phase-04 wave-2 trap and ADR-014. Named function export only, Node style (semicolons, `export`).
- **file:** lib/heal.mjs
- **depends_on:** []

### t2 — Unit tests for `resolveHealList`
- **id:** t2
- **title:** Add `tests/heal.test.mjs` (builtin `node:test` + `node:assert/strict`, real values, no mocks) covering: a single confidently-mapped conflict re-runs only that task; a `taskId:null` conflict re-runs exactly the wave tasks not in the integrator's confirmed set; multiple conflicts re-run in plan order; dedup when a null-mapped remainder overlaps a mapped conflict; empty conflicts yields an empty list. Test names read as the spec.
- **file:** tests/heal.test.mjs
- **depends_on:** [t1]

### t3 — Upgrade `INTEGRATE_SCHEMA.conflicts` to `{branch, taskId}` objects
- **id:** t3
- **title:** In `execute-phase.mjs` change `INTEGRATE_SCHEMA.conflicts` items from `{ type: 'string' }` to objects `{ type:'object', additionalProperties:false, properties:{ branch:{type:'string'}, taskId:{type:['string','null']} }, required:['branch','taskId'] }`. Keep `branches[]` (used to compute the un-confirmed remainder) and `additionalProperties:false` at every level. Comment: this object shape is what lets the script drive `runOnBranch` for the right task.
- **file:** workflows/execute-phase.mjs
- **depends_on:** []

### t4 — Mirror `resolveHealList` into the MIRROR region + inject wave task list into the integrator prompt
- **id:** t4
- **title:** In `execute-phase.mjs`: (a) add a no-semicolon, no-`export` copy of `resolveHealList` inside the `// >>> MIRROR … <<< MIRROR` sentinel block so the drift guard covers it (byte-identical modulo semicolons/`export`); (b) change `integrateWave(w)` to take the wave's tasks and inline `JSON.stringify(wave.map(t => ({ id:t.id, title:t.title, file:t.file||'' })))` into the prompt as a scalar, instructing the integrator to map each conflicted `worktree-*` branch to a taskId by commit message + changed files (taskId:null when it cannot map confidently); (c) on conflict the integrator must `git cherry-pick --abort`, verify `git status` is clean before returning, and PRESERVE (do NOT tear down) the conflicting branch+worktree; clean-merged worktrees are still torn down as today. Update the call site to pass `wave`.
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t3]

### t5 — Add `healPrompt(t, preservedBranch)` heal-executor variant
- **id:** t5
- **title:** In `execute-phase.mjs` add a `healPrompt(t, preservedBranch)` string (distinct from `execPrompt`) telling the executor this is a HEAL re-run after an integration cherry-pick conflict on `preservedBranch`: inspect current HEAD/working-tree state first, implement fresh against the integrated tip (the dropped attempt is stale by definition — do NOT resurrect it), then make ONE atomic commit. Add a `runHealOnBranch(t, preservedBranch)` wrapper calling `agent(healPrompt(...), { label:`heal:${t.id}`, phase:'Execute', agentType:'astro-executor', model: models.executor })`. Comment references open-question-1 (bias to fresh implementation).
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t4]

### t6 — Add `runTestSuite(root)` agent + strict pass/fail schema
- **id:** t6
- **title:** In `execute-phase.mjs` add a module-scope `TESTGATE_SCHEMA` (`additionalProperties:false`, `{ passed:{type:'boolean'}, output:{type:'string'} }`, `required:['passed']`) and a `runTestSuite()` helper: an `agent()` call (`agentType:'astro-executor'`, `phase:'Execute'`) with a direct prompt to run the full test suite in `${root}` and return `passed` + failure output. The strict schema prevents a silent empty return (the phase-04 trap of a skipped gate).
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t5]

### t7 — Wire the heal ladder into the wave loop + result-shape additions
- **id:** t7
- **title:** In the `execute-phase.mjs` wave loop replace the current `integ.integrated !== true → integrationFailed` branch with the self-healing ladder: when the integrator reports conflicts, `log()` each preserved branch immediately; compute the re-run list via the mirrored `resolveHealList(wave, integ.conflicts, integ.branches, …)`; re-run each task sequentially in plan order via `runHealOnBranch(t, preservedBranch)`; on a non-null result push it to `results`, mark the task healed, and direct teardown of that task's preserved branch+worktree (a follow-up integrator/agent step — the script never runs git); on a falsy result set `integrationFailed = { wave:w+1, taskId:t.id, branch:preservedBranch, note:<human-readable task+branch+why> }` and stop (no retry). After any wave where the ladder fired, call `runTestSuite()`; a failing suite sets `integrationFailed` (human-readable note) for that wave and stops. Track `healedTaskIds` and add `healed: healedTaskIds` to the `return {…}`; keep `integrationFailed.note` a human-readable string so `commands/astro-execute.md` still surfaces it unchanged. Update the FAIL verdict text to read the richer `integrationFailed` (task id + branch). Comments name the phase-04 wave-2 incident and cite ADR-014/ADR-008.
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t6]

### t8 — Extend `tests/workflows.test.mjs` contract guards
- **id:** t8
- **title:** Add static-source contract guards (string/regex over the workflow source, no eval/import, matching the existing drift-guard style): (1) `INTEGRATE_SCHEMA.conflicts` items are objects carrying `branch` and `taskId` (not `items: { type: 'string' }`); (2) the integrator prompt references the wave task list (e.g. matches the injected `wave.map`/task-list interpolation); (3) the `return {` statement includes a `healed` field; (4) a heal/test-gate agent label is present (e.g. `heal:` and a test-suite gate call). The existing hook-shadowing and MIRROR drift guards must still pass (the mirrored `resolveHealList` keeps the MIRROR byte-identical modulo semicolons/`export`).
- **file:** tests/workflows.test.mjs
- **depends_on:** [t7]

## Wave shape

- Wave 1 (parallel): t1, t3
- Wave 2: t2 (after t1), t4 (after t3)
- Wave 3: t5 (after t4)
- Wave 4: t6 (after t5)
- Wave 5: t7 (after t6)
- Wave 6: t8 (after t7)

(t2 is independent of the `execute-phase.mjs` chain and can run as soon as t1 lands;
the integrator orders it within whatever wave keeps file ownership single.)

## Out of scope (later phases — do not couple)

- Stale fork-base / file-ownership/overflow detection → phase 6.
- Task-id commit stamps + idempotent re-run done-detection → phase 7.
- Planner-side test-first split safeguards → phase 8.
- The Agent-tool fallback in `commands/astro-execute.md` (already sequential — no
  integration step to heal).
- No new runtime/dev deps; `ac install` mirrors `workflows/` automatically (no separate
  install task needed).
