# astro-code

A lean, multi-developer evolution of [GSD](https://github.com/glittercowboy/get-shit-done),
**host-agnostic** (Claude Code and Codex CLI, from one install). It runs a
`discuss → plan → execute → verify → accept` loop over milestones and phases, kept as
plain files in your repo — and adds what GSD lacks: real parallelism and safe
multi-developer collaboration.

- 🧩 **Tiny core** — one zero-dependency Node CLI (`ac`) for state; the rest is short
  markdown commands/agents + Workflow scripts. No build step, no monolith.
- ⚡ **Parallel by default** — phases plan and execute by fanning out agents through
  the 4.8 **Workflow** tool: wave-based execution, one isolated worktree per task.
  Watch live progress with **`/workflows`**; it degrades gracefully to inline
  subagents when the Workflow tool isn't available.
- 👥 **Collision-proof numbering** — milestone/phase numbers come from a shared
  registry on an orphan branch (pure git). Two devs can never grab the same number.
- 📐 **Shared canon** — conventions + decisions are team-global and injected into
  every agent, so parallel work doesn't drift.

Requires **Node ≥ 22**.

## Install

```bash
git clone git@github.com:uublive/astro-code.git
cd astro-code
npm install -g .     # puts `ac` on your PATH
ac install           # populates ~/.astro/code and publishes to every harness it finds
```

> **Windows / PowerShell:** `ac` is shadowed by PowerShell's built-in `Add-Content`
> alias (aliases beat external commands), so typing `ac install` prompts for
> `Value[0]` instead of running the CLI. Use the equivalent **`astrocode`** command
> (`astrocode install`), or bypass the alias with `ac.cmd install`, or remove it for
> your session: `Remove-Item Alias:ac`. Note `ac install` links files with symlinks,
> which on Windows require Developer Mode or an elevated shell.

`ac install` keeps the files in `~/.astro/code` and publishes them to **every agent
harness present on the machine**, each in that harness's own format, from one command.
It's idempotent; `ac uninstall` reverses it everywhere.

| Harness | Where | How you invoke a command |
|---|---|---|
| **Claude Code** | symlinked into the base `~/.claude` **and every jean-claude profile** (auto-detected from `~/.claude/.jean-claude/profiles.json`) | `/astro-plan 3` |
| **Codex CLI** | skills under `~/.codex/skills/` | `$astro-plan 3` |

### Using it on Codex

Codex has **no custom slash commands** — `/astro-plan` will not resolve. astro-code's
commands are installed as Codex *skills*, so you invoke them as `$astro-plan` or simply
ask for one by name. The six agents install as subagent skills the loop dispatches.

Two things Codex does not get yet: the **status line / phase track** (Codex requires each
hook to carry a `trusted_hash` in `config.toml`, which astro-code will not forge on your
behalf), and hook-driven session state. Everything else — the full loop, the registry,
worktree-isolated parallel execution — works the same, because the engine is
host-agnostic and `ac` drives the orchestration itself.

**Updating** is one command: `/astro-update` (or `ac update`) — it pulls the latest,
refreshes the global CLI, and re-links across every profile. The first time, if it
can't find your clone, run `ac update <path-to-clone>` once and it remembers it.

## Use it

Work inside the project repo you're building (give it an `origin` remote so numbering
is coordinated across the team). Drive the loop from Claude Code:

```
/astro-new-project        scaffold .astrocode/, shape PROJECT.md + the roadmap
/astro-adopt              adopt an EXISTING codebase: map it → draft canon → plan next
/astro-kit-new [kit-id]   start a new Astro kit: scaffold manifest v4 + recipe + build tooling, then the normal loop
/astro-kit-publish        publish a kit to a hosted Astro instance (zip with kit.json inside → its kit registry)
/astro-kit-convert [src]  convert an existing non-kit implementation into a standard Astro kit at verified feature parity
/astro-kit-test           test a kit WITHOUT publishing: offline static checks, or --tier2 against a local Astro
/astro-fix "<bug>"        fix a bug WITHOUT burning a milestone phase (reproduce → diagnose → fix → verify)
/astro-fix-accept <id>    human gate on a fix — confirm the bug is gone, then archive it
/astro-phase <name>       add a phase (claims its number)
/astro-discuss <phase>    talk through decisions/edge cases → CONTEXT.md (before planning)
/astro-plan <phase>       parallel research → executable PLAN.md (reads CONTEXT.md)
/astro-execute <phase>    wave-based parallel execution, then verify
/astro-autonomous <phase> run a whole phase end-to-end (discuss→plan→execute→verify), then stop
/astro-fast "<prompt>"    fast lane for a long, off-the-cuff prompt: capture → distill → execute
/astro-verify <phase>     AI gate: confirm the phase goal is met (goal-backward)
/astro-accept <phase>     human gate: UAT sign-off, then close the phase
/astro-milestone          start the next milestone cycle
/astro-complete-milestone archive the finished milestone
/astro-config             pick the model tier + reasoning depth per role
/astro-decision           record an architectural decision into the canon
/astro-status             where am I, and what's next?
/astro-statusline         set a rich Claude Code statusline (milestone/phase track, context bar)
/astro-update             pull the latest astro-code and re-link it everywhere
/astro-help               short guide: the loop, the commands, and how to go fast
```

Or use the CLI directly (`ac help` lists everything):

```bash
ac init --name my-project --vision "what we're building"
ac phase add "Foundation"      # claim + add a phase
ac status                      # project / milestone / phases
ac registry show               # the shared numbering registry
ac agents-md                   # refresh the astro-code block in AGENTS.md
ac fix add "<what is broken>"  # open a bugfix (dated id, no phase number)
ac fix list                    # what is open
ac fix accept <id>             # human gate — archives it
ac fix accept <id> --agent <n> # machine-signed (ADR-033): records accepted_kind=agent
ac milestone complete          # archive the current milestone
ac phase effort <n> deep       # per-phase verify→remediate budget (light|standard|deep)
ac phase note <n> "<text>"     # durable phase note (survives ROADMAP.md renders)
ac models balanced             # per-role model tier + reasoning depth, in one switch
ac tune                        # apply recommended Claude settings (additive, `--undo`able)
ac stats                       # token usage (fresh vs cheap cache reads) + wall-clock

# GitFlow (opt-in — off by default):
ac config set gitflow.enabled true   # turn it on for this project
ac flow init                   # ensure main + develop exist (creates develop off main)
ac flow                        # create+switch to feature/m<N> off develop
ac flow pr                     # push the feature branch, print the develop PR URL
ac flow release                # push develop, print the develop→main PR URL
ac flow tag [version]          # tag origin/main once that PR merges
ac flow hotfix start <name>    # branch off main; `finish` lands it in main+develop + tags
```

`ac stats` reads Claude Code's session transcripts and reports the honest breakdown —
**fresh** input/output (the real cost) vs **cache reads** (cheap), the cache-hit ratio,
and wall-clock. It's the whole project session by default; scope a single run with
`--since "<ISO timestamp>"` (or `--session <id>`). For a real astro-code-vs-X
comparison, run the same task in a fresh session and compare.

## How it works

Everything lives in **`.astrocode/`** in your repo (human-readable, git-committed):
`PROJECT.md`, `ROADMAP.md`, per-phase `CRITERIA.md`/`PLAN.md`/`SUMMARY.md`, plus the canon.

**Discuss before planning.** `/astro-discuss` asks adaptive, pick-an-answer questions
about scope, approach, and edge cases, then writes the decisions to the phase's
`CONTEXT.md` — which `/astro-plan` reads and obeys. Optional but recommended; trivial
phases can skip it.

**The fast lane (off-the-cuff work).** `/astro-fast "<a long, unplanned prompt>"` is for a
big freehand request that shouldn't need four commands to land. It **captures the raw
prompt verbatim** (the source of truth), **distills a lean spec** you can eyeball — a
checklist of changes each traced back to the prompt, plus an explicit "to clarify" list so
nothing is silently dropped — then goes **straight to execution**: sequential atomic
commits and one verify pass, skipping the research fan-out. A **scope guard** escalates
anything systemic (new architecture, cross-cutting migration, new dependency, or work that
contradicts the canon) back to the full flow. It produces a **verified** phase at best —
human `/astro-accept` still closes it.

**Bugs are not phases.** A phase is planned milestone scope; a bug is something that
turned out to be wrong. Filing one as a phase burns a milestone number on unplanned work
and leaves the roadmap describing something other than the plan. `/astro-fix "<bug>"`
keeps bugfixes **beside** the roadmap — a dated id (`2026-09-17-auth-401`), its own
directory and archive, its own lifecycle (`open → diagnosing → executing → verified →
accepted`) — and carries one end-to-end: reproduce, diagnose, fix, verify.
`/astro-fix-accept <id>` is the human gate; a failing verdict sends the fix back to
`diagnosing` (the bug is still live), never to `rejected`, which means "we've decided not
to fix this". Accepting archives it. `ac fix list` shows what's open.

**Two gates close a phase.** It moves `executing → verified → complete`: the
`astro-verifier` agent is the machine gate — adversarial and **plan-blind**, it checks the
result against a pre-registered, goal-derived `CRITERIA.md` (written *before* the plan, so
the bar can't be shaped by the implementation) by running the evidence per criterion, never
by trusting the plan or the task summaries. `/astro-accept` is the human gate (UAT against
the acceptance checklist written at plan time). The AI never auto-closes its own work;
`ac phase accept` requires a prior `verified`.

**Numbering & duplicate detection.** `ac phase add` / `ac milestone new` claim the next
free number from `registry.json` on an orphan branch (`astro-registry`) via a git
compare-and-swap: if someone else pushed first your push is rejected and `ac` retries
with the next number. No server, no `gh`. Claims also record the **name**, so adding a
phase (or `ac phase check "<name>"`) warns when another dev is already building
something with the same or similar name — catching duplicate work early. The registry
is the single source of truth: with no remote (or before `ac registry init`), a claim
**refuses with an actionable hint** rather than allocating a local number that could
later collide — set up an `origin` and run `ac registry init` first.

**Models, thinking & effort — three dials.** `.astrocode/config.json` sets a **model
tier** (`models.<role>`: opus/sonnet) and a **reasoning depth** (`reasoning.<role>`:
low→max) for each of the six roles. They're independent and both move cost — a cheap
model at `xhigh` can outspend an expensive one at `low` — so `ac models
max|balanced|fast` sets the **pair** in one switch:

- **balanced** (default) — opus + `high` for `planner` and `verifier`, sonnet + `medium`
  elsewhere (the mechanical `discover`/`integrator` stay `low` in every profile).
- **fast** — sonnet and `low` everywhere **except the verify gate**, which keeps opus +
  `high`. Going fast can never silently cost correctness. Phases dominated by execution
  shrink the most.
- **max** — opus everywhere (`xhigh` on planner/verifier), except `integrator`, which
  stays sonnet — opus on a cherry-pick is waste.

The tier ladder is **opus→sonnet for every role; haiku is excluded everywhere**. ADR-035
reverted the old `integrator` carve-out: benchmarking showed haiku's cherry-pick
*judgement* was sound but its *discipline* was not — it ran a bare `git stash -u` in the
shared tree and destroyed a completed phase plan. Speed comes from opus→sonnet, never
from dropping a role to haiku. Hosts clamp depth to their own ceiling (Codex tops out at
`xhigh`) rather than silently falling back.

The third dial is per-**phase**, not per-role: `ac phase effort <n> light|standard|deep`
(ADR-022) budgets how many verify→remediate cycles a phase may burn — 0, 1, or several.
Research stays 3 angles at every level; the budget goes into convergence, not fan-out.

Per-run without persisting: `/astro-plan <n> --fast` / `/astro-execute <n> --fast`.
Fine-tune one role with `ac config set models.executor opus`, or use `/astro-config`.

**Resilience.** astro-code runs *inside* a Claude Code session (it never shells out to the
`claude` binary), so model fallback is a session-launch concern, not a config knob: start
Claude Code with `claude --fallback-model sonnet` and a transient opus outage degrades the
session to sonnet for the rest of the run instead of failing every request mid-phase — worth
it for long autonomous runs.

**GitFlow branching (opt-in).** Off by default — planning stays orthogonal to branching,
so teams that don't want GitFlow pay zero cost. Turn it on with `ac config set
gitflow.enabled true`, then drive it explicitly (lifecycle commands like `ac milestone new`
are never touched): `ac flow init` ensures `main` + `develop` exist; `ac flow` creates and
switches to the active milestone's `feature/m<N>-<slug>` off `develop`; `ac flow pr` and
`ac flow release` push and print the develop and develop→main PR URLs; `ac flow tag` tags
`origin/main` once that merges; `ac flow hotfix start|finish` branches off `main` and lands
the fix in both long-lived branches with a patch tag. **Run `ac flow` before
`/astro-execute`:** execution forks one worktree per task from `HEAD`, so you must be on
the feature branch first. It's pure local git (no `gh`/`glab`, any remote or none) and it
refuses to touch the orphan `astro-registry` branch.

**Canon.** `CONVENTIONS.md` (rules) + `DECISIONS.md` (append-only ADR log) are shared
on the same orphan branch and injected into every plan/execute agent. `ac decision add`
appends to the shared log (ADR ids never collide across devs); `ac canon pull` refreshes
your local mirror.

**Forge knowledge graph (opportunistic, optional).** If a FORGEMASTER knowledge-graph MCP
server happens to be connected, astro-code opportunistically *consumes* it — querying
before `/astro-discuss`, `/astro-plan`, and `/astro-new-project` decide, and staging a
lifted, project-agnostic generator after `/astro-decision` records an ADR. With no server
connected, every one of those steps is a silent no-op — nothing printed, nothing missing.
This does not change the "no MCP server" pillar below: astro-code still never *hosts* one,
it only optionally reads from someone else's. See
[`templates/forge-knowledge.md`](./templates/forge-knowledge.md) for the full spec.

**Existing project?** `/astro-adopt` maps the repo once and drafts `PROJECT.md` +
`CONVENTIONS.md` from the real code, then plans what's next — a one-time bootstrap, not
an always-synced codebase map.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the design and the rationale behind
these choices (lean core, canon-over-map, no MCP server, model tiers).

## Layout

```
bin/ac.mjs   the CLI            commands/   slash commands (the loop)
lib/         engine (tested)    agents/     subagent roles
templates/   .astrocode/ seed   workflows/  Workflow 4.8 scripts
```

## Development

```bash
npm test     # engine units + a real bare-remote registry/canon integration test
```
