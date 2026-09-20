<!-- astro-discuss: captured -->

# Context — Phase 18: Canon sync never destroys or duplicates local canon

## Goal

`ac canon pull` must never silently destroy local canon, and must never turn one decision
into two. The full operator report — both production incidents, with the exact output each
printed — is in `BRIEF.md` alongside this file.

## Why this matters more than it looks

The canon is the one thing **every** agent in the loop reads before it does anything —
planner, executor, verifier. A corrupted canon is not one broken file; it is every
subsequent agent working from the wrong rules, silently, with no failure anywhere to point
at. **Both bugs are silent by construction: the command prints a success line in each case.**

Verified live during this session: `ac canon pull` ran twice and printed
`✓ pulled DECISIONS.md, CONVENTIONS.md from astro-registry` both times while a hash
comparison showed nothing changed. That success line is byte-identical to the one that
silently reverted a line-count ceiling on a real project.

## What the code actually does (grounding — read before planning)

`lib/canon.mjs`, 218 lines:

- **`canonPull` lines 181-184**: `CONVENTIONS_FILE` is an **unconditional `writeFileSync`**.
  No comparison, no warning, no notion of "local-only" — twelve lines below the careful
  ADR-034 merge that `DECISIONS.md` gets.
- **`unionLocalOnly` line 124**: `norm()` **already** collapses whitespace
  (`.replace(/\s+/g, ' ').trim()`), and line 132 skips content-identical entries. So plain
  whitespace is **not** what produced the ADR-142 false positive. Two better suspects, both
  in that one line:
  - it strips `^##\s+ADR-\d+\s*—?\s*` — an **em-dash only**. A heading written with a plain
    hyphen keeps `- Title` in the normalized text while the em-dash version drops it, so the
    two normalize differently.
  - **`buildDecision` stamps a `_date_` line into the body and `norm()` does not exclude
    it.** The same decision added on two machines on different days differs *by
    construction* — which is exactly the converge-don't-collide case.
- **`canonPush` lines 191-218**: publishes `CONVENTIONS.md` only, last-writer-wins, and
  refuses `DECISIONS.md` by design.

## Decisions

### D1 — Pull refuses rather than overwrites a diverged `CONVENTIONS.md`
When local differs from the registry copy, pull **refuses to overwrite**, says so, and names
the fix: `ac canon push` to publish yours, or an explicit force to take the registry's.
Non-destructive by default — the same courtesy `DECISIONS.md` already receives.

**Rejected — and this is the interesting rejection:** a real three-way merge *is* possible
here, because the orphan branch carries history. It was rejected anyway. Conflict markers
landing in the one file every planner and executor reads as canon are **worse** than either
alternative: an agent would read `<<<<<<<` as a rule. A prose file that is machine-consumed
cannot afford merge artifacts.

**Also rejected:** overwrite-but-keep-a-copy. It never blocks, but leaves a reconciliation
chore and a stray file the tool must then teach the user about.

### D2 — A decision is identified by its **content**, not its number
Same title and body is the same decision regardless of number, whitespace, **dash style**, or
**date stamp**. The same decision recorded independently on two machines **converges instead
of colliding**.

**Strict equality after normalization — never similarity.** The forge brain records a
deliberate prior decision on another project: an automatic entity-resolution sweep
(name-similarity + embedding-similarity + LLM adjudication feeding a merge) was **removed**,
keeping only manual merge, because the risk was *destructive wrong merges* collapsing two
distinct entities. Only exact-normalized duplicates may auto-converge. That principle is
adopted here rather than re-derived.

**The normalizer must therefore exclude the `_date_` line and tolerate dash variants** —
without both, two machines still collide on the same decision.

### D3 — `ac decision add` publishes `CONVENTIONS.md` too
This closes the "nothing ever pushes it" gap for everyone, including people who never learn
`ac canon push` exists. That gap is the root cause of half one: the user-side fix that
*looks* right ("restore the line") leaves the registry holding the old copy, so the next pull
reverts it again.

**Risk the planner must handle:** a half-edited `CONVENTIONS.md` gets published as a side
effect of recording an unrelated decision. Publishing only when it differs is an acceptable
refinement; publishing something the user did not mean to publish is not.

### D4 — Editing a published decision is refused, with supersession explained
With content identity (D2), an edited published decision genuinely differs from the
registry's. The tool **detects it, refuses, and names the supported path** — record a new
decision that supersedes the old one.

This turns a rule projects currently rediscover **by corrupting their own canon** into one
the tool teaches on first contact. The operator's report is explicit that the existing rule
("a published decision is IMMUTABLE") is *a workaround for this bug, not a design principle
anyone chose*.

**Rejected:** allowing edits as last-writer-wins updates — two people editing the same
decision would silently overwrite each other, trading duplication for a quieter data loss.

### D5 — A genuine collision refuses; nothing is ever renumbered
Same id, genuinely different content: **stop, name both decisions, leave them where they
are.** The user supersedes or renames deliberately.

Nothing moves, so **nothing can be invalidated** — the strongest form of the stated outcome.
This matters because numbers are *referenced*: on the reporting project, `CONVENTIONS.md`
and two offline verification drivers cite a decision by number, and the renumber was
survivable only because the original happened to stay put.

**Rejected:** renumbering the incoming entry while scanning for references, and renumbering
as today while listing what broke. Both still move a number something points at; refusing
removes the failure mode instead of reporting it.

### D6 — Already-duplicated canon is detected always, repaired only on request
Duplicate detection **reports content-identical pairs every time**. Collapsing them happens
**only when explicitly asked**, and **only on exact normalized match**.

Existing corruption is in scope: two duplicated pairs are already recorded as debt on the
reporting project, plus ADR-142/163. A fix that only prevents new damage leaves the canon
that is already wrong.

**Rejected:** auto-collapsing on pull — a destructive merge firing without asking is the
exact pattern D2's cited precedent deliberately removed elsewhere.

### D7 — Output distinguishes "I changed your files" from "I changed nothing"
Pull reports **per file** which were actually modified and which were already current. A
no-op pull states plainly that it changed nothing.

**Rejected:** `ac preflight`'s silent-when-clean posture. It suits an advisory check, but on
a command that can destroy work, a user who sees nothing cannot distinguish success from the
command never running — and reassurance has real value here.

## Scope

**In scope** — folded in at the operator's direction, all three already open against
`lib/canon.mjs` and all three are this phase's subject rather than a rider:

- `2026-09-17-a-canon-sync-that-finds-same-id` — same-id-different-text renumbers silently
  instead of surfacing the conflict (D5).
- `2026-09-17-ac-canon-push-publishes-conventions-md` — `ac canon push` publishes
  `CONVENTIONS.md` only, so an edit to an existing ADR never reaches the registry (D4).
- `2026-09-17-nothing-publishes-conventions-md-when-a` — nothing publishes `CONVENTIONS.md`
  when a phase closes, so the next pull silently reverts local edits (D1, D3).

They should **close with the phase**, not outlive it as register entries nobody reads. That
all three were filed by verifiers on 2026-09-17 and still reached production two days later
is itself evidence for D7: a warning nobody is forced to read is not a warning.

**Out of scope:** anything about **what the canon should contain**. This phase is purely
about sync not destroying it.

## Open questions / assumptions left to the planner

- Exact flag names (the force flag on pull, the repair verb's home — a `canon` subcommand or
  its own verb).
- The normalizer's precise rules beyond excluding the date stamp and tolerating dash
  variants.
- Whether D3 publishes unconditionally or only when the file differs — both satisfy the
  decision; the second is quieter.
- **Assumption:** the em-dash strip and the unexcluded `_date_` line are the actual causes of
  the ADR-142 false positive. This is read from the code, **not reproduced**. The planner
  should have a task reproduce the false positive from a real pair before fixing it, so the
  fix is aimed at the observed cause rather than the inferred one.
