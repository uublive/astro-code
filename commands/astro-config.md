---
description: Choose which model (opus/sonnet) runs each role — planner, researcher, executor, verifier, discover, integrator
allowed-tools: Bash, AskUserQuestion
---

Interactively configure the per-role model tiers in `.astrocode/config.json`.

If there is no `.astrocode/` here, tell the user to run `/astro-new-project` first and stop.

## Steps

1. Show the current tiers: `ac models` (prints the effective per-role map).
2. Ask the user how to set them with **AskUserQuestion** — start with a profile pick.
   The tier ladder is **opus → sonnet** for the five judgement roles (no haiku — its
   quality is too low for planning/research/execution/verification/discovery; sonnet
   is the floor there). `integrator` is the single documented exception (ADR-027):
   it is mechanical git-folding, not judgment, so it defaults to `haiku`.
   - **Balanced** (recommended): planner `opus`, researcher `sonnet`, executor
     `sonnet`, verifier `opus`, discover `sonnet`, integrator `haiku`. The default
     daily-driver.
   - **Fast**: planner `sonnet`, researcher `sonnet`, executor `sonnet`, verifier
     `opus`, discover `sonnet`, integrator `haiku`. Everything sonnet except the
     verify gate (kept opus so speed never costs correctness). Fastest sane setting.
   - **Max quality**: every role `opus`, except integrator which is `sonnet` — opus
     on a cherry-pick is waste, and sonnet already escapes haiku. Slowest, best.
   - **Custom**: choose each role yourself.
3. If **Custom**, ask the tier for each role. There are 6 roles and AskUserQuestion
   allows ≤4 questions per call, so use **two calls**: first
   `[planner, researcher, executor, verifier]`, then `[discover, integrator]`. For
   the five judgement roles, each role's options are: `opus`, `sonnet`, `inherit`
   (use the session model) — do **not** offer haiku. For `integrator`, offer `opus`,
   `sonnet`, `haiku` (default — same as leaving it unset) — do **not** offer
   `inherit`, because unset means haiku here, not session-inherit (the opposite of
   every other role).

## Apply

For a named profile (Balanced/Fast/Max), apply the whole preset in one command:
- `ac models balanced` | `ac models fast` | `ac models max`

For **Custom**, set each chosen role individually:
- a concrete tier → `ac config set models.<role> <tier>`
- `inherit` → `ac config unset models.<role>` (the workflow then uses the session model)

## Roles, for reference

- **planner** — synthesizes the PLAN.md (quality compounds across the phase)
- **researcher** — parallel investigation during planning
- **executor** — implements one task each during execution
- **verifier** — goal-backward verification (a false PASS is the costliest error)
- **discover** — mechanical task/dependency parsing before execution
- **integrator** — folds each parallel wave's worktree branches back onto the
  branch (mechanical git; the one haiku-tier role, ADR-027; anything it cannot
  pick cleanly is preserved and re-run at the executor tier)

Finish by showing the result: `ac models`.
