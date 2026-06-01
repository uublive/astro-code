---
description: Start the next milestone cycle — claims the next milestone number from the registry
argument-hint: [milestone theme]
allowed-tools: Bash, Read, Write, AskUserQuestion
---

Begin a new milestone.

1. If a theme/name is given (`$ARGUMENTS`), first `ac milestone check "$ARGUMENTS"`.
   If another developer already has a milestone with a similar name, surface it and
   use `AskUserQuestion` (proceed / rename / coordinate) before continuing.
2. Run `ac milestone new --name "<theme>"`. This **claims the next milestone number**
   from the orphan-branch registry (and auto-reserves its phase 1), collision-proof
   across the team, and records the name. Report `[remote]` or `[local]` and relay any
   `⚠ possible duplicate work` warning.
3. Update `.astrocode/PROJECT.md` with the new milestone's theme/goal (`$ARGUMENTS`
   if given; otherwise ask the user briefly).
4. Propose the milestone's phases and create them with `ac phase add "<name>"` (each
   add runs its own duplicate-name check).
5. Show `ac status` and suggest `/astro-plan <first phase>`.
