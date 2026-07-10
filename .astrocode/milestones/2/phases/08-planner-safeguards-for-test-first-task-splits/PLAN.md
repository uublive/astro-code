# Plan — Phase 08: Planner safeguards for test-first task splits

> Goal: prevent the phase-04 t5 trap at the source (ADR-018). RED-test tasks must
> never statically import a missing symbol — the dynamic-import pattern is canonical;
> the planner self-checks its plan before writing; executors get the matching escape
> hatch. Prompt/prose + contract guards only — no engine, wave, or ladder changes
> (ADR-014/015/016/017 settled).

Canon binding: Workflow scripts (`plan-phase.mjs`, `execute-phase.mjs`) stay
semicolon-free, hooks only. Agent defs are terse imperative markdown. Guards follow
the existing `readFileSync` + regex style. High-density WHY comments name phase-04 t5.

## File ownership (one owner per wave)

- `agents/astro-planner.md` — t1
- `workflows/plan-phase.mjs` — t2
- `workflows/execute-phase.mjs` — t3
- `agents/astro-executor.md` — t4
- `tests/workflows.test.mjs` — t5 (after all wiring it asserts)

## Tasks

### t1 — Planner agent def: the RED-test / dynamic-import principle
- **id:** t1
- **title:** In `agents/astro-planner.md` Principles, replace the bare "Test-first for behavior" bullet with the full rule: tasks that add behavior specify the test first, AND a RED-test task must NEVER statically import a symbol that does not yet exist on the branch — instruct `await import('../lib/x.mjs')` inside async test bodies so a missing export fails only the new tests at call time (ADR-018; the phase-04 t5 trap: a module-load crash pushes executors to implement the export and overflow their declared file). Test-after serialization (`depends_on` the impl task) stays allowed when explicitly chosen — the plan must say which. Keep the bullet style terse and imperative like its siblings.
- **file:** agents/astro-planner.md
- **depends_on:** []

### t2 — plan-phase Synthesize prompt: rule + self-verification pass
- **id:** t2
- **title:** In `workflows/plan-phase.mjs` extend the Synthesize `agent(...)` prompt: (a) state the ADR-018 rule (RED-test tasks use dynamic import — never a static import of a missing symbol; or explicitly serialize test-after); (b) close with a self-verification instruction: "Before writing PLAN.md, check EVERY task against these rules — red-test import rule, two same-file tasks never both have empty depends_on, every task declares its file(s) — and fix any violation." No semicolons; keep args/scalar conventions untouched; high-density comment naming phase-04 t5 and ADR-018.
- **file:** workflows/plan-phase.mjs
- **depends_on:** []

### t3 — execute-phase execPrompt: the escape hatch
- **id:** t3
- **title:** In `workflows/execute-phase.mjs` append one sentence to `execPrompt` (after the phase-6 "touch ONLY your declared file(s)" hygiene): if this is a RED-test task whose import would crash at module load because the export does not exist yet, use the dynamic-import pattern (`await import(...)` inside async tests) — do NOT implement the missing export; that is the impl task's job (ADR-018). `healPrompt` unchanged (heals run sequentially after the impl usually exists). No semicolons.
- **file:** workflows/execute-phase.mjs
- **depends_on:** []

### t4 — Executor agent def: same escape hatch for the fallback path
- **id:** t4
- **title:** In `agents/astro-executor.md` add the matching one-liner so Agent-tool fallback executors (no Workflow prompt) carry the same rule: RED-test task + missing export ⇒ dynamic import, never implement the export yourself (ADR-018). Match the agent def's existing voice.
- **file:** agents/astro-executor.md
- **depends_on:** []

### t5 — Contract guards
- **id:** t5
- **title:** Extend `tests/workflows.test.mjs` with static guards (readFileSync + regex, existing style): (a) `plan-phase.mjs` Synthesize prompt mentions the dynamic-import rule (e.g. matches `await import` or `dynamic.?import`) AND contains a self-verification instruction (e.g. /check EVERY task|fix any violation/i); (b) `execute-phase.mjs` `execPrompt` contains the escape hatch (matches dynamic-import wording and "do NOT implement the missing export"); (c) `agents/astro-planner.md` contains the ADR-018 rule (read via a path join to `../agents/`); (d) `healPrompt` does NOT gain the escape-hatch sentence (negative guard, mirrors the phase-6 style). Run the full suite — all green.
- **file:** tests/workflows.test.mjs
- **depends_on:** [t1, t2, t3, t4]

## Wave shape

- **Wave 1 (parallel):** t1, t2, t3, t4 — four distinct files, no deps.
- **Wave 2:** t5 — guards everything after it landed.

5 tasks ≤ seqBudget 8 ⇒ the executor will run sequentially on-branch regardless.

## Out of scope

- A standalone plan-checker agent (deferred — todo note).
- Any change to wave building, the heal ladder, stamps, or schemas.
