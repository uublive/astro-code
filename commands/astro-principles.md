---
description: List and browse your personal principles — accepted by default, or proposed, rejected, all, one entry, or a search
argument-hint: "[proposed | accepted | rejected | all | <id> | <question>]"
allowed-tools: Bash
---

Show the user their personal principle store (`~/.astro/principles`, ADR-057). This
command only READS: it never accepts, rejects, edits or proposes anything — reviewing the
queue is `/astro-principles-review`, sweeping past sessions is `/astro-principles-mine`.

## Steps

1. **Pick the view from `$ARGUMENTS`** (trimmed, case-insensitive):
   - empty or `accepted` → `ac principles list`
   - `proposed` → `ac principles list --proposed`
   - `rejected` → `ac principles list --rejected`
   - `all` → `ac principles list --all`
   - something that resolves as an entry id or a unique id prefix (it starts with a date,
     e.g. `2026-09-24-…`) → `ac principles show <id>`
   - anything else is a question → `ac principles ask "<the arguments>"`

2. **Show the output as it is.** Relay the command's own output verbatim in a code block —
   it is already one line per entry (or the full entry for `show`). Never re-summarise it,
   re-rank it or drop entries from it.

3. **Point at the next step, in at most one line**, and only when it applies:
   - the list view showed proposed entries waiting (`N proposed awaiting review`, or the
     `proposed` view is non-empty) → `review them with /astro-principles-review`;
   - the store is empty → `nothing yet — principles are proposed as you work (/astro-discuss,
     /astro-decision, /astro-accept) or by /astro-principles-mine`.
   Otherwise say nothing more.

A failing `ac` call is reported in one line with its first error; nothing else is tried.

## Never

- Never accept, reject, amend, merge, reopen or propose from this command.
- Never write under `~/.astro/principles/` or read its files directly — only `ac`.
