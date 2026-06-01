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
4. Confirm the ADR id and remind the user it will now be injected into every
   `/astro-plan` and `/astro-execute` run.

Use this whenever a real architectural choice is made — stack, pattern, naming rule,
boundary. Small, frequent entries keep the canon honest.
