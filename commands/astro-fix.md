---
description: Fix a bug end-to-end — reproduce, diagnose, fix, verify — without burning a milestone phase
argument-hint: <what is broken>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Task, AskUserQuestion
---

Fix a bug as a **first-class object beside the roadmap**, never inside it.

A phase is a unit of *planned* milestone scope. A bug is not scope — it is something
that turned out to be wrong. Filing one as a phase burns a milestone number on work
nobody planned and leaves the roadmap describing something other than the plan. So a
fix gets its own dated identity, its own directory, and its own archive.

If there is no `.astrocode/` here, tell the user to run `/astro-new-project` first and stop.

## Why the loop is different

A bug differs from a feature in one specific way: **the goal is known and narrow, but
the cause is not.** That inverts where the effort goes.

- **No discuss step.** The bug report *is* the context.
- **No research fan-out.** Diagnosis is real investigation, but it is one focused
  thread following evidence, not three parallel agents surveying a design space.
- **Verification is NOT lighter.** A bug marked fixed that isn't is the costliest
  outcome in the whole system — worse than an unfixed bug, because it stops being
  looked for.

And a fix has a **better verification primitive than a phase does**: a failing test
that now passes. Reproduce first and the criterion is pre-registered *by construction* —
no judgement call about whether the goal was met.

## Steps

1. **Open the fix.** `ac fix add "<short title>"` — claims a dated id
   (`2026-09-17-auth-401`), creates `.astrocode/fixes/<id>/`, and records it in the
   shared registry. If it warns that someone may already be on this bug, **stop and
   tell the user** rather than duplicating the work.

   Write the report verbatim to `.astrocode/fixes/<id>/REPORT.md` — first line the
   user's own words, unedited. Never paraphrase a bug report; the exact symptom is
   evidence.

2. **Reproduce.** `ac fix status <id> diagnosing`, then write a **failing test** that
   demonstrates the bug, and run it to confirm it fails *for the stated reason*.

   This is the gate. If you cannot reproduce it, say so plainly and stop — ask for
   the missing conditions. Do NOT proceed to "fix" something you have not observed
   failing: you would be guessing, and the test would pass for the wrong reason.

   Record the reproduction in `.astrocode/fixes/<id>/REPRO.md`: the test, the command
   that runs it, and the observed failure.

3. **Diagnose.** Follow the evidence to the actual cause. Distinguish the **symptom**
   from the **cause** in writing — the fix belongs at the cause. State what you ruled
   out and why, so the next person doesn't re-walk the same dead ends.

   If the cause turns out to be systemic — a design flaw rather than a defect —
   **stop and escalate**: that is a phase, not a fix. Say so and let the user decide.

4. **Fix.** `ac fix status <id> executing`. Make the smallest change that addresses
   the cause. Commit atomically, referencing the fix id.

   Match the surrounding code, read `CONVENTIONS.md`, and resist the urge to tidy
   nearby code — an unrelated change riding along in a bugfix is how a fix becomes a
   regression.

5. **Verify.** Run the reproduction test: it must now pass. Run the **full suite** —
   a fix that breaks something else is not a fix. Then `ac fix status <id> verified`.

   Report both facts plainly: the repro now passes, and the suite is green. If the
   suite was already failing before your change, say that too rather than implying
   you left it green.

6. **Hand back.** Show the user what broke, why, and what changed. Acceptance is
   theirs: `ac fix accept <id>` marks it accepted, **archives the directory** to
   `.astrocode/fixes/archive/<id>/`, and closes the registry claim.

   Do not run `accept` yourself unless the user explicitly asks — it is the human
   gate, exactly like `/astro-accept` for a phase.

## Notes

- A fix **interrupts** a phase rather than replacing it. The status line shows the
  live fix; the phase you were on is still there when you are done.
- Ids are dated, so `ls .astrocode/fixes/` and the archive both sort chronologically.
- No number is claimed. This follows ADR-013: urgent out-of-band work is
  name-identified so it stays instant and works offline.
- `ac fix list` shows what is open; `ac fix show <id>` prints one.
