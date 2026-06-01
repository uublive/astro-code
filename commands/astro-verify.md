---
description: Verify a phase actually achieves its goal (goal-backward, not just "tasks ran")
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Agent
---

Verify phase `$ARGUMENTS`.

1. Resolve the phase slug and read its goal from `.astrocode/phases/<slug>/` and the
   roadmap.
2. Spawn the **astro-verifier** agent to check, goal-backward, that the implemented
   code delivers the phase's promise — not merely that tasks completed. It must run
   the test suite and inspect the real code paths.
3. Report PASS/FAIL with concrete evidence. On PASS, mark the phase complete in the
   roadmap and clear `active_phase`. On FAIL, list exactly what's missing and stop.
