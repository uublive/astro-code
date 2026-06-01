---
description: Add a phase to the roadmap — claims the next phase number from the shared registry
argument-hint: <phase name>
allowed-tools: Bash, Read
---

Add a new phase named `$ARGUMENTS` to the current milestone.

1. Run `ac phase add "$ARGUMENTS"`. This **claims the next free phase number** from
   the orphan-branch registry on `origin` — if another developer already took that
   number, you automatically get the next one.
2. Report the claimed number and whether it was `[registry: …]` (team-coordinated)
   or `[local]` (no remote — warn the user numbers may collide on merge).
3. Show `ac status` and suggest `/astro-plan <number>` next.

Do not hand-edit `.planning/ROADMAP.md` — it is generated. Numbering only happens
through `ac`, which is what keeps it collision-proof.
