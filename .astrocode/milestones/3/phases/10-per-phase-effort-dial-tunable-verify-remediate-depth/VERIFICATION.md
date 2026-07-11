# Verification — Phase 10: Per-phase effort dial (ADR-022)

**Verdict: PASS (AI gate).**

## How it was verified
Executed sequentially on-branch (opus executors), then the P9 adversarial, plan-blind
verifier graded the result **against the pre-registered `CRITERIA.md`** (10 criteria) —
the first production use of the P9 machinery on a real phase. It did not read PLAN.md,
and gathered independent evidence per criterion (including behavioral harnesses that
drove the real remediate loop). I then **independently re-verified** the load-bearing parts.

## Evidence
- **Full suite:** `node --test` → **308 pass, 0 fail** (was 282; +26 new: `tests/effort.test.mjs`,
  the `tests/workflows.test.mjs` remediate-loop guards, `tests/commands.test.mjs` doc guards).
- **Per-criterion (verifier, independent evidence):** C1 storage/default/validation; C2 atomic
  no-clobber write incl. concurrent; C3 cycles 0/1/3 + unknown→1; C4 deep→opus with no config
  mutation; C5 `--effort` precedence, no write-back; **C6 the no-progress bail** driven through
  all three cases (HEAD-unchanged→bail, HEAD-moved-but-set-unshrunk→bail, HEAD-moved+shrunk→continue),
  never `verified`; C7 remediation scoped to unmet criteria + evidence, reuses astro-executor;
  C8 no global effort knob; C9 two-gate intact + research effort-invariant (3 angles); C10 fast
  lane light.
- **My independent probe** of `lib/effort.mjs`: cycles 0/1/3/unknown→1; `resolveEffort`
  override>stored>default; `effortModels` deep→opus with the base map untouched; `validateEffort`
  throws on a bad level. Read the t4 loop by hand — both no-progress bails keep `passed:false`
  and precede budget spend; light/absent-CRITERIA correctly degrade to single-pass.

## One fix applied (the verifier's flagged issue)
The verifier flagged a cosmetic-but-dishonest telemetry label: a single-pass FAIL (light, or
no CRITERIA.md) never entered the loop, so `stoppedReason` kept its `'passed'` default on a
FAILED verdict. The gate reads `verdict.passed` (no false-pass risk), but a "passed" label on a
failure is exactly the kind of untrustworthy signal this milestone exists to kill. Relabeled →
`'single-pass'`. Suite re-run green (308).

## Conclusion
The effort dial works end-to-end: per-phase level (persisted, validated, `standard` default),
the automated verify→remediate loop bounded by cycles **and** stop-on-no-progress, deep→opus,
`--effort` override, fast-lane-light, two-gate closure intact. Goal met.
