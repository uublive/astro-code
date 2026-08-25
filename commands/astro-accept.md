---
description: Human UAT sign-off for a phase — confirm it does what was wanted, then close it
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, AskUserQuestion
---

Run user acceptance testing (UAT) for phase `$ARGUMENTS` and close it only if the
human accepts. This is the **human gate** after `/astro-verify` (the AI gate).

1. Resolve the phase slug. Confirm its status is `verified` (`ac status` /
   `ac roadmap list`). If it isn't, tell the user to run `/astro-verify` first and stop
   (they can override with `ac phase accept <slug> --force`, but warn that skips the
   AI gate).
2. Read `.astrocode/phases/<slug>/ACCEPTANCE.md` (the user-facing checklist written at
   plan time). If it's missing, derive a short checklist from the phase goal/PLAN.
3. Walk the user through it: for each criterion, show what was built and **how to try
   it** (the command to run, the URL to open, the thing to click). Let them confirm
   each one. Use `AskUserQuestion` to collect a clear accept/reject.
4. Decide:
   - **All criteria hold** → `ac phase accept <slug>` (records who accepted + when,
     marks the phase **complete**). Suggest the next phase, or `/astro-complete-milestone`.

   **Who is signing (ADR-033).** Plain `ac phase accept` records
   `accepted_kind: "human"` — it asserts a person made this judgement. Use it ONLY when a
   human actually confirmed the criteria in step 3.

   If you are an autonomous agent standing in for the operator — running unattended, or
   accepting on their behalf without them walking the checklist — you MUST pass
   `ac phase accept <slug> --agent "<your name>"`, which records
   `accepted_kind: "agent"`. This is the ONE gate REQ-006 rests on: `verified` is the
   machine's verdict, `complete` is supposed to mean a human agreed. astro-code cannot
   detect which happened — when the operator accepts, their assistant runs this same
   command — so the record is only honest if the signer declares it. Recording a machine
   sign-off as human does not just mislabel a field; it makes the two-gate guarantee
   unauditable, which is the whole reason the second gate exists.
   - **Something fails** → `ac phase reject <slug> --reason "<what's wrong>"` (records a
     blocker, marks it **rejected**). Summarize the gap so it can be re-planned/executed.
5. On accept, close with an optional context nudge: the phase is **complete** and all
   state is saved to `.astrocode/`, so running `/clear` before the next phase keeps the
   context lean and loses nothing (each command re-grounds from disk). Phrase it as a
   suggestion, not a requirement.

Keep it real — UAT is about "is this what I actually wanted?", not re-running unit tests.
