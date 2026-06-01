---
description: Close the current milestone — archive its phases and retire its registry numbers
allowed-tools: Bash, Read
---

Complete and archive the current milestone.

1. Confirm the milestone is truly done — every phase should be **complete**
   (verified by `/astro-verify` AND accepted by `/astro-accept`). List any phase that
   isn't `complete` and stop.
2. Run `ac milestone complete`. This:
   - moves the milestone's phase directories to `.astrocode/milestones/<n>/`,
   - snapshots the roadmap,
   - clears the active roadmap for the next cycle,
   - and flips this milestone's claims to `complete` in the shared registry (so the
     numbers are visibly retired for the whole team).
3. Report what was archived and where.
4. Suggest `/astro-milestone` to start the next cycle.
