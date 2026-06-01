# astro-code

A lean, multi-developer, **Claude Code 4.8-native** evolution of [GSD](https://github.com/glittercowboy/get-shit-done).
It runs a `discuss → plan → execute → verify` loop over milestones and phases, kept
as plain files in your repo — and adds what GSD lacks: real parallelism and safe
multi-developer collaboration.

- 🧩 **Tiny core** — one zero-dependency Node CLI (`ac`) for state; the rest is short
  markdown commands/agents + Workflow scripts. No build step, no monolith.
- ⚡ **Parallel by default** — phases plan and execute by fanning out agents through
  the 4.8 **Workflow** tool: wave-based execution, one isolated worktree per task.
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
ac install           # populates ~/.astro/code and links commands/agents into Claude Code
```

`ac install` keeps the files in `~/.astro/code` and symlinks the commands/agents into
**every** Claude config dir Claude Code reads: the base `~/.claude` **and every
jean-claude profile** (auto-detected from `~/.claude/.jean-claude/profiles.json`). So
the commands show up in all your profiles at once — no per-profile reruns. It's
idempotent; `ac uninstall` reverses it across all of them. To update:
`git pull && npm install -g . && ac install`.

## Use it

Work inside the project repo you're building (give it an `origin` remote so numbering
is coordinated across the team). Drive the loop from Claude Code:

```
/astro-new-project        scaffold .astrocode/, shape PROJECT.md + the roadmap
/astro-adopt              adopt an EXISTING codebase: map it → draft canon → plan next
/astro-phase <name>       add a phase (claims its number)
/astro-plan <phase>       parallel research → executable PLAN.md
/astro-execute <phase>    wave-based parallel execution, then verify
/astro-verify <phase>     AI gate: confirm the phase goal is met (goal-backward)
/astro-accept <phase>     human gate: UAT sign-off, then close the phase
/astro-milestone          start the next milestone cycle
/astro-complete-milestone archive the finished milestone
/astro-config             pick the model (opus/sonnet/haiku) per role
/astro-decision           record an architectural decision into the canon
/astro-status             where am I, and what's next?
```

Or use the CLI directly (`ac help` lists everything):

```bash
ac init --name my-project --vision "what we're building"
ac phase add "Foundation"      # claim + add a phase
ac status                      # project / milestone / phases
ac registry show               # the shared numbering registry
ac milestone complete          # archive the current milestone
```

## How it works

Everything lives in **`.astrocode/`** in your repo (human-readable, git-committed):
`PROJECT.md`, `ROADMAP.md`, per-phase `PLAN.md`/`SUMMARY.md`, plus the canon.

**Two gates close a phase.** It moves `executing → verified → complete`: the
`astro-verifier` agent is the machine gate (goal-backward, tests), and `/astro-accept`
is the human gate (UAT against the acceptance checklist written at plan time). The AI
never auto-closes its own work; `ac phase accept` requires a prior `verified`.

**Numbering & duplicate detection.** `ac phase add` / `ac milestone new` claim the next
free number from `registry.json` on an orphan branch (`astro-registry`) via a git
compare-and-swap: if someone else pushed first your push is rejected and `ac` retries
with the next number. No server, no `gh`. Claims also record the **name**, so adding a
phase (or `ac phase check "<name>"`) warns when another dev is already building
something with the same or similar name — catching duplicate work early. Without a
remote it falls back to local numbering (and warns).

**Models.** `.astrocode/config.json → models` sets a tier per role (`opus`/`sonnet`/
`haiku`); unset a role to inherit the session model. `ac config set models.executor opus`,
or `/astro-config`. The plan/execute workflows apply the tier per agent.

**Canon.** `CONVENTIONS.md` (rules) + `DECISIONS.md` (append-only ADR log) are shared
on the same orphan branch and injected into every plan/execute agent. `ac decision add`
appends to the shared log (ADR ids never collide across devs); `ac canon pull` refreshes
your local mirror.

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
