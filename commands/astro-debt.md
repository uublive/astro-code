---
description: Review the technical-debt register — what's open, whether it's worth paying down now, and triage what isn't real
argument-hint: "[--file <path> | --phase <n> | --stale]"
allowed-tools: Bash, Read, Grep, Glob, AskUserQuestion
---

Show the technical-debt register and help the user decide what to do with it.

The register fills itself — the phase verifier files what it notices outside its criteria
— so this command exists for the other half: **reading it, and keeping it honest**. A
register nobody reviews becomes the thing it replaced.

## Steps

1. **Read the register.** Run both, and pass through any argument the user gave
   (`--file <path>`, `--phase <n>`, `--stale`):

   ```
   ac debt score
   ac debt list $ARGUMENTS
   ```

   If there is no open debt, say so in one line and stop. Nothing to review is a good
   outcome, not an empty report to dress up.

2. **Present it so it can be acted on**, not as a dump of the CLI output:
   - Lead with the **pressure number and its band, in one line**, stating what it means:
     *healthy* = your debt is not charging you, keep building; *watch* = something is
     concentrating; *pay-now* = the register is charging about what clearing it would cost.
   - Then the items, **grouped by file, one line per item**: the file name, then each of
     its items — no table. Concentration is the thing that makes a file unpleasant to work
     in, and it is invisible in a flat list.
   - Mark the ones carrying real evidence: `re-found in phase N` (the verifier hit it
     again — the strongest signal there is) and `⚠ N days old`.
   - Keep each item to its title plus one line of why. Use `ac debt show <id>` for detail
     on anything the user asks about, rather than pasting every `--why` up front.

3. **Say what you would do**, in two or three sentences — which items look worth taking
   on now and which are noise. Ground it in the score's evidence, not in how the code
   makes you feel: recurrence and concentration are facts, "this looks messy" is not.

4. **Offer the exits, one `AskUserQuestion`.** Do not act unprompted — the register
   emptying itself is exactly how it stops being trusted.
   - **Tackle one now** → tell them to run `/astro-debt-pay <id>`, which routes the item
     to the right treatment and lands it.
   - **Not debt** → `ac debt dismiss <id> --reason "…"`.
   - **No longer true** → `ac debt drop <id> --reason "…"`.
   - **Leave it** → nothing; it keeps surfacing at `/astro-discuss` and milestone close.

   **When you actually run one, say which and why in one line, not before.** A drop is a
   fact about the code (it moved on); a dismissal is a fact about the verifier (the finding
   was never real) and is the only measure of the feed's precision — if the false-positive
   rate in `ac debt score` climbs, tighten the verifier, not the register.

5. **Never file debt from this command, and never close an item because it looks stale.**
   Filing is the verifier's job (it has just driven the real code); closing needs either
   the work to be accepted or a human's explicit reason. Both bypasses are how a register
   turns back into a diary.
