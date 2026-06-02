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
   from the orphan-branch registry (monotonically — a completed milestone's number is
   never reused), collision-proof across the team, and records the name. Relay any
   `⚠ possible duplicate work` warning. If it errors with `run `ac registry init``,
   the orphan registry branch hasn't been created yet — run `ac registry init` (it
   needs an `origin` remote and backfills numbering from existing roadmaps), then retry.
3. Update `.astrocode/PROJECT.md` with the new milestone's theme/goal (`$ARGUMENTS`
   if given; otherwise ask the user briefly).
4. Propose the milestone's phases and create them with `ac phase add "<name>"` (each
   add runs its own duplicate-name check).
5. Show `ac status` and suggest `/astro-plan <number>` for the first phase — always
   reference a phase by its **number** (e.g. `/astro-plan 1`), never its name.
