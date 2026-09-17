# Report

Found during UAT of Milestone 6 (`/astro-accept 11 12 13 14 15`).

Phase 14 was rejected with `ac phase reject --reason "…"`, which records a blocker in
`.astrocode/state.json`. It was then accepted with `ac phase accept --force` once its
ACCEPTANCE.md had been amended. The phase became `complete`, but `ac status` still
reported `Blockers: 1`, pointing at the now-accepted phase.

Worse: `completeMilestone` never touches `state.json`. It archives the phase directories
and clears `roadmap.phases`, so the blocker would survive into Milestone 7 referencing a
phase that no longer exists in the roadmap at all — an unresolvable entry that nothing
can clear, because there is no CLI command to remove a blocker.

Two defects, one symptom:
1. `ac phase accept` does not clear a blocker recorded by a prior reject of that phase.
2. `completeMilestone` does not clear blockers belonging to the phases it archives.
