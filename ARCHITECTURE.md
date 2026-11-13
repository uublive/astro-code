# astro-code — Architecture

astro-code is a lean, multi-developer planning and execution system for coding
agents, host-agnostic across Claude Code, Codex CLI and Cursor — on Claude or on a local model. Planning state lives in
plain files in your repo — milestones, phases, a roadmap — and every phase is
carried through a discuss → plan → execute → verify → accept loop.

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

### astro-mods (optional, Claude-only; ADR-071)

`mods/` is a local Claude Code marketplace (`astro-code`) holding one plugin, `astro-mods`; `ac
install` copies it to `~/.astro/code/mods` and `ac mods enable` installs it from there into every
Claude config dir. `lib/mods.mjs` is the only writer of the per-user switches (`mods` in
`~/.astro/config.json`); the plugin holds no state and reads them through `ac mods status --json
--switches-only` at `session.start`, failing open if `ac` cannot answer. No command or agent
depends on it (`tests/hosts.test.mjs` guards that). `scripts/mods-probe/` is a dev-only probe of
Claude Code's mod events, never shipped; its findings are in phase 36's `PROBE.md`. `blindfold` (phase 39) is the first `hooks/features/*.js` mod: it identifies an agent by pairing the `agentId` that `agent.spawn`'s `next(e)` settles with against `subagentType` in an in-memory map (`$.agent.list()` misses Workflow agents), as phase 39's `PROBE.md` observed.

A `hook` feature is not part of the plugin: `lib/hosts/guards.mjs` is the data-only spec of each
guard (script, per-host event and matcher) and the one ownership rule (an entry is ours by script
filename, never by path), and the host adapters register from it. A hook's switch is its
registration: `lib/mods.mjs` `syncHookFeatures` writes or removes the entry in every Claude profile
(and Cursor's `hooks.json` when it is not importing Claude's), `ac install`/`update` re-run it, and
the hook script itself never reads a switch. Phase 37's `PROBE.md` records what blocks on each host. `git-guard` (phase 38) is a second `GUARD_HOOKS` entry, and the spec carries the per-host `verdict` (both deny since ADR-082; Claude asked before) that the script and `ac mods status` both read; phase 38's `PROBE.md` records why.

`witness` (phase 41) is `hooks/features/witness.js` plus `hooks/lib/gates.js` (the gate table and marker rewrite). It keeps module-level turn state (the origin and typed command of the current turn, from `prompt.submit` and `command.run`), and treats a prompt starting with a user machine-typed prefix as not human (`hooks/lib/machine.js`, shared with live-capture; the list rides in the `--switches-only` payload as `machinePrefixes`, ADR-081) and rewrites a gate `Bash` call on `tool.call`; it never blocks, and it registers no settings hook. `ac` still never detects: the flags it receives are declarations.

`brief-section` (phase 42) is `hooks/features/brief-section.js`: one `astro-mods:brief` section appended through `prompt.compose`. The settings hooks stay registered (Cursor and Codex run them), so inside Claude it drops their output by exact content: the engine exposes no hook name, only the entry text (phase 42 `PROBE.md`). `ac mods feed brief-section` (`lib/modfeed.mjs`, `sessionParts` in `lib/retrieval.mjs`) is the one place that says what the hooks print, sharing `shortlist`'s selection and logging no usage, so the plugin reimplements nothing. A SessionStart entry goes only if it is byte-equal to a part, and the PreCompact segment only if it equals the position re-read just before. The invariant: output is dropped only while the section is served, and once something was dropped the section stays even if `failOpen` switches the mods off, so the model never holds zero copies; before any drop a failure removes the section and the hooks deliver as today.

`phase-band` (phase 43) is `hooks/features/phase-band.js`: it reads `ac status --json` (`lib/nextstep.mjs`: the one `nextAction` rule plus siblings) and the `debt`, `backlog` and `fix` `list --json`s, caches them in session memory keyed by the mtimes under `.astrocode/`, and fills the composer but never submits. Its `session.start` and `agent.spawn` hooks carry a matcher because the plugin already registers one unmatched hook per event. Phase 58 scopes what it shows: `scopeOf` in `hooks/lib/band.js` is a pure filter over the `ac status --json` rows (`mine`, `feature_branch`, `tied_by`, `onBranch`, plus top-level `registry`, `registry_ref` and `branch`). On a branch with work of mine tied to it the band shows only that work (`+N elsewhere`); anywhere else only my open work (`+N by others`); with the registry ref unreadable the full view, as before. Ties live in the registry claim's `feature_branch` field (`lib/registry.mjs` `tieClaim`, `lib/flowlink.mjs`), a field beside the historic `branch`, which is never read as a tie; identity is the git email plus `identity.aliases` in `~/.astro/config.json` (`lib/identity.mjs`). The branch name rides the existing `<gitdir>/HEAD` read and ownership the existing `ac status --json` read, so the band starts no new process. See phase 43 `PROBE.md` for the live-wave source: `$.agent.list()` shows no workflow agent, so the band falls back to `ac`'s activity text.

`live-capture` (phase 44) is `hooks/features/live-capture.js`: the capture moment `templates/principle-capture.md` names as Live capture. Features live in `hooks/features/`, and `hooks/lib/badges.js` is the in-memory band contract (a feature sets a badge, `phase-band` draws the badges and claims them, otherwise live-capture prints its one dim line).

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

> Note: numbering is not policed by an external hook watching the roadmap file
> (grepping numbers out of ROADMAP.md on write); astro-code enforces it in the CLI itself
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

A common pattern is to have parallel agents write snapshot documents describing the
codebase, kept up to date forever. We deliberately don't, and invest in **canon**
instead:

- **Canon is prescriptive and permanent** — the rules new code must obey. It's the
  cheap, high-leverage way to keep many parallel agents and multiple developers
  consistent on stack/naming/patterns/decisions. It's injected into every planning
  and execution agent (`ac canon`), so consistency is *enforced*, not hoped for.
- **A codebase map is descriptive and disposable** — a photo of the code as it is.
  Genuinely useful for onboarding to an *existing/large/legacy* codebase, but for
  greenfield code grown under good canon it adds little, and a **stale map is worse
  than none** (agents trust outdated info). So it doesn't belong in the core loop.

If a map is ever needed, the right shape is one lightweight, *timestamped*,
on-demand `CODEBASE.md` (the existing `astro-mapper` agent can produce it) — not a
set of always-maintained documents that quietly drift out of date.

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
roadmap, `CONTEXT.md`, `PLAN.md`). So astro-code needs `/clear` *less often* than a
system that does its heavy lifting inline, and `/clear` is *safe*: nothing is lost.

The guidance, therefore:
- **Clear at phase boundaries**, not between every command — after a phase reaches a
  durable resting point (`astro-accept` closes it, or after `astro-execute`/
  `astro-verify` before the next phase's `discuss`/`plan`). Commands emit a one-line,
  *optional* nudge at those handoffs ("state is saved; `/clear` to keep context lean").
- **Don't** clear mid-interactive-flow (mid-`discuss`, or `discuss → plan` while the
  human is still in the thread) — that conversation carries intent not yet on disk.
- **Never** clear while a background Workflow/Agent is in flight — you'd risk losing
  its completion notification. The nudge fires only *after* the work returns.

## Why this is fast

Speed comes from doing less per turn and more in parallel — not from cutting corners.

1. **Deterministic fan-out instead of prose orchestration.** Orchestration is not a
   large workflow document the model re-reads and reinterprets each turn to decide
   what to spawn; it is a small JS script handed to the **Workflow** tool, which fans
   out agents directly. Less model reasoning per turn, true parallelism, and
   `pipeline()` with no barriers between independent tasks.
2. **Tiny context footprint.** Commands are ~20 lines. The deterministic work lives in
   the `ac` CLI and runs *outside* the model's context, rather than being loaded into
   it as a tool monolith plus a routing layer. Fewer tokens per turn → faster and
   cheaper.
3. **One call per state op.** Atomic `ac` subcommands replace inline bash + JSON
   parsing repeated in every command.
4. **Numbering is one git compare-and-swap**, not a read-write-recheck dance.
5. **No runtime conversion at install.** Each host adapter renders the same commands
   into that host's native format once, at install time.

Honest caveat: the largest win is the parallel Workflow execution plus the small
per-turn context. Wall-clock improvement should be **measured** on a real project,
not assumed.

## Do we need a vendored tool monolith / an MCP server?

**No, on both counts, for now.**

- **A vendored tool monolith.** The few essentials are deliberately reimplemented lean.
  Pulling in a large prior-art toolfile wholesale would reintroduce exactly the
  complexity the design cuts. If a specific battle-tested detail proves valuable later
  (e.g. an edge case in state locking), port that one piece — not the whole thing.
- **MCP server.** astro-code exposes its capabilities through the `ac` CLI (invoked
  via Bash) and the Workflow tool. That is simpler than running an MCP server and
  needs no extra process. An MCP server would only earn its keep if we wanted other
  MCP clients (not Claude Code) to drive astro-code, or wanted structured tool calls
  instead of shell parsing. It's a clean future option — wrap the same `lib/`
  functions as MCP tools — but not needed for v1. (Note: the "MCP test" in the
  original vision is about testing the *SaaS's* MCP servers later, a separate concern
  from the framework itself.)

## Which models?

`.astrocode/config.json` gives each of the six roles two independent dials: a **model
tier** (`models.<role>`) and a **reasoning depth** (`reasoning.<role>`, low → max). Both
move cost, so `ac models max|balanced|fast` sets the pair in one switch. The defaults
(`balanced`):

| Role       | Tier   | Why |
|------------|--------|-----|
| planner    | opus   | plan quality compounds across the phase |
| researcher | sonnet | broad parallel reading, good enough |
| executor   | sonnet | most tasks; `deep` effort escalates it to opus for one phase |
| verifier   | opus   | a false PASS is the costliest error |
| discover   | sonnet | mechanical task/dependency parsing |
| integrator | haiku | mechanical wave-fold: stamp-mapped cherry-picks; anything unclean is preserved and healed at executor tier (`max` keeps sonnet) |

Tiers are the short names `opus | sonnet | haiku` — what the agent tooling accepts, resolved by
the host to its current model. **No profile puts haiku on a judgement role; balanced and fast
run the integrator on it**, and you may still set it for any role yourself (ADR-073). ADR-035 dropped haiku 4.5 there after benchmark #2: its cherry-pick
judgement was sound but its discipline was not — it ran a bare `git stash -u` in the shared
tree and destroyed a completed plan. Haiku 5.5 is a different model at about a twentieth of
sonnet's price; with the prompt's prohibition paragraph it was 20/20 on that scenario and
never stashed. Speed otherwise comes from opus → sonnet. The integrator floors to sonnet when
unset; `ac config set models.integrator sonnet` opts out of haiku. An unset role inherits the session model.

**Local models (ADR-067).** A Claude Code session pointed at a local endpoint (e.g. Qwen
behind `ANTHROPIC_BASE_URL`) serves one model and none of the Claude tiers. `ac` detects it
from the session env it inherits and resolves every role to the `inherit` tier with no
reasoning effort; the workflows then pass no model at all — overriding the config, `deep`'s
escalation and the integrator floor — so every agent runs on the session's model. The stored
config is never changed. `ASTRO_LOCAL_MODEL=1|0` forces the detection either way.
