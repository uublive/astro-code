<!-- astro-discuss: captured -->
# Phase 14 — Cheap mechanical integrator and clean fast-path

## Goal
Drop the per-wave integrator (parallel path only) to a cheap model tier with a
clean-cherry-pick fast-path, so wide phases stop paying executor-tier prices for what is
essentially mechanical git bookkeeping. Anything the cheap tier cannot handle bails to
the existing heal ladder, which already runs at `models.executor`.

## The problem (grounded in the code)
`workflows/execute-phase.mjs` `integrateWave` (~line 669) spawns an `astro-executor` at
`model: models.executor` (sonnet) per wave. Its prompt asks for four things: staleness
check (ADR-015), overflow classification (ADR-016), cherry-pick, and teardown — plus
branch→taskId mapping "by commit message + changed files", the one genuinely inferential
step. Only the parallel path reaches it; after phase 13 (ADR-026) small phases run
sequentially and never do.

## Decisions (settled with the developer)

1. **Fast-path shape: one cheap agent, bail-fast per BRANCH.** No triage pre-pass, no
   second integrator call. It picks the clean branches and, for any branch that is stale
   / peer-colliding / conflicted, preserves it and reports it — then **keeps going** to
   the remaining branches. Bail is per-branch, never per-wave: `resolveHealList` re-runs
   every wave task not confirmed integrated, so halting early would push correctly-landed
   work into executor-tier heal re-runs and spend more than the cheap tier saved.
   Rejected: escalating the same integration to a stronger tier before healing — that is
   exactly the textual rescue ADR-014/ADR-015 forbid.

2. **Destructive git is bounded, and the bound is mechanical.** The integrator may run
   `git branch -D` / `git worktree remove --force` **only** on a branch it cherry-picked
   cleanly in this same run. Enforced two ways: a hard prompt rule, AND a new
   `tornDown: string[]` field on `INTEGRATE_SCHEMA` that the script asserts is a subset of
   the branches it reported cleanly integrated. A mismatch surfaces loudly and counts as
   an integration failure. Pure data comparison — the script still runs no git (ADR-008).

3. **Branch→task mapping becomes a stamp grep.** Replace the infer-from-message-and-files
   instructions with a mechanical read of the ADR-017 `(phase NN tK)` commit-subject stamp,
   falling back to changed-file inference only when no stamp is present. This is what
   makes a cheap tier *safe* rather than merely cheaper: it removes the only judgment-heavy
   step from the prompt.

4. **Tier scope: `integrateWave` only.** `runTeardown`, the healed-wave test gate, and
   heal re-runs all stay at `models.executor`. The test gate in particular is what stands
   between a bad heal and the next wave — not a place to save money.

5. **ADR-016 overflow behavior is preserved unchanged.** Peer-claimed extra file →
   collision → preserve + heal. Unclaimed extra files → cherry-pick **with a ⚠ advisory**.
   The comparison is a set-difference against the inlined declared-file list, mechanical
   enough for the cheap tier. Rejected: bailing on *any* overflow (contradicts ADR-016 and
   would re-run legitimate out-of-file work like the phase-04 t14 hooksPath fix) and
   dropping overflow classification entirely (removes an ADR-016 safeguard this milestone
   has no mandate to remove).

6. **The no-haiku rule gets an explicit, recorded carve-out.** The project currently
   asserts opus→sonnet only, "haiku deliberately excluded **everywhere**", in
   `lib/models.mjs`, `commands/astro-config.md`, and the `/astro-config` skill description.
   The integrator becomes the single documented exception, justified by decisions 1–5:
   mechanical git, schema-pinned return, stamp-based mapping, a cross-checked destructive
   verb, and a heal-ladder backstop for everything else. **Every place asserting
   "everywhere" must be reworded** — leaving the codebase contradicting itself is not
   acceptable.
   Note for context: pinning the integrator to sonnet instead would have been a no-op —
   `models.executor` is already sonnet under both `balanced` and `fast`.

7. **`models.integrator` hard-defaults to haiku in the workflow** (`models.integrator ||
   'haiku'`). It is the one role with a floor rather than an inherit, because the normal
   "unset = inherit the session model" would run it at the session tier (opus) — the exact
   opposite of the goal — for every project predating the key. Mirrors ADR-026's
   `lean_execution !== false` default-on reasoning. Override:
   `ac config set models.integrator sonnet` (dotted keys already work, `bin/ac.mjs:478`).

8. **All three profiles gain an integrator tier**, so a profile stays a *complete* per-role
   map as `lib/models.mjs` promises: `max` → **sonnet** (escapes haiku, but does not waste
   opus on a cherry-pick), `balanced` → **haiku**, `fast` → **haiku**. This also closes a
   live bug: `ac models <profile>` writes `models: preset` wholesale (`bin/ac.mjs:536`), so
   without this a profile switch silently wipes a custom `models.integrator`, and
   `ac models fast --preview` (fed to `/astro-execute --fast`) would carry no tier at all.
   Rejected: merge-instead-of-replace (breaks the complete-map contract).

## Scope

In:
- `workflows/execute-phase.mjs`: `integrateWave` → `model: models.integrator || 'haiku'`;
  bail-fast-per-branch prompt; stamp-based mapping; teardown restricted to
  this-run-clean-picks; `tornDown` added to `INTEGRATE_SCHEMA` + the script-side subset
  assertion and its failure surfacing.
- `lib/models.mjs`: `integrator` in all three profiles (max sonnet, balanced/fast haiku);
  reword the module's "haiku excluded everywhere" doc comment to name the carve-out.
- `commands/astro-config.md` + the `/astro-config` skill: 6th role, integrator in the
  custom-role questions and the role reference, haiku prohibition reworded.
- `commands/astro-execute.md`: document the integrator tier and the fast-path.
- `ac decision add` for the carve-out (decision 6) — architectural, affects future roles.
- Tests in `tests/workflows.test.mjs` (extract-and-eval pattern — the Workflow script
  exports no importable symbol) + `lib/models.mjs` profile coverage.

Out (untouched):
- The sequential/batched path (phase 13, ADR-026) — it never reaches the integrator.
- The heal ladder, `runTeardown`, the healed-wave test gate, `resolveHealList`,
  `classifyOverflow` semantics, and the `buildWaves` MIRROR/drift-guard region.
- The verify gate and the effort verify→remediate loop.
- `ac config set/unset` plumbing — dotted keys already work; no CLI change needed.

## Invariants to preserve
- **ADR-008 / ADR-005** — the script runs no git; `tornDown` is checked as data only.
- **ADR-014 / ADR-015** — conflicts and stale bases drop-and-rerun at the integrated tip;
  no rebase, no smarter-integrator retry, clean cherry-picks never override staleness.
- **ADR-016** — collision hard, unclaimed overflow advisory.
- **ADR-017** — stamps are now load-bearing for mapping as well as resumability.
- **ADR-021** — the verifier stays plan-blind.
- No work is ever silently lost: a preserved branch stays preserved.

## Verification (what phase CRITERIA should assert, behaviorally)
- The wave integrator is spawned at the integrator tier (haiku by default, including when
  `config.models` has no `integrator` key), while heal re-runs, teardown, and the test gate
  are still spawned at `models.executor`.
- A wave with one bad branch among several still cleanly integrates the others in the same
  call — the bad one alone is preserved and reported.
- A `tornDown` entry naming a branch not in the cleanly-integrated set is caught by the
  script and surfaced as an integration failure, not silently accepted.
- The integrator prompt maps branches via the `(phase NN tK)` stamp.
- `profileModels('max'|'balanced'|'fast')` each return an `integrator` tier
  (sonnet/haiku/haiku), so applying a profile cannot leave the role unset.
- No file in the repo still claims haiku is excluded from every role.

## Open questions / assumptions
- Assumes haiku can reliably follow the reduced prompt. The teardown cross-check plus the
  heal-ladder backstop are the safety net if it cannot; if the cheap tier proves unreliable
  in practice, the fix is `ac config set models.integrator sonnet`, not a code change.
- The whole milestone lives on `feature/lean-execution` and can be dropped wholesale.
