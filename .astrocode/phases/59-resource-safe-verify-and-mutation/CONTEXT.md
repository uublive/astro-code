<!-- astro-discuss: captured by agent: claude -->
# Phase 59 — Resource-safe verify and mutation

Origin: the owner, 2026-11-22: "The verified, especially the mutant, are taking SO much space and SO much
resources and takes SO much time … the tests yesterday crashed the computer because of memory usage."

## Evidence (measured on the owner's Mac, 36 GB RAM, 11 CPUs, 2026-11-22)

- Kernel panics (watchdog timeout, the system starved) on 2026-11-20 12:15 and 2026-11-22 22:53; the second
  during a Gremlins run for astrobot phase 167. A JetsamEvent on 11-19 shows the baseline already near full:
  Docker VM 13 GB, 28 Claude sessions 10 GB, Chrome 12 GB.
- Gremlins with no `.gremlins.yaml` starts one worker per CPU, each running `go test` on every CPU. `ac mutate`
  passes no bound. astrobot now carries a hand-written workaround (`workers: 2`, GOMAXPROCS=2,
  GOFLAGS="-short -p=2"; `test-cpu` must NOT be set: Gremlins v0.6.0 passes it as one argument, the test binary
  refuses it and every mutant reads KILLED though no test ran).
- That run tested 716 mutants: for a Go module in a subfolder `ac mutate` uses the file mode (v0.56.0), which
  mutates every line of the scoped files and filters to the phase's lines afterwards.
- Disk: Go build cache 89 GB (every mutant compile leaves entries; the linker wrote 34 GB in 11 minutes);
  `~/.astroforge/tmp` 13 GB, 6 GB of it `gremlins-*` work folders left by crashed runs; disk 94% full.

## Goal

A test suite or mutation run started by astro-code slows down instead of exhausting the machine, tests only the
mutants the phase needs, and leaves nothing behind. What a PASS means does not change: the same mutants on the
phase's lines must be killed, and the full suite is still required.

## Decisions (owner, 2026-11-22)

1. **Default budget: adaptive, conservative.** At the start of a heavy job (`ac mutate`, `ac suite run`, the
   cheap pass's suite run) ac computes a worker budget from the CPU count and the memory free right now: about a
   quarter of the cores, fewer when memory is tight, never under 1 (2–3 on this Mac). It is on by default. A
   project setting overrides it (a number), and the result states the budget used and why.
   - The budget is handed to each tool in the tool's own way: Gremlins `--workers` plus GOMAXPROCS and
     GOFLAGS `-p` for its `go test` calls (never `--test-cpu`); mutmut `--max-children` (the existing
     `mutation.max_children` wins when set); Stryker `--concurrency`; `go test` `-p`; `node --test`
     `--test-concurrency` where the suite command is ac's to shape, otherwise through documented env vars.
   - A project's own tool config (`.gremlins.yaml` workers, a Stryker concurrency) that is LOWER than the
     budget is respected; one that is higher is capped, and the result says so.
2. **One heavy job per machine: wait its turn.** A machine-wide lock (per user, outside any project) covers
   mutation runs and full-suite runs. A second job waits in line, says what it waits for (the holder's project,
   command and age), and starts when the first ends. A lock whose holder died is taken over. The wait counts
   against no cap (a mutation cap starts when the run starts).
3. **Mutation always finishes.** No early stop: one run gives the complete survivor list.
4. **Changed lines only, in subfolder modules too.** Find a way for Gremlins to mutate only what the phase
   changed when the Go module is below the repo root (today: every line of the changed files). The researched
   candidate: run Gremlins in a scratch copy of the module that is its own git repo, base commit = the module at
   the phase's base, so `--diff` works with module-relative paths. If it cannot be made sound, say so and keep
   the file mode: never report a mutant as killed or covered that was not run.
5. **Clean up.** A mutation run uses its own Go build cache (not the user's `go-build`), with a size cap and
   oldest-first eviction, and its temp folder (TMPDIR for the tool and its tests) is removed when the run ends,
   on success, failure, cap or Ctrl-C. Leftovers of dead runs are removed at the next run. `ac suite run` gets
   the same per-run temp folder when that does not change what the suite tests.
6. **Folded-in debt:** `2026-11-13-healed-wave-test-gate-still-runs-the` — the healed-wave test gate still runs
   the full suite in fast mode (workflows/execute-phase.mjs). Pay it on accept.

## Constraints

- Nothing may add time to every phase when the machine is idle and nothing else runs, beyond the lower worker
  count (the owner accepts slower over crashed).
- Works on macOS and Linux; where free memory cannot be read, fall back to the CPU-only rule.
- No new dependency (node: built-ins only).
- Record the decision (ADR): it changes the default behaviour of `ac mutate` and `ac suite run`.

## Out of scope

Astrobot's own test hygiene (its `astrobot-job*` and `hostd-bin-*` leftovers) and its gate; changing which
criteria need mutation evidence; an early stop.
