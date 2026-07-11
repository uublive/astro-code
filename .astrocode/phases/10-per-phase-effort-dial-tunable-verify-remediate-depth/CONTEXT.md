<!-- astro-discuss: captured -->
# Context — Phase 10: Per-phase effort dial (tunable verify/remediate depth)

## Goal (Matteo's directive, queued behind P9)
A per-phase **effort dial**: deep treatment for critical phases, light for routine —
*without changing the discuss→plan→execute→verify loop*. Quota **tokens are the scarce
resource, not time**; the depth budget goes into **verify→remediate cycles (which
provably converge), NOT wider planning fan-outs**. Enabled by P9: an automated
remediate loop is only safe because the verifier's FAIL/PASS signal is now trustworthy
(ADR-021).

## Decisions (this discussion)
1. **Automated verify→remediate loop.** On a mid-phase verify FAIL, execute-phase
   auto-remediates and re-verifies (up to N cycles) instead of stopping for a human.
   It reaches `verified` at best and still stops for human `/astro-accept` — **REQ-006
   two-gate closure stays intact**; the AI never closes its own work.
2. **Depth spends on verify/remediate + model tier ONLY.** Research stays at the
   standard **3 angles at every level** — the dial never widens the planning fan-out
   (resolves the "deep research" vs "not wider fan-outs" tension in favour of the P1 ruling).
3. **Expressed as discrete levels `light | standard | deep`**, set per phase
   (`ac phase effort <n> <level>`), with a one-off `/astro-execute <n> --effort <level>`
   override. Mirrors `ac models [preset]` ergonomics. **`standard` is the default.**
4. **Stop condition = max cycles per level + stop-on-no-progress.** Bail early to a
   human-facing FAIL if a cycle makes no progress — **no new commit (HEAD didn't move)**
   OR **the set of failing criteria didn't shrink**. Prevents burning budget grinding a
   stuck approach; surfaces genuinely-stuck phases instead of looping.
5. **A remediation pass = the existing `astro-executor`, scoped to ONLY the unmet
   criteria and fed the verifier's evidence** (the exact failing command + its output).
   Atomic commit, then re-verify. Fresh context each cycle so it attacks the real gap,
   not a stale plan. **No new agent type.**
6. **Level → knob mapping** (research = 3 angles at all levels):
   - `light`  = **0** remediate cycles (single pass = today's behavior), configured tier.
   - `standard` = up to **1** cycle, configured tier. *(default)*
   - `deep`   = up to **3** cycles, **and opus tier** for execute + verify that phase.

## Decisions (round 3 — items previously defaulted, now explicit)
7. **Scope across execution modes:** the dial applies in the execute-phase **Workflow path
   and its Agent-tier fallback**. **`/astro-alex` (fast lane) stays `light` / single-pass**
   (verify once, FAIL stops) — its whole point is speed for off-the-cuff work; a user can
   opt a specific run into deeper effort explicitly.
8. **Per-phase only — no project-wide effort knob.** `effort` is an **additive field on the
   roadmap phase entry** (`effort: "standard"`), **hardcoded `standard` default** when
   absent (backward-compatible), mutated only through a lock-guarded `lib/` helper (REQ-002).
   There is **no `ac config` / global effort preset** — deep is a deliberate per-phase choice.

## Logged defaults (implementation detail — for the planner)
- **Re-verify uses the same P9 verifier** (adversarial, per-criterion, plan-blind against
  CRITERIA.md) — the loop's convergence signal is exactly the trustworthy gate.

## Scope
**In:** the per-phase level, its storage + CLI (`ac phase effort`) + `--effort` override,
the auto-remediate loop in execute-phase (bounded, stop-on-no-progress), the
executor-scoped remediation brief, the level→knob mapping, and contract-guard tests.
**Out:** raw token-budget dials; a new remediator agent; widening research; changing the
two-gate model; any per-role global model change (reuse the existing preset machinery).

## Edge cases / assumptions
- `light` on a phase that fails verify → single FAIL, stop (today's behavior) — no loop.
- "No new commit" is detected via HEAD SHA before/after a remediation pass; "criteria set
  didn't shrink" via comparing the verifier's failing-criterion ids across cycles.
- `deep`'s opus override composes with (overrides) the global models preset for that phase
  only; it must not mutate persisted config.
- A remediation pass that itself hits an integration failure defers to the existing
  self-healing ladder (ADR-014) — the effort loop wraps verify, not integration.
- Loop must be idempotent-friendly with ADR-017 commit stamps so a re-run of `/astro-execute`
  doesn't double-remediate already-landed work.

## Non-goals (explicit)
No time-budget fast path; no wider research fan-out; do not weaken multi-agent deliberation
or the two-gate closure.
