---
description: Update astro-code to the latest version — git pull + reinstall the global CLI and commands
allowed-tools: Bash
---

Update the globally-installed astro-code.

1. Run `ac update`. It pulls the latest in your astro-code clone, refreshes the global
   `ac` binary if needed, and re-links the commands/agents into `~/.claude` and every
   jean-claude profile.
2. If it reports it can't find your clone, ask the user for the path and run
   `ac update <path-to-clone>` once — it remembers it for next time.
3. Report the new version. Tell the user to **restart Claude Code** if the slash-command
   list doesn't pick up new/renamed commands automatically.

This only updates the astro-code tooling itself — it never touches the user's project
or its `.astrocode/` state.
