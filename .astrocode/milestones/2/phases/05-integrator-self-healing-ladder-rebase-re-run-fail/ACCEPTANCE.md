# Acceptance — Phase 05: Integrator self-healing ladder

User-facing UAT checklist. A human confirms each before the phase closes. These are
acceptance criteria (does the phase goal really hold), not unit tests.

- [ ] The user can run a parallel-strategy phase where one wave's integration hits a
      cherry-pick conflict, and watch the run heal it automatically — the conflicted
      branch is dropped and the task is re-run on-branch at the integrated tip — instead
      of being stranded with `worktree-*` branches and a manual cleanup chore.

- [ ] The user sees live `log()` narration of the healing: the conflicted branch is
      named as preserved, the task is named as re-running, and a healed/torn-down line
      confirms the re-run's commit landed before the branch is cleaned up.

- [ ] The user can confirm there is NO rebase step: a conflicted branch is never rebased
      or textually rescued — it is re-implemented fresh (ADR-014), so the phase-04 trap
      (silently stacked duplicate helpers from an auto-merge with no conflict markers)
      cannot recur.

- [ ] The user can confirm that after a wave that healed, the full test suite runs
      (an agent runs it) before the next wave proceeds, and that a clean (un-healed)
      wave does NOT pay that test-suite cost.

- [ ] The user can confirm that when a heal re-run fails (executor errors or returns
      nothing) the phase fails immediately — no retry loop — and the failure report
      names the exact task id, the exact branch, and why; the dropped branch+worktree
      are still present (preserved, not lost) for inspection.

- [ ] The user can confirm `/astro-execute` still surfaces a readable conflict/cleanup
      hint from `integrationFailed` (the human-readable note is intact, not a raw object
      dump), and that the run result reports which tasks were `healed`.

- [ ] The user can run `node --test` and see the full suite pass, including the new
      `tests/heal.test.mjs` resolver tests and the extended `tests/workflows.test.mjs`
      contract guards (schema shape, wave-task-list-in-prompt, `healed` in the return,
      MIRROR drift, and no hook-name shadowing).
