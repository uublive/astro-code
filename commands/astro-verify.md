---
description: Verify a phase actually achieves its goal (goal-backward, not just "tasks ran")
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Agent
---

Verify phase `$ARGUMENTS` — the **AI gate** (the human UAT gate is `/astro-accept`).

1. Resolve the phase slug and read its goal from `.astrocode/phases/<slug>/` and the
   roadmap.
2. Surface the live status (`ac activity '⚙ verifying'`), then spawn the
   **astro-verifier** agent to check, goal-backward, that the implemented code
   delivers the phase's promise — not merely that tasks completed. It must run the
   test suite and inspect the real code paths.
3. Clear the live status first (`ac activity clear`). On PASS: run `ac phase verify <slug>`
   (marks the phase **verified**, NOT complete) and tell the user to run `/astro-accept <number>`
   for UAT sign-off (reference the phase by its number, e.g. `/astro-accept 3`). Once the verifier agent has returned, you may add an optional nudge:
   state is saved to `.astrocode/`, so `/clear` before `/astro-accept` keeps context lean
   and loses nothing. On FAIL: list exactly what's missing and stop — do not mark it verified.

Verification is the machine gate; it never closes the phase on its own.
