# Phase 1 — Test the wave file-disjointness layering

**Goal:** lock in the wave-layering fix (Kahn dependency layering + file-disjointness
guard) shipped in `db8d29e` with real `node:test` coverage, so a future change can't
silently regress same-file collision avoidance.

## Design decision (load-bearing)

The layering logic currently lives **inline** in `workflows/execute-phase.mjs`. That
file is **not importable** by a test: it is a Workflow-tool script with a top-level
`return` and depends on injected hooks (`agent`/`parallel`/`phase`/`log`/`args`), and
the Workflow runtime sandbox has **no filesystem/import access** (no workflow imports
anything). Testing it by eval-ing source text would be a source-grep test, which the
canon forbids.

**Resolution:** extract the *pure* layering algorithm into `lib/waves.mjs` (a normal,
fully-tested module = the source of truth), and replace the inline block in the workflow
with a **mirror copy** marked "keep in sync". A drift-guard test asserts the workflow's
mirrored region stays identical to `lib/waves.mjs`, so behavior is tested for real
against `lib/` and the un-importable copy can't diverge. This dogfoods the very fix:
the four tasks touch four distinct files, so the executor's own wave layering must keep
them collision-free.

## Tasks

### t1 — Extract pure wave layering into `lib/waves.mjs`
- **file:** `lib/waves.mjs`
- **depends_on:** []
- Export a pure `buildWaves(tasks)` plus the `claimedFiles(task)` and
  `filesCollide(a, b)` helpers, lifting the exact logic from
  `workflows/execute-phase.mjs` (Kahn layering on `depends_on`, greedy file-disjoint
  admission, `'*'` wildcard for tasks with no declared `file`, cycle fallback that runs
  remaining tasks together). `buildWaves` returns `{ waves, deferredForFiles }`.
- Named exports only, ESM `.mjs`, `node:` builtins only, high-density explanatory
  comments matching the existing block's voice (say *why* the `'*'` wildcard runs a
  no-file task alone, why the first ready task is always admitted, etc.).
- No behavior change vs the committed inline logic — this is a faithful lift.

### t2 — Unit-test the layering behavior
- **file:** `tests/waves.test.mjs`
- **depends_on:** [t1]
- `node:test` + `node:assert/strict`, sentence-form test names, real code path
  (import `buildWaves` from `../lib/waves.mjs`). Cover:
  1. independent disjoint-file tasks share one wave (parallel-safe);
  2. two tasks on the **same file** with no `depends_on` are **never co-scheduled** —
     the second is deferred to a later wave (`deferredForFiles > 0`);
  3. a task with **no `file`** runs alone (wildcard), never beside another task;
  4. `depends_on` ordering is respected (a dependent never lands before its dep);
  5. a dependency **cycle / unknown id** falls back to running the remainder together
     (no infinite loop);
  6. **progress guarantee**: every task lands in exactly one wave and order is a valid
     topological order.

### t3 — Replace the inline block with a synced mirror in the workflow
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** [t1]
- Swap the inline `claimedFiles`/`filesCollide` + Kahn/file-disjoint loop for a copy
  that is byte-identical to the corresponding region of `lib/waves.mjs`, wrapped in
  sentinel comments (e.g. `// >>> MIRROR of lib/waves.mjs — keep in sync (Workflow
  sandbox can't import) >>>` … `// <<< MIRROR <<<`). Preserve Workflow-tool style (no
  semicolons) and the surrounding `log(...)` summary + `waves`/`maxWidth`/`strategy`
  usage. The workflow must still parse and behave exactly as before.

### t4 — Drift-guard test: workflow mirror == lib source of truth
- **file:** `tests/workflows.test.mjs`
- **depends_on:** [t1, t3]
- Add a test to the existing workflow-guard suite that reads both files and asserts the
  workflow's sentinel-delimited MIRROR region matches the corresponding region of
  `lib/waves.mjs` (normalize only for the known stylistic delta — semicolons — and
  whitespace). Fails loudly if the two drift, naming both files. This is a structural
  equality guard, not a behavior-via-source test.

## Wave shape

- Wave 1: t1
- Wave 2: t2, t3 (both depend on t1; different files → parallel-safe)
- Wave 3: t4 (depends on t1, t3)

## Out of scope

- Testing the strategy auto-selection (`seqBudget`/`maxWidth`) or the integrator agent —
  those are separate behaviors; this phase covers wave construction only.
- Any change to the layering algorithm itself (it shipped in `db8d29e`).
