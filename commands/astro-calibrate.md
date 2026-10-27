---
description: Measure the verifier's false-PASS rate by planting real mutants in accepted phases (on demand, billed, never part of the loop)
argument-hint: [--defects N] [--runs K] [--seed S] [--budget USD]
allowed-tools: Bash, AskUserQuestion
---

Verifier calibration with `$ARGUMENTS` (GitHub #157). `ac verify calibrate` does all the
mechanical work: it draws real mutants from accepted phases, plants one per throwaway copy, runs the
verifier blind on each, and reports false-PASS rates with 95% intervals. It spends money, so this
command shows the bill first and runs only on the human's explicit yes. It is on demand only: no loop
command or workflow ever calls it.

1. Run `ac verify calibrate $ARGUMENTS` **without** `--yes`. That prints the bill: the estimated cost,
   defects × runs, the seed, the budget, and that `--yes` is needed. Relay it as printed, in at most 5
   lines. When it prints a shortfall or "unavailable" reason instead, relay that and stop.
2. Ask through `AskUserQuestion` whether to run this bill. Follow `$(ac path templates)/asking.md`:
   frame the round in two or three sentences (what is measured, what it costs, that the repo itself is
   never touched), then offer **Run it** (spends up to the budget), **Change the size** (a different
   `--defects` / `--runs`, then back to step 1) and **Explain more**.
3. Only on an explicit yes to that bill, re-run the same command with `--yes --seed <the seed the bill
   printed>`, so the defects planted are the ones billed. Any other answer, or no answer, ends here:
   say nothing further.
4. Relay `ac`'s summary as printed: at most 8 summary lines, then `ac`'s per-defect lines (it caps them
   and names `--json` for the rest). Say nothing else, and point at `.astrocode/CALIBRATION.jsonl` for
   the committed record.

**Never** pass `--yes` without the human's explicit agreement to that bill, and never call anything but
`ac verify calibrate`. Calibration records a number; it never changes a phase's status, a verdict or a
survivor judgement.
