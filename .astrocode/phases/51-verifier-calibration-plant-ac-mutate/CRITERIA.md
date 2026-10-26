# Phase 51 — Success criteria (pre-registered, plan-blind)

> Derived from the phase goal, CONTEXT.md (D1–D6) and canon only. A different-but-valid
> implementation must satisfy every criterion.
>
> **Fixture used by several criteria (build it under `mktemp -d`, never in this repo):** a small
> git project with at least two *accepted* (`complete`) phases and at least one phase that is
> not accepted (`pending` or `verified`). Its accepted phases carry mutation-tool data for both
> mutmut (generated mutant source) and Stryker (report entries with `replacement` + `location`),
> holding killed mutants plus survivors, and a SURVIVORS.json in which some survivors are judged
> `test-gap`, some `equivalent`, and some are unjudged. The non-accepted phase carries killed
> mutants and `test-gap` survivors too, so wrong selection is visible. The verifier is replaced
> by a stub that records, per invocation, its full input (prompt/args/stdin), its working
> directory, its environment, `git status --porcelain`, `git log --all --format=%s`, and the
> diff of its tree against the original project's tree, then returns a scripted
> PASS/FAIL verdict and a scripted cost. Use whatever stub seam the command or its test suite
> offers (e.g. a fake agent binary first on PATH). No real model call or network is needed.

### C1 — Without `--yes`, the command prints the bill and does nothing else
- **Observe:** In the fixture, run `ac verify calibrate --defects 4 --runs 2` (no `--yes`).
  The output states an estimated cost for 4 defects × 2 runs and says `--yes` is needed to
  proceed. Afterwards: the stub verifier log shows **zero** invocations, the calibration log
  in `.astrocode/` is byte-identical to before, `git status --porcelain` in the fixture is
  unchanged, and no scratch copy of the repo is left behind. Then run
  `ac verify calibrate --defects 4 --runs 4 --yes`: the estimate printed for the larger
  `--runs` is higher than for `--runs 2`.
- **Fails if:** any verifier run happens, a log record is appended, the working tree or
  `.astrocode/` state changes, no cost figure is printed, the estimate ignores `--defects`/`--runs`,
  or the command proceeds as if confirmed.

### C2 — Two defect sets, drawn only from accepted phases, reported apart
- **Observe:** Run `ac verify calibrate --defects 4 --runs 1 --yes --json` in the fixture.
  Every defect the output lists names its phase, its tool, and its set. Cross-check each
  against the fixture: every EASY defect is a mutant the project's tests **killed**; every HARD
  defect is a survivor judged **`test-gap`** in SURVIVORS.json; every defect comes from an
  accepted phase. The output (stdout and JSON) reports two separate false-PASS rates, one per
  set, each with its own counts.
- **Fails if:** a survived mutant appears in the easy set; an `equivalent`-judged or unjudged
  survivor appears in the hard set; any defect comes from a non-accepted phase; or the result is
  one blended rate (or one rate silently standing in for both).

### C3 — Each planted defect is exactly the tool's mutant, alone, in a throwaway copy
- **Observe:** From the stub's per-invocation records of the C2 run: the working directory is
  never the fixture's own working tree (nor under it), and the tree diff against the original
  project is exactly one mutant — for a mutmut defect it equals that mutant's generated
  source change; for a Stryker defect it equals the report's `replacement` applied at its
  `location`, and nothing else differs. The fixture's own working tree is byte-identical
  (`git status --porcelain` and `git diff` empty) after the run, and no scratch copies remain.
  Run the fixture with a defect from each tool to cover both.
- **Fails if:** the verifier runs in the real working tree; a copy carries zero, two or more
  defects, or a change differing from the tool's mutant (off-by-line, wrong column, partial
  replacement); either tool's defects never get planted; or the fixture or its working tree
  is altered or copies are left behind.

### C4 — The verifier runs blind, with the same contract as `/astro-verify`
- **Observe:** Compare the stub's captured input for a calibration run with the input
  `/astro-verify` gives the verifier for the same phase (same agent role/prompt and verdict
  contract, the same CRITERIA.md bar for that phase). Then search everything the verifier can
  see — its prompt/args/stdin, environment, `git status --porcelain`, `git log --all`
  subjects, branch and tag names, and the copy's files — case-insensitively for
  `calibrat`, `plant`, `mutant`, `mutat`, `defect`, `mutmut`, `stryker`, and check
  for mutation-tool artefacts (e.g. a mutmut `mutants/` tree, a Stryker report).
- **Fails if:** the verifier gets a different or reduced prompt/contract from `/astro-verify`;
  any of those words or artefacts appears where the verifier can see it; or the plant is
  visible as an uncommitted modification in `git status` or under a commit/branch message
  naming it (pointing straight at the defect).

### C5 — K trials per defect, with correct rates, 95% intervals and per-defect pass^k
- **Observe:** In the fixture, script the stub so that for a known selection one easy defect is
  PASSed on every trial, one is PASSed on 1 of 3 trials, and the rest always FAIL; run
  `ac verify calibrate --defects <n> --runs 3 --yes --json` with a seed. Check: the stub was
  invoked exactly `n × 3` times (3 per defect); each set's false-PASS rate matches the scripted
  outcomes under the definition the output states; each rate carries a 95% interval that
  contains its point estimate and lies within [0, 1]; a set with **zero** false PASSes still
  gets a non-degenerate interval (upper bound > 0); and the per-defect lines tell apart the
  always-PASSed, sometimes-PASSed and never-PASSed defects by their pass^k.
- **Fails if:** trial counts differ from K per defect; a rate is wrong for the scripted
  outcomes; an interval is missing, excludes its estimate, leaves [0, 1], or collapses to
  [0, 0] on zero false PASSes (the Wald trap); or pass^k cannot distinguish a defect caught
  on every run from one caught only sometimes.

### C6 — The same seed gives the same plants; the seed actually matters
- **Observe:** In a fixture whose usable pool is much larger than the request (e.g. ≥ 20
  candidates, `--defects 4`), run twice with `--seed 7` and once with `--seed 8`
  (`--yes --json`, stub verifier). Compare the listed defects (phase, tool, mutant identity)
  and the stub-recorded plant diffs.
- **Fails if:** the two `--seed 7` runs select or plant different defects (or in a different
  order where order is reported), or `--seed 8` selects exactly the same set as `--seed 7`
  (the seed is ignored).

### C7 — One total budget caps the run; reaching it stops cleanly and honestly
- **Observe:** Set the run's total budget (through whatever control the command exposes)
  below the cost of the full request, with the stub reporting a fixed cost per trial, and run
  `--yes --json`. Count stub invocations and read stdout, JSON and the new log record.
- **Fails if:** trials keep starting after the budget is reached; the run crashes or exits
  without a summary; the report claims the requested defect/trial counts instead of the
  completed ones; the rates are computed over trials that never ran; the run is not marked as
  stopped by the budget; or no budget limit exists at all (a large request runs unbounded).

### C8 — Shortfalls are run and reported, never padded or faked
- **Observe:** (a) Fixture with only 2 killed mutants and 1 `test-gap` survivor usable (plus
  `equivalent` and unjudged survivors), run `--defects 10 --runs 2 --yes --json`. (b) A fixture
  with **no** `test-gap` survivors. (c) A Go project whose only mutation data is from Gremlins.
- **Fails if:** (a) the report shows 10 defects, repeats a defect to fill the count, draws on
  equivalent/unjudged survivors or survived mutants, omits the real counts, or does not mark a
  rate below the stated minimum as too few defects to rely on; (b) the hard rate is reported
  as 0% (or any number) instead of unavailable; (c) the command reports 0 defects or a rate
  without saying Gremlins is not supported.

### C9 — Each completed run appends one comparable record to a committed log
- **Observe:** In the fixture run calibration twice (stub verifier), editing the verifier's
  prompt between runs. Read the calibration log in `.astrocode/`: it holds both records, the
  first unchanged, each with date, verifier model, verifier prompt version/hash, seed, both
  rates with their 95% intervals, per-defect pass^k, and counts. The prompt hash/version
  differs between the two records. `git check-ignore` reports the log as not ignored (it can be
  committed and diffed), and the numbers in the record match that run's stdout and `--json`.
- **Fails if:** a run overwrites or drops an earlier record; a field is missing; the prompt
  hash/version is unchanged after the prompt edit; the log is gitignored or outside
  `.astrocode/`; or the record disagrees with what the run printed.

### C10 — Bad flags stop before anything is spent
- **Observe:** In the fixture run, each with `--yes`: `ac verify calibrate --run 5`,
  `--defects 0`, `--runs abc`, `--seed` with no value.
- **Fails if:** any of these exits 0 or starts a verifier run; in particular an unknown or
  typo'd flag silently falls back to the default and proceeds to spend (the ADR-029 hazard).

### C11 — The slash command drives the same bill-first flow, and nothing in the loop runs it
- **Observe:** Read the installed slash command for calibration: it runs `ac verify calibrate`
  to show the bill first and passes `--yes` only after the human explicitly agrees to that
  bill, then relays the summary within a stated bound. Read the automated loop's commands and
  workflows (discuss, plan, execute, verify, accept and their workflow scripts): none starts a
  calibration.
- **Fails if:** the slash command passes `--yes` without a human confirmation step, does
  something other than call the CLI flow, has an unbounded reporting slot, or any loop
  command/workflow can trigger calibration on its own.

### C12 — The project's full test suite is green
- **Observe:** `node --test` over the repository's test files (the project's normal test
  command) exits 0 with zero failures, including the suite's own tests for this feature.
- **Fails if:** any test fails or errors, or the suite cannot be collected.
