<!-- astro-discuss: captured -->
# Phase 52 — Targeted verify: check only the criteria and suites a change can affect

## Why
GitHub #140 (@luigi-lauro): ADR-079 narrows only the re-verify after a FAIL; every other verify
re-checks the whole phase and re-runs the full suite, even after a one-line follow-up commit (phase 53's
verify took ~50 min). Luigi measured targeted runs at 1-5 units vs 9-13 for full ones. #141 (backlog,
folded in): verifiers re-run suites already passed on the identical clean tree — 16% of all test minutes.

## Goal
A verify after a recorded full PASS checks only the criteria (and suites) the diff since that PASS can
affect, carries the rest forward with a citation, and may mark the phase verified under strict
conditions — always saying which mode ran, which criteria were observed and which were carried.

## Decisions (Matteo, in this session)

D1 — **Code proposes a floor, the verifier may only widen.** `ac` computes the minimum set of criteria
to re-check from the diff since the last full PASS (criteria whose Observe line or named files/commands
touch what changed, plus the never-carry ones in D4). The verifier must observe at least that set and
may add more, never fewer. Deterministic floor, judgement on top (principle 333f).

D2 — **A targeted pass may mark the phase verified, with conditions** (amends ADR-079's "verified =
every criterion observed in one run"). Every carried criterion must: cite the phase's most recent full
PASS (run + commit) at an ancestor of HEAD; have none of its files touched by the diff; not be a
never-carry criterion (D4). Otherwise it is re-observed or the run is full. Record as an ADR.

D3 — **Automatic, full when broad.** Any verify after a recorded full PASS targets by default. A phase's
first verify, a broad diff (over a threshold of touched criteria or files), or `--full` runs everything.
The output always states the mode and why (principle b940).

D4 — **Never carried: suite and test-strength criteria.** A criterion whose evidence is the full test
suite is re-checked unless a suite receipt (D6) covers the exact clean tree. A test-strength criterion
(`[mutation]` or marked `test_strength`, ADR-085) is re-checked whenever any file in its mutate scope
changed.

D5 — **One hop only.** A carry comes only from the phase's most recent FULL pass; a targeted pass is
never the base of the next targeted pass (no carry of a carry). Successive targeted verifies all compare
against the same full PASS.

D6 — **#141 folded in: suite receipts.** Whoever runs the project's suite (executor commit hook,
reviewer, verifier) writes a small receipt (command, commit, clean-tree check, exit status, time); a
verifier on the same clean tree reuses it and cites it instead of re-running. Never reused on a dirty
tree or a different commit/command.

D7 — **Carries named per criterion.** VERDICT.json marks each criterion `observed` or `carried` (with
the run and commit it came from); `/astro-accept` and `ac phase show` list the carried ones, so the
human sees which passes were not re-observed.

## Also in scope (folded in)
- Backlog `2026-10-23-verifier-reuse-a-recorded-passing-suite` (#141) → D6; linked to phase 52.
- ADR recording D2/D4/D5 (amending ADR-079), MANUAL, CHANGELOG, verifier and command text, tests (diff →
  floor set, carry conditions, one-hop, receipt reuse/refusal, accept display).

## Out
- Changing how a narrowed re-verify after a FAIL works (ADR-079 stays for that case).
- Cross-phase carries.

## Open / for the planner
- How a criterion's "files" are known (Observe line paths/commands, the phase's stamped files, or an
  explicit annotation) and the broad-diff threshold.
- Where receipts live (local, keyed by commit + command) and who writes them in each host.
- Interaction with `ac verdict plan` (ADR-079's single decider) — extend it rather than add a second.
