# ACCEPTANCE — 13-warm-batched-sequential-executor

User-facing UAT checklist. A human confirms each before the phase closes. These are
acceptance criteria (does the phase goal really hold), not unit tests.

- [ ] The user can run `/astro-execute` on a multi-task sequential phase and see it
      implemented by ONE warm executor pass over all tasks in dependency order (a single
      `exec:batch` in the run log), instead of one cold executor per task.
- [ ] The user can confirm each task still lands its own atomic commit stamped
      `(phase 13 <taskId>)` — re-running `/astro-execute` skips already-done tasks, so a
      batch that dies midway loses no completed work.
- [ ] The user can force the old per-task behavior in two ways: persistently with
      `ac config set lean_execution false`, or one-off via `args.execMode:'per-task'` — and
      both yield one executor per task.
- [ ] The user can read `commands/astro-execute.md` and understand that batched/lean
      execution is the default for multi-task sequential phases and exactly how to turn it off.
- [ ] The user can trust that a single-task phase, a parallel/worktree run, and a
      worktree-hostile downgrade still behave exactly as before (no batching), and that
      `node --test tests/workflows.test.mjs` (existing MIRROR/integrator/heal/verify guards)
      still passes.
- [ ] The user can see that when a batch under-reports its commits, only the missing tasks
      are re-run per-task — no completed task is redone and none is silently dropped.
