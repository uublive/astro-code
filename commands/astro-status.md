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
   new milestone.
