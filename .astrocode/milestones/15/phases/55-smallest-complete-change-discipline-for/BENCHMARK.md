# Phase 55 benchmark: with vs without the smallest-complete-change section

**Result: with-arm 24 / 24 passes, without-arm 23 / 24 passes. with >= without - 1: YES.**

All 48 of 48 planned runs completed (8 tasks x 2 arms x 3 reps); none were cut by the budget.
Every total below is computed from [bench/runs.jsonl](bench/runs.jsonl), one line per run.

## Per-arm totals

| arm | runs | passed | pass rate | LOC changed (total) | LOC changed (mean) | cost $ | input tokens | output tokens | wall (min) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| with | 24 | 24 | 100% | 432 | 18.00 | 4.37 | 394 | 50267 | 10.81 |
| without | 24 | 23 | 95.8% | 444 | 18.50 | 4.50 | 404 | 50050 | 10.92 |

Cost and tokens are executor + verifier together (a run is both). Cache tokens are kept apart in
the records (`cache_tokens`).

## Per-task pass counts

| task | with (passed / runs) | without (passed / runs) |
| --- | ---: | ---: |
| 01-port-validation | 3 / 3 | 3 / 3 |
| 02-atomic-save | 3 / 3 | 3 / 3 |
| 03-last-n-off-by-one | 3 / 3 | 3 / 3 |
| 04-upper-flag | 3 / 3 | 3 / 3 |
| 05-dedupe-tags | 3 / 3 | 3 / 3 |
| 06-pagination | 3 / 3 | 3 / 3 |
| 07-email-field-label | 3 / 3 | 3 / 3 |
| 08-timeout-default | 3 / 3 | 2 / 3 |

The one difference is a single without-arm failure on 08-timeout-default. The diff size and cost
differences are small (about 3%) and not a claim of significance on 24 runs per arm.

## Conditions

- Harness: `bench/run.mjs` (one-off, hand-run, never wired into tests, hooks or CI). Pass/fail is
  the real `agents/astro-verifier.md` run against each task's pre-registered `CRITERIA.md`.
- Arm shas (`executor_sha` in the records):
  - with: `73ffa71da513500d50d6f18536629c692372b208` (`agents/astro-executor.md` at HEAD)
  - without: `0edc2205e2c6a1066d5356fa3a1d1f8282e51fd0` (the parent of the commit stamped `(phase 55 t1)`)
- Model: `claude-sonnet-5-5` for both executor and verifier, in both arms.
- lean-ctx control: excluded from both arms (`--strict-mcp-config` with an empty MCP config, so
  no MCP servers and no injected lean-ctx block).
- Run dates: 2026-11-01, 22:10 to 22:32 UTC (first run started to last run started). The first
  10 runs came from an initial budget-capped invocation, the rest from a resumed one.
