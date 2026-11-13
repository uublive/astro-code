---
description: Run the milestone full check (full suite + every phase's quick checks) on the tip, then repair what it opened, within a limit
argument-hint: (no arguments)
allowed-tools: Bash, Read, Agent
---

Run the **milestone full check** (phase 57, ADR-094). Phases verified in fast mode ran only their targeted tests;
this runs the full suite and every phase's `Cheap:` checks once, on the milestone tip, and it can run unattended.
It starts no verifier. Close needs a passing check on the **current tip**: `ac milestone complete` refuses without it.

1. Run `ac milestone verify`. It refuses on a dirty tree (commit or stash first). On PASS (`✓ milestone <n> full
   check PASS on <sha7>`) report that in **one line** and stop: nothing was opened, so there is nothing to repair.
2. On FAIL it has already opened one fix per failure (deduplicated), each tied to the phase that broke, and committed
   them. List the failures from its output in at most one line each.
3. **Repair, bounded.** `limit` is `verify.repair_attempts` (`ac config get verify`, default 2). For each open fix from
   `ac fix list --json` that has `fullcheck_from` (and is not `verified`):
   - **Agent tier.** At most `limit` attempts per fix, each one spawn of the existing `astro-executor` scoped to that
     fix's `repro` and `fullcheck_from.command`, plan-blind, ending in ONE atomic commit whose subject ends
     `(fix <id> a<k>)`. After each attempt run `ac milestone repair <id>`: it re-runs the fix's own check, counts the
     attempt and moves the fix to `verified` when it passes. Stop at the first pass or when it prints `exhausted`.
   - **Inline tier (no subagents).** The same loop yourself: fix, one atomic commit, `ac milestone repair <id>`, at most
     `limit` times per fix.
4. When any repair commit landed, run a **fresh** `ac milestone verify` (the old result is stale: a new commit needs a
   new check). Repair again only for fixes it opened or reopened, never beyond `limit` attempts each.
5. Finish with the morning report from `ac milestone repair` (no id): **one line per fix**, `✓ fixed <id>` or
   `• still open <id> (<k>/<limit> attempts)`, and say nothing when it printed no lines. Lead with the check's final
   result. A fix still open is for a human: `ac fix show <id>`, and close needs it `verified` or accepted.

Scheduling this run (overnight) is out of scope; start it with one command.
