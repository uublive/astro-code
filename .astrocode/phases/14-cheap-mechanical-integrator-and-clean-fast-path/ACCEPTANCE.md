# ACCEPTANCE — 14-cheap-mechanical-integrator-and-clean-fast-path

User-facing UAT checklist. A human confirms each before the phase closes. These are
acceptance criteria (does the phase goal really hold), not unit tests.

- [ ] The user can run `/astro-execute` on a wide (parallel) phase and see each wave's
      integrator spawned at the cheap tier — haiku by default, even in a project whose
      `.astrocode/config.json` has never heard of `models.integrator` — while the heal
      re-runs, the post-heal test gate and the teardown step still run at the executor tier.
- [ ] The user can override that with `ac config set models.integrator sonnet` (or
      `ac models max`) and see the very next wave integrate at sonnet, with no code change.
- [ ] The user can watch a wave where one branch is stale/conflicted and see the good
      branches still land in that same single integrator pass — only the bad branch is
      preserved and only its task is re-run through the heal ladder; the wave is never
      re-integrated at a stronger tier.
- [ ] The user can trust that a branch is only ever deleted if it was cherry-picked cleanly
      in that same run: an out-of-bounds teardown claim stops the run with a clear
      `integrationFailed` message naming the branch, instead of being silently accepted.
- [ ] The user can run `ac models fast`, `ac models balanced`, `ac models max` and see
      `integrator` present in the persisted map every time — switching profiles never leaves
      the role unset, and `/astro-config` offers it as a normal, documented role.
- [ ] The user can read `commands/astro-execute.md` and learn the integrator's default tier,
      how to override it, and exactly what a bail-to-heal looks like in the run log.
- [ ] The user can grep the repo for the old "haiku is excluded everywhere / the ladder is
      opus→sonnet only" claim and find nothing that still contradicts the shipped haiku
      default — and can find the carve-out recorded as ADR-027 in `.astrocode/DECISIONS.md`.
- [ ] The user can run a small phase and confirm nothing changed for them: it still runs
      sequentially, never spawns an integrator, never downgrades the executor, and
      `node --test tests/` is green.
