# Conventions — {{NAME}}

> The rules new code MUST follow. Keep this short and current — every planning and
> execution agent reads it before touching code. Vague canon = inconsistent code.

## Stack

- Language / runtime:
- Frameworks / key libraries:
- Why this stack (one line):

## Naming

- Files / modules:
- Functions / variables:
- Tests:

## Patterns

- Error handling:
- State / data flow:
- Async / concurrency:
- Config & secrets:

## Testing

- Framework:
- What must be tested:
- Style (e.g. no source-grep tests, real code paths):

## File layout

- Where new code goes:

## Voice

A report to a human **leads with the change or the decision** and keeps the evidence short
and beneath it. Two kinds of output exist: things that change what the reader does (a
decision, a bug found, a count that matters), and evidence that work happened (everything
else). Lead with the first kind; cut the second, or say in one line where the full version
lives instead of pasting it.

Every reporting slot — a command's summary, a status line, a completion message — states
either **how much it may emit** ("in one line, naming the count") or **when it emits
nothing** ("say nothing when there is nothing to report"). A slot with no stated bound tends
toward more, because omitting something feels risky and including something extra feels
free — so state the bound explicitly rather than trusting judgment in the moment.

This rule governs human-facing messages only. `PLAN.md`, `CRITERIA.md`, and a verifier's
structured return and log stay as dense as they need to be — thinning a machine-read artifact
to satisfy this rule would remove the detail another automated step depends on.

Free-form narration — the prose written between actions, not from a declared reporting slot
— should follow the same instinct: lead with the change, keep evidence short. This half is
convention, not enforcement — nothing checks it.
