---
description: Configure astro-code — which model runs each role and how hard it thinks, which extra MCP tools (e.g. lean-ctx) the agents may use, or what each statusline gauge shows
argument-hint: [models|tools|statusline]
allowed-tools: Bash, AskUserQuestion
---

Three things can be configured here:

- **models** — which model runs each role, and how hard it thinks (below, "Models").
- **tools** — which extra MCP tools astro-code's agents may use ("Agent tools").
- **statusline** — what each statusline gauge shows: bar, percent or both (last section,
  "Statusline gauges").

If `$ARGUMENTS` is `models`, `tools` or `statusline`, go straight to that section. Otherwise
ask with **AskUserQuestion** — header `Configure`, options **Models** (tier + reasoning per
role), **Agent tools** (extra MCP tools for the agents) and **Statusline** (bar / % per
gauge) — and follow the one picked.

# Models

Interactively configure the per-role **model tier** and **reasoning depth** in
`.astrocode/config.json`. They are independent levers and both move cost — a cheap
model at `xhigh` can outspend an expensive one at `low` — which is why a profile sets
the pair together.

**Do not confuse `reasoning` with a phase's `effort`.** `reasoning` is how hard one
agent thinks (`low|medium|high|xhigh|max`). `effort` (ADR-022, `ac phase effort`) is
how many verify→remediate cycles a phase may burn. Different dials, both about spend.

If there is no `.astrocode/` here, tell the user to run `/astro-new-project` first and stop.

## On Cursor

Check this first. This command opened with the **Running on Cursor** note (the Cursor
adapter prepends it to every command body) — i.e. you are Cursor's IDE agent or
`cursor-agent`. The tiers below do not apply: `opus`, `sonnet` and the Balanced/Fast/Max
profiles are Claude-only, and astro-code does not yet keep per-role Cursor models. On
Cursor every role runs on the session's model — agents are installed `model: inherit`,
so the model is chosen with Cursor's own model picker or `cursor-agent --model`.

- **Never offer** `opus`, `sonnet`, haiku or the Balanced/Fast/Max profiles, and never
  suggest a Claude model, for any role.
- **Never run `ac config set models.<role>`** from Cursor, with any model id, and never
  `ac models <profile>`. `.astrocode/config.json` is shared and committed, so a Cursor
  model written there would be handed to every Claude teammate's subagents, whose host
  does not have it.
- **What you can do:** show `ac models`, and say in one line that model tiers apply only
  to Claude Code sessions, while here every role uses the session's model (`inherit`),
  chosen with Cursor's model picker or `cursor-agent --model`.
- **Reasoning.** On Cursor, reasoning depth lives in the model id suffix rather than a
  separate dial, so `reasoning.<role>` is not applied there in v1 — say so in one line.
- If the user wants different Cursor models per role, say in one line that this isn't
  supported yet, and offer to file it: `ac backlog add "Per-role Cursor models"`.

Then stop: skip the Steps and Apply below.

## On Codex

Check this first (and this command did not open with the Running on Cursor note). If
you are running in **Codex CLI** (you are an OpenAI/Codex model, and this command
reached you as the `astro-config` skill), the tiers below do not apply.
`opus` and `sonnet` are Claude models. Codex has neither, and astro-code does not yet keep
per-role Codex models. On Codex every role runs on this session's model.

- **Never offer** `opus`, `sonnet` or the Balanced/Fast/Max profiles, and never suggest a
  Claude model, for any role.
- **Never run `ac config set models.<role>`** from Codex, with any model id, and never
  `ac models <profile>`. `.astrocode/config.json` is shared and committed, so a Codex
  model written there would be handed to every Claude teammate's subagents, whose host
  does not have it.
- **What you can do:** show `ac models`, and say in one line that model tiers apply only
  to Claude Code sessions, while here every role uses the session's model (pick it with
  Codex's own model setting). Reasoning depth is host-neutral, so offer that alone:
  `ac config set reasoning.<role> <low|medium|high|xhigh>`. Codex's ceiling is `xhigh`.
- If the user wants different Codex models per role, say in one line that this isn't
  supported yet, and offer to file it: `ac backlog add "Per-role Codex models"`.

Then stop: skip the Steps and Apply below.

## On OpenCode

Check this next. This command opened with the **Running on OpenCode** note (the OpenCode
adapter prepends it to every command body). Tiers still apply here, but OpenCode names
models `<provider>/<model>`, so each role's model is picked in two layers, both shown by
`ac opencode models`:

- **Tier per role** — exactly the Steps and Apply below (`ac models <profile>`,
  `ac config set models.<role> <tier>`). Tier names are host-neutral, so the shared project
  config stays safe for Claude teammates.
- **What each tier means on this machine** — `ac opencode map <opus|sonnet|haiku>
  <provider/model>`, user-level. Pick the ids from `opencode models` (run it through the
  shell and offer the matching ids as options; never invent one).
- **Any model for one role** — `ac opencode set <role> <provider/model>` pins a role
  whatever its tier (e.g. a non-Claude executor); `ac opencode unset <role>` removes the pin.
  User-level only.

**Never write a provider id into `.astrocode/config.json`** (`ac config set models.<role>
openrouter/…`): it is committed, and a Claude teammate's workflows would hand it to Claude.

Steps on OpenCode: show `ac opencode models`; ask with the `question` tool which layer to
change (tier per role / tier → model map / pin one role); for the map or a pin, list the
candidates from `opencode models`; apply with the commands above; finish by showing
`ac opencode models` again. Commands pass these ids as each subagent's `model` at dispatch,
so a change applies to the next run — no reinstall.

## Steps

1. Show the current settings: `ac models` (prints both the tier and reasoning maps, and
   `sources`: whether each role's value comes from this `project`, the `user` default in
   `~/.astro/config.json`, or — a role in neither — the built-in default).
2. Ask the user how to set them with **AskUserQuestion** — start with a profile pick.
   The profiles use **opus → sonnet** for every judgement role (planner, researcher,
   executor, verifier, discover). The one profile exception is the `integrator`: Balanced
   and Fast run it on haiku 5.5 (low reasoning), allowed (#125) because the integrator
   prompt pins its git behaviour (ADR-035). Beyond that, haiku is the user's choice per
   role (ADR-073), offered only under **Custom**.
   - **Balanced** (recommended): planner `opus`, researcher `sonnet`, executor
     `sonnet`, verifier `opus`, discover `sonnet`, integrator `haiku`. The default
     daily-driver.
   - **Fast**: planner `sonnet`, researcher `sonnet`, executor `sonnet`, verifier
     `opus`, discover `sonnet`, integrator `haiku`. Everything sonnet except the
     verify gate (kept opus so speed never costs correctness) and the haiku integrator.
     Fastest sane setting.
   - **Max quality**: every role `opus`, except integrator which is `sonnet` — opus
     on a cherry-pick is waste. Slowest, best.
   - **Custom**: choose each role yourself.
3. If **Custom**, ask the tier for each role. There are 6 roles and AskUserQuestion
   allows ≤4 questions per call, so use **two calls**: first
   `[planner, researcher, executor, verifier]`, then `[discover, integrator]`. For
   every role, the options are: `opus`, `sonnet`, `haiku` (cheapest; best kept to the
   mechanical roles, e.g. the integrator), `inherit` (use the session model). For
   `integrator` do not offer `inherit`,
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

**For this project, or for every project?** Settings above land in this project's
`.astrocode/config.json`. A user who runs several projects under one policy can set the
profile once as their own default instead: `ac models <profile> --user` writes
`models` + `reasoning` to `~/.astro/config.json`. Per role, the project's value wins, then
the user default, then the built-in one. A new project leaves the roles the user has a
default for unset, so they follow it; an existing project has every role set, so after
`--user` it keeps its own values until they are removed (`ac config unset models.<role>`
/ `ac config unset reasoning.<role>`) — offer that, never do it unasked, since
`.astrocode/config.json` is committed and may be a team's. Ask only when the user mentions other projects
or a personal policy; otherwise apply to the project.

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
  branch (mechanical git, run at `haiku` under Balanced and Fast, `sonnet` under Max and when unset — #125; anything it cannot
  pick cleanly is preserved and re-run at the executor tier)

Finish by showing the result: `ac models`.

# Agent tools

Each astro agent has a fixed tool list that Claude Code enforces, so it cannot call an MCP
tool the session has (e.g. lean-ctx's cheap `ctx_read`) unless the user adds it. The
setting is **per user** — `~/.astro/config.json`, shared by every project on this machine —
and `ac agent-tools` is the only thing that writes it. **The user never types a tool name:
you list what this session actually has.**

1. **Show what is set:** `ac agent-tools --json` — `config` (what the user added),
   `agents` (what each agent gets now) and `agentNames` (the valid agent names).
2. **Find the MCP tools this session has.** Collect every tool name you can see that starts
   with `mcp__` — the ones loaded in your tool list AND the deferred ones listed by name only.
   Group them by server: the part between `mcp__` and the next `__`. Tools astro-code's
   agents already reach natively (plain file read/search) need nothing. If there are no MCP
   tools at all, say so in one line and stop.
3. **Ask which servers** with AskUserQuestion (`multiSelect: true`): one option per server,
   each described in a few words from its tool names (e.g. "lean-ctx — cheap file reads and
   search"). Recommend the ones that help an agent read or search code. At most 4 options;
   if there are more, offer the 4 most useful and let "Other" name the rest.
4. **Ask which of their tools**, per chosen server, with a recommendation of **read-only
   (Recommended)** — tools whose names read, get, list, search, query, find, view, tree,
   glob or grep — versus **all tools** versus **let me pick**. Read-only is the safe default:
   the verifier and researchers must never be able to change the tree through a side door,
   and a write tool is a deliberate choice for `astro-executor` only.
5. **Ask which agents** get them: **all agents (Recommended)** (`*`), **the read-side only**
   (`astro-researcher`, `astro-planner`, `astro-verifier`, `astro-criteria-author`,
   `astro-mapper`), or **let me pick** (from `agentNames`).
6. **Apply** — never edit the JSON yourself:
   - `ac agent-tools add <agent|*> <mcp__server__tool> …` — once per target agent (or `*`)
   - to take tools away: `ac agent-tools remove <agent|*> <tool> …`, or `ac agent-tools clear`
   `ac` validates every name, keeps the other keys in that file, and applies the change to the
   installed agents immediately. Relay its warnings; if it refuses, show why and stop.
7. **Finish** with `ac agent-tools` (the per-agent result) and one line: a Claude Code session
   already running keeps its old agent definitions — restart it to pick them up.

# Statusline gauges

The statusline draws four gauges: **ctx** (context fill), **5h** and **7d** (the rolling
quota windows) and **cap** (the gateway spend cap, when present). Each can show its **bar**,
its **percent**, or **both** (the default). The setting is **per user** —
`~/.astro/config.json` under `statusline`, shared by every project on this machine — and
`ac statusline gauges` is the only thing that writes it.

1. **Show what is set:** `ac statusline gauges`.
2. **Ask** with AskUserQuestion, one question per gauge (four questions, one call) — header
   the gauge name, options **Both**, **Percent**, **Bar**, with the current value marked.
   Say once that width still wins: on a line too narrow for bars every gauge shows its
   percent, so a gauge set to **Bar** never disappears.
3. **Apply** each changed gauge — never edit the JSON yourself:
   `ac statusline gauges <ctx|5h|7d|cap|all> <both|bar|percent>`. If every gauge gets the
   same mode, one `all` call does it. If `ac` refuses (e.g. the file is not valid JSON), show
   why and stop.
4. **Finish** with `ac statusline preview`, and one line: it takes effect on the next
   statusline repaint.

**Asking the user:** whenever this command asks the user anything, follow `$(ac path templates)/asking.md` — frame the round in plain words first, start each question from its visible effect, and keep an "Explain more" option.
