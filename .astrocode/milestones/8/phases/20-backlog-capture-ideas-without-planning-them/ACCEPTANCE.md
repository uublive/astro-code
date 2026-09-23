# Acceptance — phase 20: Backlog, capture ideas without planning them

What a human confirms before this phase closes. Each item names the **precondition
state** it needs, so nothing here can pass against data that no longer covers it
(ADR-050). Run them in order in a scratch project (or this one) — the order builds the
state each later item assumes.

**Base precondition for every item:** a project with `.astrocode/` initialised, an
`origin` remote and `ac registry init` already run (only items 1 and 4 work without the
registry). Nothing in `.astrocode/backlog.json` yet.

1. **The user can write an idea down without starting anything.**
   *Precondition:* empty backlog, nothing claimed.
   Capture two ideas (`/astro-backlog "<idea>"`, or `ac backlog add`), one with a short
   note. `ac backlog list` shows both with their text intact, oldest first — and
   `ROADMAP.md` and the registry are exactly as they were: no phase number spent, no
   milestone touched.

2. **The user can see how many ideas are waiting, without being nagged.**
   *Precondition:* the two items from (1) open.
   `ac status` shows a `Backlog: 2 open` line beside `Debt:`. After everything below has
   left the list, the line is gone — it says nothing when there is nothing waiting.

3. **The user can turn an idea into a real phase that still owes a conversation.**
   *Precondition:* one open item from (1) whose note contains a sentence you will
   recognise; the registry initialised.
   `/astro-backlog-promote <id>` claims a phase number and puts it on the roadmap. Open
   the new phase's `CONTEXT.md`: your sentence is there. `ac phase context <n>` prints
   `stub`, and `/astro-plan <n>` still tells you to discuss it first — the note did not
   buy its way past the gate. The item is no longer on the open list.

4. **The user can archive an idea and get the "why" back months later.**
   *Precondition:* one open item, captured with a name you can half-remember.
   Archive it as `declined` with a reason. `ac backlog list --all` (or `show`) gives you
   back that reason word for word. Then try to archive another item with no reason, and
   with `--kind absorbed`: both are refused, and the item is still open afterwards.

5. **"Let's plan X" meets the earlier decision against X — and is not blocked by it.**
   *Precondition:* the `declined` item from (4) archived with its reason, plus one item
   archived as `obsolete` with a different recognisable name; registry initialised.
   `/astro-phase "<name close to the declined one>"` tells you what you decided and why,
   asks whether to proceed / show what you wrote / stop, and — if you proceed — creates
   the phase normally. The same with a name close to the **obsolete** item raises
   nothing at all.

6. **An idea folded into a phase leaves the list by itself.**
   *Precondition:* one open item plus an open phase whose goal genuinely touches it.
   Run `/astro-discuss <n>`: **after** its debt question, it offers to fold the item in,
   one line per item. Accept. Finish the phase and `/astro-accept <n>`: the item closes
   itself as `absorbed`, naming the phase that closed it — you never ticked anything off.

7. **A rejected phase gives the idea back.**
   *Precondition:* a second open item linked to a second phase (via `/astro-discuss`'s
   fold-in or `ac backlog link`), that phase not yet accepted.
   Reject that phase (`/astro-accept` → something fails, or `ac phase reject`). The item
   is open again on `ac backlog list` and can still be promoted — it is not stranded.

8. **Ideas never reach the debt register, the score or the statusline.**
   *Precondition:* the captures and archives from (1)–(7) done, and whatever debt the
   project already had, untouched.
   `ac debt list` and `ac debt score` read exactly as they did before any of this, and
   the statusline shows no new segment. Ideas and debt stay separate objects.

9. **Adding a phase or a note no longer wipes the roadmap's `· planned` markers.**
   *Precondition:* at least one phase with a `PLAN.md`, so its `ROADMAP.md` line ends in
   `· planned` after `ac roadmap render`.
   Run `ac phase add "<anything>"` and `ac phase note <n> "a note"`. The planned phase's
   line still ends in `· planned`, and the new phase / note is there too.
