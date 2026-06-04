# astro-code — Architecture

astro-code is a lean, multi-developer evolution of GSD, built for Claude Code 4.8.
It keeps GSD's good parts — file-based planning state, milestones/phases/roadmap,
the discuss → plan → execute → verify loop — and drops ~80% of the surface area.

## Design principles

1. **Lean substrate.** A tiny zero-dependency Node CLI (`ac`) owns *state*; the
   *thinking* lives in markdown commands/agents and Workflow scripts that Claude
   Code runs. No 68 KB monolith, no 94 workflows, no build step for the core.
2. **4.8-native orchestration.** Heavy work fans out through the **Workflow** tool
   (deterministic multi-agent JS), not hand-written orchestration prose. Phases
   execute wave-by-wave in parallel, isolated git worktrees per task.
3. **The inviolable numbering principle.** Every milestone/phase number is
   allocated from a shared registry on an **orphan branch on origin** — so two
   developers can never collide. Implemented natively in pure git (no server,
   no `gh`, no external dependency). See below.
4. **File-based state.** Everything lives in `.astrocode/`, human-readable and
   git-committable. State mutations are atomic and lock-guarded.
5. **The main thread is an orchestrator.** Token-heavy or dirty work (reading/
   searching/reasoning over many files, multi-task execution, goal-backward
   verification) runs in an *isolated context* and returns only its conclusion — so
   the session stays lean (principle #2). Work sorts into three buckets:
   - **Heavy *and* parallelizable → Workflow** (deterministic fan-out). Fall back to
     Agent subagents, then inline, if the tool is unavailable (`astro-plan`,
     `astro-execute`).
   - **Heavy but serial / single-shot → one Agent subagent** (`astro-verify` →
     `astro-verifier`; `astro-adopt` → `astro-mapper`).
   - **Interactive *or* trivial → inline in the main thread.** Anything that talks to
     the human (`astro-discuss`, `astro-new-project`, `astro-accept`) *must* stay
     inline — a subagent can't run `AskUserQuestion` against the user, and the
     conversation is the deliverable. So must one-shot CLI calls (`astro-status`,
     `astro-phase`, `astro-decision`) — wrapping a single `ac` call in a subagent just
     burns a turn. The rule is context isolation, **not** "always delegate."

## Repository layout

```
bin/ac.mjs          the CLI (init, status, state, roadmap, milestone, phase, claim, registry)
lib/                engine modules (pure, unit-tested)
  registry.mjs      ← the orphan-branch numbering registry (pure git CAS)
  roadmap.mjs       roadmap.json model + ROADMAP.md renderer
  state.mjs         atomic state.json read/modify/write
  planning.mjs      .astrocode/ scaffolding
  git.mjs / util.mjs / paths.mjs   primitives
commands/           Claude Code slash commands (the workflow loop)
agents/             specialized subagent role definitions
workflows/          Workflow 4.8 scripts (parallel plan + wave execution)
templates/          .astrocode/ scaffolding templates
tests/              node:test suite (engine + a real git registry integration test)
```

## The numbering registry (the core guarantee)

The registry is a single `registry.json` on an orphan branch (`astro-registry` by
default) on the project's `origin`. A claim is an atomic compare-and-swap done
entirely with git plumbing:

```
read   git fetch <branch>           → git show FETCH_HEAD:registry.json   (tip = T)
build  next = max(claims of this type) + 1   ← phases span all milestones (global)
write  hash-object → mktree → commit-tree -p T → push commit:refs/heads/<branch>
```

The push is a normal (non-force) fast-forward. If another developer claimed a
number meanwhile, the remote tip moved past `T`, the push is **rejected**, and we
re-read and recompute. That rejection *is* the mutual exclusion — no locks, no
server, no race. If you reach for phase 8 and it's taken, you get 9.

When there is no coordinated remote, `ac` falls back to **local** numbering from
the roadmap and warns that numbers are not team-coordinated.

### The shared store generalizes (canon lives here too)

The orphan branch is really a small **shared store**, and `lib/shared.mjs` exposes it
as a transaction: `transact(fn)` reads the current tip, lets `fn` compute file
updates, and commits a new tree that **preserves every other file** before pushing as
a fast-forward (retrying on rejection). Numbering is one transaction over
`registry.json`; the team canon is another over `DECISIONS.md` / `CONVENTIONS.md` on
the *same* branch.

This is why `DECISIONS.md` is shared: it's append-only and project-global, so
`ac decision add` is a CAS append (ADR numbers can't collide across developers) and
every teammate sees new decisions immediately. `CONVENTIONS.md` is editable, so it's
last-writer-wins via `ac canon push` (rare, by agreement). Per-phase plans/summaries
stay on the working branch with the code (see *Canon vs. codebase map*). Local
`.astrocode/` copies are fast-read mirrors refreshed by `ac canon pull`.

> Note: unlike GSD's external locksmith hook (which grepped numbers out of
> ROADMAP.md on write), astro-code enforces numbering through the CLI itself
> (`ac phase add` / `ac milestone new`). ROADMAP.md is *generated*, never the
> source of truth — simpler and collision-proof by construction.

## State model

- `.astrocode/PROJECT.md` — prose vision/requirements (human/model authored).
- `.astrocode/state.json` — active milestone/phase, status, decisions, blockers.
- `.astrocode/roadmap.json` — canonical phase list; `.astrocode/ROADMAP.md` rendered.
- `.astrocode/CONVENTIONS.md` — prescriptive canon (stack, naming, patterns, testing).
- `.astrocode/DECISIONS.md` — append-only ADR-lite log (decision · why · rejected).
- `.astrocode/phases/NN-slug/` — PLAN.md, task files, SUMMARY.md (agent authored).

## Canon vs. codebase map (why we have one, not the other)

GSD ships `map-codebase` (parallel agents write 4 snapshot docs of the code). We
deliberately don't, and instead invest in **canon**:

- **Canon is prescriptive and permanent** — the rules new code must obey. It's the
  cheap, high-leverage way to keep many parallel agents and multiple developers
  consistent on stack/naming/patterns/decisions. It's injected into every planning
  and execution agent (`ac canon`), so consistency is *enforced*, not hoped for.
- **A codebase map is descriptive and disposable** — a photo of the code as it is.
  Genuinely useful for onboarding to an *existing/large/legacy* codebase, but for
  greenfield code grown under good canon it adds little, and a **stale map is worse
  than none** (agents trust outdated info). So it doesn't belong in the core loop.

If a map is ever needed, the right shape is one lightweight, *timestamped*,
on-demand `CODEBASE.md` (the existing `astro-mapper` agent can produce it) — not
GSD's four always-maintained documents.

## The loop

`ac init` → `astro-new-project` → per phase: `astro-phase` (claim) →
`astro-discuss` (adaptive questions → CONTEXT.md) →
`astro-plan` (parallel research + synthesis + acceptance checklist, reads CONTEXT.md) →
`astro-execute` (wave-based parallel executors) → `astro-verify` (AI gate →
`verified`) → `astro-accept` (human UAT gate → `complete`) →
`astro-complete-milestone` → `astro-milestone` (next cycle).

Phase status is two-gated: `executing → verified → complete`. The AI verifier can
only reach `verified`; closing a phase requires human UAT sign-off
(`ac phase accept`, which refuses unless the phase is already `verified`).

### Context hygiene (`/clear`-safe by design)

Because all state lives in `.astrocode/` files + the registry — and because heavy
work runs in workflows/subagents with their own contexts (principle #5) — the main
thread barely accumulates, and every command re-grounds from disk (`ac status`,
roadmap, `CONTEXT.md`, `PLAN.md`). So astro-code needs `/clear` *less often* than
GSD (which does its heavy lifting inline) and `/clear` is *safe*: nothing is lost.

The guidance, therefore:
- **Clear at phase boundaries**, not between every command — after a phase reaches a
  durable resting point (`astro-accept` closes it, or after `astro-execute`/
  `astro-verify` before the next phase's `discuss`/`plan`). Commands emit a one-line,
  *optional* nudge at those handoffs ("state is saved; `/clear` to keep context lean").
- **Don't** clear mid-interactive-flow (mid-`discuss`, or `discuss → plan` while the
  human is still in the thread) — that conversation carries intent not yet on disk.
- **Never** clear while a background Workflow/Agent is in flight — you'd risk losing
  its completion notification. The nudge fires only *after* the work returns.

## Why this is faster than GSD

Speed comes from doing less per turn and more in parallel — not from cutting corners.

1. **Deterministic fan-out instead of prose orchestration.** GSD's execute loop is
   driven by large workflow files (1,000–1,700 lines) the model re-reads and
   interprets each turn to decide what to spawn. astro-code hands orchestration to
   the 4.8 **Workflow** tool: a small JS script fans out agents directly. Less model
   reasoning per turn, true parallelism, and `pipeline()` with no barriers between
   independent tasks.
2. **Tiny context footprint.** GSD loads `gsd-tools.cjs` (68 KB), big workflow files,
   and a routing layer. astro-code commands are ~20 lines; the deterministic work
   lives in the `ac` CLI and runs *outside* the model's context. Fewer tokens per
   turn → faster and cheaper.
3. **One call per state op.** Atomic `ac` subcommands replace GSD's many inline bash
   patterns + JSON parsing per command.
4. **Numbering is one git compare-and-swap**, not a read-write-recheck dance.
5. **No runtime install/conversion.** GSD's installer converts skills across five
   runtimes. astro-code targets Claude Code directly.

Honest caveat: the largest win is the parallel Workflow execution plus the small
per-turn context. Wall-clock improvement should be **measured** on a real project,
not assumed — that's a good early benchmark to run.

## Do we need the GSD / an MCP codebase?

**No, on both counts, for now.**

- **GSD codebase.** We deliberately reimplemented the few essentials lean. Pulling in
  `gsd-tools.cjs` wholesale would reintroduce exactly the complexity we cut. If a
  specific battle-tested detail proves valuable later (e.g. an edge case in state
  locking), we can port that one piece — not the whole thing.
- **MCP server.** astro-code exposes its capabilities through the `ac` CLI (invoked
  via Bash) and the Workflow tool. That is simpler than running an MCP server and
  needs no extra process. An MCP server would only earn its keep if we wanted other
  MCP clients (not Claude Code) to drive astro-code, or wanted structured tool calls
  instead of shell parsing. It's a clean future option — wrap the same `lib/`
  functions as MCP tools — but not needed for v1. (Note: the "MCP test" in the
  original vision is about testing the *SaaS's* MCP servers later, a separate concern
  from the framework itself.)

## Which models?

Workflow agents inherit the **session model** by default (currently Opus 4.8). For
cost/speed, `.astrocode/config.json` → `models` assigns a tier per role:

| Role       | Default  | Model id (4.x)              | Why |
|------------|----------|-----------------------------|-----|
| planner    | opus     | `claude-opus-4-8`           | plan quality compounds across the phase |
| researcher | sonnet   | `claude-sonnet-4-6`         | broad parallel reading, good enough |
| executor   | sonnet   | `claude-sonnet-4-6`         | most tasks; bump to opus for hard phases |
| verifier   | opus     | `claude-opus-4-8`           | a false PASS is the costliest error |
| discover   | haiku    | `claude-haiku-4-5-20251001` | mechanical task/dependency parsing |

Tiers use the short names `opus | sonnet | haiku` (what the agent tooling accepts);
omit a role to inherit the session model. Set `ac config set models.executor opus`
for a max-quality run, or push everything to `haiku`/`sonnet` for a cheap draft.
