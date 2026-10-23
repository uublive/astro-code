---
description: Check that the astro-code install and its hooks are consistent — one line per problem, each ending with its fix
allowed-tools: Bash
---

Report whether this machine's astro-code install is consistent. The checks live in `ac doctor`
and nowhere else; this command only runs it and relays what it printed.

1. Run `ac doctor`. Run `ac doctor --json` as well only when the user asks for a bug-report
   shape.
2. If it printed a single `✓` line, relay that line **only** and say **nothing** more — a
   clean install is not news.
3. Otherwise list each `⚠` line exactly as printed, **one line per problem**, each keeping the
   fix it ends with, and add nothing else. Point to `ac doctor --json` for a bug report.
4. Never run a fix unasked: the doctor is report-only. Offer the printed command and let the
   user decide.
