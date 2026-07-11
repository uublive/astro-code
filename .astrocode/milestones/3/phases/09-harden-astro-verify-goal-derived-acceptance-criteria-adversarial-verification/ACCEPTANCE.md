# ACCEPTANCE — Phase 09: Harden astro-verify (goal-derived criteria + adversarial verifier)

User-facing UAT checklist. A human confirms these before the phase closes. These prove
the goal (the verifier NEVER agrees with bad work), not the unit tests.

- [ ] The user can run `/astro-plan <n>` on a real phase and find a new
      `.astrocode/phases/<slug>/CRITERIA.md` written **before** the researchers ran,
      containing falsifiable `C#` criteria each with an `Observe:` command and a `Fails if:`.
- [ ] The user can read CRITERIA.md and confirm the criteria are goal-level/behavioral —
      they would still hold for a different valid implementation, and none is a bare
      "file exists"/"grep for string X" structural check.
- [ ] The user can open `agents/astro-verifier.md` and confirm it checks goal + CRITERIA.md
      only, explicitly forbids reading PLAN.md, assumes FAIL per criterion until it runs the
      evidence itself, and PASSes only when EVERY criterion independently passes.
- [ ] The user can run `/astro-verify <n>` on a phase that has NO CRITERIA.md and see the
      verdict open with a provenance line stating it self-derived criteria from the goal —
      never silently trusting the plan/SPEC.
- [ ] The user can point the verifier at deliberately-broken work and see it return FAIL
      naming the unmet criterion with the command output it ran — a false PASS no longer slips through.
- [ ] The user can run `node --test` and see the full suite green, including the new
      `tests/criteria.test.mjs` and `tests/verify.test.mjs` contract guards.
