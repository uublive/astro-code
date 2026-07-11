<!-- astro-discuss: captured -->
# Context — Phase 9: Harden astro-verify (goal-derived criteria + adversarial verification)

## Mission (Matteo, via Forgemaster — forge 090bd528)
Make astro-code's self-judgment trustworthy — the verifier must **never agree with bad work**.
Optimize for correctness/depth, not speed. Driver: Terminal-Bench 2.0 — on
`adaptive-rejection-sampler`, internal verify PASSed work the ground-truth verifier scored
**0.0**. In real projects there is no external verifier, so a false-PASS silently ships broken work.

## Root cause (confirmed in code)
- `ACCEPTANCE.md` is written by `astro-planner` from research + the plan (`workflows/plan-phase.mjs`
  L63–95). It's a human-UAT doc for `/astro-accept`; the machine verifier never reads it.
- `astro-verifier` reads *the goal and the plan* and traces code (`agents/astro-verifier.md`;
  spawn prompt `workflows/execute-phase.mjs` L999–1010). With no independent bar, "goal-backward"
  degrades into "re-read the plan and agree."

## RATIFIED ARCHITECTURE — ADR-021 (Matteo's ruling: Option A, plan-time)
A **plan-blind, goal-derived `CRITERIA.md`** becomes the verifier's independent bar.

### 1. CRITERIA.md generation — new FIRST stage of `/astro-plan`
- A dedicated **criteria-author** agent runs BEFORE the researcher fan-out in `plan-phase.mjs`.
- Inputs: phase **goal** + `CONTEXT.md` + project canon. It does **not** see a plan (none exists yet).
- Output `.astrocode/phases/<slug>/CRITERIA.md` — falsifiable, goal-sourced success criteria.
- The researchers + planner MAY read CRITERIA.md (the plan should *aim at* the bar). Independence
  is preserved because criteria are authored first/plan-blind and the **verifier** is plan-blind —
  not the other way around.

### 2. CRITERIA.md schema (each criterion)
- `id` (C1, C2…); a one-line **observable, design-independent** claim about the finished system
  ("Given X, the system does Y").
- **Observe:** the concrete command to run + the expected observable result, OR the artifact/behavior
  to inspect and what proves pass. Must be something the verifier can **independently execute** — never
  "the plan says so."
- **Fails if:** the failure mode that would make it FAIL (adversarial framing).
- Criteria are **goal-level/behavioral** (survive a different valid implementation), but concrete
  enough to be checkable.

### 3. Verifier rewrite (`agents/astro-verifier.md` + execute-phase spawn prompt)
New contract:
1. Read goal + CRITERIA.md. **Do NOT read PLAN.md. Do NOT trust task/commit summaries or executor claims.**
2. Per criterion: **assume FAIL**; independently gather evidence — run the command / drive the behavior,
   observe the actual result. Cite the command + its output as proof.
3. Run the full suite (kept), but green ≠ criterion-passed unless it exercises that behavior. Keep the
   existing safeguards: commits present, no un-integrated `worktree-*` branches, canon violations,
   wave-boundary-compile check (ADR-020 wave-green).
4. **Overall PASS only if EVERY criterion has independent passing evidence.** Any criterion without it → FAIL, naming the gap.
5. Adversarial framing throughout: "your job is to prove it wrong; a false PASS is the costliest error."

### 4. Robust fallback — CRITERIA.md absent
If no CRITERIA.md (trivial phase, or the `/astro-alex` fast lane which has no plan-phase), the verifier
**self-derives goal criteria from the goal itself and says so** — it never silently skips the bar and
never falls back to trusting the plan. (This also makes the new file **additive**: existing phases
without CRITERIA.md still verify, just via self-derived criteria.)

## Wiring points (for the plan to break into tasks)
- `workflows/plan-phase.mjs` — add the plan-blind criteria stage before Research; write CRITERIA.md;
  have Synthesize reference CRITERIA.md as the bar the plan must satisfy.
- `agents/astro-verifier.md` — rewrite to the new contract.
- `workflows/execute-phase.mjs` (~L999) — verifier spawn prompt: point at CRITERIA.md, enforce
  plan-blindness + per-criterion evidence + self-derive fallback.
- `commands/astro-verify.md`, `commands/astro-plan.md`, `commands/astro-autonomous.md` — mention CRITERIA.md.
- Consider `commands/astro-alex.md` verify step (uses the shared verifier → gets self-derive fallback).

## Edge cases / risks
- Criteria too implementation-specific → break on valid designs. Mitigate in the author prompt: goal-level/behavioral/design-independent.
- Criteria not machine-observable → require an `Observe:` method per criterion.
- Non-code phases (docs/config): `Observe:` = inspect the artifact/behavior.
- Backward compat: additive file; absent → self-derive fallback. No break to existing phase dirs.

## Testing strategy (dogfood the mission)
Repo convention is **static contract guards** on workflow/agent prompt strings (`tests/workflows.test.mjs`,
`tests/contracts.test.mjs`). Add guards:
- plan-phase emits a criteria stage that runs BEFORE research and writes CRITERIA.md; its prompt is plan-blind.
- astro-verifier + execute-phase spawn contain: plan-blind ("do not read PLAN.md"), per-criterion independent
  evidence, adversarial "assume FAIL", and the self-derive fallback.
- A behavioral guard where feasible: a criterion with an `Observe:` command whose failing output must yield FAIL.

## Non-goals (explicit)
No time-budget fast path; no single-pass plan / dropping researcher fan-out; do not weaken multi-agent
deliberation — deepen what works.

## Queued (P10 — do NOT start): per-phase EFFORT DIAL
Tunable depth (deep research + multi-verify/remediate cycles for critical phases, lighter for routine)
without changing the core loop. Spend quota on verify→remediate cycles (proven to converge), not wider fan-outs.

## Open flag (not blocking): canon numbering
The wave-green rule is cited as **ADR-020** across the code but was never recorded in DECISIONS.md; the
ledger's ADR-020 now names the M3 framing decision. Reconcile at end of phase (renumber code refs or record
wave-green properly) — do not relitigate the rule itself.
