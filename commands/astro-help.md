---
description: Short guide to astro-code — the loop, the commands, and how to go fast
allowed-tools: Bash
---

Start with the astro-code mark: run `ac logo` and show its output verbatim inside a
```text fenced block (it is plain text here — do not add colour or alter the art).

Then print a concise guide to astro-code. Keep it scannable — this is a reference, not a
tutorial. If the user passed a term in `$ARGUMENTS`, focus the guide on that (e.g.
`speed`, `models`, `autonomous`, `milestone`) instead of printing everything.

First, if there's a `.astrocode/` here, run `ac status` once and show a one-line "you are
here" up top (project · milestone · phase · next action). If there's no `.astrocode/`,
say so and point at `/astro-new-project` (or `/astro-adopt` for an existing codebase).

Then print this guide (trim sections that don't apply):

---

**astro-code** — a `discuss → plan → execute → verify` loop over milestones and phases,
kept as plain files in `.astrocode/`. Numbering + canon are shared via git so multiple
devs never collide.

**The loop (per phase):**
- `/astro-discuss <n>` — talk through decisions/edge cases → `CONTEXT.md` (optional; skip trivial phases)
- `/astro-plan <n>` — parallel research → `PLAN.md` (reads CONTEXT.md)
- `/astro-execute <n>` — wave-based execution, then the AI verify gate
- `/astro-accept <n>` — human UAT sign-off; this is what actually closes a phase
- `/astro-autonomous <n>` — runs discuss→plan→execute in one go, then **stops** for you (still need `/astro-accept`)

**Fast lane for off-the-cuff work:**
- `/astro-fast "<long unplanned prompt>"` — captures the raw prompt verbatim, distills a
  lean traceable spec (+ a "to clarify" list so nothing is lost), then executes straight
  through — sequential atomic commits + one verify pass, no research/plan fan-out.
  Executor defaults to Opus (`--model sonnet` to override); a **scope guard**
  escalates anything systemic back to the full loop. Verified at best — `/astro-accept` closes it.

**Capture without planning:**
- `/astro-backlog` — list what's parked · `/astro-backlog "<idea>"` — file one, no phase spent · `/astro-backlog review` — triage each one (promote/link/archive)
- `/astro-backlog-promote <id>` — turn a captured idea into a real phase, seeding its captured note into `CONTEXT.md`
- `/astro-review` — walk the proposed personal principles in batches (accept / edit / reject / skip, merge duplicates)
- `/astro-mine` — sweep this project's past sessions for principles you kept stating (on demand, never automatic)
- `/astro-forge-import` — bring principles over from a connected forge server (writes an export file, then runs `ac principles import --from-forge`)

**Set up & navigate:**
- `/astro-new-project` — scaffold a new project · `/astro-adopt` — adopt an existing codebase; both give an app-shaped project a one-command container contract (`docker compose up` → healthy, seeded app) and leave `RUN-CONTRACT.md` behind
- `/astro-kit-new` — start a new Astro kit (standalone kit project: manifest v4 + recipe + build tooling)
- `/astro-kit-publish` — publish a kit to a hosted Astro instance (zip with `kit.json` inside → the instance's kit registry)
- `/astro-kit-convert <source path>` — convert an existing non-kit implementation into a standard Astro kit at verified feature parity with the original
- `/astro-phase <name>` — add a phase · `/astro-milestone` — start the next milestone
- `/astro-status` — where am I, what's next · `/astro-decision` — record an ADR into the canon
- `/astro-statusline` — set a rich statusline (busy/idle dot · task recap · model · context-fill bar · milestone/phase)

**Go faster** (the speed switch — an opus→sonnet ladder; no role runs haiku, ADR-035):
- `ac models fast` — persist the fast profile (sonnet everywhere except the opus verify gate)
- `ac models balanced` (default) · `ac models max` (all opus) · `ac models` (show current)
- one-off without persisting: `/astro-plan <n> --fast` or `/astro-execute <n> --fast`
- `/astro-config` — pick tiers interactively
- resilience for long runs: launch with `claude --fallback-model sonnet`

**The engine (CLI)** — run `ac help` for the full list. Common:
`ac status` · `ac models [profile]` · `ac registry show` · `ac flow` (opt-in GitFlow) · `ac stats` (token usage)

**Two gates close a phase:** the AI verifier (goal-backward + full test suite) marks it
*verified*; only human `/astro-accept` marks it *complete*. The AI never closes its own work.

More: `MANUAL.md` (the full reference), `README.md` (5-minute overview) and
`ARCHITECTURE.md` (design rationale) in the repo.
