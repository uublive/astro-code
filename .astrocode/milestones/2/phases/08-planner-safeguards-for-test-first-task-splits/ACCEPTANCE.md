# Acceptance (UAT) — Phase 08: Planner safeguards for test-first task splits

Human-confirmed before the phase closes. These prove the goal ("bad test-first splits
are prevented at the source, with an executor escape hatch") is really met.

- [ ] The user can read `agents/astro-planner.md` and find the ADR-018 principle: a
      RED-test task never statically imports a missing symbol — dynamic-import is the
      stated pattern, explicit test-after serialization the allowed fallback.

- [ ] The user can read the Synthesize prompt in `workflows/plan-phase.mjs` and find
      both the rule AND a closing self-verification instruction telling the planner to
      check every task against the rules before writing PLAN.md.

- [ ] The user can read `execPrompt` in `workflows/execute-phase.mjs` and find the
      escape hatch: RED-test task + missing export ⇒ dynamic import, do NOT implement
      the missing export — while `healPrompt` stays free of it.

- [ ] The user can read `agents/astro-executor.md` and find the same escape hatch for
      the Agent-tool sequential fallback path.

- [ ] The user can run `node --test` green, including new contract guards pinning all
      four texts (and the healPrompt negative guard).

- [ ] Spot-check: the next plan produced by `/astro-plan` (any phase) declares, for
      each RED-test task, either the dynamic-import pattern or an explicit test-after
      dependency — never a bare static import of a missing symbol.
