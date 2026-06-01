---
description: Add a phase to the roadmap — checks for duplicate work, then claims the next phase number
argument-hint: <phase name>
allowed-tools: Bash, Read, AskUserQuestion
---

Add a new phase named `$ARGUMENTS` to the current milestone.

1. **Check for duplicate work first:** `ac phase check "$ARGUMENTS"`. If it reports a
   phase with the same/similar name claimed by **another developer**, surface it and
   use `AskUserQuestion` to let the user choose: proceed anyway, rename, or stop and
   coordinate with that dev. (A match by *you* is just informational.)
2. Run `ac phase add "<final name>"`. This **claims the next free phase number** from
   the orphan-branch registry — if another dev took that number you automatically get
   the next one — and records the name so future duplicate checks work. If it prints a
   `⚠ possible duplicate work` warning, relay it.
3. Note whether it was `[registry: …]` (team-coordinated) or `[local]` (no remote —
   numbers/names aren't shared).
4. Show `ac status` and suggest `/astro-plan <number>` next.

Don't hand-edit `.astrocode/ROADMAP.md` — it's generated. Numbering and name tracking
only work through `ac`.
