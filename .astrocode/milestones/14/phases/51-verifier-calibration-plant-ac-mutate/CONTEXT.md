<!-- astro-discuss: captured -->
# Phase 51 — Verifier calibration: the verifier's false-PASS rate

## Why
GitHub #157 (@luigi-lauro): ADR-021/022/079 rest on the verifier's PASS being trustworthy, but
nothing measures it — "trustworthy" is an assertion, and after a verifier prompt or model change no
number says whether it got better or worse. `ac mutate` (ADR-083/084/085) measures whether tests
catch a change; nothing measures whether the verifier does.

## Goal
`ac verify calibrate` plants real defects into accepted phases (from `ac mutate`'s own mutants),
runs the verifier on each exactly as `/astro-verify` would, several times, and reports false-PASS
rates with intervals and per-defect pass^k — a number that can be compared across verifier changes.

## Decisions (Matteo, in this session)

D1 — **Two defect sets, reported apart.** EASY: mutants the project's tests already kill (a real bug
by construction). HARD: survivors a human judged `test-gap` in a phase's SURVIVORS.json (a real bug no
test catches). Two false-PASS rates; the hard one shows whether the verifier looks beyond the suite.

D2 — **Small default, bill first, one budget.** Default 10 defects × 3 runs each (`--defects`,
`--runs` to change). Before anything runs it prints the estimated cost and proceeds only with
`--yes`. One total budget caps the run; reaching it stops cleanly and reports what completed
(principle 8d73). Never part of the automated loop — on demand only.

D3 — **Committed history.** Each run appends one record to a calibration log in `.astrocode/`
(date, verifier model and prompt version/hash, seed, both rates with 95% intervals, per-defect
pass^k, counts), so "did the new prompt help?" is a diff. Stdout shows the same summary.

D4 — **mutmut and Stryker.** Planting is exact for both: mutmut from its generated mutant source
(phase 49's `mutantsFileChanges`), Stryker from the report's `replacement` + `location`. Gremlins
reports no patch — left out, and the command says so for a Go project.

D5 — **Blind.** The verifier gets the same prompt and contract as `/astro-verify`, in a throwaway
copy of the repo (never the working tree); nothing tells it a defect was planted.

D6 — **Shortfall: run what exists, say so.** When accepted phases offer fewer usable defects than
asked, plant what is available, report the real counts and the wider interval, and mark a rate "too
few defects to rely on" below a stated minimum. Never pad with weaker defects.

Settled by principle (not asked): measurement is frozen and repeated — the verifier is not changed
during a run, k trials per defect, no look-and-fix mid-run, same seed → same plants (principle cc77).

## Scope
In: `ac verify calibrate [--defects N] [--runs K] [--seed S] [--yes] [--json]` (+ a slash command,
principle 2310); deterministic selection from the seed; planting into a scratch copy; blind verifier
runs; rates with intervals and pass^k; the committed log; MANUAL, CHANGELOG; tests with stub tools and
a stub verifier (selection determinism, planting reproducibility, bill/budget, shortfall, log record).

Out: running in the verify→remediate loop; tuning the verifier (that is what the number is for, later);
Gremlins; astro-code calibrating itself (its `node --test` suite has no supported mutation tool —
calibration runs in projects such as Waupaca or Astrobot).

## Open / for the planner
- How "accepted phase" and its stamped files are found (archived milestones included) and which
  CRITERIA.md the verifier grades against for a planted defect.
- The cost estimate's basis (recorded verifier spend, e.g. `ac stats` after #152/#153) and the
  budget unit.
- How a planted defect maps to the criteria it should fail, if at all, for reporting.

## Amendment after planning (Matteo, 2026-10-26)
D7 — C3 amended: the per-trial copy removes the mutation records C4 requires hidden (SURVIVORS.json, VERDICT.json mutation evidence, CALIBRATION.jsonl, tool artefacts), listed per trial in the JSON; blindness wins over a literal one-change diff.
D8 — `--budget <usd>` caps a run (default 1.5x the printed bill; cost from what Claude reports per trial, stated fallback $3 per trial), satisfying D2/C7.
D9 — C4 bounded after four fix rounds (Matteo, 2026-10-26): paths are matched by their REAL path (any spelling) in symlinks, text files and the environment; a third-party binary embedding an unrecognised spelling is a stated limit in the MANUAL and the output, not a C4 failure.
