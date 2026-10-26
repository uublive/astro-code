---
description: Verify a phase actually achieves its goal (goal-backward, not just "tasks ran")
argument-hint: <phase number or slug> [--full]
allowed-tools: Bash, Read, Agent
---

Verify phase `$ARGUMENTS` — the **AI gate** (the human UAT gate is `/astro-accept`).

1. Resolve the phase slug and read its goal from `.astrocode/phases/<slug>/` and the
   roadmap.
2. **Plan the run first.** Run `ac verdict plan <slug> --json` (add `--full` when the user
   passed `--full`, which forces a full run). It decides, in code, whether this re-verify may
   narrow (ADR-079); the thresholds and the fallbacks live there, so never restate or second-guess
   them here. Surface the live status (`ac activity '⚙ verifying'`), then spawn **ONE**
   **astro-verifier** invocation — a narrowed re-verify is still a single run that continues to
   full coverage, never a second spawn. Its bar is the pre-registered, goal-derived
   `.astrocode/phases/<slug>/CRITERIA.md` — it checks the result against **that**, not
   the plan. This command spawns the verifier directly (bypassing the execute-phase
   prompt), so restate the contract when you spawn it: <!-- verifier-contract -->check goal + CRITERIA.md only;
   **do NOT read PLAN.md/SPEC.md or trust task/commit summaries**; per criterion, assume
   FAIL until you run its `Observe:` evidence yourself and cite the command output; run
   the full suite; PASS only if **every** criterion independently passes. If CRITERIA.md
   is absent, self-derive goal criteria and open the verdict with a provenance line — never
   silently trust the plan.<!-- /verifier-contract -->
   - **When the plan says `narrowed`**, restate the same narrowed contract the execute workflow
     sends: re-check the plan's `first` ids first (the saved run and commit are in the plan),
     from scratch against their own `Observe:` lines; inspect `git diff <range>` first, and a
     **broad** fix (one touching what many criteria rest on) means a full run from the start with
     `broad: true`; **check ALL** of the `first` ids before stopping; if any is still unmet, stop
     with a FAIL and report every other criterion as `carried` (never as passed); if they all now
     pass, **continue in the same run** over EVERY other criterion and return `mode: full`.
   - **Ask the verifier to end with a fenced JSON block**
     `{"mode": "full"|"narrowed", "broad": <bool>, "criteria": [{"id": "C1", "passed": <bool>, "mutation": {…}}]}`
     listing only the criteria it actually checked this run (omit carried ones). `mutation` is
     optional per criterion: the `ac mutate <slug> --json` evidence with `triage` added per survivor,
     and `"test_strength": true` on every criterion the verifier used the tool for, tagged or not
     (gated in code once marked, and the mark is sticky; the survivors file and the rules are
     `lib/survivors.mjs` and `lib/verdict.mjs`). A `'` inside it is written `\u0027` so the single-quoted
     `--result '<json>'` survives.
3. Clear the live status first (`ac activity clear`). **Record the verdict** whenever the plan's
   `ids` is non-empty: `ac verdict record <slug> --result '<that JSON>'` (it saves and commits
   `VERDICT.json`, and derives `passed` itself). PASS requires the record's `passed: true`; if the
   record or the gate refuses, that is a FAIL line, not a PASS. On PASS: run
   `ac phase verify <slug>` (marks the phase **verified**, NOT complete — it refuses without a full
   recorded verdict), then report **in one line**: verified, plus
   the next command by number (`/astro-accept <number>`) for UAT sign-off. The `/clear`-before-
   `/astro-accept` nudge (state lives in `.astrocode/`, so context is safe to drop) is optional
   and, if given, stays to one line too. On FAIL: **one line per unmet criterion** — what is
   missing, not how it was observed — and, for a narrowed run, **one more line** for the carried
   criteria: `carried, not re-checked: <n> (run <R> @ <sha7>)`, citing the saved run and commit;
   then one line pointing to the verifier's full
   per-criterion report for the reproduction detail, then stop. Do not mark it verified.
   On PASS or FAIL, when a criterion's `mutation` evidence has a `fallback`, add **at most one
   line**: the evidence's `fallback.report`, verbatim (it is worded from the reason, so it says AI
   mutants stood in only when they did); say nothing about mutation otherwise.
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
