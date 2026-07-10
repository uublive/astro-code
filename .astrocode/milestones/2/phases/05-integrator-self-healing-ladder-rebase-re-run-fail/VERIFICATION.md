# Verification — Phase 05: Integrator self-healing ladder

## Re-verification addendum (UAT-gap fix, commit 2ee7854) — 2026-06-11

Status before this addendum: phase PASSED full verification, then was REJECTED at
human UAT for ONE gap: after a SUCCESSFUL heal the preserved `worktree-*` branch +
worktree were never torn down (no agent step, no narration). Consequence: stale
worktrees accumulate and the final verifier's `git rev-list HEAD..worktree-*`
un-integrated-commits check would false-FAIL a correctly healed phase. CONTEXT.md
required: "The dropped branch + worktree are preserved until the re-run's commit
lands — only then torn down."

### Verdict: PASS

The fix in commit `2ee7854` closes the gap goal-backward, with no regressions.

### Evidence (file: workflows/execute-phase.mjs)

1. **runTeardown + strict schema, gate-pass-only invocation.**
   - `TEARDOWN_SCHEMA` (lines 365-373) is `additionalProperties:false` with
     `required:['removed']` — a silent no-op teardown cannot read as success.
   - `runTeardown(w, branches)` (lines 387-401) is an executor agent step (ADR-005:
     the script never runs git; the agent does).
   - The call site (lines 635-649) is nested THREE levels deep, gating it exactly:
     `if (integ.integrated !== true && conflicts.length)` (542) →
     `if (ladderFired && !integrationFailed)` (614) →
     gate-pass `else` branch (628, after `if (!gate||!gate.passed)` sets
     `integrationFailed`). So teardown runs ONLY when: heal fired AND no integration
     failure AND the post-heal suite passed.
   - **Never-torn-down-on-failure confirmed.** A failed heal `break`s at line 604
     (sets `integrationFailed`, never sets `ladderFired`→ gate block skipped). A
     failed gate takes the `if` branch (616-627) which sets `integrationFailed` and
     does NOT call runTeardown. Both leave the preserved branch untouched for
     inspection (ADR-014).

2. **Prompt restriction + non-silent leftover advisory.**
   - The teardown prompt (389-399) passes the EXPLICIT `JSON.stringify(branches)`
     list and instructs "Touch ONLY the listed branches — any other `worktree-*`
     branch must stay untouched (it may be a preserved failed heal under inspection)."
   - Leftover diffing (645-648): `healedBranches.filter(b => !removed.includes(b))`
     → `⚠ preserved branch(es) not removed — clean up manually: ...`. Cleanup
     failure is non-fatal (not an integrationFailed) but never silent.

3. **Narration (ACCEPTANCE criterion-2).**
   - Line 639: `✓ wave N healed branch(es) torn down after re-run commits landed: ...`
     — matches ACCEPTANCE.md lines 11-13 ("a healed/torn-down line confirms the
     re-run's commit landed before the branch is cleaned up").

4. **'unknown' sentinel never reaches teardown.**
   - Line 586: `if (preservedBranch !== 'unknown') healedBranches.push(preservedBranch)`
     — the 'unknown' fallback (577) is excluded from `healedBranches`, so it can
     never be passed to runTeardown.

5. **Contract guard t8-5 (tests/workflows.test.mjs lines 810-850) is genuine.**
   Pins (a) `const TEARDOWN_SCHEMA` presence, (b) `runTeardown` + `teardown:w`
   label, (c) gate-before-teardown ordering via static index comparison
   (`indexOf('await runTeardown(') > indexOf('test gate passed after heal')`),
   (d) `clean up manually` advisory. Non-vacuity proven by mutation testing —
   each assertion independently FAILS t8-5 when broken:
   - schema removed (rename so substring absent) → not ok
   - ordering inverted → not ok
   - `teardown:w` label removed → not ok
   - `clean up manually` removed → not ok
   All four anchor strings occur exactly once in the source, so the ordering
   check is unambiguous.

6. **No regressions.**
   - MIRROR drift guard passes (test "execute-phase.mjs MIRROR region matches
     lib/waves.mjs").
   - Workflow style intact: no semicolons at end of code lines (only matches are
     inside comments); only `phase()/agent()/parallel()/log()` hooks plus local
     helpers; no `child_process/execSync/fs/process/console/fetch/import()` in the
     script body (ADR-005 — agents do git, the script doesn't).
   - ADR-014 invariants hold (drop-&-rerun ladder, no rebase, failed heal/gate
     preserved).
   - **Full suite (`node --test` from repo root): 193 tests, 193 pass, 0 fail,
     0 skipped** (duration ~21s). t8-5 is test #193.

7. **Hygiene.**
   - `git status`: clean for tracked files (untracked `.astrocode/`, `.claude/`,
     `AGENTS.md`, `LEAN-CTX.md` are pre-existing, unrelated to this fix).
   - Commit `2ee7854` is atomic: exactly two files — `workflows/execute-phase.mjs`
     and `tests/workflows.test.mjs`.

### Conclusion
The UAT gap is closed correctly. Teardown happens strictly after re-run commits land
AND the healed wave's suite passes; failed heals and failed gates preserve their
branches for inspection; the 'unknown' sentinel is excluded; leftovers are named, not
silent; and the contract guard genuinely pins the behavior. No regressions across the
full 193-test suite.
