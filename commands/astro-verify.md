---
description: Verify a phase actually achieves its goal (goal-backward, not just "tasks ran")
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Agent
---

Verify phase `$ARGUMENTS` — the **AI gate** (the human UAT gate is `/astro-accept`).

1. Resolve the phase slug and read its goal from `.astrocode/phases/<slug>/` and the
   roadmap.
2. Surface the live status (`ac activity '⚙ verifying'`), then spawn the
   **astro-verifier** agent. Its bar is the pre-registered, goal-derived
   `.astrocode/phases/<slug>/CRITERIA.md` — it checks the result against **that**, not
   the plan. This command spawns the verifier directly (bypassing the execute-phase
   prompt), so restate the contract when you spawn it: check goal + CRITERIA.md only;
   **do NOT read PLAN.md/SPEC.md or trust task/commit summaries**; per criterion, assume
   FAIL until you run its `Observe:` evidence yourself and cite the command output; run
   the full suite; PASS only if **every** criterion independently passes. If CRITERIA.md
   is absent, self-derive goal criteria and open the verdict with a provenance line — never
   silently trust the plan.
3. Clear the live status first (`ac activity clear`). On PASS: run `ac phase verify <slug>`
   (marks the phase **verified**, NOT complete) and tell the user to run `/astro-accept <number>`
   for UAT sign-off (reference the phase by its number, e.g. `/astro-accept 3`). Once the verifier agent has returned, you may add an optional nudge:
   state is saved to `.astrocode/`, so `/clear` before `/astro-accept` keeps context lean
   and loses nothing. On FAIL: list exactly what's missing and stop — do not mark it verified.

Verification is the machine gate; it never closes the phase on its own.
