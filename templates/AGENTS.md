## astro-code

This project is driven by [astro-code](https://github.com/uublive/astro-code): work is
organised into **milestones** containing numbered **phases**, each carried through a
`discuss → plan → execute → verify → accept` loop. State lives in plain files under
`.astrocode/`, so it is readable, diffable and reviewable like any other code.

**Orient yourself before doing anything:** run `ac status`. It prints the current
milestone, the current phase, its lifecycle state, and the recommended next command.
Deliberately not duplicated here — this file would go stale within a day, and a stale
map is worse than no map.

### The loop

| Step | What it produces |
|---|---|
| `discuss <phase>` | `CONTEXT.md` — decisions and edge cases settled *before* planning |
| `plan <phase>` | `PLAN.md` — dependency-aware tasks, from parallel research |
| `execute <phase>` | the actual change, wave by wave, one commit per task |
| `verify <phase>` | an adversarial check that the phase's **goal** was met |
| `accept <phase>` | human sign-off; only this marks a phase `complete` |

Phase lifecycle: `pending → executing → verified → complete` (plus `rejected`).
`verified` means the AI checked it. `complete` means a human accepted it. They are
different claims and must not be conflated.

### Rules that matter

- **Never hand-edit `.astrocode/roadmap.json`, `state.json`, or the registry.** Phase and
  milestone numbers come from a shared registry on an orphan git branch so that two
  developers can never claim the same number. Editing the files directly desynchronises
  that and the corruption surfaces later, in someone else's branch.
- **`ROADMAP.md` is generated** from `roadmap.json`. Edits to it are overwritten.
- **Read `CONVENTIONS.md` and `DECISIONS.md` before proposing an approach.** They are the
  project's canon: conventions are binding, decisions record what was already settled and
  why. Re-litigating a recorded decision wastes the work that produced it.
- **One task, one commit.** Executors commit atomically so a failed task can be re-run
  without unpicking someone else's work.
- **A phase's goal is the bar, not its task list.** Every task passing while the goal is
  unmet is a failed phase.

### Invoking the commands

astro-code publishes the same commands to whichever agent harness you are running. The
invocation differs by host:

| Host | Invocation |
|---|---|
| Claude Code | `/astro-status`, `/astro-plan 3` |
| Codex CLI | `$astro-status`, `$astro-plan 3` — Codex has **no** custom slash commands |
| any host | the `ac` CLI directly: `ac status`, `ac phase add "<name>"` |

`ac help` lists the whole CLI surface.
