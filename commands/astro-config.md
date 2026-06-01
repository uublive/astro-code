---
description: Choose which model (opus/sonnet/haiku) runs each role — planner, researcher, executor, verifier, discover
allowed-tools: Bash, AskUserQuestion
---

Interactively configure the per-role model tiers in `.planning/config.json`.

If there is no `.planning/` here, tell the user to run `/astro-new-project` first and stop.

## Steps

1. Show the current tiers: `ac config get models`.
2. Ask the user how to set them with **AskUserQuestion** — start with a profile pick:
   - **Balanced** (recommended): planner `opus`, researcher `sonnet`, executor
     `sonnet`, verifier `opus`, discover `haiku`.
   - **Max quality**: every role `opus`.
   - **Fast & cheap**: planner `sonnet`, researcher `haiku`, executor `sonnet`,
     verifier `sonnet`, discover `haiku`.
   - **Custom**: choose each role yourself.
3. If **Custom**, ask the tier for each role. There are 5 roles and AskUserQuestion
   allows ≤4 questions per call, so use **two calls**: first
   `[planner, researcher, executor, verifier]`, then `[discover]`. Each role's
   options are: `opus`, `sonnet`, `haiku`, `inherit` (use the session model).

## Apply

For each chosen role:
- a concrete tier → `ac config set models.<role> <tier>`
- `inherit` → `ac config unset models.<role>` (the workflow then uses the session model)

(For Balanced/Max/Fast, apply the whole mapping above with `ac config set models.<role> <tier>`.)

## Roles, for reference

- **planner** — synthesizes the PLAN.md (quality compounds across the phase)
- **researcher** — parallel investigation during planning
- **executor** — implements one task each during execution
- **verifier** — goal-backward verification (a false PASS is the costliest error)
- **discover** — mechanical task/dependency parsing before execution

Finish by showing the result: `ac config get models`.
