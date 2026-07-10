# Acceptance — Phase 1: Test the wave file-disjointness layering

UAT checklist (human-confirmable before the phase closes):

- [ ] `npm test` passes, and includes the new `tests/waves.test.mjs` suite.
- [ ] The user can see a test that **fails** if two same-file tasks were ever placed in
      one wave (i.e. the suite genuinely exercises collision avoidance, not just the
      happy path).
- [ ] The pure layering lives in `lib/waves.mjs` and is imported by the test (real code
      path — no eval-ing of workflow source).
- [ ] `workflows/execute-phase.mjs` still runs and behaves as before; its layering block
      is a marked mirror of `lib/waves.mjs`.
- [ ] A drift-guard test fails if the workflow's mirrored block diverges from
      `lib/waves.mjs` (verify by temporarily editing one and watching the test go red).
