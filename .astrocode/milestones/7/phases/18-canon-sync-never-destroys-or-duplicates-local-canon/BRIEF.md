# BRIEF — Phase 18: Canon sync never destroys or duplicates local canon

> Raw report from the operator, captured verbatim in substance on 2026-09-19. **This is
> not `CONTEXT.md`** — the forks below are explicitly NOT settled, and `/astro-discuss 18`
> must settle them before any plan exists. Do not treat this file as a discuss gate.

## Both bugs were observed on a real project, hours apart, the same day

`ac canon pull` can **destroy local canon** and can **duplicate a decision**. Both happened
in production.

**Why this matters more than it looks:** the canon is the one thing every agent in the loop
reads before it does anything — planner, executor, verifier. A corrupted canon is not one
broken file; it is every subsequent agent working from the wrong rules, silently, with no
failure anywhere to point at. **Both bugs are silent by construction: the command prints a
success line in each case.**

## Half one — pull overwrites `CONVENTIONS.md` with no warning and no merge

Raised a line-count ceiling in `CONVENTIONS.md` (15000 → 20000), recorded it with
`ac decision add`, committed. Minutes later `ac canon pull` ran in the normal course of a
plan command and printed:

```
✓ pulled DECISIONS.md, CONVENTIONS.md from astro-registry
```

The ceiling was silently back to 15000, the file showing as modified in git. Nothing warned.
It was caught only by grepping for the new value out of suspicion from the other bug.

**The asymmetry IS the bug.** For `DECISIONS.md` the same command is careful — it merges and
reports what it kept:

```
⚠ kept 4 local-only decision(s) the registry has never seen: ...
```

For `CONVENTIONS.md` it is a whole-file replace: no comparison, no warning, no notion of
"local-only". A file the command never verified you had published is overwritten with the
registry's copy.

**Worse, the failure teaches the wrong lesson.** The obvious user-side fix is "restore the
line" — which leaves the registry holding the old copy, so the next pull reverts it again.
The actual fix is `ac canon push`, which is not what the situation looks like it needs. A
real project has carried *"ac canon pull silently reverts CONVENTIONS.md, because nothing
ever pushes it"* in its `DEFERRED.md` as known debt for days. **That is a user working around
a data-loss bug rather than reporting it — which is what a silent failure trains people to
do.**

## Half two — pull renumbers an identical decision into a duplicate

Same command, same day, different damage:

```
⚠ 1 local decision(s) shared an id with a DIFFERENT registry decision
  and were renumbered to keep both: ADR-142 -> ADR-163
```

It appended a copy under the new number. **But the two were not different** — local ADR-142
and registry ADR-142 had the same title and the same body, confirmed by diff. The collision
was a **false positive**, most likely whitespace or a trailing newline treated as different
content. Result: two identical decisions under two numbers.

**The damage is not cosmetic, and this is the part to design against: numbers are
referenced.** In that project `CONVENTIONS.md` and two offline verification drivers cite
that decision **by number**. Renumbering the local copy to 163 was survivable only because
the original 142 happened to stay put. Had the renumber moved the one everything points at,
every reference would silently point at nothing — and again, nothing would have failed.

**This is the third duplicated-decision incident on that project.** Two earlier pairs are
already recorded as known debt. A rule was learned the hard way and written down after the
second: *a published decision is IMMUTABLE, and editing one creates a duplicate on the next
sync.* **That rule is a workaround for this bug, not a design principle anyone chose.**

## Desired outcomes (stated as outcomes, not implementation)

- Pull **never loses local work silently.** If local canon differs from the registry in a way
  pull would overwrite, the user is told and gets to decide — the same courtesy
  `DECISIONS.md` already gets.
- Two decisions that are **the same decision are recognised as the same**, whatever their
  whitespace. A collision is only a collision when the **content** differs.
- When a genuine collision does occur, renumbering **never moves a decision that other files
  reference by number** — or if it must, it **says which references it just invalidated**.
- The command's output **distinguishes "I changed your files" from "I changed nothing".**
  Today a destructive pull and a no-op pull print the same success line.

## Forks to be discussed, NOT assumed

1. Should pull **refuse** and require an explicit push/force when local canon has diverged,
   or should it **merge** `CONVENTIONS.md` the way it merges decisions — and **can a prose
   file even be merged safely?**
2. Should `ac decision add` **push `CONVENTIONS.md` too**, so the "nothing ever pushes it"
   gap closes without anyone having to know the command exists?
3. **What identifies a decision — its number, or its content?** If content, the same decision
   recorded independently on two machines should **converge rather than collide**.
4. Is the immutability rule ("never edit a published decision") something the tool should
   **ENFORCE and explain**, rather than something each project rediscovers by corrupting its
   own canon?

## Out of scope

Anything about **what canon should contain**. This is purely about **sync not destroying it**.

## Already in the debt register — filed by verifiers on 2026-09-17, before this report

All three are `lib/canon.mjs`, and this report is the production confirmation of all three:

- `2026-09-17-a-canon-sync-that-finds-same-id` — a canon sync that finds
  same-id-different-text renumbers **silently** instead of surfacing the conflict (half two).
- `2026-09-17-ac-canon-push-publishes-conventions-md` — `ac canon push` publishes
  `CONVENTIONS.md` only, so an edit to an **existing ADR never reaches the registry**.
- `2026-09-17-nothing-publishes-conventions-md-when-a` — **nothing publishes
  `CONVENTIONS.md` when a phase closes**, so the next `ac canon pull` silently reverts local
  edits (half one, named exactly).

That the register already held all three — and that the bugs still reached production two
days later — is itself evidence for the fourth desired outcome: a warning nobody is forced
to read is not a warning.
