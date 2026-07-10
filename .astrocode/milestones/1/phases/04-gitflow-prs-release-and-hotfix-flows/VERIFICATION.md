# VERIFICATION — Phase 04: GitFlow PRs, release and hotfix flows

**Verdict: PASS**

Verified goal-backward against HEAD on `main` (working tree). Every promised
capability is delivered by real code paths that the test suite actually exercises
over a real bare git remote.

## Test suite
- `npm test` (the project's `node --test` script): **157 tests, 157 pass, 0 fail**
  (~19s). Note: `node --test tests/` fails on Node 22 because it resolves `tests/`
  as a module path — the canonical runner is `npm test` (bare `node --test`), which
  is green.
- Flow-specific: `tests/flow.test.mjs` 54/54, `tests/flow_tags.test.mjs` 11/11,
  `tests/flow_cli.test.mjs` 11/11.
- No `worktree-*` branches hold un-integrated commits.
- Commits `82bc35c..HEAD` are atomic and follow the t1–t16 RED→GREEN cadence
  (failing test commit precedes each engine commit; t16 wires CLI + HELP last).

## Capability trace (goal-backward)
- **`ac flow pr`** — `flowPR` (lib/flow.mjs) guards HEAD on `feature/<prefix>/`,
  requires remote, `push -u`, builds compare URL targeting `develop`, embeds the
  state.json conflict advisory. Wired at bin/ac.mjs:270. Tested: push lands on bare
  remote (ls-remote), URL targets develop, degrade on unrecognized host, no-remote
  throw, disabled throw, advisory-in-body.
- **`ac flow release`** — `flowRelease` guards HEAD==develop, pushes develop, prints
  develop→main URL, NEVER tags (OQ2). Explicit "no tag created" test (t7) plus
  wrong-branch and no-remote guards. Wired at bin/ac.mjs:283.
- **`ac flow tag [version]`** — `flowTag` fetches main+tags, resolves `v<N>` (or the
  explicit version arg), verifies develop tip is ancestor of `origin/main` before
  tagging, pushes the tag refspec. Refusal test (t9) confirms the verify-then-tag
  hard guard. Wired at bin/ac.mjs:296, version arg passed through.
- **`ac flow hotfix start <name>`** — `flowHotfixStart` branches `hotfix/<name>` off
  main, works fully offline (no remote required — ADR-013), idempotent, carries the
  user-supplied-name collision advisory, check-ref-format validation. Wired at
  bin/ac.mjs:308.
- **`ac flow hotfix finish`** — `flowHotfixFinish` (pr:none) dual-merges `--no-ff`
  into main then develop, tags the main merge commit `v<N>.<k>` before the develop
  merge, single batched push of main+develop+tag. Tested end-to-end including the
  v1.1→v1.2 increment (remote-seeded, local tag deleted to prove fetch path). Wired
  at bin/ac.mjs:315.

## Binding OQ resolutions — all honored
- **OQ1** — pr:none local dual-merge + single push verified. The push-rejection test
  installs a real POSIX `pre-receive` hook in the bare remote rejecting
  `refs/heads/develop`; `flowHotfixFinish` throws an actionable recovery message
  naming the manual push command and the local merge/tag state — no silent
  half-apply. pr:gh/glab path opens two PRs and does NOT auto-tag (detection-only,
  per plan).
- **OQ2** — `flowRelease` never tags (explicit test); `flowTag` verifies ancestry via
  `git merge-base --is-ancestor` and refuses on a stale main.
- **OQ3** — `nextPatchTag` is pure, parseInt/Math.max (no lexicographic bug); t3
  covers v3.10→v3.11; v1.2 derivation proven over a remote-only seeded tag.
- **OQ4** — no-remote fast-fail (`no remote "<remote>"`) on pr/release/tag/hotfix
  finish; hotfix start succeeds offline.

## Canon conformance
- Zero deps; only `node:child_process` + sibling lib modules. ESM named exports.
- `lib/flow.mjs` throws Errors; no `die()` call (only a comment mentions it).
  Top-level `main().catch(e => die(e.message))` in bin/ac.mjs translates throws to
  the `✖` line. Glyphs in lib appear only inside returned `message`/`advisory`
  data strings — the established phase-3 pattern (flowInit), printed by bin.
- Every phase-4 function gates on `assertFlowEnabled` + `assertNoRegistryCollision`
  (confirmed by source inspection). Flow commands target only main/develop/feature/
  hotfix/tags — never the orphan `astro-registry` ref.
- Forge success paths are not integration-tested; detection (`forgePresent`,
  ENOENT-safe) and graceful degrade-to-URL after a successful push are tested.
  Forge CLI failure after push degrades (returns fallback compare URL + ⚠), never
  throws — confirmed in flowPR/flowRelease/flowHotfixFinish source.

## Observations (non-blocking, do not affect the verdict)
1. **flowTag ancestry check vs. hotfix pr-mode follow-up.** The pr:gh/pr:glab hotfix
   path instructs `ac flow tag v<N>.<k>` after the main-only PR merges. `flowTag`
   always verifies *develop tip ⊆ origin/main*. After a hotfix lands on main while
   develop carries unreleased work, that ancestry may not hold, so the follow-up
   `ac flow tag` could refuse. This lives entirely on the opt-in, explicitly
   NOT-integration-tested forge path; the default pr:none path tags locally and
   never calls flowTag, so no tested/promised default capability is broken. Worth a
   future-phase note (a hotfix-tag mode that verifies the tag commit is in
   origin/main rather than develop), but out of scope for this phase's binding plan.
2. The orphan-registry no-touch guard has an explicit test only for flowInit/
   flowBranch (phase 3). The phase-4 functions are structurally covered (same gate,
   no registry ref as a target) but lack a dedicated assertion. Low risk.

These are notes, not gaps in a promised capability. The phase goal is delivered.
