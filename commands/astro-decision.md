---
description: Record an architectural decision (ADR-lite) so it's respected by future agents, not relitigated
argument-hint: <decision title>
allowed-tools: Bash, AskUserQuestion, ToolSearch, mcp__forge__forge_capture_knowledge
---

Capture a decision into the project canon.

1. Take the decision title from `$ARGUMENTS`. If empty, ask the user for it.
2. Ask the user (briefly) for the **why** and what was **rejected** (the alternatives
   and why not). Keep it to a sentence or two each.
3. Record it: `ac decision add "<title>" --why "<why>" --rejected "<rejected>"`.
4. Confirm the ADR id (and whether it landed `[shared]` on the orphan branch or
   `[local]`). It's now part of the canon injected into every `/astro-plan` and
   `/astro-execute` run, and — when shared — instantly visible to the whole team.
5. Once step 3 has succeeded, opportunistically stage the decision into the forge
   knowledge graph — see `` `$(ac path templates)/forge-knowledge.md` `` for the full
   detection/degradation rules and capture contract (tools absent → skip silently, no
   output). Lift the generator: strip every project noun, filename, number and proper
   name from the ADR. If what survives is vacuous or untrue as a general rule, capture
   nothing and say so in one line — do not force a generalization. Otherwise call
   `mcp__forge__forge_capture_knowledge` with the lifted generator and print ONE line
   summarizing what was staged to the human-approval queue. No confirmation prompt —
   this never gates or precedes the ADR already recorded in step 3, and a failed capture
   never fails the command.

Use this whenever a real architectural choice is made — stack, pattern, naming rule,
boundary. Small, frequent entries keep the canon honest.
