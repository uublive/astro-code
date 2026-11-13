# Phase 58 — success criteria (pre-registered, plan-blind)

Goal: tie phases and milestones to a feature branch (stored in the shared registry claim, automatic on
discuss/plan/execute while on a feature branch, plus `ac flow link/unlink`); the phase band shows only
work tied to the current branch, and elsewhere only my open work, hiding other people's phases behind a
dim count; identity = git email plus personal aliases.

**Shared fixture (used by several criteria).** Under a scratch temp dir: one bare remote, two working
clones of a project initialised with astro-code (registry initialised on the remote, `gitflow.enabled`
on), clone A with `git config user.email me@example.test`, clone B with `alex@example.test`. One
milestone holds at least five phases: two claimed from A (one of them complete), two claimed from B,
plus one more claimed from A in a second milestone. Every `ac` call runs with `HOME` pointed at a
scratch dir, so the personal settings file is a scratch copy and the owner's real `~/.astro` is never
read or written. "The band" means the phase-band's render core (`mods/astro-mods/hooks/lib/band.js`)
fed exactly what `mods/astro-mods/hooks/features/phase-band.js` feeds it at a turn boundary: the
clone's `ac status --json` and the branch the clone is on. Where a step needs fresh registry data in a
clone, a `git fetch` or any `ac` registry read in that clone first is allowed.

### C1 [core] — `ac flow link` / `ac flow unlink` tie, move and untie a phase or milestone to the current feature branch, and the tie is shared through the registry
- **Observe:** in the fixture, clone A runs `git switch -c feature/alpha`, then `ac flow link <A's open phase>`; clone B (after fetching) runs `ac status --json` and its row for that phase reports branch `feature/alpha`. Clone A then switches to `feature/beta` and runs `ac flow link <same phase>`: B now sees `feature/beta` only. `ac flow link m<N>` on `feature/alpha` ties the milestone (B's status shows the milestone, or each of its phases, tied to `feature/alpha`). `ac flow unlink <phase>` makes B's row for that phase report no feature-branch tie. Each command exits 0 with a one-line confirmation. Rests on `bin/ac.mjs`, `lib/registry.mjs`, `lib/shared.mjs`, `lib/flow.mjs`, `lib/nextstep.mjs`.
- **Fails if:** the tie lives only in clone A (local state, not the registry claim), so clone B never sees it; a re-link leaves the phase tied to both branches or still to the old one; unlink leaves the tie in place; `m<N>` is rejected or ties nothing; or the registry write clobbers sibling files on the registry branch (canon, other claims).

### C2 [core] — Advancing a phase through discuss, plan or execute while on a feature branch ties it to that branch automatically; doing so on develop/main ties nothing and never overwrites an existing tie
- **Observe:** in the fixture, take the `ac` steps that `commands/astro-discuss.md`, `commands/astro-plan.md` and `commands/astro-execute.md` instruct the agent to run to record a phase as discussed, planned and executing. Run them in clone A on `feature/alpha` for an untied phase (one phase per command): afterwards clone B's `ac status --json` reports each of them tied to `feature/alpha` without any `ac flow link` call. Run the same steps in clone A on `develop` for a phase already tied to `feature/alpha`: it stays tied to `feature/alpha`; for an untied phase on `develop` it stays untied.
- **Fails if:** a tie only ever appears via `ac flow link`; any one of discuss, plan or execute does not tie; working on `develop` or `main` records `develop`/`main` as the phase's feature tie or replaces an existing feature tie; or the auto-tie creates or switches git branches (ADR-009 keeps branching explicit).

### C3 [core] — `ac status --json` phase rows expose each phase's owner and branch tie, plus whether it is mine and whether it is tied to the current branch
- **Observe:** in the fixture, with clone A on `feature/alpha` and one of A's and one of B's phases tied to `feature/alpha`, run `ac status --json` in clone A and inspect `phases[]`: every claimed phase row carries its owner and its tied branch (none for an untied phase); A's phases read as mine and B's do not; the two `feature/alpha` phases read as on the current branch and the rest do not. Switch clone A to `develop` and re-run: no phase reads as on the current branch, and a phase whose historic claim branch is `develop` or `main` reads as untied. Rests on `lib/nextstep.mjs`, `bin/ac.mjs`.
- **Fails if:** owner or tie is missing for teammates' phases; "mine" is computed from a display name or a shortened tag rather than the claim's email; "on branch" is true for every row, ignores the current branch, or treats a historic `develop`/`main` claim branch as a feature tie; or `ac status --json` starts doing a network fetch per call (it must stay the offline read the band relies on).

### C4 [core] — Identity is the repo's git `user.email` plus personal aliases kept per user outside the project
- **Observe:** in the fixture, claim one phase from a third working copy whose `user.email` is `me-old@example.test`. In clone A, `ac status --json` reports it as not mine. Add `me-old@example.test` as a personal alias the way MANUAL documents (a command or the per-user settings file under the scratch `HOME`), re-run: it now reads as mine, and the band (C6 setup) lists it among my rows. `git -C <clone A> status --porcelain` shows no change caused by adding the alias. Remove the alias: it reads as not mine again. Changing clone A's `user.email` to `alex@example.test` flips B's phases to mine. Rests on `lib/nextstep.mjs`, `bin/ac.mjs`.
- **Fails if:** aliases are read from or written to anything committed in the project (`.astrocode/` or another tracked file); an alias has no effect; the alias list replaces the git email instead of adding to it; or identity ignores the repo's `user.email` (e.g. reads only a global or hard-coded value).

### C5 [core] — On a feature branch with work tied to it, the band shows only that work, and everything else behind one dim `+N elsewhere` line
- **Observe:** in the fixture, clone A on `feature/alpha` with two phases of the first milestone tied to it, plus the second milestone tied to it via `ac flow link m<N>` (which brings that milestone's phases). Render the band: its roadmap rows, meter count, milestone title and next-step buttons name only phases tied to `feature/alpha` (including the tied milestone's phases); no untied phase and no teammate phase appears in any row or button; one dim line reports the count of hidden phases (e.g. `+N elsewhere`), and N equals the number of phases in the roadmap the band would otherwise track minus those shown. Rests on `mods/astro-mods/hooks/lib/band.js`, `mods/astro-mods/hooks/features/phase-band.js`, `lib/nextstep.mjs`.
- **Fails if:** an untied or other-branch phase appears as a chip or a button; the meter still counts the whole milestone; a tied milestone's phases are not shown; the hidden-count line is missing, wrong, or repeated per phase; or a next-step button points at a phase not tied to the branch.

### C6 [core] — On develop/main, or on a branch nothing is tied to, the band shows only my open work across milestones, and other people's phases only as a dim `+N by others` count
- **Observe:** in the fixture, render the band for clone A on `develop`, then on `main`, then on a fresh `feature/empty` with nothing tied. Each time the rows and next-step buttons list exactly A's claimed phases that are not complete — the open one in the first milestone and the one in the second milestone — and none of B's; one dim line counts B's hidden phases (e.g. `+2 by others`). Include one B phase whose historic claim branch is `develop`: it still does not show on `develop`. Repeat with `gitflow.enabled` off: the same mine-only view. Rests on `mods/astro-mods/hooks/lib/band.js`, `mods/astro-mods/hooks/features/phase-band.js`, `lib/nextstep.mjs`.
- **Fails if:** a teammate's phase appears in rows or buttons (the Alex-in-Astrobot pollution the goal exists to remove); my phase in another milestone is missing; a complete phase of mine is still listed as work; the `by others` count is missing or wrong; a historic `develop` claim makes everything claimed on develop show as "tied"; or mine-only only applies when git flow is enabled.

### C7 [core] — When ownership cannot be known, the band falls back to the full view instead of hiding work
- **Observe:** in a fixture clone whose registry data is unavailable to the offline read (registry never fetched, origin removed, or remote unreachable), render the band on a feature branch and on `develop`: every phase the band tracked before this phase still appears, and no `+N elsewhere` / `+N by others` line hides anything. Separately, with the registry readable but clone A on a branch that has been deleted on the remote, the band still renders (mine-only view) without an error row. Rests on `mods/astro-mods/hooks/lib/band.js`, `mods/astro-mods/hooks/features/phase-band.js`, `lib/nextstep.mjs`.
- **Fails if:** missing registry data reads as "nothing is mine" and empties the band, or hides phases behind a count; or the band errors or shows `status unavailable` merely because the registry or the branch is gone.

### C8 [core] — `ac status` (text) still lists every phase, other people's included
- **Observe:** in the fixture clone A on `feature/alpha` with ties as in C5, run `ac status` (no `--json`): every phase of the milestone, B's included, is listed, as it was before the phase; owner/branch information may be added. Rests on `bin/ac.mjs`.
- **Fails if:** the text status applies the band's branch or mine-only filtering and drops any phase.

### C9 [edge] — The band stays cheap: rendering it starts no extra `ac` or git process
- **Observe:** compare `mods/astro-mods/hooks/features/phase-band.js` at the phase's base commit and at HEAD (`git diff <base> HEAD -- mods/astro-mods/hooks/`): the set of processes the band spawns per render or per turn boundary is unchanged (the branch, owner and tie data arrive through the existing `ac status --json` read and the existing `.git/HEAD` read); and the plugin's own band tests still pass.
- **Fails if:** a new `ac`, `git` or other process (e.g. `git config user.email`, `ac registry …`, a fetch) is added to the band's render or turn-boundary path.

### C10 [edge] — The user-facing docs explain linking, the band's filtering and aliases
- **Observe:** run `ac flow` help (e.g. `node bin/ac.mjs flow --help` or `node bin/ac.mjs help flow`): it lists `link` and `unlink` with their argument forms (`<phase>` and `m<N>`). Read `MANUAL.md`: it explains the automatic tie on discuss/plan/execute, what the band shows on a feature branch versus elsewhere (including the dim counts), and how to set personal email aliases. Following the MANUAL's alias instruction literally in the C4 fixture produces the C4 result.
- **Fails if:** link/unlink are missing from the flow help, the MANUAL does not explain the band's filtering or the alias setting, or the documented alias instruction does not work.

### C11 [suite] [core] — The full test suite passes
- **Observe:** `npm test` (runs `node scripts/test.mjs`) exits 0 with no failing test, on the phase's final commit.
- **Fails if:** any test fails, including the registry contract suite (two working copies against a real bare remote) or existing band/status tests broken by the new fields or filtering.
