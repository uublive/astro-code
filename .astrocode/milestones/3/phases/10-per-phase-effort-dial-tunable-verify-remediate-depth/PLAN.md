# PLAN — Phase 10: Per-phase effort dial (ADR-022)

Executable task list. Implements the decided design in `CONTEXT.md` and aims at every
criterion in `CRITERIA.md`. One owner per file. Wave 1 = all impl + test-first suites
(no deps); Wave 2 = the two static contract-guard test files that grep the impl source
(test-after, explicitly serialized because they assert the shape of already-landed code).

Design invariants that every task must respect:
- `effort` is an ADDITIVE roadmap-phase field; default is a HARDCODED `standard` applied
  at the READ site (`ph.effort ?? 'standard'`) — never backfilled, never sourced from
  config (there is NO global/config effort knob — ADR-022 / C8).
- Level → max remediate cycles: `light=0`, `standard=1`, `deep=3`; unknown/absent →
  `standard` budget (C3). `deep` ALSO escalates executor+verifier to `opus` for the whole
  phase, in-memory only, never persisting config (C4).
- `workflows/execute-phase.mjs` runs in the Workflow sandbox: NO `import`, NO `git`/`exec`.
  It inlines its own tiny level→cycles literal; every git fact (HEAD SHA) comes back from a
  schema'd agent return, never a direct git call (ADR-005).
- Two-gate closure (REQ-006) stays intact: the loop reaches `verified` at best, never
  `complete`/accept. Research fan-out stays 3 angles — the dial spends ONLY on
  remediate-cycles + model tier (C9).

---

## Wave 1 — implementation + test-first suites (all `depends_on: []`)

### t1 — effort level table + pure resolution helpers
- **id:** t1
- **file:** lib/effort.mjs
- **depends_on:** []
- **what:** New module mirroring `lib/models.mjs` shape/voice. Export:
  `EFFORT_LEVELS = ['light','standard','deep']`; `DEFAULT_EFFORT = 'standard'`;
  a frozen knob table `EFFORT_KNOBS = { light:{maxCycles:0}, standard:{maxCycles:1},
  deep:{maxCycles:3, tier:'opus'} }` (block-comment each entry's rationale — "quota tokens
  are the scarce resource", cite ADR-022); `validateEffort(level)` throwing loud on an
  unknown level ("unknown effort … choose one of: …", `profileModels`-style) — used by the
  strict WRITE path (C1); `effortKnobs(level)` returning a FRESH copy that NORMALIZES an
  absent/unknown level to the `standard` budget (`maxCycles:1`) for the READ/resolve path
  (C3); `resolveEffort(stored, override)` = precedence `override > stored > DEFAULT_EFFORT`,
  normalizing to a valid level, reading NO config (C5, C8); `effortModels(models, level)`
  returning a fresh map where `deep` forces `executor:'opus'` + `verifier:'opus'` and
  every other level passes the base tiers through untouched (C4). Zero deps (ADR-001).

### t2 — lock-guarded setPhaseEffort roadmap mutator
- **id:** t2
- **file:** lib/roadmap.mjs
- **depends_on:** []
- **what:** Add `export async function setPhaseEffort(root, slug, level)` copying the exact
  `setPhaseStatus` shape: `withLock(p.lock, () => { read; validate; mutate; atomicWriteJSON
  + atomicWriteText(renderRoadmapMd) })`. Validate `level` via `validateEffort` (import from
  `./effort.mjs`) and throw BEFORE writing so a bogus level never lands (C1). Mutate ONLY
  `ph.effort` on the matched phase — preserve every other phase/field/milestone byte-for-byte
  (C2); the shared lock gives concurrent-write safety (C2). Additive field only — no roadmap
  migration, no schema change.

### t3 — `ac phase effort` CLI verb (read/resolve + write)
- **id:** t3
- **file:** bin/ac.mjs
- **depends_on:** []
- **what:** Add an `effort` branch inside the existing `case 'phase':` `switch(sub)`
  (sibling to `verify`/`accept`/`reject`), mirroring `ac models` ergonomics. Import
  `setPhaseEffort` (from `lib/roadmap.mjs`) and `resolveEffort`/`DEFAULT_EFFORT` (from
  `lib/effort.mjs`).
  - `ac phase effort <n>` (no positional level) → RESOLVE mode: resolve via
    `findPhase` (`die` if missing), print `resolveEffort(ph.effort, flags.effort)` — i.e.
    the stored level (or hardcoded `standard` when absent), overridable for a single read
    by an optional `--effort <level>` flag (non-persisting, `--preview`-idiom). Prints the
    effective level on stdout so `/astro-execute` can consume it (C5).
  - `ac phase effort <n> <level>` → WRITE mode: `await setPhaseEffort(...)`; on an invalid
    level the thrown validation error → `die(...)` (non-zero exit, nothing written — C1);
    on success `console.log('✓ phase N "…" → <level>')`.
  - Do NOT add any `ac config` effort key (C8).

### t4 — automated verify→remediate loop + structured verify schema
- **id:** t4
- **file:** workflows/execute-phase.mjs
- **depends_on:** []
- **what:** The core loop. Self-contained single-file change; leaves the build green on its
  own (existing workflow tests only guard the `integrationFailed` verdict branch, which is
  preserved).
  1. Read `const effort = input.effort || 'standard'`; inline `const maxCycles =
     ({ light:0, standard:1, deep:3 })[effort] ?? 1` (small literal — no MIRROR block).
     Rename the destructured base tiers and resolve EFFECTIVE models ONCE at the top so
     EVERY `agent()` call (initial waves, verify, remediation) uses them: for `deep`,
     `{ ...base, executor:'opus', verifier:'opus' }`; otherwise the base map unchanged —
     never mutate persisted config (C4). Include `effort` in the final `return`.
  2. Add `VERIFY_SCHEMA` (`additionalProperties:false`, `required:['passed','criteriaFound',
     'summary']`): `passed:boolean`, `criteriaFound:boolean`, `summary:string` (human FAIL
     text), `criteria:[{ id, passed, command, output }]` (item `additionalProperties:false`,
     `id` the exact `C<n>` from CRITERIA.md). Give the existing goal-verify `agent()` call
     this schema; extend its prompt to (a) set `criteriaFound`, (b) return per-criterion
     `C<n>` ids with the exact failing command + its output as evidence, (c) fill `summary`.
     Keep the `integrationFailed` branch producing its current string-shaped FAIL detail
     wrapped into the same `{passed:false, summary, criteria:[], criteriaFound:false}`
     object so the return stays one consistent shape.
  3. After the first verify, run the remediate loop when `!integrationFailed`,
     `!verdict.passed`, `verdict.criteriaFound` (degrade to single-pass — 0 cycles — when
     CRITERIA.md is absent, keeping the shrink-comparison decidable), and the effective
     budget `> 0`. Bounded `for (let cycle = 0; cycle < maxCycles && !verdict.passed; cycle++)`:
     - Build `remediatePrompt(unmetCriteria)` (a THIRD prompt sibling to `execPrompt`/
       `healPrompt`) scoped to ONLY the unmet `C<n>` ids, embedding each failing command +
       output VERBATIM, explicitly forbidding reading PLAN.md/SPEC.md and re-attacking
       passing criteria, telling it to make ONE atomic commit stamped
       `(phase ${phaseNum} remediate-c${cycle})`, and appending `OBEY` (C7).
     - `runRemediation` = `agent(remediatePrompt(...), { agentType:'astro-executor',
       phase:'Execute', model: models.executor, schema: REMEDIATE_SCHEMA })` — reuse the
       EXISTING executor, no new agent type (C7). `REMEDIATE_SCHEMA`
       (`additionalProperties:false`, `required:['headBefore','headAfter']`): the executor
       reports the `git rev-parse HEAD` it read before AND after committing (the script
       can't run git — ADR-005/finding 3), plus a `summary`.
     - Re-verify by reusing the SAME schema'd verify `agent()` block (do not fork a second
       verifier prompt).
     - STOP-ON-NO-PROGRESS (C6), checked BEFORE consuming remaining budget: bail to a
       human-facing FAIL if `headAfter === headBefore` (HEAD didn't move) OR the new
       failing-`C<n>`-id set is NOT strictly smaller than the prior set (use a plain
       `.length` cardinality comparison via `new Set(...)` ids — DELIBERATE choice: a cycle
       that fixes one criterion but incidentally breaks a different one is net-no-progress
       and bails, safe-over-fast). On bail set `stoppedReason:'no-progress'` and keep
       `verdict.passed=false` — NEVER `verified`; fires even with budget remaining.
     - Narrate each cycle with the file's glyph style (`✓/✖/⚠/•/⊡`): cycle N/M, criteria
       remaining, and any bail reason.
  4. Extend the final `return {…}` additively: `effort`, `remediationCycles`,
     `stoppedReason ('passed'|'no-progress'|'max-cycles')`. `verdict` is now the structured
     object (its `summary`/`passed` are what the commands read). The loop's best self-produced
     status is still `verified` at the command layer — it never sets `complete`/accepts (C9).

### t6 — `/astro-execute --effort` override + structured-verdict reporting
- **id:** t6
- **file:** commands/astro-execute.md
- **depends_on:** []
- **what:** Document, in the terse command-literal style, the `--effort <light|standard|deep>`
  one-off (mirror the existing `--fast` template): resolve the effective level with
  `ac phase effort <slug>` (stored/default) or `ac phase effort <slug> --effort <level>` when
  the flag is passed, and pass it as `args.effort` to the `Workflow(...)` call (the workflow
  itself applies deep→opus + the cycle budget, so the command does NOT recompute tiers, and
  the override is never written back to roadmap.json — C5). Note the auto verify→remediate
  loop and the stop-on-no-progress FAIL. Update step 5 to read `verdict.summary` /
  `verdict.passed` (verdict is now structured). Have the Agent-tier fallback also honor the
  dial: use the deep→opus tiers and, on a verify FAIL, re-spawn the existing `astro-executor`
  scoped to the unmet criteria up to the level's budget with the same stop-on-no-progress
  rule. Keep the closing two-gate reminder (verified at best, never complete).

### t7 — `/astro-alex` stays light / single-pass
- **id:** t7
- **file:** commands/astro-alex.md
- **depends_on:** []
- **what:** In the Workflow call (step 8) pass `args.effort: "light"` explicitly so the fast
  lane defaults to 0 remediation cycles (verify once, FAIL stops) regardless of any stored
  level — a deeper effort only applies if a run explicitly opts in (C10). Update step 9's
  reporting to read `verdict.summary` (structured verdict). No remediate loop wiring is added
  here — light is already single-pass.

### t8 — verifier contract: structured per-criterion return
- **id:** t8
- **file:** agents/astro-verifier.md
- **depends_on:** []
- **what:** Add to the verifier contract that it returns, alongside the human verdict, a
  per-criterion result keyed to the EXACT `C<n>` id from CRITERIA.md (never re-worded), a
  `criteriaFound` boolean, and — for each unmet criterion — the exact failing command and its
  output as evidence, so the remediate loop can scope + compare failing sets. Keep the ADR-021
  adversarial/plan-blind rules unchanged; this only pins the return shape to match the
  workflow's `VERIFY_SCHEMA`.

### t10 — effort unit + CLI contract tests (test-first, dynamic import)
- **id:** t10
- **file:** tests/effort.test.mjs
- **depends_on:** []
- **what:** New suite modeled on `tests/models.test.mjs`. Import modules under test with
  `const { … } = await import('../lib/effort.mjs')` (and `../lib/roadmap.mjs`) INSIDE async
  test bodies, and drive the CLI via `child_process` spawning `bin/ac.mjs` — NEVER a static
  top-of-file import of a not-yet-existing symbol (ADR-018), so a missing export fails only
  its own case, not the file. Cover: level→maxCycles = 0/1/3 and unknown/absent→1 (C3);
  `validateEffort` throws on a bogus level, `effortKnobs` normalizes (C1/C3); `resolveEffort`
  precedence override>stored>hardcoded-`standard`, config-independent (C5/C8);
  `effortModels` forces opus for deep only and passes base tiers through for light/standard
  without mutating input (C4); `setPhaseEffort` round-trips light/standard/deep, rejects a
  bogus level with a non-zero CLI exit + no write, preserves other phases (C1/C2), and a
  roadmap entry with NO effort field loads/reads as `standard` (C1). This suite and its impl
  tasks share Wave 1 and merge before the gate, so they land green together.

---

## Wave 2 — static contract-guard tests (test-after; grep landed source)

### t5 — remediate-loop contract guards
- **id:** t5
- **file:** tests/workflows.test.mjs
- **depends_on:** [t4]
- **what:** Extend the static-source suite (string/regex + `runInNewContext` on extracted
  literals — NEVER execute the sandbox script). Assert: `VERIFY_SCHEMA` and `REMEDIATE_SCHEMA`
  each have `additionalProperties:false` + the required verdict/head fields; the inline
  level→cycles map yields 0/1/3 with unknown→standard; deep resolves executor+verifier to
  `opus` while light/standard pass base tiers through; `remediatePrompt` names only unmet
  criteria, embeds the failing command+output, forbids PLAN.md/SPEC.md, appends `OBEY`, and
  uses `agentType:'astro-executor'` (no new agent type); ordering guards — the remediate loop
  runs only after a verify FAIL, the stop-on-no-progress check precedes the next cycle, and
  the loop is bounded by `maxCycles` with a `criteriaFound` gate; a no-progress bail keeps
  `passed:false`/never `verified`; no Workflow-hook name is shadowed and `phaseSlug` is
  preserved. Test-after (serialized on t4) is deliberate: these guards assert the shape of
  already-landed source.

### t9 — command-doc contract guards
- **id:** t9
- **file:** tests/commands.test.mjs
- **depends_on:** [t6, t7]
- **what:** Extend the command-markdown guard suite (extract-a-section + assert-phrasing).
  Assert: `astro-execute.md` documents the `--effort` one-off, passes `effort` to the
  Workflow args, and reads `verdict.summary`/`verdict.passed`; `astro-alex.md` pins the fast
  lane to `effort: "light"`. Test-after (serialized on t6/t7) — asserts landed prose.
