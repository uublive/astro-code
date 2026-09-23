<!-- astro-discuss: captured -->

# Context — Phase 19: Agent output leads with what changed, not what was done

## Goal

astro-code's human-facing output leads with the decision or the change, and keeps evidence
short and beneath it. Whoever uses the framework gets that by default, rather than by
knowing to ask for it.

## Why this exists

The operator's observation, from a full day of running the loop: these tools write a lot,
most of it deep technical detail, and it becomes noise. Verified against this session's own
transcript — tables restating output already printed directly above them, per-criterion
recaps of a verdict that was already a PASS, multi-paragraph commit messages, an eight-file
deletion explained at greater length than the files were worth.

The useful split is **not** long versus short. It is:

- **things that change what the reader does** — *t5's work landed inside t4's commit*,
  *677 tests were green while both bugs were live*, *an editor is corrupting debt.json*
- **evidence that work happened** — everything else

Almost all the noise was the second kind. The mechanism is an asymmetry, not a style choice:
the writer does not pay the reading cost, omitting something important is a visible failure
while including something unimportant is a diffuse one, and length is a cheap proxy for
diligence. Every gradient runs toward more, so it has to be corrected deliberately.

## What the code already does (grounding — read before planning)

- **The instinct exists, ad-hoc.** Roughly eleven per-slot brevity instructions are scattered
  across `commands/` — "say so in one line", "say nothing at all when there is no relevant
  debt", "do not list them in full", "in exactly one line". Each reads like it was added
  after someone got buried. There is no principle behind them, so slots nobody got burned on
  stayed verbose. That is why quality varies by command.
- **The only global voice rule pushes the other way.** `.astrocode/CONVENTIONS.md` §Voice
  says comments carry *"high, explanatory density"*. Correct for code comments, injected into
  every agent as canon, and with **no counterpart** describing how to write to a human.
- **Generated projects inherit nothing.** `templates/CONVENTIONS.md` has no Voice section at
  all.

## Decisions

### D1 — The rule governs human-facing messages only
Command reports and summaries get it. `PLAN.md` and `CRITERIA.md` stay as dense as they need
to be: a verifier and an executor read them, and their detail is exactly what caught C7 and
the stale-fixture case. **Thinning the machine-read artifacts would attack the thing that
works.**

### D2 — The verifier stays verbose; the command summarises
The verifier keeps writing full reproductions into its structured return and the log — that
long-form evidence caught C7 when 677 passing tests did not. The **command** that reports to
the human leads with the verdict and the one-line cause, with the evidence available on
request.

The bug was never that the verifier wrote too much. It was relaying 800 words of it into a
channel that needed 20. Machine-readable artifacts and human messages are different
audiences; the failure was writing one thing for both.

### D3 — The rule ships to generated projects
A Voice section is added to `templates/CONVENTIONS.md` so every new project inherits it.
This is the operator's actual ask — *whoever uses it gets the same quality* — and it cannot
be met by fixing only astro-code's own commands.

### D4 — A slot passes the guard test by stating a line budget or a silence rule
Every human-facing reporting slot states either **how much it may emit** ("one line, naming
the count") or **when it emits nothing** ("say nothing when clean"). Concrete, greppable, and
it matches the shape of the eleven instructions already present, so the existing ones become
compliant rather than needing rework.

### D5 — Enforcement is a guard test on slot shape, and nothing stronger
A test asserts each reporting slot still specifies an output form — the technique phase 16's
t8 already uses to assert the three cold-start wordings survive a prompt rewrite. It tests
the **shape, not the quality**.

**Stated limit, deliberately not papered over:** you cannot mechanically test whether a
paragraph earned its place, and a word-count gate would just produce worse writing. A canon
rule alone was rejected — a convention nobody checks is the precise failure mode phases 17
and 18 exist around.

### D6 — Free-form narration gets a canon rule, honestly labelled unenforced
Most of the observed noise was the main session's prose between tool calls, not output from
a declared slot. The rule is stated in `CONVENTIONS.md` and `AGENTS.md` so it shapes default
behaviour, and **the phase says plainly that this half is convention, not enforcement**.

Naming the limit is the point. Claiming the guard test covers free prose would be the same
class of dishonesty as a success line that reports intent instead of outcome — which this
session found three times.

### D7 — The loop commands are audited first
`discuss`, `plan`, `execute`, `verify`, `accept`, `status`, `debt` — the ones run constantly,
so the highest noise reduction per edit. The rest follow the convention without a specified
slot until someone touches them.

An exhaustive 26-command audit was rejected: a large diff across files whose prose is
load-bearing, with real chance of breaking an instruction that mattered.

## Scope

**In scope:** the Voice rule in both canons, per-slot shape specifications across the loop
commands, the template section for generated projects, and the guard test.

**Out of scope:** the content of `PLAN.md` / `CRITERIA.md` (D1), and any change to the
existing "high explanatory density" rule for code comments — that rule is right for what it
governs.

## Open questions / assumptions left to the planner

- Exact wording of the Voice section, and whether it carries a worked before/after example (a
  demonstrated shape transfers to an agent better than an adjective like "concise").
- Which test file the guard lives in — `tests/commands.test.mjs` is the obvious home.
- Whether the existing §Voice comment rule is extended in place or gains a sibling section.
  It must not be weakened; it is correct for code comments.
- **Assumption:** the eleven existing per-slot instructions already satisfy D4's bar and need
  no rework. The planner should verify this rather than take it on faith — if several fail,
  the audit is larger than D7 assumes.
