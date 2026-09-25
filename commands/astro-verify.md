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
   (marks the phase **verified**, NOT complete), then report **in one line**: verified, plus
   the next command by number (`/astro-accept <number>`) for UAT sign-off. The `/clear`-before-
   `/astro-accept` nudge (state lives in `.astrocode/`, so context is safe to drop) is optional
   and, if given, stays to one line too. On FAIL: **one line per unmet criterion** — what is
   missing, not how it was observed — then one line pointing to the verifier's full
   per-criterion report for the reproduction detail, then stop. Do not mark it verified.
3b. **On PASS only, file the verifier's non-blocking findings as debt.** If the agent
   returned `findings[]`, file each item whose `outsideCriteria` is **explicitly `true`**:

   ```
   ac debt add "<title>" --why "<why>" --phase <number> --file <file> --cost <small|medium|large>
   ```

   Then report the count in one line (`filed 2 debt items — \`ac debt list\``), or say
   nothing when there are none. **Discard any finding that omits `outsideCriteria`, and
   file nothing at all on a FAIL** — on a FAIL the gap belongs in the missing-list the
   user is about to read, not in a register they will open next month. This mirrors the
   gate the execute-phase workflow applies in code; here it is yours to apply, so apply
   it literally and never file a finding of your own.

Verification is the machine gate; it never closes the phase on its own.
