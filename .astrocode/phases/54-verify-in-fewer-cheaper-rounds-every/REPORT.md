# Why phase 54 exists — evidence gathered 2026-10-28 (input for /astro-discuss, not a decision record)

Matteo: "the verification phase is still soooo long … what if whatever doesn't pass in the verification
could be flagged as a bug and so the verification passes and we can move forward? of course those bugs are
tracked and need to be resolved." / "in astro-bot each verify pass is taking ages."

astro-code (phases 51, 52): one verify run 10–15 min (suite ~2 min); 9 recorded runs per phase, because each
narrowed FAIL stops at the first unmet criterion and every round finds one new gap.

Astrobot (git log of chore(verdict) commits):
- phase 104: 10 runs over ~22 h before a full PASS; phase 105: 7 full FAILs in ~9 h, ~1.5 h apart.
- every run since 104 run 5 records reason "broad fix declared by the verifier" → full, never narrowed.
- criteria are heavy scenarios: scratch hostd world with several people, a pre-phase binary built from a
  fixed commit, `bash scripts/gate.sh all` with a stage on the Mac — rebuilt every run.
- failing sets flip between runs (104: C4/C5/C6 pass, fail, pass) — regressions from fixes or verifier
  inconsistency; one-gap-per-round hides it.

Proposed scope (agreed in principle by Matteo, details for discuss):
1. every unmet criterion reported in one FAIL run, not only the first;
2. a fast first check (suite + each criterion's cheapest observation) before the full adversarial run;
3. remediation starts on known failures while the remaining criteria are still being checked;
4. human-chosen deferral: a failed edge-case criterion becomes a tracked fix (repro pre-filled) and the phase
   may be verified with it listed; core criteria never deferrable; the milestone cannot close while those
   fixes are open; never automatic;
5. a "broad" claim must name what the fix touches and code checks it against the criteria's file map
   (lib/impact.mjs, phase 52), so re-verifies narrow when they can;
6. expensive setup (builds keyed by commit, scratch worlds) cached across runs on the same commit.
