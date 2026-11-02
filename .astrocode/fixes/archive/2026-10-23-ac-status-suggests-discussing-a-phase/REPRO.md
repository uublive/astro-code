# Reproduction

Test: `tests/fix_status_sibling_milestone.test.mjs` — the issue's fixture (active milestone 1; phase
1 planned and active, phase 2 in milestone 2, phase 3 in milestone 1), plus a unit case where the
active milestone has nothing left (a later milestone is offered, an earlier one never) and one where
milestone order beats phase number.

Command: `node --test tests/fix_status_sibling_milestone.test.mjs`

Observed before the fix: siblings `['/astro-discuss 2']`, expected `['/astro-discuss 3']`.

# Diagnosis

- Symptom: "also /astro-discuss <n>" names a phase of a later, inactive milestone.
- Cause: `siblingCommands` (lib/nextstep.mjs) took `phases.find(p.number > n && pending && !planned)`
  and `statusJson` did not even pass each phase's milestone, so phase number alone decided.
- Ruled out: `nextAction` (the primary recommendation) — it already works on the active phase.

# Fix

`statusJson` passes `milestone` per phase and the active milestone to `siblingCommands`, which ranks
candidates by milestone (active first, later ones in order, earlier ones dropped), then phase number.
A phase without a milestone counts as the active one's.
