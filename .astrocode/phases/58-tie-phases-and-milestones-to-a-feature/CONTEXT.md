<!-- astro-discuss: captured by agent: claude -->
# Phase 58 — Tie phases and milestones to a feature branch; the band shows only what belongs to the current branch

## Why
The phase band (astro-mods phase-band) lists every phase of the milestone, including other people's
(e.g. Alex's claims in Astrobot) and work living on other branches, so it no longer says clearly what
*I* have to do *here*. With git flow on, a phase/milestone should belong to a feature branch, and the
band on that branch should show only that work. Note: ADR-007 already maps milestone → `feature/m<N>`
via `ac flow`, but real projects use free-form feature names (Astrobot: `feature/v0-full-walk`), so the
tie must be stored explicitly, not inferred from the branch name.

Grounding: registry claims (origin/astro-registry `registry.json`) already carry `owner` (git email) and
`branch` per phase/milestone claim (lib/registry.mjs `claim`, identity from `transact`). The band reads
`ac status --json`, whose phase rows carry no owner/branch today. The band already knows the current
branch (phase 0.58.0 `⎇` banner, read from .git/HEAD).

## Decisions (owner, 2026-11-13)
1. **Linking = automatic + a command.** Discussing/planning/executing a phase while on a feature branch
   ties it (and, where natural, its milestone) to that branch automatically; `ac flow link <phase|m<N>>`
   and `ac flow unlink …` tie/move one by hand.
2. **Shared, in the registry.** The tie is stored with the phase/milestone claim in the team registry
   (reuse/extend the existing `branch` field), so teammates' bars and `ac status` see it.
3. **On a feature branch:** the band shows only the phases (and milestone meter/title/next buttons) tied
   to that branch — a milestone tied to the branch brings its phases. Everything else is hidden behind
   one dim line (e.g. `+12 elsewhere`).
4. **On develop/main, or a branch with nothing tied:** the band shows **only my open work** — phases
   claimed by me that are not complete, across milestones.
5. **Other people's phases:** never in my rows or next-step buttons; one dim count (e.g. `+3 by others`).
   `ac status` (full text) still lists everything.
6. **Who is me:** the repo's git `user.email` counts as me, plus a personal setting listing my other
   emails (aliases), so claims made under another email still count as mine. Personal = per user
   (e.g. ~/.astro/config.json), not committed to the project.
7. **Mine-only applies in every project**, git flow or not; the branch tie is the git-flow extra.

## Scope
In: tie storage in the registry + `ac flow link/unlink`; automatic tie on discuss/plan/execute while on a
feature branch; owner/branch (and a computed `mine` / `onBranch`) exposed in `ac status --json` phase
rows; identity + aliases setting; band filtering (rows, meter, title, buttons, autocomplete rows offered
by the band) with the dim `+N elsewhere` / `+N by others` lines; docs (MANUAL, flow help).
Out: changing `ac status` text output beyond adding owner/branch info; renaming/creating branches
automatically (ADR-009 keeps branching explicit); migrating historic claims (old claims with
branch `main`/`develop` simply count as untied).

## Assumptions / open for the planner
- A phase tied to a branch that was merged or deleted stays tied (history); it is complete by then in
  the normal flow. Plan states what the band does if the current branch is gone from the registry.
- The band must stay cheap: no extra `ac`/git process per render; any new data rides the existing
  `ac status --json` read at turn boundaries (ADR-071, phase 43 rules).
- When the registry is unreachable, the band falls back to today's full view rather than hiding work.
- Phase 57 runs in the same milestone concurrently: this phase must not depend on its changes.
