# Reproduction

- The issue's git-only case, run here: one commit `first plan: add parser (phase 29 t1)` → the Discover grep
  for `(phase 29 t1)` returns 1 line (done, skipped), for `(phase 29 t11)` 0 lines.
- `node --test tests/fix_replan_stamped_ids.test.mjs`: a phase with t1..t8 stamped (and a remediation stamp)
  and a re-plan that reuses t1..t3. Before the fix: all 3 tests fail (no `ac phase stamps`). After: the stamped
  ids and `next: t9` are listed, `--check` refuses t1, t2, t3 and passes t9, t10, and an unstamped phase starts
  at t1.
