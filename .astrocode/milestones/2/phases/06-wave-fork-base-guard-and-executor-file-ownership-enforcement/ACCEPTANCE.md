# Acceptance — Phase 6: Wave fork-base guard & executor file-ownership enforcement

User-facing UAT checklist. A human confirms each item before the phase closes
(acceptance criteria — not unit tests).

- [ ] The user can run a parallel-strategy phase where one worktree branch forked from
      a stale base, and see that branch routed to the heal ladder and re-run fresh —
      even though its cherry-pick would have applied cleanly (ADR-015). The clean-but-
      wrong fold no longer slips through.

- [ ] The user can run a wave where one task overflows into a file ANOTHER same-wave
      task claimed, and see that collision routed to the heal ladder (never two parallel
      attempts at one file folded together) (ADR-016).

- [ ] The user can run a wave where a task legitimately touches a file nobody else in
      the wave claims (e.g. the phase-04 t14 hooksPath-style fix) and see it integrate
      successfully WITH a named ⚠ advisory listing the extra files — its work is kept,
      not rejected.

- [ ] The user can confirm that any wave which healed OR integrated-with-⚠ runs the full
      test suite before the next wave builds on it, while clean contract-conforming
      waves still skip the gate and stay fast (`ladderFired || overflowFlagged`).

- [ ] The user can read each executor's instructions and see it is told to touch ONLY
      its declared file(s) and to call out any genuinely-required out-of-file change in
      its summary — while heal re-runs remain unrestricted.

- [ ] The user can run `node --test` and see the whole suite pass, including the new
      `classifyOverflow` unit tests and the new `tests/workflows.test.mjs` contract
      guards, with the MIRROR drift guard green (`lib/waves.mjs` and the workflow's
      mirror copy in sync).
