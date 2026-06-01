---
description: Start the next milestone cycle — claims the next milestone number from the registry
argument-hint: [milestone theme]
allowed-tools: Bash, Read, Write, AskUserQuestion
---

Begin a new milestone.

1. Run `ac milestone new`. This **claims the next milestone number** from the
   orphan-branch registry (and auto-reserves its phase 1), collision-proof across
   the team. Report whether it was `[remote]` or `[local]`.
2. Update `.astrocode/PROJECT.md` with the new milestone's theme/goal (`$ARGUMENTS`
   if given; otherwise ask the user briefly).
3. Propose the milestone's phases and create them with `ac phase add "<name>"`.
4. Show `ac status` and suggest `/astro-plan <first phase>`.
