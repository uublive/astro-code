---
description: Promote a backlog idea into a real phase, claiming a number and seeding the captured thinking into its CONTEXT.md
argument-hint: <backlog id or fragment>
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

Turn a captured idea into a phase, without spending its number until the human confirms
it is still worth one.

Promotion claims a real, permanent phase number — nothing reissues a spent one if the
idea turns out to be stale. So this command asks before it acts, then does the one thing
`ac backlog promote` does: seed the phase with the captured note, not a discussion.

## Steps

1. **Confirm the idea is still worth a phase.** Run `ac backlog show $ARGUMENTS` (or
   `ac backlog list` first if the argument does not resolve) and show the human the
   captured title and note, in two or three lines — not a paste of the full record.
   Ask, one `AskUserQuestion`: still worth a phase, or would it
   read better folded into a phase already in flight (`ac backlog link`), or archived
   instead (`/astro-backlog`)? Only proceed on "still worth a phase" — a spent phase
   number is not reissued, so this confirmation happens before anything is claimed.

2. **Promote it.** Run:

   ```
   ac backlog promote <id>
   ```

   This claims the next phase number, records the claim in the shared registry, and
   writes the item's captured text verbatim into the new phase's `CONTEXT.md` — without
   the `<!-- astro-discuss: captured -->` marker, so `/astro-plan` still demands a real
   discuss round on it (D2). The backlog item leaves the open list as `promoted`.

3. **Say what happened**, in one line: the new phase number and that it still needs a
   real discussion — point at `/astro-discuss <n>`, stating plainly that the seeded
   `CONTEXT.md` is the captured note, not a discussion, and does not satisfy the discuss
   gate.

## Notes

- Promotion targets a **phase only, never a fix** (D3). An idea by definition has no
  reproduction case, and `/astro-fix` must never contain a bugfix without one; something
  in the backlog that turns out to be broken behavior goes to `/astro-fix` directly, not
  through here.
- If the item was already promoted, `ac backlog promote` refuses and names the phase it
  already became — report that and stop, rather than retrying.
