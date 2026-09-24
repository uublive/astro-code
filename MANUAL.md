# astro-code — Manual

The complete reference. For a five-minute orientation, read [`README.md`](./README.md);
for an interactive walkthrough, open the
[field manual](https://claude.ai/code/artifact/80291435-e40c-4029-a933-8fbdf2d69539).
For *why* it is built this way, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

- [Install and hosts](#install-and-hosts)
- [The loop](#the-loop)
- [Two gates close a phase](#two-gates-close-a-phase)
- [Numbering and duplicate detection](#numbering-and-duplicate-detection)
- [Bugs are not phases](#bugs-are-not-phases)
- [Technical debt](#technical-debt)
- [Backlog](#backlog)
- [Principles](#principles)
- [The fast lane](#the-fast-lane)
- [Canon](#canon)
- [Models, thinking and effort](#models-thinking-and-effort)
- [GitFlow branching (opt-in)](#gitflow-branching-opt-in)
- [Astro kits](#astro-kits)
- [External knowledge graph (retired)](#external-knowledge-graph-retired)
- [Command reference](#command-reference)
- [Layout and development](#layout-and-development)

---

## Install and hosts

```bash
git clone git@github.com:uublive/astro-code.git
cd astro-code
npm install -g .     # puts `ac` on your PATH
ac install           # populates ~/.astro/code and publishes to every harness it finds
```

Requires **Node ≥ 22**.

`ac install` keeps the files in `~/.astro/code` and publishes them to **every agent
harness present on the machine**, each in that harness's own format, from one command.
It's idempotent; `ac uninstall` reverses it everywhere.

| Harness | Where | How you invoke a command |
|---|---|---|
| **Claude Code** | symlinked into the base `~/.claude` **and every jean-claude profile** (auto-detected from `~/.claude/.jean-claude/profiles.json`) | `/astro-plan 3` |
| **Codex CLI** | skills under `~/.codex/skills/` | `$astro-plan 3` |

**Updating** is one command: `/astro-update` (or `ac update`) — it pulls the latest,
refreshes the global CLI, and re-links across every profile. The first time, if it
can't find your clone, run `ac update <path-to-clone>` once and it remembers it.

### Letting Claude Code run the shipped workflows

`/astro-plan`, `/astro-execute` and `/astro-fast` run workflow scripts that live in
`~/.astro/code/workflows`, outside your project. Claude Code only reads a `scriptPath`
outside the project when that directory is granted, so add it once — per project in
`.claude/settings.local.json`, or for every project in `~/.claude/settings.json`:

```json
{ "permissions": { "additionalDirectories": ["<output of: ac path>"] } }
```

Paste what `ac path` prints, not a hand-typed `~/.astro/code`: it resolves symlinks, and
on systems where `/home` is a link (`/var/home` on Fedora Silverblue, Bazzite and other
ostree distros) only the resolved form matches. Don't copy the scripts into the project
instead — a local copy silently goes stale after `ac update`.

### Windows / PowerShell

`ac` is shadowed by PowerShell's built-in `Add-Content` alias (aliases beat external
commands), so typing `ac install` prompts for `Value[0]` instead of running the CLI.
Use the equivalent **`astrocode`** command (`astrocode install`), or bypass the alias
with `ac.cmd install`, or remove it for your session: `Remove-Item Alias:ac`.

Note `ac install` links files with symlinks, which on Windows require Developer Mode or
an elevated shell.

### Using it on Codex

Codex has **no custom slash commands** — `/astro-plan` will not resolve. astro-code's
commands are installed as Codex *skills*, so you invoke them as `$astro-plan` or simply
ask for one by name. The six agents install as subagent skills the loop dispatches.

Two things Codex does not get yet: the **status line / phase track** (Codex requires each
hook to carry a `trusted_hash` in `config.toml`, which astro-code will not forge on your
behalf), and hook-driven session state. Everything else — the full loop, the registry,
worktree-isolated parallel execution — works the same, because the engine is
host-agnostic and `ac` drives the orchestration itself.

---

## The loop

Everything lives in **`.astrocode/`** in your repo (human-readable, git-committed):
`PROJECT.md`, `ROADMAP.md`, per-phase `CRITERIA.md`/`PLAN.md`/`SUMMARY.md`, plus the canon.

Per phase: `discuss → plan → execute → verify → accept`.

### Discuss before planning

`/astro-discuss` asks adaptive, pick-an-answer questions about scope, approach, and edge
cases, then writes the decisions to the phase's `CONTEXT.md` — which `/astro-plan` reads
and obeys. Optional but recommended; trivial phases can skip it.

It also surfaces open debt touching the files this phase is about to change, because debt
is cheap to pay when you are already in the file.

### Plan

`/astro-plan` first has the `astro-criteria-author` agent pre-register goal-derived,
falsifiable success criteria — **before any plan exists**, so the verifier's bar can never
be shaped by the implementation. Then researchers fan out on three angles and a planner
synthesizes an executable, dependency-aware `PLAN.md` plus the acceptance checklist you
will sign against later.

### Execute

`/astro-execute` runs the plan **wave by wave** on the working branch: independent tasks in
parallel, one isolated git worktree each, an integrator landing them. One task, one commit —
so a failed task can be re-run without unpicking someone else's work. It calls the verify
gate itself when the last wave lands.

Watch live progress with **`/workflows`**. It degrades gracefully to inline subagents when
the Workflow tool isn't available.

### Context hygiene (`/clear`-safe by design)

Because all state lives in `.astrocode/` files plus the registry — and because heavy work
runs in workflows/subagents with their own contexts — the main thread barely accumulates,
and every command re-grounds from disk. So astro-code needs `/clear` *less often* than a
system that does its heavy lifting inline, and `/clear` is *safe*: nothing is lost.

- **Clear at phase boundaries**, not between every command.
- **Don't** clear mid-`discuss`, or `discuss → plan` while you are still in the thread —
  that conversation carries intent not yet on disk.
- **Never** clear while a background Workflow/Agent is in flight — you would risk losing
  its completion notification.

---

## Two gates close a phase

A phase moves `executing → verified → complete`.

The `astro-verifier` agent is the **machine gate** — adversarial and **plan-blind**. It
checks the result against the pre-registered, goal-derived `CRITERIA.md` by running the
evidence per criterion, never by trusting the plan or the task summaries.

`/astro-accept` is the **human gate**: UAT against the acceptance checklist written at plan
time. The AI never auto-closes its own work; `ac phase accept` requires a prior `verified`.

> **A phase's goal is the bar, not its task list.** Every task passing while the goal is
> unmet is a failed phase.

---

## Numbering and duplicate detection

`ac phase add` / `ac milestone new` claim the next free number from `registry.json` on an
orphan branch (`astro-registry`) via a git compare-and-swap: if someone else pushed first
your push is rejected and `ac` retries with the next number. No server, no `gh`.

Claims also record the **name**, so adding a phase (or `ac phase check "<name>"`) warns
when another dev is already building something with the same or similar name — catching
duplicate work early.

The registry is the single source of truth: with no remote (or before `ac registry init`),
a claim **refuses with an actionable hint** rather than allocating a local number that
could later collide — set up an `origin` and run `ac registry init` first.

> **Never hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry.** Editing
> them desynchronises the claim ledger and the corruption surfaces later, on someone
> else's branch. `ROADMAP.md` is **generated** — edits to it are overwritten; use
> `ac phase note <n> "<text>"` for a note that survives.

A phase's milestone lives **on the phase**. Scheduling a phase for a future milestone never
moves the project. **Milestones have a lifecycle** — planned → active → complete:
`ac milestone new --planned --name "…"` declares one as a destination without moving the
project, work is assigned with `--milestone N` (`phase add`, `debt pay --as phase`,
`backlog promote`), and `ac milestone activate <n>` is the separate step that starts it.
Work can only target a claimed, unclosed milestone. A roadmap that already uses a
milestone the registry never claimed is repaired once with
`ac milestone new --planned --number N`, which only works when phases reference N.
Correct a wrong assignment with `ac phase milestone <n> <N>`, which
moves the phase's registry claim too (it refuses, changing nothing, if the registry is
unreachable). `ac status` flags any phase whose roadmap and registry milestones differ.
Closing a milestone archives only its own phases — ones scheduled for a later milestone
stay on the roadmap.

---

## Bugs are not phases

A phase is planned milestone scope; a bug is something that turned out to be wrong. Filing
one as a phase burns a milestone number on unplanned work and leaves the roadmap describing
something other than the plan.

`/astro-fix "<bug>"` keeps bugfixes **beside** the roadmap — a dated id
(`2026-09-17-auth-401`), its own directory and archive, its own lifecycle
(`open → diagnosing → executing → verified → accepted`) — and carries one end-to-end:
reproduce, diagnose, fix, verify.

`/astro-fix-accept <id>` is the human gate; a failing verdict sends the fix back to
`diagnosing` (the bug is still live), never to `rejected`, which means "we've decided not
to fix this". Accepting archives it. `ac fix list` shows what's open.

---

## Technical debt

The phase verifier is the highest-context observer in the loop — it has just driven the
real code — so anything real it notices that no criterion covers is filed automatically as
debt. You type nothing; `ac debt list` is the quality dashboard you check when you feel
like it.

An item is never worked in place: it **graduates** into the objects that already exist —
`ac debt pay <id>` opens a **fix**, `--as phase` puts it on the **roadmap** (under the
active milestone, or `--milestone N` for a later one) — and closes
when that work is *accepted*, never on a promise.

That automatic outflow is the whole design: a list whose entries only leave when a human
remembers to delete them is a diary, and a diary rots (astro-code's own `todo.md` spent
months insisting GitFlow was unimplemented while `lib/flow.mjs` shipped it). Two hooks keep
it live rather than archival: `/astro-discuss` surfaces debt touching the files a phase is
about to change, and `/astro-complete-milestone` asks you to pay or drop anything stale.

The verifier can never park a *criterion* failure here: a finding is admissible only if it
explicitly asserts it is outside every criterion, and findings from a failing phase are
discarded, so the quality gate keeps no back door.

### Drop vs dismiss

Two exits exist for an item that isn't going to be fixed, and the difference is the point:

- `ac debt drop` — it **was** true and the code moved on.
- `ac debt dismiss` — it was **never** true and the verifier was wrong.

Both keep the record. Only the second is a measurement of the *feed* — if dismissals climb,
tighten the verifier rather than grinding through the register.

### Is it worth paying down?

`/astro-debt` (or `ac debt score`) answers with a 0–100 number and the evidence behind it,
then offers the exits; `/astro-debt-pay <id>` takes one on and lands it — checking first
that it is still real, routing it to a fix or a phase, and closing it only through the
acceptance gate.

It is explicitly **not** a count: volume is a guilt meter that says "pay debt" every day of
the project. Instead it weighs what the debt is *charging* you — **recurrence** (the
verifier hit the same item again in a later phase, so you demonstrably keep walking over
this ground), **concentration** (several items in one file), and age but only where it
compounds a recurrence — against the **principal** it would cost to clear
(small 1 · medium 3 · large 8).

So filing more debt can never raise the score by itself: a fresh, isolated finding is pure
principal and pushes the number *down*. Debt in code you never touch reads as zero, which is
the honest answer.

| Score | Reading |
|---|---|
| under 25 | healthy |
| 25–49 | worth watching |
| 50+ | the register is charging you about what clearing it would cost |

The same number rides the statusline as `debt nn` — and **only** once it leaves the healthy
band, so the segment appearing is itself the signal.

---

## Backlog

A place to write down an idea you are not ready to plan — `/astro-backlog "<idea>"` files
it with no file touched and no phase number spent. It is a peer of debt and fixes, not a
status inside either: an idea has no file and no recurrence, so folding it into the debt
register would corrupt the one number in the system that currently carries signal.

Like debt, it cannot rot into a `todo.md`: every item leaves the list the same way it
arrived. `/astro-discuss` offers to **link** an open item to the phase it relates to, and
a linked item **closes automatically** when `/astro-accept` accepts that phase — never on
a human remembering to delete a line. An item can also be **promoted**
(`/astro-backlog-promote <id>`) into a real phase, which claims a number and seeds the
idea's captured text into the new phase's `CONTEXT.md` — deliberately without marking it
as a discuss round, so `/astro-plan` still demands a real one. Or it can be **archived**
with a reason (`declined` or `obsolete`), keeping the record of why so a later "let's plan
X" can be answered instead of re-litigated.

`/astro-backlog` with no argument just lists what's open and stops — checking is a glance,
so it never costs a round of questions. `/astro-backlog review` is the triage pass that
offers each item its exits.

---

## Principles

A personal store of your own patterns, preferences and antipatterns — the notes you keep
making across every project, kept once instead of re-typed into every `CONTEXT.md`.
`ac principles add "<statement>" --kind principle|pattern|preference|antipattern` writes
one Markdown file per entry under `~/.astro/principles/` (`ASTRO_PRINCIPLES_DIR`
overrides that), never inside the project: ADR-057's explicit exception to "state lives
under `.astrocode/`", because what is being written travels with YOU, not the repo.

**Accepting is the only way in.** A manual `ac principles add` is accepted directly; a
machine that later observes something (phase 23) can only `--propose` it — an entry
starts governing agents once a human accepts it, never on its own. `ac principles reject
<id> --reason "…"` and `ac principles retire <id> --reason "…"` both need a reason, and
neither one deletes the entry: a rejection is what stops the same idea from being
re-proposed later, so `list --all` keeps showing it long after `list --accepted` stops.
`ac principles amend <id> --reason "…" [--statement … | --edit]` rewords or rescopes an
accepted entry in place — same id, one history line naming the reason and the prior text.

**Remote and sync.** With no remote configured the store is purely local and every
command is offline. `ac principles remote <url>` points it at your own private git
repo (never a team's) and syncs immediately; after that, every command pulls first and
pushes after a mutation, offline-first — an unreachable remote is only ever an advisory
line, never a failure, and nothing is force-pushed. Two machines that both changed the
*same* entry since their last sync produce a genuine conflict: the machine you are on
keeps its own copy in `<id>.md`, the other machine's copy lands in
`conflicts/<id>.<sha>.md`, and every command warns until you run
`ac principles resolve <id> [--take mine|theirs]`. Two machines changing *different*
entries never conflict — one file per entry makes that true by construction.

**Promote vs. personal.** A principle stays personal until you deliberately promote it:
`ac principles promote <id>` (accepted entries only) records a shared ADR in the current
project's canon by default, or `--as convention` appends a bullet to its
`CONVENTIONS.md` (local only — it prints the `ac canon push` you still have to run
yourself). Either way the entry itself stays in your home store, still accepted, still
yours everywhere else — `show <id>` lists every project it has been promoted into.

**How proposals arrive.** Four moments propose into your store — never accept anything
on their own (ADR-058): after `/astro-decision` records an ADR, after `/astro-discuss`
captures `CONTEXT.md`, on an `/astro-accept` rejection (a plain acceptance proposes
nothing), and the `/astro-complete-milestone` retrospective sweep over the whole
milestone's ADRs, CONTEXT files, rejections and the surprises `/astro-execute` records
along the way. Only moments a human actually answered propose — an agent-captured
discussion or an agent-signed accept/reject (`--agent`) never does. Each moment proposes
at most 3, each carrying its own why, and ends with at most one line —
`ac principles list --proposed` reviews the queue. See
[`templates/principle-capture.md`](./templates/principle-capture.md) for the full spec.

**Review and dedupe.** An EXACT repeat of any existing statement — normalised for case,
punctuation and whitespace, never a similarity score — never mints a second entry,
regardless of the existing entry's status: it records a *sighting* on it instead ("seen
again N"), so an already-accepted principle just accumulates evidence and an
already-rejected one stays rejected without re-entering the queue. An OVERLAP
candidate (a statement that shares real content words with an existing one, short of
being the exact same wording) is only ever *surfaced* — `ac principles match
"<statement>"` names it and the words that matched — never acted on: the capturing
agent, or you, decides whether it's the same principle (`ac principles sight <id>`
instead of proposing) or a genuinely different one. `/astro-review` walks the proposed
queue in batches — accept, edit-then-accept, reject (reason required) or skip each
item, and offers `ac principles merge <dup> --into <id>` for a near-duplicate group
instead of rejecting one of them for "no". `ac principles reopen <id> --reason "…"` is
the only way back from rejected. Sightings recorded on two machines merge across a sync
with no conflict — they're append-only evidence, never a decision to arbitrate.

- `ac principles match "<statement>" [--json]` — exact/overlap candidates, explainable, never acted on.
- `ac principles sight <id> [--from-project …] [--excerpt …]` — record an explicit sighting.
- `ac principles reopen <id> --reason "…"` — rejected → proposed, the only way back.
- `ac principles merge <dup> --into <id>` — fold a duplicate's evidence into the survivor; the duplicate stays citable as `merged`.

**Retrieval — a structural shortlist, not a search engine.** `ac principles brief [--stage
s] [--work w,…] [--files a,b] [--rules-only] [--by role] [--json]` prints the per-task
shortlist: every `strength: rule` entry in full, plus a compact index (id, kind/strength,
first-sentence statement, ≤ 25 lines) of *in-scope* accepted defaults — a default is in
scope when EVERY non-empty scope dimension (stack/work/files) matches something in the
task's context (stack ∩ project tags, work ∩ requested work, a requested file matching a
glob); an unscoped dimension on either side is a wildcard, but no `--files` at all means a
file-scoped entry stays silent — a glob is a narrow claim nothing confirms it against.
Stack is detected from manifests at the project root (`package.json` deps, `go.mod`,
`Cargo.toml`, …), overridable with `ac config set stack '["rust"]'`; the tags used are
always printed, so a wrong detection is visible, never silent. Nothing served ⇒ empty
stdout (hooks key their silence on that) and one line on stderr. `ac principles ask
"<question>"` ranks by keyword — statement, why and scope tags, weighted — and says WHY
each result matched (no embeddings, ever). `ac principles cite <id>… --stage s --by role`
records what you actually applied; `ac principles list --usage` surfaces served-often-
never-cited ("ignored") and never-served ("unused") entries from that log, which lives at
`~/.astro/principles/.local/usage.jsonl` — per-machine, unsynced, ids only. A shortlist
that shares words with your project's `CONVENTIONS.md`/`DECISIONS.md` prints `⚠ canon may
override: ADR-nnn` — a candidate only; canon always wins and nothing is resolved for you.
Every astro agent (executor, researcher, planner) runs `brief` for its own stage and
`cite`s what it applies; the verifier only ever sees hard rules, non-blocking (a violation
is filed as debt, never a failed criterion). The Claude Code session gets the same
shortlist injected automatically at start/compact; on any other host, the managed
`AGENTS.md` block tells the agent to run `ac principles brief` itself.

---

## The fast lane

`/astro-fast "<a long, unplanned prompt>"` is for a big freehand request that shouldn't need
four commands to land. It **captures the raw prompt verbatim** (the source of truth),
**distills a lean spec** you can eyeball — a checklist of changes each traced back to the
prompt, plus an explicit "to clarify" list so nothing is silently dropped — then goes
**straight to execution**: sequential atomic commits and one verify pass, skipping the
research fan-out.

A **scope guard** escalates anything systemic (new architecture, cross-cutting migration,
new dependency, or work that contradicts the canon) back to the full flow.

It produces a **verified** phase at best — human `/astro-accept` still closes it.

---

## Canon

`CONVENTIONS.md` (rules) + `DECISIONS.md` (append-only ADR log) are shared on the same
orphan branch as the registry and injected into every plan/execute agent, so consistency
across parallel work is enforced rather than hoped for.

`ac decision add` appends to the shared log (ADR ids never collide across devs, and each
entry records the commit it was made at); `ac canon pull` refreshes your local mirror.

**A decision leaves the log without being deleted.** `ac decision supersede <id> --by <id>`
and `ac decision retire <id> --reason "…"` stamp it with a status; the full entry stays in
`DECISIONS.md` for audit, but agents read `DECISIONS.in-force.md` — every live decision in
full, and a one-line stub (successor and date) for each one no longer in force, so a
citation still resolves. `ac canon stats` shows what every agent is handed.
`ac canon dedupe` leaves a stub too, so a collapsed number is never reissued.

**Correcting prose is not a new decision.** `ac decision amend <id> --reason "…" --why "…"`
(or `--rejected`, `--body-file`) fixes a dead link or a translation: same id, same title,
and an `_Amended <date>: <reason>_` line records it. A decision that *changed* is a new one
plus `supersede`.

**Keep the mirror honest.** The committed `DECISIONS.md` is what ties canon to your code —
`git show <tag>:.astrocode/DECISIONS.md` is the canon in force at that tag. `ac canon check`
exits non-zero, per decision, when it differs from the registry (put it in CI or a hook);
`ac status` flags it in one line. Never hand-edit a published entry: amend it.

> Read `CONVENTIONS.md` and `DECISIONS.in-force.md` before proposing an approach. Conventions are
> binding; decisions record what was already settled and why. Re-litigating a recorded
> decision wastes the work that produced it.

**Existing project?** `/astro-adopt` maps the repo once and drafts `PROJECT.md` +
`CONVENTIONS.md` from the real code, then plans what's next — a one-time bootstrap, not an
always-synced codebase map.

---

## Models, thinking and effort

`.astrocode/config.json` sets a **model tier** (`models.<role>`: opus/sonnet) and a
**reasoning depth** (`reasoning.<role>`: low→max) for each of the six roles. They're
independent and both move cost — a cheap model at `xhigh` can outspend an expensive one at
`low` — so `ac models max|balanced|fast` sets the **pair** in one switch:

- **balanced** (default) — opus + `high` for `planner` and `verifier`, sonnet + `medium`
  elsewhere (the mechanical `discover`/`integrator` stay `low` in every profile).
- **fast** — sonnet and `low` everywhere **except the verify gate**, which keeps opus +
  `high`. Going fast can never silently cost correctness. Phases dominated by execution
  shrink the most.
- **max** — opus everywhere (`xhigh` on planner/verifier), except `integrator`, which stays
  sonnet — opus on a cherry-pick is waste.

The tier ladder is **opus→sonnet for every role; haiku is excluded everywhere**. ADR-035
reverted the old `integrator` carve-out: benchmarking showed haiku's cherry-pick *judgement*
was sound but its *discipline* was not — it ran a bare `git stash -u` in the shared tree and
destroyed a completed phase plan. Speed comes from opus→sonnet, never from dropping a role
to haiku. Hosts clamp depth to their own ceiling (Codex tops out at `xhigh`) rather than
silently falling back.

The third dial is per-**phase**, not per-role: `ac phase effort <n> light|standard|deep`
(ADR-022) budgets how many verify→remediate cycles a phase may burn — 0, 1, or several.
Research stays 3 angles at every level; the budget goes into convergence, not fan-out.

Per-run without persisting: `/astro-plan <n> --fast` / `/astro-execute <n> --fast`.
Fine-tune one role with `ac config set models.executor opus`, or use `/astro-config`.

### Measuring cost

`ac stats` reads Claude Code's session transcripts and reports the honest breakdown —
**fresh** input/output (the real cost) vs **cache reads** (cheap), the cache-hit ratio, and
wall-clock. It's the whole project session by default; scope a single run with
`--since "<ISO timestamp>"` (or `--session <id>`). For a real astro-code-vs-X comparison,
run the same task in a fresh session and compare.

### Resilience

astro-code runs *inside* a Claude Code session (it never shells out to the `claude` binary),
so model fallback is a session-launch concern, not a config knob: start Claude Code with
`claude --fallback-model sonnet` and a transient opus outage degrades the session to sonnet
for the rest of the run instead of failing every request mid-phase — worth it for long
autonomous runs.

---

## GitFlow branching (opt-in)

Off by default — planning stays orthogonal to branching, so teams that don't want GitFlow
pay zero cost. Turn it on with `ac config set gitflow.enabled true`, then drive it
explicitly (lifecycle commands like `ac milestone new` are never touched):

```bash
ac flow init                   # ensure main + develop exist (creates develop off main)
ac flow                        # create+switch to feature/m<N> off develop
ac flow pr                     # push the feature branch, print the develop PR URL
ac flow release                # push develop, print the develop→main PR URL
ac flow tag [version]          # tag origin/main once that PR merges
ac flow hotfix start <name>    # branch off main; `finish` lands it in main+develop + tags
```

> **Run `ac flow` before `/astro-execute`.** Execution forks one worktree per task from
> `HEAD`, so you must be on the feature branch first.

It's pure local git (no `gh`/`glab`, any remote or none) and it refuses to touch the orphan
`astro-registry` branch.

---

## Astro kits

```
/astro-kit-new [kit-id]   start a new Astro kit: scaffold manifest v4 + recipe + build tooling
/astro-kit-convert [src]  convert an existing non-kit implementation at verified feature parity
/astro-kit-test           test a kit WITHOUT publishing: offline static checks, or --tier2
/astro-kit-publish        publish a kit to a hosted Astro instance (zip with kit.json inside)
```

A kit is developed as a standalone astro-code project and goes through the normal loop.

---

## External knowledge graph (retired)

astro-code used to make one opportunistic read against an external knowledge-graph MCP
server before `/astro-discuss`, `/astro-plan`, and `/astro-new-project`. Phase 25 replaced
every one of those calls with `ac principles ask` / `ac principles brief` — a personal
store, local and always available, with no connect/degrade dance to document. No astro-code
command or agent reads (or hosts) an external knowledge-graph server any more; retrieval
now runs entirely through `ac principles` (see [Principles](#principles)).

---

## Command reference

### Slash commands

```
/astro-new-project        scaffold .astrocode/, shape PROJECT.md + the roadmap
/astro-adopt              adopt an EXISTING codebase: map it → draft canon → plan next
/astro-phase <name>       add a phase (claims its number)
/astro-discuss <phase>    talk through decisions/edge cases → CONTEXT.md (before planning)
/astro-plan <phase>       parallel research → executable PLAN.md (reads CONTEXT.md)
/astro-execute <phase>    wave-based parallel execution, then verify
/astro-verify <phase>     AI gate: confirm the phase goal is met (goal-backward)
/astro-accept <phase>     human gate: UAT sign-off, then close the phase
/astro-autonomous <phase> run a whole phase end-to-end (discuss→plan→execute→verify), then stop
/astro-fast "<prompt>"    fast lane for a long, off-the-cuff prompt: capture → distill → execute
/astro-fix "<bug>"        fix a bug WITHOUT burning a milestone phase
/astro-fix-accept <id>    human gate on a fix — confirm the bug is gone, then archive it
/astro-debt               review the debt register
/astro-debt-pay <id>      take one debt item on and land it
/astro-backlog             list the open backlog and stop
/astro-backlog "<idea>"    capture an idea (no phase or milestone spent)
/astro-backlog review      triage: offer each item promote / link / archive
/astro-backlog-promote <id> promote a backlog idea into a real phase
/astro-milestone          start the next milestone cycle
/astro-complete-milestone archive the finished milestone
/astro-decision           record an architectural decision into the canon
/astro-config             pick the model tier + reasoning depth per role
/astro-status             where am I, and what's next?
/astro-statusline         set a rich Claude Code statusline (milestone/phase track, context bar)
/astro-update             pull the latest astro-code and re-link it everywhere
/astro-help               short guide: the loop, the commands, and how to go fast
/astro-kit-new /astro-kit-convert /astro-kit-test /astro-kit-publish
```

On Codex, invoke the same commands as `$astro-plan 3`.

### CLI

`ac help` lists everything. The common ones:

```bash
ac init --name my-project --vision "what we're building"
ac status                      # project / milestone / phases
ac phase add "Foundation"      # claim + add a phase
ac phase check "<name>"        # is someone already building this?
ac phase accept <n>            # human gate — requires a prior `verified`
ac phase reject <n> --reason … [--agent name]  # UAT failed → rejected + a blocker (--agent: machine-signed)
ac phase surprise <n> [--healed n] [--remediation-cycles n] [--stopped-reason r] [--note "…"]  # execute records a run surprise
ac phase context <n> [--author]  # discuss-gate status, or who captured it: human | agent <name> | none
ac phase effort <n> deep       # per-phase verify→remediate budget (light|standard|deep)
ac phase note <n> "<text>"     # durable phase note (survives ROADMAP.md renders)
ac phase milestone <n> [<N>]   # read/correct a phase's milestone (never moves the project)
ac milestone new               # claim the next milestone number and start it
ac milestone new --planned     # declare a later milestone without starting it (--number N: repair)
ac milestone activate <n>      # move the project into a planned milestone
ac milestone complete          # archive the current milestone's phases (refuses over unfinished ones; --force)
ac milestone harvest [<n>] [--json]  # retrospective sweep material for the principle sweep

ac fix add "<what is broken>"  # open a bugfix (dated id, no phase number)
ac fix list                    # what is open
ac fix accept <id>             # human gate — archives it
ac fix accept <id> --agent <n> # machine-signed (ADR-033): records accepted_kind=agent

ac debt list [--stale]         # open technical debt (the verifier files it automatically)
ac debt score                  # pay-it-down-now signal, 0-100, with the evidence
ac debt pay <id> [--as phase] [--milestone N]  # graduate it into a fix (default) or a roadmap phase
ac debt drop <id> --reason "…" # it WAS true and stopped being true
ac debt dismiss <id> --reason … # it was NEVER true — the verifier was wrong

ac backlog add "<idea>"        # capture an idea (no file, no phase number spent)
ac backlog list                # open ideas, oldest first
ac backlog note <id> ["<text>"] # read/set/clear an item's note (the title stays fixed)
ac backlog link <id> --phase N # fold it into a phase already in flight
ac backlog promote <id>        # claim a phase number and seed CONTEXT.md from it
ac backlog archive <id> --kind declined|obsolete --reason "…" # file it WITHOUT doing it

ac principles add "<stmt>" --kind principle|pattern|preference|antipattern  # a personal note in ~/.astro/principles (--propose queues it)
ac principles list [--proposed|--accepted|--rejected|--all] [--json]  # the personal store (default: accepted)
ac principles show <id> [--json] # one entry — fields, source, promotions, history
ac principles accept <id> [--edit | --statement … [--why …]] # proposed → accepted (reword first)
ac principles reject <id> --reason … # proposed → rejected (kept, never deleted)
ac principles retire <id> --reason … # accepted → retired
ac principles supersede <id> --by <id> # accepted → superseded by a newer entry
ac principles amend <id> --reason … [--statement … | --edit] # reword/rescope, id unchanged
ac principles promote <id> [--as decision|convention] # accepted → this project's canon (personal copy stays)
ac principles remote [<url>]   # set (and sync) the store's private git remote, or print it
ac principles resolve <id> [--take mine|theirs] # clear an open sync conflict on one entry

ac models balanced             # per-role model tier + reasoning depth, in one switch
ac config set models.executor opus
ac stats                       # token usage (fresh vs cheap cache reads) + wall-clock
ac registry init|show          # the shared numbering registry
ac canon pull|push             # the shared conventions + decisions
ac decision add "<t>" --why …  # append an ADR-lite decision (shared)
ac agents-md                   # refresh the astro-code block in AGENTS.md
ac preflight                   # warn if HEAD diverged from upstream
ac tune                        # apply recommended Claude settings (additive, `--undo`able)
ac install | uninstall | update
```

---

## Layout and development

```
bin/ac.mjs   the CLI            commands/   slash commands (the loop)
lib/         engine (tested)    agents/     subagent roles
templates/   .astrocode/ seed   workflows/  Workflow scripts
```

```bash
npm test     # engine units + a real bare-remote registry/canon integration test
```
