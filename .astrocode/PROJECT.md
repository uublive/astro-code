# astro-code

## Vision

A lean, multi-developer planning & execution framework for coding agents, host-agnostic
across Claude Code and Codex CLI. It runs a `discuss → plan → execute → verify → accept`
loop over milestones and phases, keeps **all state as plain files in the repo**, and adds
real multi-agent parallelism plus collision-proof cross-developer coordination. The `ac`
CLI owns deterministic state; the "thinking" lives in markdown commands/agents and
Workflow scripts the host runs in isolated contexts — so the main session stays lean and
`/clear`-safe. Consistency comes from a prescriptive **canon** (conventions + decisions)
injected into every agent, not from a maintained codebase map.

## Milestone 2 — Self-healing parallel-wave integration

Make parallel-wave execution recover from its own failure modes instead of stranding
conflicted `worktree-*` branches on the user (the phase-04 incident; full analysis in
`todo.md` → "Self-healing parallel-wave integration"). Strengthens REQ-005. Goals:
the integrator heals conflicts via a fallback ladder (rebase → drop-and-rerun
sequentially at the integrated tip → only then fail), stale fork bases and
out-of-declared-file commits are detected rather than trusted, `/astro-execute`
re-runs are idempotent (done-detection from task-id commit stamps), and the planner
stops emitting test-first task splits that force executors to overflow their files.

## Milestone 4 — Kit command standardization & conversion

Two goals. (1) **Standardize the kit command surface** onto one consistent naming
convention so all kit commands read as a coherent group — today the set mixes forms
(`new-kit`, `publish-kit`, and a future converter) — keeping deprecated aliases so
existing invocations and muscle memory keep working, and updating every cross-reference
(README, `/astro-help`, KIT-CONTRACT, installer). (2) **Add a kit-conversion command**
that takes an existing *non-kit* implementation — a standalone script/repo or an
existing tool/service — and reproduces its capability as a standard Astro kit: full kit
anatomy (manifest v4, recipe, `src/` + vendored `tools/`, EXAMPLES, report generator),
built and publishable, at **feature parity** with the original — parity verified against
the source's real behavior, not assumed.

## Milestone 5 — Lean execution path

Scale execution overhead to the size of the work so a small phase runs about as lean as
plain Claude Code, while wide phases keep their parallel worktrees. The tax today is
**N cold subagents**: even in the sequential strategy, `execute-phase.mjs` spawns one
fresh `astro-executor` per task, each re-reading canon + CONTEXT + PLAN + repo. Two
changes (Change 3 — a proportional/downgraded verify tier — was explicitly rejected to
keep the anti-false-PASS gate intact):

1. **Warm batched sequential executor** (phase 13): when the strategy is sequential and
   there are ≥2 executable tasks, hand the whole dependency-ordered task list to ONE
   `astro-executor` that reads the canon once and makes one atomic, stamped commit per
   task — N cold starts → 1. Behind a `lean_execution` config default (escape hatch to
   per-task). Preserves ADR-017 stamps/resumability, ADR-021 plan-blind verify,
   ADR-008/005 (no script-run git, no parallel same-tree), and a partial-failure
   fallback to per-task so no task is silently dropped.
2. **Cheap mechanical integrator + clean fast-path** (phase 14): the per-wave integrator
   agent (parallel path only) drops to a cheap model tier (`models.integrator`, default
   haiku) with a clean-cherry-pick fast-path; conflicts still route to the existing heal
   ladder at the executor tier. Small phases never reach it (Change 1 keeps them
   sequential).

Developed on the `feature/lean-execution` branch so the whole line can be dropped if it
doesn't pan out.

## Milestone 9 — Second Nature

astro-code learns how *you* build, and asks before it believes anything. A system you
understand and control is worth more than a smarter one you don't: so the tool should
align itself to the way its user works, rather than the user bending to the tool.

Today a project has **canon** (CONVENTIONS.md + DECISIONS.md, shared by the team). What
it lacks is the **personal** layer: the principles, patterns, preferences and
antipatterns one developer carries across every project. FORGEMASTER keeps that in a
knowledge graph mined from session transcripts; this milestone brings it into astro-code
so it works standalone (and open source), after which forge's version is retired.

- **A personal store, outside the repo** (`~/.astro/`), so one developer's preferences
  never land in a teammate's clone. Each entry: kind, statement, *why*, scopes (stack,
  file patterns, kind of work), evidence (the conversation it came from), strength (hard
  rule or preference), and a lifecycle — proposed → accepted / rejected *with a reason* /
  retired / superseded. A principle that should bind the whole team is *promoted* into
  that project's canon on purpose. Project canon wins over personal preference, and a
  conflict is flagged, never silently resolved.
- **The machine proposes, the human decides.** Proposals come first from the moments
  that already carry intent — `/astro-discuss`, `/astro-decision`, `/astro-accept`,
  milestone close — then from an opt-in, on-demand transcript sweep. Nothing is accepted
  without the user; a rejection is remembered so it is not proposed again.
- **Retrieval without a black box.** Agents get a structural shortlist (scopes vs the
  task's stack, files and stage) as a compact index — one line per principle, full text
  on demand, the few hard rules always in full — and do the semantic matching themselves.
  `ac principles ask` ranks by keyword and says why each result matched. Usage is logged,
  so unused or ignored principles surface for review. No embeddings until real usage
  shows the index has outgrown a prompt.

Phases 22–27: the store and CLI → capture at the moments of intent → the review workflow
→ retrieval into prompts → the transcript miner → forge import and handover.

## Milestone 10 — astro-code on Pi

> **Parked 2026-09-25**, before phase 28 was discussed. A local model already runs under
> Claude Code, so a Pi host is not needed now. Phases 28–32 stay on the roadmap, undiscussed;
> resume with `/astro-discuss 28`. The prior Pi research is pointed at from phases 29–30's notes.

astro-code runs in [Pi](https://pi.dev) as a first-class host, including against a
local model, and **stays** running there: a feature written for one host must not
silently fail on another.

- **One source, rendered per host.** Commands, agents and workflows are authored once;
  the Pi adapter renders them (prompt templates, agents, tool-name map) exactly as the
  Claude and Codex adapters do. Verified against a real Pi install, never against docs
  alone — the Codex adapter proved the docs wrong once already.
- **Same surface, not a second dialect.** A Pi extension provides what the command text
  and workflow scripts already assume — the Workflow surface (`agent`, `parallel`,
  `phase`, `log`) on Pi's SDK, structured output, an ask-the-user tool — so a command
  does not need a Pi branch to work in Pi.
- **A parity guard that fails the build.** Each host declares what it can provide; a test
  fails when a command, agent or workflow depends on something a wired host cannot. A
  gap is either closed or declared as a visible, shrinking exception — never discovered
  in the field. This is what keeps versions from drifting.
- **Local models are a real configuration.** Roles map to a provider/model per host, so
  the planner and verifier can stay on a frontier model while executors run locally; the
  local model's limits (output cap, no reasoning control) are reported, not papered over.

The research this builds on (Pi SDK spike, headless contract, three-host design) was done
in September 2026 and is consolidated into the first phase's research note.

## Requirements

<!-- One line per requirement. Use stable IDs (REQ-001) so phases can map to them. -->

- REQ-001 Dependency-free substrate: ESM `.mjs`, Node ≥ 22, `node:` builtins only — no
  build step, no runtime/dev deps.
- REQ-002 Plain-file state under `.astrocode/`, mutated only through lock-guarded `lib/`
  helpers; `ROADMAP.md` is generated, never source of truth.
- REQ-003 Collision-proof cross-developer coordination via an orphan-branch git
  compare-and-swap (`lib/shared.mjs` `transact`) — project-global numbering, shared
  decisions, no server, no `gh`.
- REQ-004 Multi-surface invocation: `ac` CLI, slash commands, Workflow-tool scripts,
  and subagents — each command degrades gracefully (Workflow → Agent → inline).
- REQ-005 Safe parallel execution: dependency waves + file-disjointness guard, worktree
  isolation, a sole git-actor integrator, and goal-backward verification.
- REQ-006 Two-gate phase closure: AI verifier reaches `verified` at best; only human
  `/astro-accept` reaches `complete`.
- REQ-007 Per-role model tiers (opus/sonnet/haiku) configurable per role.
- REQ-008 Reversible install: copy to `~/.astro/code`, symlink into every Claude profile,
  additively wire `settings.json` (skip unparseable rather than clobber).

## Constraints

- No runtime or dev dependencies; no build/transpile step. ESM only, Node ≥ 22.
- Git CLI only (never `gh`) so the registry works on any remote.
- The orphan-branch CAS is inviolable: non-force push, retry-on-reject, preserve sibling
  files, phase numbers project-global (never restart per milestone).
- The framework dogfoods itself — this repo is also an astro-code project.

## Out of scope

- A maintained always-on codebase map (a stale map is worse than none; the mapper runs
  on-demand for adopt only).
- Server-side coordination, hosted state, or any non-git transport for shared state.
