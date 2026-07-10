---
description: Set a rich Claude Code statusline — task recap, model, context-fill bar, milestone/phase
allowed-tools: Bash
---

Wire up (or refresh) astro-code's rich statusline for this machine, then show the user a preview.

1. Run `ac statusline install`. This deploys the latest statusline hook to
   `~/.astro/code/hooks`, points each Claude config dir's `statusLine` at it, and
   wires two tiny turn-boundary hooks (`UserPromptSubmit`/`Stop`) that drive the
   busy/idle dot. It **composes** with any statusline you already run (that one
   keeps its place) rather than clobbering it, and it's safe to re-run any time.
2. Run `ac statusline preview` and show the user the rendered line verbatim (add
   `--idle` to show the idle variant).
3. Explain each segment, in order:
   - **● / ○ status dot** — the leading char: a solid green **●** while a turn is
     in flight (Claude is working), a hollow dim **○** when idle/waiting for you
   - **❯ recap** — the task in flight (your last request, squished to one line)
   - **model** — the running model (e.g. `Opus 4.8`)
   - **context bar** — how full the context window is: a graphical `█░` bar +
     percent + `tokens/limit`, coloured green→yellow→red as it fills (the 1M-context
     Opus variant is detected from its `[1m]` id; everything else is the 200k window)
   - **⊡ astro** — current milestone `M<n>` and phase `P<n> <name>` with its
     lifecycle status (or live activity verb), phase progress `done/total`, and any `⚠blockers`
   - **⎇ branch** — current git branch · **$cost** — session spend so far
4. Tell the user the line takes effect on the **next** statusline repaint (a
   keystroke or the next turn), but the busy/idle **dot** only starts toggling once
   Claude Code reloads `settings.json` — i.e. **restart Claude Code** (or start a
   new session) after the first install so the turn-boundary hooks are live.

If `ac` isn't found, the framework isn't installed — point the user at the astro-code
install (`ac install`, or `/astro-update` to refresh an existing checkout).
