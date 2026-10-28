<!-- astro-discuss: captured -->
# Phase 54 — Verify in fewer, cheaper rounds

## Why
Evidence in REPORT.md (this folder). astro-code phases 51/52: 9 verify runs each, one new gap per narrowed
round. Astrobot phase 104: 10 runs over ~22 h; 105: 7 full FAILs in ~9 h, ~1.5 h apart; every run since 104
run 5 was full because the verifier declared every fix "broad"; criteria are heavy scenarios (scratch hostd
world, a pre-phase binary build, gate.sh on the Mac) rebuilt per run; criteria flip pass/fail between runs.

## Goal
A phase reaches `verified` in fewer and cheaper verify rounds without weakening what `verified` means for
its core criteria: every gap is found in one pass, a cheap check runs first, remediation overlaps the rest of
the verify, a human can defer failed edge criteria to tracked fixes, a "broad" claim is checked in code, and
costly setup is reused across runs on the same commit.

## Decisions (Matteo, in this session)

D1 — **Deferral is chosen by the human at a FAIL, never automatic.** The FAIL report lists which failed
criteria are deferrable; the human names the ones to defer (e.g. `ac verdict defer <phase> C7 C9`). Each
deferred criterion opens a fix (the existing fix register, `ac fix`) with the verifier's failing command and
output pre-filled as its reproduction. The verdict records the criterion as `deferred` with its fix id; the
phase may then be verified when every non-deferred criterion passes.

D2 — **Core vs edge is fixed at pre-registration.** The criteria author tags each criterion core or edge in
CRITERIA.md, plan-blind, before any plan exists (so the bar cannot be bent after a FAIL). Core criteria and
the suite criterion are never deferrable; the code refuses. An untagged criterion is core (fail-closed).

D3 — **What a deferral blocks.** The phase can be verified and accepted; `/astro-accept`, `ac phase show`,
`ac status` and the band list the open deferred fixes; `ac milestone complete` refuses while any deferred
fix of that milestone is open.

D4 — **Fast first check, stop early.** A verify first runs one cheap pass: the suite (or a reusable suite
receipt, ADR-089) plus each criterion's cheapest observation. If anything fails there, it reports the FAIL
at once with EVERY unmet criterion it found. The expensive adversarial scenarios run only when the cheap pass
is clean. Applies inside the loop (execute workflow and /astro-verify), not as a separate command.

D5 — **Every gap in one pass.** A FAIL run reports all unmet criteria it observed, not only the first; a
narrowed re-verify that finds its first ids still unmet still lists any other failure it saw.

D6 — **A "broad" claim must name files; code checks it** (principle ce7b). The verifier lists the files that
make the fix broad; `ac verdict record`/`ac verdict plan` check them against the criteria's file map
(lib/impact.mjs). An unsupported claim is refused: the run stays narrowed and the output says why.

D7 — **Remediation overlaps the verify, in a worktree.** Once failures are known, the executor starts fixing
them on its own worktree branch while the verifier keeps checking the rest on the unchanged tree; the fix
lands after the verdict, so the verifier never sees a moving tree. (Hosts or configs without worktrees fall
back to sequential: verify, then fix.)

D8 — **Cached setup keyed by commit + declared command.** A project declares its expensive setup steps (e.g.
"build the pre-phase binary at <commit>"); each result is cached by the exact command and the commit it
builds from, like suite receipts, and reused only when both match. Stored locally in `.astrocode/.local/`
(never committed), with a size cap and oldest-first cleanup.

D9 — **Flapping is flagged, never changes the verdict.** Using the verdict history (below), the FAIL report
marks a criterion that passed in an earlier run of the same phase and now fails, and says whether its files
(impact map) changed since — a regression from a fix vs an inconsistent verifier.

## Folded in
- Backlog `2026-10-23-verdict-history-ac-verdict-history` (linked to phase 54): `ac verdict history <phase>`
  and an append-only `VERDICTS.jsonl` beside VERDICT.json — the data source for D9.
- Debt `2026-10-15-after-a-withdrawn-carried-pass-the-loop` (workflows/execute-phase.mjs): after a withdrawn
  carried PASS the loop spends a remediation cycle on zero unmet criteria and the FAIL summary reads 'ok'.

## Also in scope
ADR(s) for D1–D3 (deferral amends what "verified" means — record it), MANUAL, CHANGELOG, verifier/executor
and command text, tests (deferral refusal for core/suite/untagged, milestone-close refusal, broad-claim
refusal, cache hit/miss, one-pass FAIL listing, flapping flag, history append).

## Out
- Automatic deferral of any kind; deferral by the verifier.
- Changing targeted verify (ADR-089) or the narrowed decision (ADR-079) beyond D5/D6.
- Speeding up a project's own test suite.

## Open / for the planner
- The core/edge tag syntax in CRITERIA.md and how the criteria-author prompt asks for it.
- How "each criterion's cheapest observation" is expressed (a CRITERIA.md field vs verifier judgement) —
  keep the decision in code where it can be (principle 333f).
- The setup-step declaration format and where it lives (config.json vs RUN-CONTRACT.md).
- How D7's worktree branch is integrated after the verdict, reusing the existing integrator.
