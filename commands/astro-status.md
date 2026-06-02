---
description: Show project status and recommend the next astro-code action
allowed-tools: Bash, Read
---

Show where the project stands and what to do next.

1. Run `ac status`. If there is no `.astrocode/`, tell the user to run
   `/astro-new-project`.
2. Run `ac registry show` if a remote is configured, to confirm team-coordinated
   numbering is live.
3. In one short paragraph, tell the user the single best next action — e.g. plan the
   first pending phase, execute a planned phase, verify a finished one, or start a
   new milestone. **Always reference a phase by its number** in any command you
   suggest (e.g. `/astro-plan 1`, `/astro-execute 3`), never by its name or slug.
4. If the active phase just hit a resting point (**verified** or **complete**) and the
   next action starts a new phase, add an optional one-liner: state is on disk, so
   `/clear` before the next phase keeps context lean and loses nothing. Skip this nudge
   mid-phase or when work is still in flight.
