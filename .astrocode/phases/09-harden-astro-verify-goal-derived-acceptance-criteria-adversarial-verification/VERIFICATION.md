# Verification — Phase 9: Harden astro-verify (ADR-021)

**Verdict: PASS (AI gate).** Verified adversarially with independent behavioral evidence,
not just static checks — the mission's own method applied reflexively.

## Static contract guards
`node --test tests/*.test.mjs` → **282 pass, 0 fail** (was 276 + 6 new). New guards:
- `tests/criteria.test.mjs` — the Criteria stage is declared and CALLED before Research /
  the researcher `parallel()` fan-out; spawns `agentType: 'astro-criteria-author'` at
  planner tier; the author agent is plan-blind and pins the `C<n>`/`Observe:`/`Fails if:`
  schema and bans structural checks.
- `tests/verify.test.mjs` — the verifier agent + the execute-phase Verify spawn are
  plan-blind (forbid PLAN.md), adversarial ("assume FAIL"), check CRITERIA.md, and
  self-derive with a provenance line; the verifier grants no Write tool.

## Behavioral evidence (the part static guards can't prove)
Two adversarial probes: a gamed `solver.mjs` that sums only its first two args while its
own weak bundled test (`2 3 → 5`) passes and its PLAN.md claims "DONE, tests green, PASS".
The OLD verifier (trust the plan + run the green suite) would PASS this — the exact
Terminal-Bench 2.0 false-PASS.

- **Probe A (CRITERIA.md present):** verifier returned **FAIL**. Opened with
  `CRITERIA.md found (1 criterion)`, ran the criterion's own commands
  (`node solver.mjs 2 3 4` → `5`, expected `9`; `10 20 30` → `30`, expected `60`), cited the
  output, and **explicitly refused to treat PLAN.md's "PASS" as evidence**.
- **Probe B (no CRITERIA.md):** verifier returned **FAIL**. Opened with
  `CRITERIA.md absent — self-derived 3 criteria from the goal`, ran the evidence, and caught
  an extra bug the planted criteria didn't name (single-arg → `NaN`).

## Generation half (dogfood)
Spawned `astro-criteria-author` on a fresh goal (plan-blind): produced **10 criteria**, each
with an `Observe:` black-box command + `Fails if:`, **zero** structural/existence checks,
covering edge cases the goal only implied (2-dp rounding of 7/3, empty input, negatives,
float rejection, single-line output).

## Conclusion
The verifier never agreed with the bad work — in both the CRITERIA-present and self-derive
paths — and the criteria it grades against are goal-derived and behavioral. Goal met.

## Activation note (not a code gap)
The DEPLOYED agents at `~/.astro/code/agents/` are the pre-ADR-021 copies until
`ac update`/`ac install` redeploys — required for live sessions to pick up the new contract.
