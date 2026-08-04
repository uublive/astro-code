---
description: Short guide to astro-code — the loop, the commands, and how to go fast
allowed-tools: Bash
---

Print a concise guide to astro-code. Keep it scannable — this is a reference, not a
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
- `/astro-alex "<long unplanned prompt>"` — captures the raw prompt verbatim, distills a
  lean traceable spec (+ a "to clarify" list so nothing is lost), then executes straight
  through — sequential atomic commits + one verify pass, no research/plan fan-out.
  Executor defaults to Opus (`--model sonnet|haiku` to override); a **scope guard**
  escalates anything systemic back to the full loop. Verified at best — `/astro-accept` closes it.

**Set up & navigate:**
- `/astro-new-project` — scaffold a new project · `/astro-adopt` — adopt an existing codebase
- `/astro-new-kit` — start a new Astro kit (standalone kit project: manifest v4 + recipe + build tooling)
- `/astro-phase <name>` — add a phase · `/astro-milestone` — start the next milestone
- `/astro-status` — where am I, what's next · `/astro-decision` — record an ADR into the canon
- `/astro-statusline` — set a rich statusline (busy/idle dot · task recap · model · context-fill bar · milestone/phase)

**Go faster** (the speed switch — opus→sonnet ladder, no haiku):
- `ac models fast` — persist the fast profile (sonnet everywhere except the opus verify gate)
- `ac models balanced` (default) · `ac models max` (all opus) · `ac models` (show current)
- one-off without persisting: `/astro-plan <n> --fast` or `/astro-execute <n> --fast`
- `/astro-config` — pick tiers interactively
- resilience for long runs: launch with `claude --fallback-model sonnet`

**The engine (CLI)** — run `ac help` for the full list. Common:
`ac status` · `ac models [profile]` · `ac registry show` · `ac flow` (opt-in GitFlow) · `ac stats` (token usage)

**Two gates close a phase:** the AI verifier (goal-backward + full test suite) marks it
*verified*; only human `/astro-accept` marks it *complete*. The AI never closes its own work.

More: `README.md` (overview) and `ARCHITECTURE.md` (design rationale) in the repo.
