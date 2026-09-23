---
description: Take on one technical-debt item and land it — routed to the right treatment, closed only when the work is accepted
argument-hint: <debt id or fragment>
allowed-tools: Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion
---

Pay off one item from the technical-debt register, end to end.

Debt is an **inbox, not a plan**: it is never worked in place. It graduates into one of
the two objects astro-code already has — a **fix** or a **phase** — and closes when that
work is *accepted*. This command picks the right one and sees it through, so "I want to
spend an hour on debt" is a single command rather than five.

## Steps

1. **Resolve the item.** `ac debt show $ARGUMENTS` — the argument matches the full id, the
   bare slug, any id fragment, or a word from the title. If `$ARGUMENTS` is empty, run
   `ac debt list` and ask which one; if exactly one item is open, use it.

   Read its `why`, its `file`, and any `also_found_in` — a repeat sighting means the
   verifier hit this again in a later phase, which is the best evidence you have that it
   is worth the hour.

2. **Confirm it is still real** before spending anything on it. Open the file and look.
   Debt is filed from a snapshot of the code and the code moves; an item that describes
   something already fixed should leave the register, not consume an hour:
   - already true → `ac debt drop <id> --reason "…"` and stop, saying so;
   - never was true → `ac debt dismiss <id> --reason "…"` and stop.

   This check is the point of the command, not a formality. Paying debt that no longer
   exists is worse than ignoring it: it produces a commit that changes nothing and a
   register that looks like it is working.

3. **Route it.** Ask with `AskUserQuestion` when it is genuinely ambiguous; decide
   yourself when it is not, and say which you chose and why:

   - **Bug-shaped** — something is *wrong* and you can demonstrate it (the wrong output,
     the missing refetch, the crash). → `ac debt pay <id>`, which opens a fix, then work
     it the way `/astro-fix` does: **reproduce first** with a failing test, diagnose the
     cause as distinct from the symptom, fix, re-run.
   - **Refactor-sized** — a structural change, a migration, anything touching several
     files or needing a plan. → `ac debt pay <id> --as phase` puts it on the roadmap (add
     `--milestone N` when it belongs to a later milestone than the active one), then
     stop and tell the user to run `/astro-discuss` on it. **Do not start implementing a
     phase from here.**
   - **Mechanical** — a one-line correction with no design content (the `renderRoadmapMd`
     → `renderRoadmap` class of thing). Still `ac debt pay <id>` to open the fix, because
     the closure has to go through an acceptance; just skip the diagnosis theatre.

   Routing matters for honesty: a refactor pushed through the fix loop produces a
   "bugfix" with no reproduction case, and the reproduction is the only thing that makes
   `ac fix` trustworthy.

4. **Do the work** (fix route only). One atomic commit, tests run, canon obeyed
   (`ac canon`). Add a regression test wherever the change adds or corrects behavior — an
   item that comes back because nothing pinned it is the same debt twice. Then
   `ac fix status <fix-id> verified`.

5. **Close it through the gate, never around it.** Show the user what changed and the
   command that proves it, then have them run **`/astro-fix-accept <fix-id>`** (or
   `ac fix accept <fix-id>`). Accepting the fix closes the debt automatically and prints
   `✓ debt <id> paid`.

   **Never mark the debt paid by hand.** There is deliberately no command that does it:
   an item closes because the work was accepted, and that is the whole reason this
   register does not rot the way a markdown list does. If you are an agent accepting on
   the user's behalf, pass `--agent <name>` (ADR-033) so the record says so.

6. **Report the new pressure** — `ac debt score` — so the effort has a visible effect.
   Paying a *recurring* item moves the number far more than paying an isolated one, which
   is the behaviour the score exists to encourage.
