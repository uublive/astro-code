---
description: Choose which model runs each role and how hard it thinks — planner, researcher, executor, verifier, discover, integrator
allowed-tools: Bash, AskUserQuestion
---

Interactively configure the per-role **model tier** and **reasoning depth** in
`.astrocode/config.json`. They are independent levers and both move cost — a cheap
model at `xhigh` can outspend an expensive one at `low` — which is why a profile sets
the pair together.

**Do not confuse `reasoning` with a phase's `effort`.** `reasoning` is how hard one
agent thinks (`low|medium|high|xhigh|max`). `effort` (ADR-022, `ac phase effort`) is
how many verify→remediate cycles a phase may burn. Different dials, both about spend.

If there is no `.astrocode/` here, tell the user to run `/astro-new-project` first and stop.

## Steps

1. Show the current settings: `ac models` (prints both the tier and reasoning maps).
2. Ask the user how to set them with **AskUserQuestion** — start with a profile pick.
   The tier ladder is **opus → sonnet** for EVERY role. haiku is excluded everywhere,
   integrator included: ADR-035 reverted the ADR-027 carve-out after a haiku integrator
   ran a bare `git stash -u` in the shared working tree and destroyed a completed phase
   plan. Never offer haiku for any role.
   - **Balanced** (recommended): planner `opus`, researcher `sonnet`, executor
     `sonnet`, verifier `opus`, discover `sonnet`, integrator `sonnet`. The default
     daily-driver.
   - **Fast**: planner `sonnet`, researcher `sonnet`, executor `sonnet`, verifier
     `opus`, discover `sonnet`, integrator `sonnet`. Everything sonnet except the
     verify gate (kept opus so speed never costs correctness). Fastest sane setting.
   - **Max quality**: every role `opus`, except integrator which is `sonnet` — opus
     on a cherry-pick is waste. Slowest, best.
   - **Custom**: choose each role yourself.
3. If **Custom**, ask the tier for each role. There are 6 roles and AskUserQuestion
   allows ≤4 questions per call, so use **two calls**: first
   `[planner, researcher, executor, verifier]`, then `[discover, integrator]`. For
   every role, the options are: `opus`, `sonnet`, `inherit` (use the session model) —
   **never** offer haiku, for any role. For `integrator` do not offer `inherit` either,
   because unset floors to `sonnet` there rather than inheriting the session model (the
   one way it still differs from the others).

## Apply

For a named profile (Balanced/Fast/Max), apply the whole preset — tier AND reasoning —
in one command:
- `ac models balanced` | `ac models fast` | `ac models max`

For **Custom**, set each chosen role individually:
- a concrete tier → `ac config set models.<role> <tier>`
- a reasoning depth → `ac config set reasoning.<role> <low|medium|high|xhigh|max>`
- `inherit` → `ac config unset models.<role>` / `ac config unset reasoning.<role>`
  (the workflow then uses the host default)

Reasoning by profile: **max** spends `xhigh` on planner and verifier, **balanced** uses
`high` on those two and `medium` elsewhere, **fast** drops to `low` everywhere EXCEPT
the verify gate, which keeps `high` for the same reason it keeps opus — speed must never
silently cost correctness at the gate. `discover` and `integrator` stay `low` in every
profile: both are mechanical, and more thinking buys nothing.

Not every host honours every level. Codex's ceiling is `xhigh`, Pi's is `max`; asking
for more clamps to the host's ceiling rather than silently falling back to its default.

## Roles, for reference

- **planner** — synthesizes the PLAN.md (quality compounds across the phase)
- **researcher** — parallel investigation during planning
- **executor** — implements one task each during execution
- **verifier** — goal-backward verification (a false PASS is the costliest error)
- **discover** — mechanical task/dependency parsing before execution
- **integrator** — folds each parallel wave's worktree branches back onto the
  branch (mechanical git, run at `sonnet` like every other role — ADR-035; anything it cannot
  pick cleanly is preserved and re-run at the executor tier)

Finish by showing the result: `ac models`.
