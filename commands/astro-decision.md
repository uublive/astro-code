---
description: Record an architectural decision (ADR-lite) so it's respected by future agents, not relitigated
argument-hint: <decision title> | renumber <file|id> <N|next> | backfill
allowed-tools: Bash, AskUserQuestion
---

Capture a decision into the project canon.

1. Take the decision title from `$ARGUMENTS`. If empty, ask the user for it.
2. Ask the user (briefly) for the **why** and what was **rejected** (the alternatives
   and why not). Keep it to a sentence or two each.
3. Record it: `ac decision add "<title>" --why "<why>" --rejected "<rejected>"`.
4. Confirm the ADR id (and whether it landed `[shared]` on the orphan branch or
   `[local]`), naming the ADR file when the project has an ADR folder. It's now part of the canon injected into every `/astro-plan` and
   `/astro-execute` run, and — when shared — instantly visible to the whole team.
5. **Propose the principle behind it.** The why/rejected came from the user in this
   turn — see `` `$(ac path templates)/principle-capture.md` `` for the full gate,
   the lift rule, the volume cap and the invocation; here only this moment's own
   binding: `--from-ref "ADR-<nnn>"` (the id step 3 printed), excerpt = the why the
   user gave. Runs strictly after step 3 has already succeeded. Reporting is exactly
   one line, or say nothing when nothing was proposed.

Use this whenever a real architectural choice is made — stack, pattern, naming rule,
boundary. Small, frequent entries keep the canon honest.

**Two other forms** (when `$ARGUMENTS` starts with the word):

- `renumber <file|id> <N|next>` — two decisions took the same ADR number. Run
  `ac decision renumber <file|id> <N|next> --dry-run` first and show the user its lines,
  then run it without `--dry-run`. It moves that one decision to a freshly claimed number and
  rewrites only the citations its own branch added; report the lines it listed for a human.
- `backfill` — the one-time upgrade for a project with an ADR folder. Run
  `ac decision backfill` (a dry run) and show the plan; run `ac decision backfill --apply`
  only on the user's word.

**Asking the user:** whenever this command asks the user anything, follow `$(ac path templates)/asking.md` — frame the round in plain words first, start each question from its visible effect, and keep an "Explain more" option.
