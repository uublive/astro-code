# PLAN — Phase 09: Harden astro-verify (goal-derived CRITERIA.md + adversarial verifier)

Implements ADR-021. Additive, backward-compatible. All new tests are **static
contract guards** (readFileSync + regex over source/prompt strings) — they import no
runtime symbols, so the ADR-018 dynamic-import trap does not apply. Test tasks are
**test-after** (each `depends_on` the impl task it guards): the guards assert the
presence of specific prompt strings, so a RED-before-impl test would leave the suite
red at a wave boundary — serializing after the impl keeps every wave green while still
pinning the load-bearing prompt language (which is the only real enforcement — a Read
tool cannot be sandboxed, so the contract text IS the guard).

Every task touches disjoint files except where `depends_on` serializes an ordering
requirement. No deletions/renames, so no destructive-edit atomicity concerns.

---

### t1 — Create the plan-blind criteria-author agent
- **id:** t1
- **title:** New `astro-criteria-author` agent that authors goal-derived, falsifiable CRITERIA.md
- **file:** `agents/astro-criteria-author.md`
- **depends_on:** (none)
- **what:** New read-plus-write recon agent modeled on `agents/astro-mapper.md`/`astro-planner.md` shape.
  Frontmatter: `name: astro-criteria-author`, terse `description`, `tools: Read, Write, Grep, Glob`
  (NO Bash, NO WebSearch/WebFetch — it authors claims from goal+CONTEXT+canon only, no external
  research, no code), `color: orange` (unused; taken: blue/cyan/green/magenta/yellow). Prose contract:
  (a) **plan-blind** — inputs are ONLY the phase goal + `CONTEXT.md` + project canon; a plan does not
  exist yet; explicitly "Do NOT read PLAN.md / ACCEPTANCE.md / SPEC.md even if one is present from a
  prior attempt in this phase directory." (b) Output `.astrocode/phases/<slug>/CRITERIA.md` using the
  schema `### C1 — <one-line observable, design-independent claim>` then `- **Observe:**` (concrete
  command to run + expected observable result, OR artifact/behavior to inspect and what proves pass) and
  `- **Fails if:**` (the adversarial failure mode). (c) Criteria are **goal-level/behavioral** — must
  survive a different valid implementation; ban structural/existence checks (grep-for-a-string,
  file-exists) in favor of black-box behavioral checks. (d) Every `Observe:` must be independently
  executable with ONLY `Read, Bash, Grep, Glob` (the verifier's toolset) — no network/GUI/other tools.
  (e) May cite CONTEXT.md decisions/constraints but must phrase each criterion as an outcome an alternate
  valid design would also satisfy. Comment/prose names the rationale: **pre-registration** (define success
  before the plan exists → prevents HARKing / plan-shaped grading; the Terminal-Bench 2.0 false-PASS this
  phase fixes). End with a `Return …` line.

### t2 — Add the Criteria stage as the new FIRST stage of plan-phase
- **id:** t2
- **title:** plan-phase.mjs runs criteria-author before the researcher fan-out and writes CRITERIA.md
- **file:** `workflows/plan-phase.mjs`
- **depends_on:** t1
- **what:** Prepend a `{ title: 'Criteria', detail: '…' }` entry FIRST in `meta.phases`. Before the
  existing `phase('Research')`/`parallel(ANGLES…)` block, add `phase('Criteria')` + a single sequential
  `await agent(…)` (NOT inside the researcher `parallel()` array — it must complete/write CRITERIA.md
  before researchers run so they may consult the bar) with `agentType: 'astro-criteria-author'`,
  `model: models.planner` (reuse the planner tier — highest-leverage step deserves planner-grade quality;
  avoids adding a 6th role to `lib/models.mjs`/every command's models map). Prompt tells it to write
  `${root}/.astrocode/phases/${phaseSlug}/CRITERIA.md`, plan-blind, per the schema, using the same OBEY
  disk-read pattern. Update the `log()` narration and the Synthesize prompt to reference CRITERIA.md as
  the bar the plan must satisfy (inline, defense-in-depth, matching the L56–62 style). Header comment
  explains the false-PASS/Terminal-Bench-2.0 motivation. `depends_on t1` because contracts.test.mjs
  asserts every `agentType` has a matching `agents/*.md`; t1 must land first (addition, so the earlier
  boundary simply lacks the reference — compiles clean).

### t3 — Rewrite the astro-verifier contract (plan-blind, per-criterion, self-derive)
- **id:** t3
- **title:** astro-verifier.md checks goal + CRITERIA.md + independent evidence only; forbids PLAN.md
- **file:** `agents/astro-verifier.md`
- **depends_on:** (none)
- **what:** Rewrite the contract. Keep `tools: Read, Bash, Grep, Glob` (no Write — read-only per canon).
  New body: (1) Read the phase **goal + CRITERIA.md** only. **"Do NOT read PLAN.md. Do NOT trust
  task/commit summaries or executor claims. Do NOT broad `grep -r`/`Glob` the phase directory"** (avoid
  incidentally surfacing PLAN.md). (2) Per criterion: **assume FAIL** until independently proven — run
  the `Observe:` command / drive the behavior, cite the actual command + its output as proof; a green
  full suite is not evidence unless it exercises that behavior. (3) Keep existing safeguards verbatim:
  commits present, no un-integrated `worktree-*` branches, canon violations, and the wave-boundary-compile
  / ADR-020 wave-green check. (4) **Overall PASS only if EVERY criterion has independent passing evidence**
  — any gap → FAIL naming it. (5) **Self-derive fallback:** if CRITERIA.md is absent (trivial phase or the
  /astro-alex fast lane, which produces a SPEC.md not a CRITERIA.md — never treat SPEC.md as the bar),
  self-derive goal criteria from the goal itself and **say so**; open the verdict with a one-line
  provenance statement ("CRITERIA.md found" vs "CRITERIA.md absent — self-derived N criteria from goal").
  Keep/extend the adversarial framing: "your job is to prove it wrong; a false PASS is the costliest error."
  Rationale line: structural independence (plan-blind) beats willpower.

### t4 — Rewrite the verifier spawn prompt in execute-phase
- **id:** t4
- **title:** execute-phase.mjs verifier spawn points at CRITERIA.md, forbids PLAN.md, enforces per-criterion evidence + self-derive
- **file:** `workflows/execute-phase.mjs`
- **depends_on:** (none)
- **what:** Rewrite ONLY the `agent(...)` prompt string in the `else` branch of `phase('Verify')`
  (~L999–1010). Leave the `integrationFailed` early-fail branch untouched. New prompt: read goal +
  `${root}/.astrocode/phases/${phaseSlug}/CRITERIA.md` (do not read PLAN.md; do not broad-grep the phase
  dir); per criterion assume FAIL and cite the run command + output; keep the existing commits-present /
  `worktree-*` / test-suite / canon checks; overall PASS only if every criterion independently passes;
  self-derive fallback with the provenance line when CRITERIA.md is absent. Inline the plan-blind + assume-FAIL
  rules (defense-in-depth, same rationale as the L56–62 pattern in plan-phase). Add a high-density comment
  explaining the Terminal-Bench-2.0 false-PASS this closes.

### t5 — /astro-verify command doc references CRITERIA.md + plan-blindness
- **id:** t5
- **title:** astro-verify.md step 2 names CRITERIA.md as the bar and the plan-blind constraint
- **file:** `commands/astro-verify.md`
- **depends_on:** (none)
- **what:** Update step 2 so the spawned verifier checks against goal + CRITERIA.md (self-derive when
  absent), does NOT read PLAN.md, and gathers independent per-criterion evidence — this command spawns the
  verifier directly (bypassing execute-phase's prompt), so the prohibition must be restated here too.

### t6 — /astro-plan command doc mentions CRITERIA.md-first
- **id:** t6
- **title:** astro-plan.md notes the criteria stage runs first and CRITERIA.md is an output artifact
- **file:** `commands/astro-plan.md`
- **depends_on:** (none)
- **what:** In step 3 (both the Workflow path and the no-Workflow Agent fallback) and the closing "the
  result is … PLAN.md (+ ACCEPTANCE.md)" line, note that a plan-blind, goal-derived `CRITERIA.md` is
  produced FIRST (before research) and is now a phase artifact.

### t7 — /astro-autonomous command doc mentions CRITERIA.md
- **id:** t7
- **title:** astro-autonomous.md step 2 notes plan-phase now writes CRITERIA.md too
- **file:** `commands/astro-autonomous.md`
- **depends_on:** (none)
- **what:** Extend step 2 "It writes PLAN.md + ACCEPTANCE.md" to include CRITERIA.md (the verifier's bar).

### t8 — /astro-alex verify step self-derives (no SPEC.md as bar)
- **id:** t8
- **title:** astro-alex.md verify step tells the verifier to use canon + goal only and self-derive criteria
- **file:** `commands/astro-alex.md`
- **depends_on:** (none)
- **what:** Update the Agent-tier verify wording (~L120) so the astro-verifier reads canon + the phase
  **goal** (not SPEC.md) for criteria purposes and self-derives goal criteria — the fast lane has no
  CRITERIA.md and SPEC.md is a task-broken execution contract (plan-shaped), which the verifier must NOT
  trust as the bar. One-line wording change; no structural change.

### t9 — README artifact list + gate description parity
- **id:** t9
- **title:** README lists CRITERIA.md and describes the plan-blind adversarial verify gate
- **file:** `README.md`
- **depends_on:** (none)
- **what:** Add CRITERIA.md to the per-phase artifact list and update the "two gates close a phase"
  paragraph so the machine gate is described as goal-derived/plan-blind/per-criterion-evidence. Introduce
  no new `/astro-*` or `ac <subcommand>` references (contracts.test guards those).

### t10 — Contract guards for the criteria stage + author agent
- **id:** t10
- **title:** tests/criteria.test.mjs — plan-phase runs Criteria before Research; author prompt is plan-blind + schema-shaped
- **file:** `tests/criteria.test.mjs`
- **depends_on:** t1, t2
- **what:** New static-guard test file (workflows.test.mjs style: `readFileSync` + regex, no eval/import).
  Assert: (a) `meta.phases` lists `'Criteria'` before `'Research'`; (b) in source order the criteria
  `agent(` / `phase('Criteria')` call precedes both `parallel(` and `phase('Research')` (file-offset
  comparison, the verifyIdx technique) so CRITERIA.md is written before the fan-out; (c) the criteria
  `agent()` uses `agentType: 'astro-criteria-author'` and `model: models.planner`; (d) `agents/astro-criteria-author.md`
  requires the per-criterion schema tokens (`Observe:` and `Fails if`/`Fails-if` and a `C1`/`### C` id shape)
  and carries the plan-blind prohibition ("do not read PLAN.md"/"even if present") and the
  goal-level/design-independent instruction. Test-after: `depends_on t1,t2` (guards assert strings the impl
  introduces — keeps the wave boundary green).

### t11 — Contract guards for the adversarial verifier
- **id:** t11
- **title:** tests/verify.test.mjs — verifier + spawn are plan-blind, per-criterion, self-derive with provenance
- **file:** `tests/verify.test.mjs`
- **depends_on:** t3, t4
- **what:** New static-guard test file. Assert: (a) `agents/astro-verifier.md` contains the plan-blind
  prohibition ("do NOT read PLAN.md"), the adversarial "assume FAIL" framing, a per-criterion independent-evidence
  instruction, and the self-derive-with-provenance fallback string; (b) the execute-phase `phase('Verify')`
  else-branch spawn prompt (extracted by offset from `phase('Verify')`, the existing technique) references
  `CRITERIA.md`, forbids `PLAN.md`, and carries the self-derive fallback; (c) the verifier still keeps `tools:
  Read, Bash, Grep, Glob` (no Write). Test-after: `depends_on t3,t4`.

---

## Wave shape (informative)
- **Wave 1 (parallel, no deps):** t1, t3, t4, t5, t6, t7, t8, t9
- **Wave 2:** t2 (after t1), t11 (after t3, t4)
- **Wave 3:** t10 (after t1, t2)
