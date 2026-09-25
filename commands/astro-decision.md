---
description: Record an architectural decision (ADR-lite) so it's respected by future agents, not relitigated
argument-hint: <decision title>
allowed-tools: Bash, AskUserQuestion
---

Capture a decision into the project canon.

1. Take the decision title from `$ARGUMENTS`. If empty, ask the user for it.
2. Ask the user (briefly) for the **why** and what was **rejected** (the alternatives
   and why not). Keep it to a sentence or two each.
3. Record it: `ac decision add "<title>" --why "<why>" --rejected "<rejected>"`.
4. Confirm the ADR id (and whether it landed `[shared]` on the orphan branch or
   `[local]`). It's now part of the canon injected into every `/astro-plan` and
   `/astro-execute` run, and — when shared — instantly visible to the whole team.
5. **Propose the principle behind it.** The why/rejected came from the user in this
   turn — see `` `$(ac path templates)/principle-capture.md` `` for the full gate,
   the lift rule, the volume cap and the invocation; here only this moment's own
   binding: `--from-ref "ADR-<nnn>"` (the id step 3 printed), excerpt = the why the
   user gave. Runs strictly after step 3 has already succeeded. Reporting is exactly
   one line, or say nothing when nothing was proposed.

Use this whenever a real architectural choice is made — stack, pattern, naming rule,
boundary. Small, frequent entries keep the canon honest.
