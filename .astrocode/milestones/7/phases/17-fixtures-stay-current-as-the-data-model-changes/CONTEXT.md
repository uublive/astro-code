<!-- astro-discuss: captured -->

# Context — Phase 17: Fixtures stay current as the data model changes

## Goal

A phase that changes the data model cannot reach `verified` with stale fixtures. Phase 16
defines the contract; **this phase makes it stay true**.

## Why this exists

Fixtures written once at new-project time are stale by phase three, and then the ephemeral
preview is empty again in practice even though the machinery works. The known failure mode
is named explicitly: **a convention nobody checks**. This phase is the checking.

## Depends on phase 16

Phase 16 produces the two things this phase grips: a **stable seed entry point** (the
compose `seed` service delegating to the stack-native script) and a **stated contract**
(`RUN-CONTRACT.md`) that a criterion can be written against and a declaration can live in.
Phase 17 cannot start until 16 is accepted.

## Decisions

### D1 — Three layers, each doing what it is actually good at (ADR-050)
- **`CONVENTIONS.md`** states the rule. Canon is injected into every planning and execution
  agent, so this is what makes extending fixtures the default behaviour rather than an
  afterthought.
- **`CRITERIA.md`** is the enforcement. A behavioural criterion the verifier actually runs:
  after the one-command cold start, the app holds the state this phase's acceptance items
  assume. The phase **fails verification** if it doesn't.
- **The advisory check** covers the lanes where criteria never fire.

**Explicitly NOT a hard build gate.** The only thing a build gate can mechanically see is
that a file changed when a migration changed — forgeable by touching the file, false-failing
on correct work built differently, and the exact structural check
`agents/astro-criteria-author.md:41` forbids ("file X exists", "grep finds string Y").

### D2 — The advisory check is a new `ac` verb
Its own verb (e.g. `ac fixtures check`), in `ac preflight`'s posture: **exit 0 always,
silent when clean, never blocks a run the operator meant to make**. Being a real CLI verb
means it is testable in `lib/` and works in every host and every lane.

### D3 — The criteria-author is triggered by a standing rule keyed on the goal
The criteria-author is **plan-blind and runs before implementation exists**, so it cannot
read a diff. Its prompt gains a standing rule: when the goal or `CONTEXT.md` implies new or
changed persisted state, register the fixture criterion. It infers from what it already
reads — no new inputs, no new bookkeeping.

**Rejected:** a `touches_data_model` roadmap field (a human has to set it, which is the
convention-nobody-checks failure one level up) and a CONTEXT.md-only convention (silent for
every phase that skips discuss).

**Phrasing constraint:** the rule must be expressed as an **outcome** — "the booted app
contains X" — never "the seed file was edited". Phrased structurally it degrades into
precisely the check the criteria-author is forbidden to write.

### D4 — The data-model paths and seed source are declared in `RUN-CONTRACT.md`
It is already the one binding contract copied **verbatim** into the project by phase 16, so
the declaration joins its pinned values. One file, one place, and it survives astro-code
being removed from the project.

**Rejected:** the project's `CONVENTIONS.md` — canon is *distilled*, not copied, so stated
values can drift from the contract.

### D5 — A missing declaration says so; it never reads as clean
The check prints one line distinguishing **"no declaration — not checked"** from
**"checked, clean"**. Adopted codebases and anything predating this will have no
declaration, and a project that never opted in must not be indistinguishable from one that
passed. Silence must never mean fine — that is the failure mode of this whole phase in
miniature.

**Rejected:** glob heuristics as a fallback, even labelled as inferred — it reintroduces
the wrong-answer risk D4 exists to remove.

### D6 — The warning is both reported and filed
A line in the run's final summary for the moment it happens, **and** a debt entry for
durability. A warning that fires inside a background workflow and lands in scrollback
nobody opens is the same as no warning; `ac status` surfaces the debt count passively on a
command already run constantly (ADR-045's precedent — debt is a register agents fill).
`ac debt add` is idempotent, so a recurring warning becomes a **repeat sighting**, which the
register treats as signal rather than duplication.

### D7 — Invocation: wired into `/astro-execute`, after the waves
The same slot ADR-041's stamp audit occupies — the diff exists, the phase is not yet
verified, and it fires on every phase without anyone remembering to ask for it. A command
nobody invokes fails exactly the way a convention nobody checks does.

**Rejected:** hanging it on the verifier (it is deliberately plan-blind and adversarial about
one thing; a bookkeeping chore dilutes that) and manual-only invocation.

### D8 — The diff range is the phase's own stamped commits
ADR-017 stamps every task commit with `(phase NN tK)`, so the phase's changes are precisely
identifiable. This matches the claim being made — *this* phase touched the data model.

**Rejected:** branch-versus-base (attributes earlier phases' schema changes to whichever
phase runs last) and working-tree-versus-HEAD (wrong by construction — the workflow commits
once per task, so the tree is clean when the check runs).

### D9 — `/astro-fast` gets the check too
ADR-050 justified this layer **specifically** because criteria never fire in the fast lane,
where the verifier self-derives its bar and there is no criteria-author at all. Wiring it
only into `/astro-execute` would leave exactly the gap the layer was created to close.

### D10 — ACCEPTANCE preconditions get a guard test
ADR-050 requires `ACCEPTANCE.md` items to name the precondition state they assume. A test
asserts the planner prompt still carries that rule — the same technique phase 16's t8 uses
for the three cold-start outcome stems. Cheap, deterministic, and it catches a future prompt
rewrite silently dropping the sentence.

### D11 — Proof: unit tests on the check, plus one rehearsal of the criterion path
astro-code is a library/CLI with **no data model of its own**, so this machinery can never
fire in this repo. Unit-test `ac fixtures check` against fixture repos in `tests/` (fast,
deterministic regression cover), **and** run one scratch-project rehearsal that tries to
sneak a schema change past with stale fixtures and observes the criterion fail.

The forge brain holds a standing *prove-before-automating* principle — carry the workflow
out by hand end-to-end first and treat that manual output as the seed data for the
automation. That is an argument for the rehearsal, and it agrees with this decision.

## Open questions / assumptions left to the planner

- The verb's exact name and flag surface (`ac fixtures check` is indicative, not binding).
- The precise wording of the criteria-author's standing rule — must stay outcome-shaped
  per D3.
- Where the rehearsal project lives and whether it can reuse phase 16's scratch harness
  (`.scratch-p16/` and the host Docker bridge) rather than building a second one.
- **Assumption:** phase 16 lands `RUN-CONTRACT.md` in a form that can carry the declaration
  (D4). If 16's contract ends up shaped differently, D4 is the decision to revisit first.

## Debt

Checked at discuss time: none open against the files this phase implicates
(`agents/astro-criteria-author.md`, `agents/astro-verifier.md`, `workflows/plan-phase.mjs`,
`commands/astro-execute.md`, `templates/CONVENTIONS.md`). Nothing folded in.
