---
description: Verify a phase actually achieves its goal (goal-backward, not just "tasks ran")
argument-hint: <phase number or slug>
allowed-tools: Bash, Read, Agent, mcp__forge__forge_capture_knowledge
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
4. **Opportunistic capture — after the verdict above is already reported, never before,
   and never changes it (a capture can never turn a PASS into a FAIL or vice versa).**
   Capture only on a surprise that changed the approach: a **FAIL whose missing-list
   evidence revealed a wrong assumption** the plan had made, not merely unfinished work.
   A clean PASS captures nothing. A FAIL that is just incomplete work (nothing about the
   *approach* was wrong) also captures nothing — state that explicitly rather than
   forcing a capture. When the surprise condition holds, lift the generator the same way
   `/astro-decision` does: strip every project noun, filename, number and proper name; if
   nothing project-agnostic survives, **capture nothing and say so in one line** rather
   than force a generalization. Otherwise call `mcp__forge__forge_capture_knowledge` and
   print ONE line summarizing what was staged to the human-approval queue — no
   confirmation prompt, and a failed capture never fails this command. See
   `` `$(ac path templates)/forge-knowledge.md` `` for the full detection/degradation
   rules and capture contract (tools absent → skip silently, no output).

Verification is the machine gate; it never closes the phase on its own.
