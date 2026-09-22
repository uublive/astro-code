---
description: List the ideas you have parked, capture a new one, or review them one by one
argument-hint: "[<idea> | review]"
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

List the ideas you have parked, capture a new one, or triage them.

The backlog is a peer of debt and fixes, not a status inside either — an idea has no
file and no recurrence, so it never belongs in the debt register (ADR-056). It is not a
`todo.md`: every item leaves the same way it arrived, by being promoted, folded into a
phase, or archived with a reason.

## Steps

Three modes, keyed on `$ARGUMENTS`:

| `$ARGUMENTS` | Mode |
|---|---|
| empty | **list** — print what is open and stop |
| exactly `review` | **triage** — list, then offer each item its exits |
| anything else | **capture** — treat it as the idea |

Checking what you have parked is a glance, and it is the most frequent thing anyone does
here. It must not cost a round of questions, or it stops being done. Triage is the rarer,
deliberate act, so it is the one that asks to be named.

### Capture — `$ARGUMENTS` is an idea

1. **Capture the idea.** Run:

   ```
   ac backlog add "$ARGUMENTS"
   ```

   Pass along `--note "…"` only if the user gave more than the one line — the note is
   for a short paragraph of reasoning, not a plan; if you find yourself writing one,
   say so and suggest `/astro-discuss` on a new phase instead.

   If the command prints a similarity warning, relay it **in one line**, naming the
   existing item. Never refuse the capture over it — D5/D6 warn and proceed.

### List — `$ARGUMENTS` is empty

1. **Read the backlog.** Run `ac backlog list`. If there is no open idea, say so in one
   line and stop — nothing parked is a good outcome, not an empty report to dress up.

2. **Present it** as one line per item — the id, its age, a `⚠` on anything the CLI
   flagged as stale — never a table. Keep each item to its title plus the one line the
   CLI already gave you; do not paste the full record.

   **Then stop.** Do not offer exits, do not raise an `AskUserQuestion`, do not suggest
   what to do with any item. A glance that ends in a question is not a glance. At most,
   close with one line naming `/astro-backlog review` for anyone who wants to act.

### Triage — `$ARGUMENTS` is exactly `review`

Do steps 1 and 2 above first, then:

3. **Offer the exits**, one `AskUserQuestion` per item under discussion (or grouped if
   several are being reviewed at once):
   - **Promote it** → tell them to run `/astro-backlog-promote <id>`.
   - **Fold it into a phase already in flight** → `ac backlog link <id> --phase <n>`.
   - **Archive, declined** → `ac backlog archive <id> --kind declined --reason "…"`,
     using the reason the human actually gives, never one you invent.
   - **Archive, obsolete** → `ac backlog archive <id> --kind obsolete --reason "…"`,
     same rule on the reason.
   - **Leave it** → nothing; it stays open and surfaces again next review.

   When you act, say which exit you took **in one line**, after the fact, not before.

## Notes

- Never archive without a reason typed by the human — `ac backlog archive` refuses
  without one, and inventing a reason defeats the entire point of the register (C4).
- Never mark an item `absorbed` by hand. That status is set only when the phase it was
  linked to is accepted (`ac phase accept`) — this command's job stops at linking.
