# Acceptance (UAT) — Phase 07: Idempotent re-execution

Human-confirmed before the phase closes. These prove the goal ("make
`/astro-execute` resumable via task-id commit stamps") is really met — not unit tests.

- [ ] The user can re-run `/astro-execute` on a phase that partially completed and see
      already-landed tasks SKIPPED rather than re-executed — each skip is narrated as
      `• task tK already on branch (stamp found) — skipping`.

- [ ] The user can see every executor/heal commit subject end with `(phase NN tK)`
      (space-separated, zero-padded phase number) in `git log --oneline`.

- [ ] The user can re-run a phase where EVERY task is already done and watch it
      short-circuit straight to Verify (no Execute waves run), with Verify still
      executing and reporting a verdict.

- [ ] The user can confirm a task whose id is a prefix of another (e.g. `t1` vs `t14`)
      is NOT falsely skipped — only the exact stamp `(phase NN t1)` counts as done.

- [ ] The user can confirm a task with a MISSING stamp simply re-runs (safe-over-fast)
      rather than being wrongly skipped.

- [ ] The user can read `skipped: [...]` in the workflow's returned result alongside
      `healed`, and confirm skipped tasks are NOT counted in `executed`.

- [ ] The user can run the full test suite (`node --test`) green, including the new
      `buildWaves` pre-seed unit tests and the workflow contract guards, with the
      MIRROR drift guard still passing.
