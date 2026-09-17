---
description: Human sign-off on a bugfix — confirm the bug is actually gone, then close and archive it
argument-hint: <fix id or fragment>
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

Run user acceptance on a bugfix and close it only if the human agrees the bug is gone.
This is the **human gate** after the AI marked it `verified` — the same two-gate shape
`/astro-accept` gives a phase.

A fix has one advantage a phase does not: **the acceptance criterion is objective.** A
test that failed before and passes now either exists or it doesn't. So this is a short
conversation, not a checklist walk — but it is still a real gate, because "the test
passes" and "the bug is gone" are not the same claim. A test can pass for the wrong
reason.

## Steps

1. **Resolve the fix.** `ac fix list` to see what is open; the argument matches on the
   full id, the bare slug, or any fragment. If `$ARGUMENTS` is empty and exactly one fix
   is open, use it — otherwise ask which.

   Confirm its status is `verified`. If it is still `open`, `diagnosing` or `executing`,
   say so and stop: there is nothing to accept yet. Run `/astro-fix` to finish it.

2. **Show the user what happened**, reading from `.astrocode/fixes/<id>/`:
   - **What broke** — quote `REPORT.md`, their own words.
   - **The cause** — from the diagnosis, and say plainly how it differs from the symptom.
   - **What changed** — the commits and files, with `git log --oneline` / `--stat`.
   - **The proof** — the reproduction test: name it, and give the exact command so they
     can run it themselves.

   Keep this short and concrete. The user is deciding one thing: *is the bug actually
   gone?*

3. **Let them check it themselves.** Offer the command that reproduces the original
   report — not just the unit test. A unit test passing is evidence; the original
   symptom being gone is the claim.

   If the bug cannot be exercised directly (a race, a rare state), say so rather than
   implying it was reproduced by hand.

4. **Collect the verdict** with `AskUserQuestion`.

   - **Bug is gone** → `ac fix accept <id>`. This marks it accepted, **archives** the
     directory to `.astrocode/fixes/archive/<id>/`, and closes the registry claim.
   - **Still broken** → `ac fix status <id> diagnosing` and write what is still wrong
     into `.astrocode/fixes/<id>/REPORT.md` under a dated heading. The bug is still live,
     so it goes back to diagnosis rather than being rejected — `rejected` means "we have
     decided not to fix this", which is a different statement.

## Who is signing (ADR-033)

Plain `ac fix accept <id>` records `accepted_kind: "human"` — it asserts a person judged
the bug gone. Use it ONLY when the user actually confirmed it in step 3 or 4.

If you are an autonomous agent standing in for the operator — running unattended, or
closing on their behalf without them confirming — you MUST pass
`ac fix accept <id> --agent "<your name>"`, which records `accepted_kind: "agent"`.

astro-code cannot detect which happened: when the operator accepts, their assistant runs
this same command. The record is only honest if the signer declares it. This matters more
for a bug than for a phase — a bug wrongly marked fixed stops being looked for, which is
worse than a bug known to be open.

## After

The record stays in `.astrocode/fixes.json` with `accepted_at` — what broke and when is
the most useful history a project has. Only the working directory is archived.

Mention that `ac fix list` is now shorter, and if nothing else is open, say so.
