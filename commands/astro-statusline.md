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
   - **ctx** — how full the context window is, drawn like the quota windows:
     `ctx █░░░░ 13%`, on the same green→yellow→red ramp. On a narrow line the bar goes
     first (`ctx 13%`). Current models have a 1M window; Haiku and legacy models 200k
   - **rate-limit quota** — how much of your subscription's rolling **5h** and
     **7d** windows is spent (`5h ██░░░ 23% · 7d ███░░ 41%`), plus a gateway-only
     **spend cap** (`cap`) when present. Shown whenever Claude sends the data —
     never threshold-gated, since a quota bar you only see once it's alarming
     can't answer "do I have room for this?". Coloured on the same green→yellow→red
     ramp as the context bar (yellow at 60%, red at 85%); a window at or past red
     also appends its time-to-reset (`·2h12m`). Past 100% the bar stops while the
     percentage keeps climbing — that's the spend cap blowing its budget, not a bug.
     On a narrow line the bars go first, then the coolest window, so what survives
     is whichever is actually about to stop you.
   - **cache** — the prompt cache (Claude Code 2.1.280+): `cache 96% →14:52` is the
     session hit ratio and the clock time the cache goes cold if you stay idle;
     `cache cold ·184k` means it already expired and the next turn re-writes that many
     tokens. For five minutes after a miss it adds the cause (`miss: tools +3/-0`,
     `miss: model`, `miss: idle >5m`), so switching model, effort, fast mode or MCP
     tools shows up as what broke the cache. On a typical-width line it carries one
     fact (a fresh miss, else cold, else the deadline), and it is dropped from the line
     before it would force a second row. Absent until the first API request.
   - **⊡** — current version, milestone `M<n>` and phase `P<n> <name>` with its
     lifecycle status (or live activity verb), phase progress `done/total`, and any `⚠blockers`
   - **debt nn** — technical-debt pressure (0–100), shown **only** once debt is actually
     costing you: yellow at 25+ (`watch`, something is concentrating), red at 50+
     (`pay-now`). It is not a count — filing more debt pushes it *down* — so the
     segment appearing at all is the signal. `/astro-debt` explains the number.
   - **⎇ branch** — current git branch
4. Tell the user the line takes effect on the **next** statusline repaint (a
   keystroke or the next turn), but the busy/idle **dot** only starts toggling once
   Claude Code reloads `settings.json` — i.e. **restart Claude Code** (or start a
   new session) after the first install so the turn-boundary hooks are live.

If `ac` isn't found, the framework isn't installed — point the user at the astro-code
install (`ac install`, or `/astro-update` to refresh an existing checkout).
