<!-- astro-discuss: captured -->
# Context — Phase 8: Planner safeguards for test-first task splits

Decisions settled with the user 2026-06-12. Final phase of milestone 2 (the phase-04
incident's prevention-at-the-source piece; `todo.md` § "Planner guidance"). The trap:
"test-first" + "one file per task" yields RED-test tasks that statically import a
not-yet-existing export — the whole test file crashes at module load, so executors
implement the export to make tests run, overflowing their declared file (phase-04 t5).

## Decisions

- **Canonical rule = mandate the dynamic-import pattern.** A failing-test task must
  NEVER statically import a symbol that does not exist yet on the branch. Instead:
  `const { fn } = await import('../lib/x.mjs')` inside async test bodies, so a missing
  export fails ONLY the new tests at call time and the rest of the suite keeps
  running. This is the proven house pattern (our own phase-6/7 plans used it: see
  tests/flow.test.mjs flowRelease/flowTag/flowHotfix tests). Test-after serialization
  (`depends_on` the impl task) stays allowed as an EXPLICIT fallback when dynamic
  import is awkward — the plan must say which it chose. Rejected: test task declaring
  the impl file too (blurs ownership, invites the overflow phase 6 polices).
- **Enforcement = prose rules + planner self-check.** The rules go in
  `agents/astro-planner.md` (Principles section) AND the Synthesize prompt in
  `workflows/plan-phase.mjs`, which gains a closing self-verification instruction:
  before writing PLAN.md, check every task against the rules (red-test import rule;
  same-file tasks serialized; every task declares its file(s)) and fix violations.
  Zero extra agents. Rejected: a separate plan-checker agent (extra run per planning,
  scope of its own — deferred note, not this phase); prose-only (no self-check).
- **Executor-side escape hatch = yes, one line.** `execPrompt` (and
  `agents/astro-executor.md` for the Agent-tool fallback path) tells executors: if
  your RED-test task would crash at module load on a missing import, use the
  dynamic-import pattern — do NOT implement the missing export (that is the impl
  task's job; phase-6's "touch ONLY declared files" tells you the WHAT, this is the
  HOW). Defense in depth for splits that slip through anyway.

## Scope

In scope:
- `agents/astro-planner.md`: add the red-test/dynamic-import principle + the
  same-file/serialization rule already implied, with the phase-04 t5 WHY in one line.
- `workflows/plan-phase.mjs`: Synthesize prompt carries the same rule + the
  self-verification closing instruction.
- `workflows/execute-phase.mjs`: one sentence in `execPrompt` (escape hatch);
  `healPrompt` needs nothing (heals run sequentially — the impl usually exists).
- `agents/astro-executor.md`: the same one-line escape hatch for the fallback path.
- Contract guards in `tests/workflows.test.mjs`: plan-phase prompt mentions the
  dynamic-import rule + self-check; execute-phase `execPrompt` mentions the escape
  hatch. A small static guard over `agents/astro-planner.md` content is fine too
  (same readFileSync style).

Out of scope:
- A standalone plan-checker agent (deferred note for a future phase).
- Retroactive plan rewrites; changes to wave-building or the heal ladder
  (ADR-014/015/016/017 all settled — this phase is prompt/prose + guards only).

## Canon reminders

plan-phase.mjs and execute-phase.mjs are Workflow scripts: no semicolons, hooks only.
Agent defs are markdown with frontmatter — keep the planner principles list terse and
imperative like the existing bullets. High-density WHY naming phase-04 t5. Guards
follow the existing readFileSync + regex style in tests/workflows.test.mjs.
