<!-- astro-discuss: captured by agent: claude -->
# Phase 57 — Fast phase verify, full check at milestone close

## Why
A phase verify round costs 20–30 min, almost all of it the full test suite (11.7 min wall on this Mac,
~104 CPU-min), paid once in the cheap pass, again in the verifier, and again by remediation executors —
multiplied by the number of rounds (phase 56: 6 rounds, ~2.5 h). Measured 2026-11-12 on phase 56
(14 criteria): a verifier that runs only the tests the phase touched (23 files, 80 s) took 3.5–6.3 min
per run, and with Opus caught 3/3 planted defects and a real loop bug the full verify had missed
(fix 2026-11-13-verify-loop-a-withdrawn-carried-pass). Sonnet was not faster and verified more weakly:
the verifier model stays as configured (Opus).

## Decisions (owner, 2026-11-13)
1. **Fast mode is the default for every project** (owner chose "on for everyone"). A project setting
   switches back to today's behaviour (full suite on every phase PASS). Name the setting in the plan
   (suggestion: `verify.full_suite: milestone | phase`, default `milestone`).
2. **Phase verify in fast mode** runs no full suite — not in the cheap pass, not in the verifier, not in
   remediation executors. Instead it runs an **auto-picked test set**, computed in code (never by the
   verifier's judgement): the test files the phase changed plus the tests of the source files it changed.
   No list to maintain. A PASS in fast mode needs that targeted set green on the verified commit.
3. **No linked tests** (docs-only / prompt-only phase): run no tests, verify the criteria only, and the
   report says "no linked tests". No fallback to the full suite.
4. **Phase status after a fast PASS** is verified and may be accepted and released immediately, but it is
   visibly marked **fast-verified, full check pending** (status, band/`ac status`, accept output, and
   release notes when a release is cut) so nobody mistakes it for fully checked.
5. **Milestone full check**: one command (e.g. `ac milestone verify` / `/astro-verify-milestone`) runs,
   on the milestone tip, the **full test suite + every phase's quick re-checks** (each criterion's
   `Cheap:` command; a phase with none contributes nothing beyond the suite). Not a full re-verify of
   each phase.
6. **On a failure** the full check opens a fix tied to the phase whose criterion/tests broke (suite
   failures: tie to the phase that last changed the failing test's subject when determinable, else to
   the milestone), then **tries to repair it overnight** with an agent, within a limit (default 2
   attempts per fix), and ends with a morning report: fixed / still open.
7. **Milestone close is blocked** until the full check has passed on the current tip (a new commit after
   the check needs a new check) with no open fix it created. `ac milestone complete` refuses otherwise.
8. **Proposing the full check**: when the last phase of the milestone is accepted, or when the user goes
   to close the milestone (`/astro-complete-milestone`, `ac milestone complete`) without a passing full
   check, astro-code proposes running it (one line + the command). Started by the user or Comet with
   one command; it runs unattended and reports when done. Scheduling it automatically is out of scope.

## Scope
In: the setting; targeted test selection in code; fast-mode paths in `ac verdict cheap`, the verifier
contract (both tiers: workflows/execute-phase.mjs prompts and commands/astro-verify.md /
agents/astro-verifier.md), remediation executor prompts, `ac verdict record` / `ac phase verify` gates;
fast-verified marking; the milestone full-check command + its fix/repair loop + morning report; the
milestone-close gate and the proposal at last-phase accept / close; ADR amending ADR-079/089/091/093;
docs (MANUAL, astro-config).
Out: scheduling the night run; parallel/split verifiers to reach ~2 min (deferred note: measured floor
of one verifier is ~3–5 min; splitting criteria across 2–3 Opus verifiers is the next lever);
speeding up the slow test files (hooks_principles, calibrate_e2e, kit_test_sources, canon_guard —
backlog candidate); the C12 loop bug (its own fix).

## Assumptions / open for the planner
- Existing in-flight milestones: phases already fully verified count as fully checked; nothing is
  re-run retroactively. Projects in `phase` mode keep ADR-093 behaviour unchanged.
- Test↔source mapping heuristic must be deterministic and testable (e.g. changed `tests/*.test.*`, plus
  test files that import or name a changed source file); state its limits in the report.
- Release-notes marking applies where astro-code produces release notes (`ac flow release` path);
  if it produces none, the marking lives in status/accept output only.
