# Plan — Phase 6: Wave fork-base guard & executor file-ownership enforcement

Goal: close the clean-but-wrong fold gap in `workflows/execute-phase.mjs`. The
integrator checks `merge-base(HEAD, branch)` per worktree branch — stale base ALWAYS
routes to the phase-5 heal ladder even when the cherry-pick is clean (ADR-015).
Overflow into a same-wave-claimed file routes to the ladder; overflow into unclaimed
files integrates with a named ⚠ advisory (ADR-016). The test gate trigger extends to
`ladderFired || overflowFlagged`. Executor prompt hygiene: touch only declared files.

Canon binding every task: the workflow body has NO semicolons and runs NO git/fs
(ADR-005 — the integrator is the sole git actor); `lib/waves.mjs` uses semicolons; any
new pure helper in `lib/waves.mjs` MUST be byte-mirrored into the `// >>> MIRROR …
// <<< MIRROR` sentinel region of `workflows/execute-phase.mjs` (the drift guard
normalizes only semicolons + the `export` prefix — no other delta allowed); every
schema keeps `additionalProperties:false` at every level; comments carry high-density
"why" naming the phase-04 incident causes (#1 stale base, #2 overflow).

## File ownership (one owner per wave; same-file tasks serialized)

- `tests/waves.test.mjs` — t1 only.
- `lib/waves.mjs` — t2 only (also edits the MIRROR copy inside
  `workflows/execute-phase.mjs`, so t2 is serialized into the execute-phase chain).
- `workflows/execute-phase.mjs` — single serial chain t2 → t3 → t4 → t5.
- `tests/workflows.test.mjs` — t6 only (runs after the wiring it asserts).

## Wave shape

- **Wave 1 (parallel):** t1, t6src-prep? No — see below. The only no-dependency tasks
  are the two test-first authors that own distinct test files: **t1** (waves) and the
  workflows-test author. The workflows-test author (t6) must run AFTER the workflow
  wiring exists, so it carries deps. Net: **Wave 1 = { t1 }** runs first alongside the
  start of the execute-phase chain (t2). The execute-phase chain (t2→t3→t4→t5) is
  strictly serial because all four touch the same file. t6 is the final guard.

Concretely the executor will run: t1 ∥ (t2 → t3 → t4 → t5) → t6.

---

## Tasks

### t1 — Unit tests for `classifyOverflow` (test-first)
- **id:** t1
- **title:** Add failing unit tests in `tests/waves.test.mjs` for the pure helper
  `classifyOverflow(changedFiles, declaredFiles, waveClaimMap)`. Assert it returns
  `{ kind, extraFiles }` where `kind` is `'clean'` (changed ⊆ declared; `extraFiles`
  empty), `'collision'` (an extra file is claimed by ANOTHER wave task → routes to the
  ladder, ADR-016), or `'harmless'` (extra files exist but none claimed by a wave peer
  → ⚠ advisory). Cover the edge cases too: solo wave (empty `waveClaimMap`) ⇒ any
  overflow is always `'harmless'` (CONTEXT note 4); a declarer whose `declaredFiles` is
  the wildcard `Set(['*'])` treats every changed file as declared (no overflow); an
  empty `changedFiles` ⇒ `'clean'`; the declarer's own id appearing in `waveClaimMap`
  is ignored (only OTHER tasks count). Import from `'../lib/waves.mjs'`; match the
  existing `node:test` + `node:assert/strict` sentence-name style.
- **file:** tests/waves.test.mjs
- **depends_on:** []

### t2 — Implement `classifyOverflow` in `lib/waves.mjs` and MIRROR it
- **id:** t2
- **title:** Add the pure `classifyOverflow(changedFiles, declaredFiles, waveClaimMap)`
  export to `lib/waves.mjs` (`changedFiles: string[]`, `declaredFiles: Set<string>`,
  `waveClaimMap: Map<string, Set<string>>` of OTHER wave tasks' claims; returns
  `{ kind: 'clean'|'collision'|'harmless', extraFiles: string[] }`). Compute
  `extraFiles` = changed files not in `declaredFiles` (wildcard `'*'` in `declaredFiles`
  ⇒ no overflow); if `extraFiles` is empty ⇒ `'clean'`; if any extra file collides with
  any peer claim set in `waveClaimMap` (reuse `filesCollide`/`claimedFiles`) ⇒
  `'collision'`; else (incl. solo/empty map) ⇒ `'harmless'`. High-density "why" comment
  naming phase-04 cause #2 and ADR-016. Then byte-mirror the new function into the
  `// >>> MIRROR … // <<< MIRROR` region of `workflows/execute-phase.mjs` (strip
  semicolons + `export` to match the drift-guard normalizer). Makes t1 green; run
  `tests/waves.test.mjs` and `tests/workflows.test.mjs` (drift guard) before committing.
- **file:** lib/waves.mjs, workflows/execute-phase.mjs
- **depends_on:** [t1]

### t3 — `execPrompt` hygiene + `INTEGRATE_SCHEMA` stale/overflow fields
- **id:** t3
- **title:** In `workflows/execute-phase.mjs`: (1) add to `execPrompt` the hygiene
  sentence "touch ONLY your declared file(s); if other changes are genuinely required,
  say so in your summary" before its final `Return a short summary …` line — leave
  `healPrompt` UNRESTRICTED (CONTEXT note 1: heal re-runs sequentially on-branch, the
  co-scheduling hazard is gone). (2) Extend `INTEGRATE_SCHEMA` with two optional arrays:
  `staleBranches` (items `{ branch, taskId }`, `taskId: ['string','null']`,
  `additionalProperties:false` — same shape as `conflicts.items`) and `advisories`
  (items `{ branch, taskId, extraFiles: { type:'array', items:{type:'string'} } }`,
  `additionalProperties:false`). Keep `required: ['integrated']` and top-level
  `additionalProperties:false` unchanged, and preserve the brace layout so the
  `const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})` extraction regex still matches. No
  semicolons; high-density comment naming causes #1/#2.
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t2]

### t4 — Integrator prompt: merge-base staleness + overflow classification
- **id:** t4
- **title:** Extend the `integrateWave` prompt with the CONTEXT-mandated check order,
  inserted BEFORE the existing cherry-pick step (item 2): **(a) staleness first** — for
  each candidate branch run `git merge-base HEAD <branch>` and compare to
  `git rev-parse HEAD`; if they differ the branch is stale: do NOT cherry-pick it,
  PRESERVE it (no `worktree remove` / `branch -D`), add `{ branch, taskId }` to
  `staleBranches[]`, and route it to heal like a conflict (ADR-015 — a clean cherry-pick
  proves nothing). **(b) overflow classification** — `git diff --name-only
  <merge-base>..<branch>` vs the task's declared file(s) from the inlined wave task
  list: an extra file claimed by ANOTHER same-wave task ⇒ route to heal (collision,
  ADR-016, never integrate two parallel attempts at one file); extra files nobody in the
  wave claims ⇒ cherry-pick AND record `{ branch, taskId, extraFiles }` in `advisories[]`
  with a ⚠ note (do NOT reject — the phase-04 t14 hooksPath fix was legitimate). Each
  branch is reported under exactly one outcome (integrated / integrated-with-⚠ /
  routed-to-heal with reason). No semicolons; high-density comment naming causes #1/#2.
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t3]

### t5 — Wave-loop wiring: stale/collision routing, `overflowFlagged`, extended gate, `log()` narration
- **id:** t5
- **title:** Wire the new integrator outcomes into the wave loop. **(1)** Fold
  `integ.staleBranches` into the same `conflicts`-shaped list that `resolveHealList`
  consumes so stale tasks re-run fresh at the integrated tip and pay the test gate +
  post-gate teardown exactly as phase 5 (reuse `resolveHealList`; do NOT fork the
  ladder — ADR-014/015). **(2)** Declare a per-wave `overflowFlagged` boolean at the
  SAME scope as `ladderFired` (inside the wave-loop body, not phase scope, so it never
  leaks into a later clean wave); set it true when `integ.advisories` is non-empty.
  **(3)** Change the gate condition from `if (ladderFired && !integrationFailed)` to
  `if ((ladderFired || overflowFlagged) && !integrationFailed)`. **(4)** Add `log()`
  narration: a `⚠` line per advisory naming `branch` + `extraFiles`, and a `•`/`✖` line
  for each stale-base branch routed to heal. No semicolons; comments name causes #1/#2.
- **file:** workflows/execute-phase.mjs
- **depends_on:** [t4]

### t6 — Contract guards in `tests/workflows.test.mjs` (test-after, static source)
- **id:** t6
- **title:** Append static-source contract guards (string + regex + `runInNewContext`
  only — no full-workflow eval/import), following the existing t8 section style. Pin:
  **(a)** the integrator prompt runs `git merge-base HEAD <branch>` staleness check and
  routes stale branches to `staleBranches[]`/heal, never cherry-picking them; **(b)** the
  integrator prompt classifies changed-files vs declared files, distinguishing collision
  (→ heal) from harmless overflow (→ `advisories[]` ⚠); **(c)** `INTEGRATE_SCHEMA` carries
  `staleBranches` and `advisories` with `additionalProperties:false` item schemas
  (extract via the existing `const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})` regex +
  `runInNewContext`); **(d)** `execPrompt` source contains the "touch ONLY" / declared-file
  hygiene instruction while `healPrompt` does NOT; **(e)** the wave-loop gate fires on
  `ladderFired || overflowFlagged` (locate the `if` via `wfSrc.indexOf` + windowed
  slice; assert both booleans appear) and `overflowFlagged` is declared at per-wave
  scope; **(f)** the loop consumes `integ.staleBranches`/`integ.advisories` and `log()`
  narrates the ⚠ advisory. Match the existing `// ── tN: … ──` header + block-comment
  ADR-reference style. All guards must be green once t2–t5 have landed.
- **file:** tests/workflows.test.mjs
- **depends_on:** [t5]

---

## Execution order (deterministic)

1. **Parallel start:** t1 (tests/waves.test.mjs) runs concurrently with t2.
2. **Serial chain on `workflows/execute-phase.mjs`** (one owner, never co-scheduled):
   t2 → t3 → t4 → t5. (t2 also owns `lib/waves.mjs`; its MIRROR edit lands here so the
   drift guard stays green from the first commit onward.)
3. **Final guard:** t6 (tests/workflows.test.mjs), after t5.

No two tasks with empty `depends_on` share a file: t1 owns tests/waves.test.mjs; t2 is
the sole no-empty-dep root of the execute-phase chain (it depends on t1 for test-first).
The full suite (`node --test`) must be green after t2, t5, and t6.
