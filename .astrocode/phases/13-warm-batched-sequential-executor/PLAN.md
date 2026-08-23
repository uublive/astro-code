# PLAN — 13-warm-batched-sequential-executor

> Goal: when `strategy === 'sequential'` and there are ≥2 executable tasks, run ONE warm
> `astro-executor` over `waves.flat()` (dependency order) that makes one atomic stamped
> commit per task, instead of one cold executor per task. Escape hatch:
> `args.execMode:'per-task'` or `lean_execution=false`. Partial-failure re-runs exactly the
> missing task ids via the existing per-task `runOnBranch`. Surgical: the parallel/worktree
> path, integrator, heal ladder, verify tier, and the buildWaves MIRROR region stay untouched
> (ADR-005/008/017/021/022/026, CONTEXT.md, CRITERIA C1–C6).

## Conventions binding on every task
- `workflows/*.mjs` is Workflow-tool style: **no semicolons**, no `import` (the sandbox
  cannot import — `lib/config.mjs` is NEVER read from the script; the value arrives as a
  scalar arg). Named function exports only, camelCase, `node:test` + `node:assert/strict`,
  high-density "why" comments. Cite `ADR-026` in new script comments.
- `tests/workflows.test.mjs` NEVER imports the workflow script (it has no importable symbol).
  It is tested by **extract-and-eval**: `readFileSync` + regex slice, `runInNewContext`
  (already imported) for isolated object literals, and — for behavior — the CRITERIA
  "Harness note" recipe: strip leading `export ` from `meta`, wrap the body in
  `new AsyncFunction('phase','agent','parallel','log','args', body)`, inject recording
  `agent`/`parallel` stubs + no-op `phase`/`log`, run, and assert on call count / order /
  prompt contents. No dynamic import of the script, no subprocess, no real git.
- **Test-first choice per task:** because the workflow script cannot be imported, its tests
  are extract-and-eval against source TEXT and cannot pass before the source exists. Each
  script task therefore adds its behavior AND its tests in ONE atomic task (the executor
  writes the test first, then implements until green) — this keeps every wave boundary green
  (ADR-020) and honors test-first WITHIN the task. No separate RED-test task is split out.
  t1's config test lives in `tests/cli.test.mjs`, which statically `import`s `lib/config.mjs`;
  the new export and its test therefore MUST land in the same task (a static import of a
  not-yet-existing export would crash the whole file at load — the ADR-018 trap).

---

## Tasks

### t1 — `lean_execution` config key + getter + template seed
- **id:** t1
- **title:** Add `leanExecutionEnabled(root)` getter (default true via `!== false`), seed
  `"lean_execution": true` in the template, and unit-test both.
- **file:** `lib/config.mjs`, `templates/config.json`, `tests/cli.test.mjs`
- **depends_on:** _(none)_
- **details:**
  - `lib/config.mjs`: add a tiny named export mirroring `resolveModels`'s shape —
    `export function leanExecutionEnabled(root) { return loadConfig(root).lean_execution !== false }`
    with a one-line "why default-true" comment (back-compat: projects predating the key stay
    on the fast path). Keep semicolons — this file uses them.
  - `templates/config.json`: add `"lean_execution": true` as a top-level boolean next to
    `"use_worktrees": true` so new projects ship the explicit default.
  - `tests/cli.test.mjs`: extend the static import to include `leanExecutionEnabled`; add
    tests: unset key ⇒ `true` (default), `lean_execution:false` ⇒ `false`, and the template
    ships the key as `true`. Follows the existing `config ships model tiers` test style.
  - Note: `ac config get/set/unset lean_execution` already works via the generic
    `case 'config':` in `bin/ac.mjs` — no CLI change needed (do NOT touch `bin/ac.mjs`).

### t2 — Document lean/batched default + escape hatch in the command
- **id:** t2
- **title:** Add a lean-mode note to the astro-execute command doc and wire
  `ac config get lean_execution` → `args.leanExecution` in the Workflow-args block.
- **file:** `commands/astro-execute.md`
- **depends_on:** _(none)_
- **details:**
  - In the `Workflow({ args: {...} })` block, add `leanExecution: <boolean from
    'ac config get lean_execution'>` alongside `useWorktrees` (same resolve-command-side,
    pass-scalar pattern — the workflow cannot read config itself).
  - Add a short prose paragraph (mirroring the `useWorktrees` / `--fast` / `--effort`
    paragraphs) stating that a **sequential phase with ≥2 tasks runs as ONE warm/batched
    executor by default** (reads canon once, one atomic stamped commit per task), and naming
    BOTH opt-outs: persisted `ac config set lean_execution false`, and one-off
    `args.execMode:'per-task'` — must match the switch the script actually honors (C6/C2).
  - In the no-Workflow-tool fallback prose, note that lean/batched mode is a Workflow-tool
    optimization only (that tier is already per-task by construction under ADR-008) — no
    behavior change needed there.
  - Targets CRITERIA **C6**.

### t3 — Batch primitives: BATCH_SCHEMA + missingFromBatch + batchPrompt + runBatchOnBranch (defined, not yet wired)
- **id:** t3
- **title:** Add the batch schema, the set-diff recovery helper, and the fourth-sibling
  batch prompt/runner to the script, plus their extract-and-eval unit tests.
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** _(none)_
- **details (all OUTSIDE the `// >>> MIRROR … <<< MIRROR` region, lines 116–393):**
  - `BATCH_SCHEMA` next to the other `*_SCHEMA` constants: `additionalProperties:false` at
    every level, `committed:{type:'array',items:{type:'string'}}`, `summary:{type:'string'}`,
    `required:['committed']` (summary is narration-only, left optional — mirrors
    `TEARDOWN_SCHEMA`/`TESTGATE_SCHEMA` which avoid hollow required fields). Precede it with a
    "why strict / why committed is the load-bearing field" comment citing ADR-026.
  - `missingFromBatch(orderedTasks, committed)` — a small top-level pure helper (sibling to
    `missingFromWave`, placed OUTSIDE the MIRROR block) with a heavy "why" JSDoc: it is
    Set-based, not positional (`const c = new Set(committed); return orderedTasks.filter(t =>
    !c.has(t.id))`). Null-safe: caller wraps `(out && out.committed) || []` so a failed/null
    batch return counts every task as missing.
  - `batchPrompt(orderedTasks)` — the fourth executor prompt (sibling to
    `execPrompt`/`healPrompt`/`remediatePrompt`), with a comment stating how it DIFFERS from
    `execPrompt`: ONE call, an ordered task list, per-task atomic commits, no squash. It MUST:
    open with an emphatic MULTI-TASK-BATCH override of the astro-executor "exactly ONE task"
    persona ("implement ALL tasks below in dependency order, ONE commit per task, do not stop
    after the first"); inline the ordered list as a trimmed JSON scalar
    (`JSON.stringify(orderedTasks.map(t => ({id,title,file,depends_on})))`, mirroring
    `integrateWave`); reuse `execPrompt`'s per-task contract verbatim (test-first, ADR-018
    dynamic-import guidance, touch-only-declared-files, stamp `(phase ${phaseNum} <taskId>)`
    per task, DO NOT squash); instruct the agent to derive `committed` MECHANICALLY via the
    existing done-detection idiom (`git log --oneline --fixed-strings --grep "(phase NN
    <taskId>)"` per id) rather than self-belief; append `OBEY`.
  - `runBatchOnBranch(orderedTasks)` — a single `agent()` call (matching every other `run*`
    wrapper): `{ label:'exec:batch', phase:'Execute', agentType:'astro-executor',
    model: models.executor, schema: BATCH_SCHEMA }`. Deliberately NO `isolation:'worktree'`
    (single serial writer on-branch, ADR-005/008).
  - These are defined but NOT yet called — the build/tests stay green (dead-but-valid).
  - `tests/workflows.test.mjs`: add `phase-13`-tagged tests — extract `BATCH_SCHEMA` literal
    via regex + `runInNewContext` and assert `additionalProperties:false`, `committed.items.
    type==='string'`, `required` includes `committed`; assert `batchPrompt` source contains
    the multi-task override, the per-task `(phase ... )` stamp, the no-squash instruction, the
    mechanical `committed` derivation, and the dependency-ordered JSON inlining; a
    `missingFromBatch` unit test (extract-and-eval the function body) proving the Set-diff and
    null-safety.
  - Do NOT touch the MIRROR region; the MIRROR-drift test must keep passing (C5a).

### t4 — Wire the batch branch at the call site + partial-failure recovery + harness tests
- **id:** t4
- **title:** Hoist a batch branch BEFORE the wave loop for
  `strategy==='sequential' && executableTasks.length>=2 && leanExecution`, run
  `runBatchOnBranch(waves.flat())` once, re-run only the missing ids via `runOnBranch`, and
  add the CRITERIA-harness behavioral tests.
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** t3
- **details:**
  - Read the opt-out off `input` (no destructure, mirroring `useWorktrees` at line 443):
    `const leanExecution = input.execMode === 'per-task' ? false : input.leanExecution !== false`.
    `execMode:'per-task'` is the explicit-override-wins idiom (like `input.strategy`); the
    `!== false` default keeps old commands on the fast path.
  - `const leanBatch = strategy === 'sequential' && executableTasks.length >= 2 && leanExecution`.
    Immediately after `phase('Execute')` and the all-done short-circuit (~line 732), BEFORE the
    `for (let w …)` loop, add: if `leanBatch`, `log('• lean batch: ONE warm executor over N
    task(s) in dependency order (ADR-026)')`, `const ordered = waves.flat()`,
    `const out = await runBatchOnBranch(ordered)`,
    `const committed = new Set((out && out.committed) || [])`; push one result per committed id
    so `results.length` stays "tasks executed" (matching every other path);
    `const missing = missingFromBatch(ordered, committed)`; if `missing.length`, `log('⚠ …
    re-running on-branch: …')` and `for (const t of missing) { const r2 = await runOnBranch(t);
    if (r2) results.push(r2) }` (conceptually mirrors `missingFromWave` recovery — NOT literal
    reuse; batch returns one object for N tasks).
  - Gate the existing loop so batch mode skips it, leaving the loop body byte-for-byte
    untouched (surgical): `for (let w = 0; w < waves.length && !integrationFailed && !leanBatch;
    w++)`. Do NOT modify the sequential/parallel/downgrade branches inside the loop — the
    worktree-hostile downgrade path stays per-task (CONTEXT.md).
  - Optionally add a flat `batched: leanBatch` (or similar) field to the return literal for
    observability, following the existing flat-field convention — not required.
  - `tests/workflows.test.mjs`: add the CRITERIA "Harness note" dynamic tests (build the
    `AsyncFunction`, inject recording `agent`/`parallel` stubs keyed off `schema`/`label`,
    no-op `phase`/`log`): **C1** default sequential + ≥2 not-done ⇒ exactly ONE executor call
    enumerating ALL ids in `waves.flat()` order; **C2** `execMode:'per-task'` AND
    `leanExecution:false` each ⇒ N single-task calls; **C3** 4 tasks with one `done:true` ⇒
    batch carries exactly the 3 not-done ids in order and its prompt requires per-task
    `(phase 13 <id>)` stamps / no squash; **C4** stub `committed:['t1','t3']` ⇒ the batch call
    then exactly ONE per-task recovery call carrying `t2`, none for t1/t3; **C5b**
    `strategy:'parallel'` wide wave ⇒ `parallel()` invoked and NO batch call. Assert the run
    completes using only injected stubs (no git/subprocess — C5c).
  - Targets CRITERIA **C1, C2, C3, C4, C5(b/c)**.
