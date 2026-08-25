---
description: Add a phase to the roadmap — checks for duplicate work, then claims the next phase number
argument-hint: <phase name>
allowed-tools: Bash, Read, AskUserQuestion
---

Add a new phase named `$ARGUMENTS` to the current milestone.

1. **Check for duplicate work first:** `ac phase check "$ARGUMENTS"`. If it reports a
   phase with the same/similar name claimed by **another developer**, surface it and
   use `AskUserQuestion` to let the user choose: proceed anyway, rename, or stop and
   coordinate with that dev. (A match by *you* is just informational.)
2. Run `ac phase add "<final name>"`. This **claims the next free phase number** from
   the orphan-branch registry (phase numbers are **project-global** — they don't
   restart at 1 each milestone, so every phase number is unique on its own) — if
   another dev took that number you automatically get the next one — and records the name so
   future duplicate checks work. If it prints a `⚠ possible duplicate work` warning,
   relay it. If it errors with `run `ac registry init``, run that first (needs an
   `origin` remote), then retry.
3. Show `ac status` and suggest `/astro-discuss <number>` next (then `/astro-plan <number>`);
   a trivial phase can skip straight to `/astro-plan <number>`.

## Sizing a phase (ADR-032)

Every phase carries fixed overhead — a discuss round, a plan run, an execute run, a
verify pass and a human accept. Measured on a real project that is ~1h of workflow plus
several round trips **per phase**, largely independent of how much work the phase
contains. Two small phases therefore cost roughly twice what one merged phase does, for
the same code.

So prefer **fewer, larger phases**: a phase should be the largest chunk that still has
**one coherent goal** a verifier can check end-to-end. Split only when there is a real
reason — a genuine dependency boundary, a risky change worth its own gate, or a scope
you want to be able to accept and ship separately. "These are two different files" is
not a reason; the planner already parallelizes tasks *within* a phase.

Do NOT merge phases that disagree about their goal. A phase whose CRITERIA cannot be
stated as one coherent bar is too big, and verification degrades into a checklist —
which is what ADR-021 exists to prevent.

Don't hand-edit `.astrocode/ROADMAP.md` — it's generated. Numbering and name tracking
only work through `ac`.
