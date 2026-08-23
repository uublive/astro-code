# astro-code

A lean, multi-developer, **Claude Code 4.8-native** evolution of [GSD](https://github.com/glittercowboy/get-shit-done).
It runs a `discuss → plan → execute → verify` loop over milestones and phases, kept
as plain files in your repo — and adds what GSD lacks: real parallelism and safe
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
ac install           # populates ~/.astro/code and links commands/agents into Claude Code
```

> **Windows / PowerShell:** `ac` is shadowed by PowerShell's built-in `Add-Content`
> alias (aliases beat external commands), so typing `ac install` prompts for
> `Value[0]` instead of running the CLI. Use the equivalent **`astrocode`** command
> (`astrocode install`), or bypass the alias with `ac.cmd install`, or remove it for
> your session: `Remove-Item Alias:ac`. Note `ac install` links files with symlinks,
> which on Windows require Developer Mode or an elevated shell.

`ac install` keeps the files in `~/.astro/code` and symlinks the commands/agents into
**every** Claude config dir Claude Code reads: the base `~/.claude` **and every
jean-claude profile** (auto-detected from `~/.claude/.jean-claude/profiles.json`). So
the commands show up in all your profiles at once — no per-profile reruns. It's
idempotent; `ac uninstall` reverses it across all of them.

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
/astro-phase <name>       add a phase (claims its number)
/astro-discuss <phase>    talk through decisions/edge cases → CONTEXT.md (before planning)
/astro-plan <phase>       parallel research → executable PLAN.md (reads CONTEXT.md)
/astro-execute <phase>    wave-based parallel execution, then verify
/astro-autonomous <phase> run a whole phase end-to-end (discuss→plan→execute→verify), then stop
/astro-alex "<prompt>"    fast lane for a long, off-the-cuff prompt: capture → distill → execute
/astro-verify <phase>     AI gate: confirm the phase goal is met (goal-backward)
/astro-accept <phase>     human gate: UAT sign-off, then close the phase
/astro-milestone          start the next milestone cycle
/astro-complete-milestone archive the finished milestone
/astro-config             pick the model (opus/sonnet/haiku) per role
/astro-decision           record an architectural decision into the canon
/astro-status             where am I, and what's next?
/astro-help               short guide: the loop, the commands, and how to go fast
```

Or use the CLI directly (`ac help` lists everything):

```bash
ac init --name my-project --vision "what we're building"
ac phase add "Foundation"      # claim + add a phase
ac status                      # project / milestone / phases
ac registry show               # the shared numbering registry
ac milestone complete          # archive the current milestone
ac stats                       # token usage (fresh vs cheap cache reads) + wall-clock

# GitFlow (opt-in — off by default):
ac config set gitflow.enabled true   # turn it on for this project
ac flow init                   # ensure main + develop exist (creates develop off main)
ac flow                        # create+switch to feature/m<N> off develop
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

**The fast lane (off-the-cuff work).** `/astro-alex "<a long, unplanned prompt>"` is for
the way some people work — a big freehand request dumped in one go that shouldn't need
four commands to land. It **captures the raw prompt verbatim** (the source of truth),
**distills a lean spec** you can eyeball — a checklist of changes, each traced back to
the raw prompt, plus an explicit "to clarify / unclassified" list so nothing is silently
dropped — then goes **straight to execution**: sequential atomic commits and a single
verify pass, skipping the research/planning fan-out. It defaults the executor to Opus
(there's no upstream Opus plan feeding it; override with `--model sonnet|haiku`), and a
**scope guard** stops and escalates anything systemic (new architecture/data-model,
cross-cutting migration, new dependency, or work that contradicts the canon) back to the
full `discuss → plan → execute` flow. Like every other path, it produces a **verified**
phase at best — human `/astro-accept` still closes it.

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

**Models & speed.** `.astrocode/config.json → models` sets a tier per role
(`opus`/`sonnet`/`haiku` for `integrator`); unset a role to inherit the session model.
The fastest lever is the **one-command speed switch** — `ac models max|balanced|fast`
applies a whole per-role preset at once (the ladder is opus→sonnet for every judgement
role — haiku is scoped to the mechanical wave `integrator`, ADR-027):
- **balanced** (default) — opus for `planner`+`verifier`, sonnet for the rest, haiku for
  `integrator`.
- **fast** — sonnet everywhere **except** the `verifier` (kept opus) and `integrator`
  (haiku), so going fast can never silently cost correctness: the verify gate still runs
  the full test suite at full quality. Big phases dominated by execution shrink the most.
- **max** — every role on opus, except `integrator` (sonnet — mechanical work doesn't
  need opus either).

Per-run without persisting: `/astro-plan <n> --fast` / `/astro-execute <n> --fast`. Fine-tune
a single role with `ac config set models.executor opus`, or use `/astro-config`. The
plan/execute workflows apply the resolved tier per agent.

**Resilience.** astro-code runs *inside* a Claude Code session (it never shells out to the
`claude` binary), so model fallback is a session-launch concern, not a config knob: start
Claude Code with `claude --fallback-model sonnet` and a transient opus outage degrades the
session to sonnet for the rest of the run instead of failing every request mid-phase — worth
it for long autonomous runs.

**GitFlow branching (opt-in).** Off by default — planning stays orthogonal to branching,
so teams that don't want GitFlow pay zero cost. Turn it on per project with
`ac config set gitflow.enabled true`, then drive it with two explicit commands (lifecycle
commands like `ac milestone new` are never touched). `ac flow init` ensures the long-lived
branches exist, creating `develop` off `main` if missing (idempotent). `ac flow` derives the
active milestone's branch — `feature/m<N>-<slug>` — and creates+switches to it off `develop`;
phases then land as commits on that branch. **Run `ac flow` before `/astro-execute`:**
execution forks one git worktree per task from `HEAD`, so you must be on the feature branch
first — `ac flow` lands you there and prints a reminder. It's pure local git (no `gh`/`glab`,
works against any remote or none), and it refuses to touch the orphan `astro-registry` branch.

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
