<!-- astro-discuss: captured -->
# Context — Phase 6: Wave fork-base guard & executor file-ownership enforcement

Decisions settled with the user 2026-06-11. This phase closes the gap phase 5
deliberately left open: a CLEAN-but-wrong fold from a stale-base or overflowing
worktree branch never triggered the heal ladder. Both causes are from the phase-04
incident (`todo.md` → "Self-healing parallel-wave integration", causes 1 and 2).
Builds directly on phase 5's ladder in `workflows/execute-phase.mjs` (ADR-014).

## Decisions

- **The fork-base check lives in the INTEGRATOR.** Key invariant: only the integrator
  advances HEAD during execution, so at integration time HEAD *is* the tip every
  worktree in the wave should have forked from. Before cherry-picking each
  `worktree-*` branch the integrator runs `git merge-base HEAD <branch>`; any answer
  other than the HEAD sha means a stale fork base. Zero new plumbing. Rejected:
  threading the expected SHA through the script/schema (duplicates what HEAD already
  encodes); executor self-checks (an executor cannot know the intended base).
- **Stale base ⇒ ALWAYS route to the heal ladder — even when the cherry-pick would
  apply cleanly.** Textual cleanliness proves nothing (phase-04: auto-merge stacked
  duplicate helpers with zero conflict markers). The stale branch is never
  cherry-picked; it is preserved and reported like a conflict (`{branch, taskId}`),
  the task re-runs fresh at the integrated tip, and the wave pays the test gate +
  post-gate teardown exactly as phase 5 defined. Rejected: cherry-pick + gate
  (green suite can miss stacked duplicates); warn-only.
- **File-ownership enforcement is hard ONLY on wave collision.** The integrator
  diffs each branch (`git diff --name-only <merge-base>..<branch>` style) against the
  task's declared file(s):
  - overflow into a file claimed by ANOTHER task in the SAME wave → the real
    co-scheduling hazard → route to the heal ladder (never integrate two parallel
    attempts at one file);
  - overflow into files nobody in the wave claims → integrate WITH a ⚠ advisory
    naming the extra files (the phase-04 t14 hooksPath fix was legitimate — blanket
    rejection would have thrown away good work).
  Rejected: always-hard (rejects legitimate fixes, forces pointless re-runs);
  warn-only (leaves the t5-style hazard open — defeats the phase).
- **The test gate extends to anomalous waves.** Phase 5's `ladderFired` trigger
  becomes `ladderFired || overflowFlagged`: any wave that deviated from its contract
  (healed OR integrated-with-overflow-⚠) proves itself green before later waves build
  on it. Clean, contract-conforming waves still skip the gate.

## Scope

In scope:
- `workflows/execute-phase.mjs`: integrator prompt additions (merge-base staleness
  check; per-branch changed-files vs declared-files comparison with the wave's claim
  map; routing rules above), any small schema additions needed to report staleness/
  overflow distinctly (keep `additionalProperties:false`), the gate-trigger extension,
  result-shape observability for overflow advisories, and `log()` narration for both
  new anomaly types.
- Executor prompt hygiene (`execPrompt`, and `healPrompt` consistency): instruct
  "touch ONLY your declared file(s); if other changes are genuinely required, say so
  in your summary" — the integrator, not the executor, decides what that means.
- Contract guards in `tests/workflows.test.mjs` pinning: the merge-base check is in
  the integrator prompt, stale-base routes to heal (not cherry-pick), the
  collision-vs-harmless overflow distinction, and the extended gate trigger.
- Mirror/pure-helper rule: any non-trivial decision logic (e.g. classifying overflow
  as collision vs harmless given the wave claim map) should be a pure helper in
  `lib/waves.mjs` re-exported per the `resolveHealList` pattern, unit-tested in its
  own test file, and MIRROR-copied so the drift guard covers it.

Out of scope:
- Task-id commit stamps / Discover done-detection → phase 7 (do not couple; the
  integrator maps tasks the phase-5 way).
- Planner-side task-split safeguards → phase 8.
- The sequential strategy path (no worktrees, no integrator — prompt hygiene applies
  to all executors, but detection/routing is parallel-only).
- No changes to `lib/heal.mjs` semantics beyond what routing reuse requires.

## Notes for the planner

1. **Heal re-runs need NO file restriction:** by the time a collision-overflow task
   re-runs, it executes sequentially on-branch — the co-scheduling hazard is gone.
   Keep `healPrompt` unrestricted; bias to fresh implementation as in phase 5.
2. Integrator check order: staleness first (one cheap merge-base per branch), then
   changed-files classification, then cherry-pick — report each branch under exactly
   one outcome (integrated / integrated-with-⚠ / routed-to-heal with reason).
3. A wave can mix outcomes; the gate fires once per wave if ANY branch healed or
  ⚠-overflowed. Phase 5's teardown applies only to healed branches, as shipped.
4. Wildcard `'*'` file claims (tasks with no declared file) already force solo waves
   via `claimedFiles` — a solo wave has no collision partner; overflow there is
   harmless-⚠ by definition.

## Canon reminders

Workflow scripts: no semicolons, hooks only, no git/fs in script body (ADR-005: the
integrator is the git actor). ADR-014 ladder semantics are settled — reuse, don't
fork. Pure helpers live in `lib/` with the MIRROR pattern. High-density "why"
comments naming the phase-04 incident causes (#1 stale base, #2 overflow).
