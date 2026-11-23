# Phase 59 — Acceptance (human UAT)

Shared precondition, unless an item says otherwise:
- The owner's Mac (11 CPUs, 36 GB) with the installed `ac` from this branch.
- Two astro-code projects (`ac init` done), each with a committed node test file (`tests/a.test.mjs`).
- No `heavy.workers` setting in either project.
- No other `ac mutate` or `ac suite run` running.

1. **The user can run a suite and see how many workers it got and why.**
   - Precondition: the shared state above.
   - Steps: run `ac suite run --command "node --test"`.
   - Check: one line shows the worker budget (2 or 3 here) and its reason (CPUs, free memory).
   - Check: the suite's pass/fail and exit code match a plain `node --test`.
   - Steps: run `ac config set heavy.workers 1` and re-run.
   - Check: the line shows 1 and names the project setting.

2. **The user can start a second heavy job while one is running and watch it wait its turn.**
   - Precondition: the shared state above.
   - Steps: in project A start `ac suite run --command "sleep 20"`. In project B start `ac suite run --command "node --test"`.
   - Check: B prints one line naming A's project, its command and how long it has held the lock.
   - Check: B starts only after A ends, and exits normally.
   - Steps: run the same again, but `kill -9` A mid-run.
   - Check: B starts within a few seconds instead of waiting forever.

3. **The user can run `ac mutate` on a Go phase whose module is in a subfolder and see only the changed lines mutated, with the Mac staying responsive.**
   - Precondition: a project with real `gremlins` and `go` installed.
   - Precondition: a Go module at `svc/` (its `go.mod` there, not at the root).
   - Precondition: a completed phase whose stamped commits changed a few lines of one file in `svc/`.
   - Steps: run `ac mutate <phase>`.
   - Check: the result states the budget handed to Gremlins.
   - Check: the result tests only the mutants on the phase's lines, or says plainly that it fell back to whole-file mode and why.
   - Check: Activity Monitor shows no more than about the budget's worth of `go test` processes at a time.
   - Check: the run finishes with the complete survivor list.

4. **The user can see that a mutation run leaves nothing behind.**
   - Precondition: the Go phase from item 3, with `du -sh "$(go env GOCACHE)"` noted before the run.
   - Check: after `ac mutate <phase>`, the user's Go build cache has not grown.
   - Check: `~/.astro/heavy/runs/` holds no `ac-run-*` folder.
   - Check: `~/.astro/heavy/gocache` stays at or below `heavy.go_cache_max_mb` (default 5 GB).
   - Steps: press Ctrl-C during a second run.
   - Check: its run folder is gone right away.
   - Steps: `kill -9` a third run, then run `ac mutate <phase>` again.
   - Check: one line says the dead run's folder was cleaned.

5. **The user can execute a phase whose wave needs healing and see the test gate run only the phase's targeted tests in fast mode.**
   - Precondition: a project in the default fast mode (`verify.full_suite` unset).
   - Precondition: a phase whose plan makes a wave need the heal ladder.
   - Precondition: phase-stamped changes with linked tests.
   - Steps: run `/astro-execute <phase>`.
   - Check: the test gate runs `ac suite run` on the targeted test files, not the whole suite.
   - Check: with `ac config set verify.full_suite phase`, the same situation runs the full suite.
   - Check: a red or zero-test gate still stops the phase in both modes.
