# ACCEPTANCE — 14-cheap-mechanical-integrator-and-clean-fast-path

User-facing UAT checklist. A human confirms each before the phase closes. These are
acceptance criteria (does the phase goal really hold), not unit tests.

> **AMENDED 2026-09-17 at acceptance.** Three criteria below are struck through: they
> required the integrator to default to **haiku**, which **ADR-035 deliberately reverted**
> after a haiku integrator ran an unscoped `git stash -u` in the shared working tree and
> destroyed a finished PLAN/CRITERIA/ACCEPTANCE set (benchmark #2). ADR-037 then purged the
> remaining haiku recommendations from the docs. The integrator now runs at `sonnet` in
> every profile. The rest of this phase shipped and is in daily use, and is what was
> accepted. The struck items are left visible rather than deleted — what was promised is
> part of the record.

- [~] ~~integrator spawned at the cheap tier — haiku by default~~ **REVERTED (ADR-035).**
      What holds instead: each wave's integrator is spawned at `sonnet` in every profile,
      while the heal re-runs, the post-heal test gate and the teardown step run at the
      executor tier.
- [x] The user can override the integrator tier with `ac config set models.integrator <tier>`
      (or a profile switch) and see the very next wave integrate at that tier, with no code
      change. ~~(originally: override haiku → sonnet)~~
- [x] The user can watch a wave where one branch is stale/conflicted and see the good
      branches still land in that same single integrator pass — only the bad branch is
      preserved and only its task is re-run through the heal ladder; the wave is never
      re-integrated at a stronger tier.
- [x] The user can trust that a branch is only ever deleted if it was cherry-picked cleanly
      in that same run: an out-of-bounds teardown claim stops the run with a clear
      `integrationFailed` message naming the branch, instead of being silently accepted.
- [x] The user can run `ac models fast`, `ac models balanced`, `ac models max` and see
      `integrator` present in the persisted map every time — switching profiles never leaves
      the role unset, and `/astro-config` offers it as a normal, documented role.
- [x] The user can read `commands/astro-execute.md` and learn the integrator's default tier,
      how to override it, and exactly what a bail-to-heal looks like in the run log.
- [~] ~~grep the repo and find nothing contradicting the shipped haiku default~~
      **INVERTED (ADR-035/ADR-037).** What holds instead: the repo consistently states that
      no role runs haiku, integrator included, and both ADR-027 (the carve-out) and ADR-035
      (its revert) are recorded in `.astrocode/DECISIONS.md`.
- [x] The user can run a small phase and confirm nothing changed for them: it still runs
      sequentially, never spawns an integrator, never downgrades the executor, and
      `node --test tests/` is green.
