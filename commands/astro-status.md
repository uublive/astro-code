---
description: Show project status and recommend the next astro-code action
allowed-tools: Bash, Read
---

Show where the project stands and what to do next.

1. Run `ac status`. If there is no `.astrocode/`, tell the user to run
   `/astro-new-project`.
2. Run `ac registry show` if a remote is configured, to confirm team-coordinated
   numbering is live.
3. In one short paragraph, tell the user the single best next action — e.g. discuss or
   plan the first pending phase, execute a planned phase, verify a finished one, or
   start a new milestone. For a pending, unplanned phase, the status line shows its
   discuss state: **`undiscussed` → suggest `/astro-discuss <n>` first** (mention that a
   trivial phase can skip straight to `/astro-plan <n>`); `discussed` → suggest
   `/astro-plan <n>`. **Always reference a phase by its number** in any command you
   suggest (e.g. `/astro-discuss 1`, `/astro-execute 3`), never by its name or slug.
3b. **Keep the pipeline fed (ADR-032).** If the phase you are about to suggest executing
   has a successor that is still `undiscussed`, suggest `/astro-discuss <next>` FIRST.
   `/astro-execute` plans the next phase concurrently with the current one's execution —
   but only if that phase is already discussed, so under the naive
   discuss→plan→execute→accept order the gate never passes and the saving is never
   realised. One extra discuss up front turns it on.

4. If the active phase just hit a resting point (**verified** or **complete**) and the
   next action starts a new phase, add an optional one-liner: state is on disk, so
   `/clear` before the next phase keeps context lean and loses nothing. Skip this nudge
   mid-phase or when work is still in flight.
