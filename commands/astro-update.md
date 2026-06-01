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

## How you know an update is waiting

You don't have to remember to check. `ac install` wires two passive notices into each
Claude config dir (reversed by `ac uninstall`):

- a **SessionStart banner** — at the start of a session, if your clone is behind its
  origin, Claude shows `astro-code update available: N commits behind … — run /astro-update`;
- a **statusline segment** — `⬆ astro-code N behind` appended to your existing statusline
  (it composes with the one you already run, e.g. GSD's, rather than replacing it).

Both read a cache refreshed in the background (a throttled `git fetch` + behind-count
against your clone's upstream), so startup is never blocked on the network. The first
session after installing just primes the cache; the banner appears from the next one on.
