<!-- astro-discuss: captured by agent: claude -->
# Phase 56 — Run a slow test suite last in verify

Origin: the owner's request, relayed by the astrobot-vault session (2026-11-09). Astrobot's full gate
(`bash scripts/gate.sh all`) takes ~50 min, mostly `go test -race`; a verify round that fails one quick
criterion still pays for it (phase 130 there is on its 8th run). Speeding up Astrobot's own gate is done in
the Astrobot repo, not here.

## Goal

A verify round that fails costs the time of what it checked, not the slowest thing in the project: a suite
measured as slow runs only once every other criterion has passed. Nothing about what a PASS means changes.

## Decisions (owner, 2026-11-09)

1. **Which suite is slow — measured, not declared.** ac already records each suite run's duration
   (`lib/receipts.mjs`, `seconds` in the receipt). A suite command whose most recent recorded run on this
   machine took longer than a threshold is **slow**. Threshold: 10 minutes by default; a project setting
   (e.g. `verify.slow_suite_minutes`) changes it.
2. **No timing yet = slow.** A suite command with no recorded run is treated as slow (held back to the end)
   until it has been timed once.
3. **Order for a slow suite.**
   - The cheap first pass (ADR-091) does NOT run a slow suite. It still reuses a reusable suite receipt when
     one exists (that costs nothing). Fast suites keep today's behaviour (run in the cheap pass).
   - The verifier observes every non-suite criterion first. Only if ALL of them pass does it run the slow
     suite (through `ac suite run`, so the receipt and timing are recorded).
   - If any non-suite criterion is unmet, the round ends as a FAIL listing EVERY unmet criterion (never just
     the first), and the suite criteria are reported as not run in this round ("held back: slow suite"),
     never as passed and never as failed.
4. **PASS unchanged.** A PASS still needs the full suite observed (or a valid reusable receipt) on the
   verified commit: ADR-079/089/091 and `verifiedGate` hold. The owner rejected running race only once per
   phase: do not weaken the full-suite requirement.
5. **Remediation rounds** (narrowed/targeted re-verify) follow the same order: re-check the unmet non-suite
   criteria first, the slow suite last.
6. **Record the decision** as an ADR amending ADR-091 (it changes the verifier contract).
7. **Folded-in debt:** `2026-10-15-after-a-withdrawn-carried-pass-the-loop` — after a withdrawn carried PASS
   the loop spends a remediation cycle on zero unmet criteria, and the FAIL summary reads 'ok'. Fix it in the
   same verify-loop code; pay the debt on accept.

## Constraints

- Nothing may add time to every phase (CONTEXT of phase 55, principle proposed then): the change only removes
  work from failing rounds.
- Works without the Workflow tool too (the Agent-tool tier of `/astro-verify` and `/astro-execute` follows the
  same order).
- The verifier stays plan-blind; the order is decided by code/commands (`ac verdict …`), not by the verifier's
  judgement where possible.

## Out of scope

Running race once per phase; changing Astrobot's gate; per-criterion "slow" tags (the measurement decides).
