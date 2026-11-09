**What happens.** `workflows/execute-phase.mjs` Discover marks a task `done:true` when `git log --oneline --fixed-strings --grep "(phase NN <taskId>)"` returns a line (line ~292 in v0.55.0). The grep covers the whole branch history, so when a phase is re-planned and the new `PLAN.md` reuses ids `t1..tN`, every new task matches the old plan's stamps and is skipped as already landed.

**Observed (houston, 2026-11-02, err-452).** Phase 29 was re-planned with fresh t1-t7 after an earlier plan had landed t1-t8. The execute run reported `executed 0, skipped t1-t7`, ran verify and one remediation, and ended FAIL 3/12 after ~3.2e6 ms and ~601k subagent tokens, with none of the new work built. We worked around it by renumbering the new tasks t11-t17.

**Minimal reproduction (clean git repo, no astro-code involved).**
```
git init . && git commit --allow-empty -m "first plan: add parser (phase 29 t1)"
git log --oneline --fixed-strings --grep "(phase 29 t1)"    # 1 line  -> done:true, skipped
git log --oneline --fixed-strings --grep "(phase 29 t11)"   # 0 lines -> would run
```

**Ask (any of).**
1. `/astro-plan` on a phase that already has stamped commits numbers the new tasks above the highest stamped id (or warns and refuses ids that collide).
2. Discover's done check is scoped to the current plan: stamps only count when the commit is newer than the plan file's last commit (`git log <plan-commit>..HEAD`), or the plan records the commit it was written at.
3. At minimum, Discover reports "N tasks matched stamps from before this plan was written" instead of a benign skip, so a re-plan cannot silently execute zero tasks.

Houston side: until fixed, a re-plan renumbers its tasks (tracked in our upstream register).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015kzahmoqoizcqknfadGMPK

(GitHub #186 by @luigi-lauro, verbatim above.)

## Diagnosis

- **Symptom:** a re-plan reusing t1..tN executes zero tasks ("skipped t1-t7").
- **Cause:** execute's Discover marks a task done when ANY commit on the branch carries `(phase NN tK)`; nothing
  on the plan side knew which ids the branch already used.
- **Fix chosen by the owner (2026-11-09):** the issue's ask 1, plan-time numbering, as the safer option. The
  execute-side scoping (ask 2) was considered and not taken: a committed edit to PLAN.md mid-phase would make
  already-landed tasks run again.

## Fix

- `lib/stamps.mjs` + `ac phase stamps <n> [--json]`: the task ids already stamped for the phase (remediation
  stamps excluded) and the next free `tN`.
- The planner (`agents/astro-planner.md`, the `plan-phase.mjs` Synthesize prompt) numbers new or changed
  tasks from that free id; a stamped id is kept only for the same, already-landed task.
- `ac phase stamps <n> --check` exits 1 naming every PLAN.md id that collides with a stamp; `/astro-plan`
  step 3a runs it and asks before committing, so a reused id is never a silent skip.

## Verification

- Repro `tests/fix_replan_stamped_ids.test.mjs`: 3/3 fail before, pass after; with the command, workflow, agent and CLI contract tests: 286 pass.
- Full suite: 2,855 pass, 0 fail (run with `ASTRO_SIGNER_AGENT` unset; with it set, 14 signer-kind tests fail regardless of this change — they assume a human signer).
