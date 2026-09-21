<!-- astro-discuss: captured -->

# Phase 20 — Backlog: capture ideas without planning them

## Goal

A place to write down an idea or task you are not ready to plan, which can later be
promoted into a phase, folded into one being planned, or archived **with its reason
intact** so a future "let's plan X" can be answered with "you already decided against
that, here's why".

## Why a separate object, not a debt status (decided, architectural)

`ac debt score` measures what debt **charges** you — recurrence and concentration —
against principal. A backlog item has no `file` and no recurrence, so every one added
would read as pure principal and push the score *down*. Putting ideas in the debt
register corrupts the one number in the system that currently carries signal.

Secondary: `drop`/`dismiss` do not map to ideas (an idea was never "not true"), and debt's
integrity claim is that the verifier files it — human wishes would break that.

This is recorded in the canon, not only here.

## Decisions

### D1 — The drain: link at discuss, close at accept

An item leaves the list the same way debt does. `/astro-discuss` offers to link related
open items to the phase; a linked item closes automatically when `/astro-accept` closes
that phase, with status `absorbed`.

Mirrors `payDebt` (`paid_by: {kind, workRef}`) and `closeDebtFor(root, {kind, workRef})`
in `lib/debt.mjs` — the mechanism already exists and should be reused, not reinvented.

**Rejected:** asking "did this address any of these?" after every acceptance (a prompt on
every accept is a prompt people learn to dismiss); manual archiving only (this is exactly
the diary-that-rots the README warns about, citing `todo.md`).

**This is the anti-rot mechanism and must be in CRITERIA.** A capture command with no
automatic outflow is a `todo.md` with extra steps. It is also the easiest part to quietly
drop under time pressure — it must not be a nice-to-have.

### D2 — Promotion seeds CONTEXT.md, WITHOUT the provenance marker

`ac backlog promote <id>` claims a phase number and writes the item's captured text into
the new phase's `CONTEXT.md` — deliberately **without** the
`<!-- astro-discuss: captured -->` marker.

So the thinking survives to the moment it is useful, and `phaseContextStatus` reads the
file as **`stub`**, meaning `/astro-plan` still demands a real discuss round. Writing the
marker would make a promoted item silently satisfy the discuss gate — precisely the
seeded-placeholder failure mode `phaseContextStatus` exists to catch
(see `tests/planning.test.mjs`).

**Rejected:** title only (loses the captured reasoning at the moment it becomes useful);
seed + marker (defeats the discuss gate).

### D3 — Promotion targets a phase only, never a fix

An idea is not a bug. The fix lifecycle depends on a reproduction case, which a backlog
item by definition does not have; routing one through it would produce a "bugfix" with no
reproduction — the one thing `/astro-fix` must never contain. Something in the backlog that
turns out to be broken behaviour goes to `/astro-fix` directly.

Deliberately **asymmetric** with `ac debt pay --as fix|phase`. Drops a flag, a code path and
its tests.

### D4 — Archiving takes a kind AND a reason

```
ac backlog archive <id> --kind declined|obsolete --reason "…"
```

- `declined` — we decided not to do this. **Only this kind arms the D5 warning**, because
  "this stopped being relevant" is not an argument against a fresh idea.
- `obsolete` — the world moved on.
- `absorbed` — never typed by a human; set by the D1 drain.

The distinction is the whole value, exactly as `drop` vs `dismiss` is for debt. A reason is
**required** on both kinds: an archived item with no reason answers "we didn't do it" but
not "why", and the second is the entire point of keeping the history.

### D5 — Duplicate detection fires at capture *and* at `ac phase add`

- `/astro-backlog "<idea>"` → warns on similar **open** items.
- `ac phase add "<name>"` → warns when a similar item was archived as **`declined`**.

Reuses `findNameMatches` (`lib/registry.mjs`), already used by `ac phase check` /
`warnNameMatches`.

**Posture, per D6:** the CLI **warns and proceeds** — consistent with how
`warnNameMatches` already treats registry name collisions, and it never blocks a script.
`/astro-phase` additionally raises an `AskUserQuestion`: proceed / show me what I wrote /
stop. Richer where a human is present, non-blocking where one is not.

**Rejected:** blocking `ac phase add` without `--force` (first hard refusal in the phase
path, and it would fire on false name matches too).

## Scope

**In:**
- `lib/backlog.mjs` — mirrors `lib/debt.mjs`/`lib/fixes.mjs`. Reuse `datedId` from
  `fixes.mjs` (already generic, takes a `fallback`).
- `.astrocode/backlog.json` — a local committed file beside `debt.json`/`fixes.json`.
  **No registry involvement**: backlog items claim no number. A number is claimed at
  promotion, by the existing `ac phase add` path.
- CLI: `ac backlog add|list|promote|archive` (+ `show` if it falls out cheaply).
- Slash: `/astro-backlog "<idea>"` (capture) · `/astro-backlog` no-arg (review: list, flag
  stale, promote/archive inline) · `/astro-backlog-promote <id>`. Two command files, same
  count as debt.
- `/astro-discuss` — the fold-in offer (D1). Place it **after** the existing debt prompt so
  the phase's own questions still lead.
- `/astro-accept` — the drain (D1).
- `ac phase add` + `/astro-phase` — the declined-match warning (D5).
- `ac status` — a `Backlog: N open` line, matching the existing `Debt:` line.

**Folded-in debt (in scope):**
- `2026-09-17-ac-phase-add-and-ac-phase-note-strip` (`lib/roadmap.mjs`, small) —
  `ac phase add` and `ac phase note` strip the `planned` flag from every line of
  ROADMAP.md. Promotion calls `addPhase`, so this phase is already in that file.

**Out:**
- **No priority field.** Every backlog grows one and every one becomes meaningless. If
  ordering is wanted later, bump an existing item when a similar idea is re-added —
  earned recurrence, like debt, never self-reported priority.
- **No statusline segment.** A backlog count is never actionable. `debt nn` earns its slot
  by appearing only outside the healthy band; backlog has no such threshold.
- **No score.** Nothing to weigh — there is no principal and no recurrence.
- **No registry/orphan-branch storage.** Nothing to collide on.
- Bodies longer than a short paragraph. If you are writing a plan, it is a phase.

## Open questions for the planner

1. **A linked item when its phase is REJECTED, not accepted.** `closeDebtFor` only fires on
   acceptance, so a linked item would sit in `linked` indefinitely. It should revert to
   `open` on `ac phase reject` — confirm and cover it.
2. **Item text → CONTEXT.md format (D2).** The seeded file must be recognisable as a
   promoted stub and must not look like a real discuss capture. State the shape in the plan.
3. **`ac backlog list` ordering.** Oldest-first like `ac fix list`, or by staleness. Debt's
   `STALE_DAYS = 30` is the precedent for flagging, not for ordering.

## Assumptions

- Team visibility comes from git (the file is committed), like `debt.json` and `fixes.json`.
  No cross-branch immediacy is promised.
- `findNameMatches` similarity is good enough for D5; no new matching algorithm.
