<!-- pre-registered: written plan-blind, before any PLAN.md existed -->

# Criteria — Phase 17: Fixtures stay current as the data model changes

Pre-registered success bar. Derived from the phase goal, `CONTEXT.md` (D1–D11) and
ADR-050/ADR-052 only. Every criterion is an outcome; a different-but-valid implementation
of the same goal must still satisfy all of them.

Notation used below: **the check** = whichever `ac` verb this phase ships for fixture
currency (discover it from `node /Users/buu/Development/astro-code/bin/ac.mjs help`; the
exact name was left open by CONTEXT.md). **the declaration** = the data-model-paths +
seed-source declaration whose home and format are stated in `RUN-CONTRACT.md`.

---

### C1 — The check reports three distinguishable outcomes — fired, clean, and not-checked — and never fails a run
- **Observe:** In three throwaway git repos built under the scratch dir (each with an
  `.astrocode/` project state and the phase set to `17`), using only the declaration format
  documented in the project's own `RUN-CONTRACT.md` copy:
  (A) declare a data-model path and a seed source, commit a baseline, then commit a change
  to the declared data-model path with an ADR-017 stamped subject (`… (phase 17 t2)`) and
  leave the seed source untouched;
  (B) same as A but the same stamped commit also changes the declared seed source;
  (C) no declaration at all.
  Run the check in each with `; echo "exit=$?"`. Required: **A** prints a finding that names
  the phase and the changed data-model path; **B** prints nothing at all; **C** prints one
  line that says in plain words that nothing was checked because there is no declaration.
  All three exit `0`, and A's and C's outputs are not the same text.
- **Fails if:** any run exits non-zero; A is silent (stale fixtures pass unnoticed); B emits
  output (noise on correct work destroys the silent-when-clean posture); C is silent or its
  wording is indistinguishable from B's clean result, i.e. an un-opted-in project reads as
  passing; or the check throws / prints a stack trace on the missing-declaration repo.

### C2 — A finding is attributed to the phase that actually changed the data model, not to whichever phase ran last
- **Observe:** Build a repo that declares a data-model path and a seed source, then:
  (i) commit a change to that declared path with an **earlier** phase's stamp
  (`… (phase 15 t3)`) plus an unstamped commit that also touches it, then commit phase 17's
  own stamped work touching only unrelated files; run the check for phase 17 → it must print
  nothing;
  (ii) in a second repo, put the declared-path change inside a phase 17 stamped commit, leave
  the working tree **clean** (nothing uncommitted, matching how the real workflow commits once
  per task) and run the check for phase 17 → it must fire.
- **Fails if:** (i) fires — the implementation diffs branch-versus-base or merge-base and
  blames phase 17 for phase 15's schema change; or (ii) is silent — the implementation only
  looks at uncommitted working-tree changes, so it can never fire in the lane that invokes it.

### C3 — A finding survives the run: it is filed as debt, and a repeat sighting does not become a second item
- **Observe:** In the C1-scenario-A repo, run the check, then
  `node /Users/buu/Development/astro-code/bin/ac.mjs debt list --json` → an open item exists
  that identifies the phase and the declared data-model path involved. Re-run the check for a
  later phase number with the same violation and list again → still exactly one item for that
  violation, now carrying the extra sighting (e.g. `also_found_in`), and the open-debt count
  has not grown.
- **Fails if:** nothing is filed (the warning lives only in scrollback, which CONTEXT.md D6
  calls equivalent to no warning); or each invocation files a fresh item, so the register
  inflates and pressure/`ac status` signal is destroyed.

### C4 — Both orchestrated lanes run the check after their waves without anyone asking, and its result reaches the run's final summary
- **Observe:** Read the `/astro-execute` and `/astro-fast` orchestration specs and confirm the
  check is an unconditional step that runs **after** the task waves (the slot ADR-041's stamp
  audit occupies) and whose output is folded into the run's final summary the operator reads —
  not an optional or operator-typed step. Then prove the wiring is regression-covered: make a
  copy of the repo in the scratch dir, delete the check's invocation step from
  `/astro-execute`, run `npm test` in the copy → the suite must fail naming the missing check;
  repeat the deletion for `/astro-fast` → the suite must fail again.
- **Fails if:** either lane only runs the check when a flag is passed or a human types it; the
  check runs before/inside the waves (where the stamped diff it needs does not exist yet); its
  output is not surfaced in the summary; or removing either invocation leaves `npm test` green,
  meaning the next prompt rewrite silently drops the lane.

### C5 — The behavioural criterion actually catches stale fixtures: a re-runnable rehearsal shows a data-model change with stale fixtures failing the cold-start-state check, and passing once fixtures are extended
- **Observe:** Follow the rehearsal's own recorded commands (as phase 16's
  `COLD-START-REHEARSAL.md` did) against a scratch app project, driving the real one-command
  cold start (use the `host` bridge for Docker if the container lacks it). Required, in order:
  with the schema change landed and fixtures **not** extended, the cold start comes up
  healthy and a query for the state the acceptance items assume returns **absent/empty** — the
  criterion FAILS; after extending the seed's fixtures at the declared seam and nothing else,
  the same cold start returns that state present — the criterion PASSES.
- **Fails if:** the rehearsal is only a narrative with no commands a third party can re-run;
  both variants report the same result (the criterion cannot discriminate stale from current);
  the "failure" is the app failing to boot or the seed exiting non-zero rather than the
  expected state being absent from a healthy app; or the pass required editing anything beyond
  the fixtures.

### C6 — A generated project keeps the rule and the declaration on its own, with astro-code deleted
- **Observe:** Assemble a project from the shipped canon alone (the `RUN-CONTRACT.md` copied
  verbatim plus the generated project `CONVENTIONS.md`) in the scratch dir, with no astro-code
  checkout reachable from it. Reading **only** those project files, answer two questions
  concretely: (a) what must happen to fixtures when a phase adds a table/column, stated as the
  state the booted app must hold — not as "edit the seed file"; (b) exactly where and in what
  format to declare the data-model paths and the seed source. Then write a declaration
  following only those instructions, and run the check against that project → it must parse
  the declaration and produce a clean or fired result (never "not checked").
- **Fails if:** either answer can only be found in astro-code's own repo (the project stops
  being self-sufficient the moment astro-code is removed); the rule is phrased as a file-edit
  obligation rather than an observable state outcome; or the check reports "not checked" /
  errors on a declaration written faithfully from the documented format, i.e. the real format
  is an undocumented one only the implementation knows.

### C7 — The regression cover bites: the suite is green and deterministic, and each of the three silent-drop failure modes breaks it
- **Observe:** In the repo, `npm test` passes twice in a row with no network access and with
  `git status --porcelain` unchanged afterwards. Then, in a scratch copy, apply each mutation
  separately and re-run `npm test`, expecting a failure each time: (1) make the check
  unconditionally silent/clean; (2) remove the criteria-author's standing rule about goals
  implying new or changed persisted state; (3) remove the planner's rule that `ACCEPTANCE.md`
  items name the precondition state they assume.
- **Fails if:** the suite is red, order-dependent, needs the network, or leaves files behind;
  any mutation leaves the suite green (the "test" asserts nothing that would notice the
  behaviour disappearing); or the added cover exercises the check only through a stub instead
  of a real repo with real stamped commits.
