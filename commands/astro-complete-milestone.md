---
description: Close the current milestone — archive its phases and retire its registry numbers
allowed-tools: Bash, Read, AskUserQuestion
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
4. **Triage stale debt.** Run `ac debt list --stale`. Milestone close is the natural beat
   for this: you are already stepping back from the work, and an item nobody has touched
   in a month is either worth planning into the next cycle or is no longer true.

   For each stale item ask **once**, with `AskUserQuestion`, which exit it takes:
   - **Pay it now** → `ac debt pay <id> --as phase` puts it on the new milestone's roadmap
     (or `--as fix` if it is bug-shaped — a refactor routed through the fix loop would be
     a "bugfix" with no reproduction case);
   - **Drop it** → `ac debt drop <id> --reason "…"`, a reason is required;
   - **Keep it open** → leave it; it will surface again next milestone.

   Batch the questions rather than asking per item, and skip this step in silence when
   nothing is stale. Never pay or drop on the user's behalf — a register that empties
   itself is back to being a list nobody trusts.
5. Suggest `/astro-milestone` to start the next cycle.
