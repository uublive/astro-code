<!-- astro-discuss: captured -->
# Context — Phase 5: Integrator self-healing ladder

Decisions settled with the user 2026-06-11. Background: the phase-04 wave-2 incident
(analysis in `todo.md` → "Self-healing parallel-wave integration"). This phase changes
`workflows/execute-phase.mjs` (the parallel strategy's integration path) so a wave
conflict heals automatically instead of stranding `worktree-*` branches on the user.

## Decisions

- **NO rebase rung — the ladder is: drop & re-run, then fail.** A conflicted branch was
  written against a stale tip; rescuing it textually is exactly the trap we hit in
  phase 04 (git auto-merge stacked duplicate helper copies with no conflict marker —
  textual success ≠ correct code). On any cherry-pick conflict the integrator DROPS
  that branch's integration attempt and the SCRIPT re-runs that task sequentially
  on-branch at the integrated tip via the existing `runOnBranch(t)` (ADR-008-consistent:
  on-branch re-runs cannot conflict by construction). The phase name's "rebase" is
  historical — there is deliberately no rebase rung. Rejected: rebase-with-test-gate
  (complexity, tests-green ≠ no stale/duplicated code); raw rebase (the proven failure).
- **Branch→task mapping: the integrator maps it.** The integrator prompt receives the
  wave's task list (id + title + declared file); `INTEGRATE_SCHEMA.conflicts` becomes
  objects `{ branch, taskId }` (taskId nullable). It maps by commit message + changed
  files. If it cannot map confidently → `taskId: null`, and the script re-runs every
  wave task the integrator did not explicitly confirm as integrated. Rejected:
  always re-running the whole wave remainder (wasteful in wide waves); depending on
  task-id commit stamps (that's phase 7 — do not couple).
- **Test gate only after a HEALED wave.** Clean folds stay fast. Any wave where the
  ladder fired ends with a full test-suite run (an agent runs it — the script cannot)
  before the next wave proceeds; a failing suite is treated like an integration failure
  for that wave (fail loudly, stop). Rejected: gating every wave (suite × waves cost);
  verifier-only (a wave-2 silent bad merge would poison all later waves).
- **Re-run failure → fail the phase immediately.** One sequential re-run attempt per
  conflicted task; if the executor errors or returns nothing, set `integrationFailed`
  as today but the report must name the exact task id, branch, and why. No retry loops.
  **The dropped branch + worktree are preserved until the re-run's commit lands** —
  only then torn down — so no work is ever lost silently. Rejected: auto-retry
  (doubles worst-case on genuinely-broken tasks); skip-and-continue (cascading
  failures in dependent waves).

## Scope

In scope:
- `workflows/execute-phase.mjs` only (plus its installed mirror via `ac install`, and
  test updates): integrator prompt + `INTEGRATE_SCHEMA` change, the script-side heal
  loop (drop → `runOnBranch(t)` → confirm landed → tear down preserved branch),
  the healed-wave test gate, result-shape additions (e.g. `healed: [taskIds]`,
  richer `integrationFailed`), and narration via `log()` so the user sees healing
  happen live.
- Keep ADR-005/ADR-008 invariants: integrator stays the sole git actor among agents;
  re-runs are sequential on-branch; never parallel-without-isolation.
- Tests: extend `tests/workflows.test.mjs` contract-style guards (schema shape, prompt
  carries the wave task list, no hook-name shadowing). Pure helpers added to the script
  should follow the existing mirror pattern (`buildWaves` mirrors `lib/waves.mjs`) if
  they need real unit tests.

Out of scope (later phases of this milestone):
- Stale fork-base detection and file-ownership/overflow detection → phase 6. (Known
  gap accepted for now: a CLEAN-but-wrong fold from a stale-base branch does not
  trigger the ladder or the test gate in this phase — phase 6's fork-base guard is
  what closes it.)
- Task-id commit stamps and Discover done-detection (idempotent re-runs) → phase 7.
- Planner-side test-first split safeguards → phase 8.
- The Agent-tool fallback path in `commands/astro-execute.md` (already sequential — no
  integration step to heal).

## Open questions (planner decides)

1. **Re-run executor prompt content:** at minimum tell it this is a heal re-run after
   an integration conflict (so it inspects the current code state before acting);
   whether to also point it at the preserved branch's diff for reference is the
   planner's call — bias toward fresh implementation, the dropped attempt is stale by
   definition.
2. **Wave with multiple conflicts:** re-run each mapped task sequentially in plan order;
   the healed-wave test gate runs once after all of that wave's re-runs.
3. The user may want to rename the phase later (drop "rebase" from the name) — cosmetic,
   not blocking.

## Canon reminders

Workflow scripts: no semicolons, `phase()`/`agent()`/`parallel()`/`log()` hooks only,
args stay small JSON scalars, scripts cannot run git or fs. Schema changes must keep
`additionalProperties: false`. High-density "why" comments naming the bug each choice
prevents (this file is itself the "phase-04 wave-2" story — reference it).
