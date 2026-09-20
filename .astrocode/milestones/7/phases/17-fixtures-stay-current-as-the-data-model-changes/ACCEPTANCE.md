# ACCEPTANCE — Phase 17: Fixtures stay current as the data model changes

User-facing UAT. A human confirms these before the phase closes (`/astro-accept`).

**Precondition state assumed by these items (ADR-050).** Items 1–3 assume a throwaway git
repo under `/Users/buu/Development/` with an `.astrocode/` project state, a project-root
`RUN-CONTRACT.md` whose declaration block has been filled in, and **at least one commit whose
subject carries an ADR-017 stamp** (`… (phase 17 t2)`) touching a declared data-model path —
the check reads committed, stamped history, so an uncommitted edit is invisible to it by
design. Item 4 assumes a scratch app-shaped project that already boots with one command and
persists data, with Docker reachable via the host bridge (`host "docker compose version"`).
Item 5 assumes that same project with **no astro-code checkout reachable from it**. No item
requires a `.env`, an exported variable, or a migration run by hand.

1. **The user can change the data model and be told, in the run they are already watching,
   that the fixtures were not extended.** Run `/astro-execute` on a phase whose stamped
   commits touch a declared data-model path while leaving the declared seed source alone: the
   run's final summary carries a line naming the phase and the changed path. Nobody typed a
   flag, nobody asked for the check, and the phase's verdict is unaffected — it is a warning,
   not a gate.

2. **The user can still find that warning tomorrow.** After that run, `ac debt list` shows one
   open item naming the phase and the path, and `ac status` reflects it in the debt count. Hit
   the same thing again in a later phase and the register still shows **one** item, now
   recording the repeat sighting — it never inflates into a wall of duplicates.

3. **The user can tell "nothing to report" apart from "nothing was checked".** On correct work
   (the same commit extends the declared seed source) the check prints nothing at all. In a
   project that has never filled in the declaration it prints one plain-English line saying
   nothing was checked and why. The two are never confusable, and neither ever fails the run —
   the same holds in `/astro-fast`, which runs the check too.

4. **The user can watch the enforcement layer catch stale fixtures for real.** Following the
   commands recorded in `FIXTURE-REHEARSAL.md` verbatim, a schema change with fixtures left
   alone comes up as a **healthy** app whose data simply does not contain the state the
   acceptance items assume — the criterion fails. Extending the fixtures at the named seam,
   and changing nothing else, makes the same one command return that state present.

5. **The user can hand the project to someone with no astro-code and they can keep the rule.**
   Reading only the project's own `RUN-CONTRACT.md` and `CONVENTIONS.md`, they can say what
   must be true of the booted app after a phase adds a table (not "which file to edit"), and
   where and in what format to declare the data-model paths and the seed source — and a
   declaration written from those instructions alone is understood by the check.

6. **The user can trust the guard rails stay in place.** `npm test` is green twice in a row
   with no network and leaves nothing behind; and deleting the check from `/astro-execute`,
   from `/astro-fast`, the criteria-author's standing rule, or the planner's
   precondition-state rule each turns it red — so a future prompt rewrite cannot quietly
   remove any of them.
