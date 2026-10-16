<!-- astro-discuss: captured -->
# Phase 45 — Targeted re-verify after a FAIL (GitHub #129)

## Goal
A re-verify after a FAIL stops paying a full Opus run each time it is still failing. It re-checks the
previously unmet criteria first and fails cheaply when any is still unmet, and it never marks a phase
verified on a carried PASS.

## Evidence (from #129 and the backlog note)
117 verifier runs measured; full re-runs after 1–3 small local failures were 33% of verifier cost.
astro-forge phase 222 (2026-10-14) was re-verified in full four times over one criterion (C6). At the
default `standard` effort the in-workflow loop runs one remediation cycle (`maxCycles` 1), so most repeat
runs are hand-run `/astro-verify`; today nothing persists between verify runs.

## Decisions
1. **The passing run is always full (ADR-031's guarantee kept).** A phase is marked `verified` only by a
   run that independently checked EVERY criterion. Narrowing only makes a still-failing re-verify cheap.
2. **One run, unmet first.** A narrowed re-verify is a single verifier run: it re-checks the previously
   unmet criteria first, from scratch and plan-blind as today (their `Observe:` evidence). If any is
   still unmet, it stops with FAIL. If all now pass, the SAME run continues and checks every other
   criterion, so a PASS never costs two runs.
3. **A narrowed FAIL reports every previously unmet criterion** (checks them all before stopping, so the
   user sees the full remaining list in one go). Criteria not re-checked are reported as carried, each
   citing the verdict (run and commit) it rests on.
4. **Both paths:** the verify→remediate loop in `workflows/execute-phase.mjs` and hand-run
   `/astro-verify`.
5. **The verdict is saved, committed, in the phase folder:** a machine-read `VERDICT.json` beside
   CRITERIA.md, written only through `ac` (never by hand; canon-guard should protect it like the
   other ac-owned files): per criterion passed/failed/carried, the commit (HEAD) it ran on, the
   CRITERIA.md it graded against (hash), mode (full/narrowed), timestamp. The next re-verify reads it.
6. **Fall back to a full run automatically when any of these holds** (deterministic checks first, the
   verifier's judgement last):
   - many criteria unmet: more than 3, or more than a third of all criteria (planner may tune; state it once);
   - CRITERIA.md changed since the saved verdict (hash differs);
   - history doesn't line up: the saved verdict's commit is not an ancestor of HEAD, or no saved verdict;
   - a broad fix: the verifier, given the diff since the saved verdict, judges it touches what many
     criteria rest on. (The diff is input to the run; deciding "broad" is the verifier's call.)
   A `--full` flag on `/astro-verify` (and a workflow arg) forces a full run.

## Defaults for the planner (not discussed; change only with reason)
- The no-progress bail in the loop keeps comparing the COMPLETE failing set: carried criteria count as
  last seen (ADR-031's cross-cycle comparison stays intact).
- Test suite: the full continuation runs it as today (or reuses the after-commit gate log on the same
  HEAD). A narrowed FAIL runs it only when a previously unmet criterion's `Observe:` needs it.
- `findings[]`/debt filing stays PASS-only (unchanged).
- `tests/workflows.test.mjs` "ADR-031: re-verify redirects depth but never narrows coverage" is
  updated to the new contract, not deleted: a PASS still requires full coverage.

## Out of scope
- Carrying a PASS into `verified` (rejected above).
- Changing remediation scoping, effort levels or cycle counts.

## Canon touched
ADR-031 (amended, not superseded: coverage stays total for any PASS), ADR-021 (plan-blind unchanged),
ADR-022 (loop unchanged except the narrowed re-verify).
