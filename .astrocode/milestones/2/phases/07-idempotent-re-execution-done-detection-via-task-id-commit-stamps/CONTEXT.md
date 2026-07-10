<!-- astro-discuss: captured -->
# Context — Phase 7: Idempotent re-execution (done-detection via task-id commit stamps)

Decisions settled with the user 2026-06-12. Phase-04 incident cause: after a partial
failure, re-running `/astro-execute` re-executes completed tasks because Discover
returns every PLAN.md task with no done-awareness (`todo.md` § "Done-detection on
re-run"). This phase makes `/astro-execute` resumable: stamp → detect → skip.

## Decisions

- **Canonical stamp = subject suffix `(phase NN tK)`.** Codifies the convention
  executors already use ad hoc (13 of the last 30 commits carry it), stays visible in
  `git log --oneline`, matches with a plain `--grep`, and is RETROACTIVELY compatible
  — phases executed before this feature already match. `NN` is the zero-padded
  project-global phase number from the slug; `tK` the plan task id. Rejected: git
  trailer `Astro-Task:` (cleaner but invisible in oneline, no retro match, new format
  to teach); both (two things to drift).
- **Done-detection lives in the extended Discover agent.** Discover already reads
  PLAN.md; its prompt additionally checks the current branch's `git log` for each
  task's stamp and `TASK_SCHEMA` gains a required `done: boolean` per task. One
  round-trip, no new agent. The instruction must be DEAD SIMPLE (Discover runs on the
  configured `discover` tier — possibly haiku): one grep per task, mechanical.
  Rejected: a separate pre-flight agent (extra run paid on every execution, even
  first runs).
- **Stamp = done; the verifier backstops.** A found stamp skips the task — no
  pre-flight suite run, no file-touch archaeology. The end-of-phase verifier already
  goal-checks the real tree, so a wrongly-skipped task surfaces there. The inverse
  failure mode is safe by construction: a MISSING stamp merely re-runs a task —
  safe-over-fast. Rejected: stamp+green-suite pre-flight; stamp+file-touch heuristic.

## Scope

In scope:
- `workflows/execute-phase.mjs`:
  - Discover prompt + `TASK_SCHEMA` (`done: boolean`, required; keep
    `additionalProperties:false`).
  - Skip wiring: done tasks are never executed; narrate each skip
    (`• task tK already on branch (stamp found) — skipping`); result gains
    `skipped: [taskIds]` alongside `healed`.
  - Wave building: done task ids PRE-SEED the completed set so dependents are ready
    in wave 1 — done tasks are filtered from execution but their ids satisfy
    `depends_on`. This is a pure change (e.g. `buildWaves(tasks, preCompleted)`)
    in `lib/waves.mjs`, unit-tested, MIRROR-copied per the established pattern.
  - All-done short-circuit: if every task is done, skip Execute entirely and go
    straight to Verify (a phase may have executed fully but failed verification —
    verify must still run).
  - Stamping instruction added to `execPrompt` AND `healPrompt`: end the commit
    subject with `(phase NN tK)` (NN/tK interpolated per task).
- `commands/astro-execute.md`: the Agent-tool sequential fallback tells its executors
  to stamp the same way (one line — keep the command spec thin).
- Tests: unit tests for the `buildWaves` pre-seed change in `tests/waves.test.mjs`;
  contract guards in `tests/workflows.test.mjs` (schema carries required `done`,
  Discover prompt mentions the stamp grep, `skipped:` in the return, exec/heal
  prompts carry the stamp instruction, MIRROR drift stays green).

Out of scope:
- Planner-side task-split safeguards → phase 8.
- Stamp ENFORCEMENT (verifying every landed commit is stamped, warning on unstamped)
  — unstamped work is self-correcting (it re-runs); enforcement is ceremony. Deferred
  note only.
- Reverted-commit detection (a stamp from a later-reverted commit reads as done) —
  the verifier backstop covers it; do not build git archaeology.

## Notes for the planner (binding)

1. **Grep precision — the t1/t14 trap:** the match MUST include the closing paren:
   `--grep "(phase 07 t1)"` with fixed-string semantics (or regex-escaped parens),
   never a bare `t1` substring — `(phase 07 t1` would match `t14`. Spell the exact
   pattern in the Discover prompt.
2. The stamp's NN must be derived from the phase slug's leading number at prompt-build
   time (the script has `phaseSlug`) — don't make the Discover agent invent it.
3. `skipped` tasks must not appear in `executed` counts; keep
   `executed: results.length` semantics intact.
4. Skips happen at discovery time only — do not re-check mid-run (a task completed by
   THIS run is tracked by the run itself, not by stamps).

## Canon reminders

Workflow scripts: no semicolons, hooks only, no git/fs in the script body (agents do
git — ADR-005). Pure helpers in `lib/waves.mjs` with the MIRROR pattern + drift guard.
Schemas keep `additionalProperties:false` at every level. High-density "why" comments
naming the phase-04 re-run cause. ADR-014/015/016 ladder semantics are settled —
done-detection composes with them, never alters them.
