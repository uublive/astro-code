# PLAN — Phase 04: GitFlow PRs, release and hotfix flows

> Executable task list. Builds on phase 3's `lib/flow.mjs` (Option A, ADR-007/009/010)
> and the phase-4 ADRs 011/012/013. Every new exported `lib/flow.mjs` function gates on
> `assertFlowEnabled(cfg)` + `assertNoRegistryCollision(root, cfg)` first; throws Errors
> (never `die()`); pure `git`/forge subcommands only; the orphan `astro-registry` branch
> is never a target. Forge CLI (`gh`/`glab`) success paths are NOT integration-tested —
> only detection + degrade are. Comments carry high "why" density matching phase-3 voice.

## Open-question resolutions (binding for executors)

- **OQ1 — `hotfix finish` under `pr:none`:** follow the `pr` setting. `pr:none` →
  local `git merge --no-ff hotfix/<name>` into `main` then into `develop`, tag the
  `main` merge commit `v<N>.<k>`, then push `main develop` + the tag refspec. On a push
  rejection (branch protection), throw an actionable recovery message — never leave a
  half-applied hotfix silently. `pr:gh`/`pr:glab` → open two PRs (main + develop) and do
  NOT auto-tag (user tags via `ac flow tag` after the main PR merges).
- **OQ2 — release tag timing:** never tag at PR-open time. `ac flow release` pushes
  `develop` + opens/prints the develop→main PR only. A separate `ac flow tag` (run after
  the merge) fetches `main`, verifies the develop tip is an ancestor of `origin/main`,
  then tags `origin/main` `v<N>` and pushes the tag refspec.
- **OQ3 — patch-suffix:** computed purely from `git tag -l "v<N>.*"` after a
  `git fetch --tags --quiet`; parse integers (no lexicographic sort), return `v<N>.<max+1>`.
- **OQ4 — no-remote:** push-requiring commands (`pr`, `release`, `tag`, `hotfix finish`)
  fail fast with `✖ no remote "<remote>" — add one and retry`; no partial side effects.
  Local-only ops (`hotfix start` branch create) still succeed offline.

---

## Tasks

### t1 — Test: remote-URL → compare-URL parsing (pure)
- **id:** t1
- **title:** Add failing unit tests for `parseCompareUrl(remoteUrl, base, head)` covering all six remote forms + fallback (HTTPS/SSH/ssh:// for github.com & gitlab.com, GitLab subgroups, no `.git` suffix, GHES `*.github.com`, self-hosted `gitlab.*`, and unrecognized host → `null`).
- **file:** `tests/flow.test.mjs`
- **depends_on:** []

### t2 — Engine: `parseCompareUrl` + `getRemoteUrl` + `forgePresent`
- **id:** t2
- **title:** Add pure helpers to the engine: `getRemoteUrl(remote, cwd)` (exported, reads `git remote get-url`), `parseCompareUrl(remoteUrl, base, head)` (github→`/compare/b...h`, gitlab→`/-/compare/b...h`, unknown→`null`, strips `.git`, handles scp/ssh/https), and `forgePresent(cmd)` (`spawnSync(cmd,['--version'])` returning `!res.error && res.status === 0` — ENOENT-safe). High-density header on each. Makes t1 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t1]

### t3 — Test: `nextPatchTag` derivation (pure)
- **id:** t3
- **title:** Add failing unit tests for `nextPatchTag(tagListStdout, milestoneN)`: empty→`v<N>.1`, existing `v3.1`→`v3.2`, `v3.10` present→`v3.11` (no lexicographic bug), ignores other-milestone tags and malformed lines.
- **file:** `tests/flow_tags.test.mjs`
- **depends_on:** []

### t4 — Engine: `nextPatchTag` pure helper
- **id:** t4
- **title:** Add the exported pure `nextPatchTag(tagListStdout, milestoneN)` to the engine (prefix-match, `parseInt`, `Math.max`, return `v<N>.<max+1>`). Makes t3 pass. (Separate test file from t1/t2 so the two test tasks never collide on `tests/flow.test.mjs`.)
- **file:** `lib/flow.mjs`
- **depends_on:** [t2, t3]

### t5 — Test: `flowPR` push + compare-URL (pr:none) over a real bare remote
- **id:** t5
- **title:** Extend tests: on a `withRegistry` repo, `flowBranch` then `flowPR(root)` pushes `feature/m<N>-*` to origin and returns a github compare URL targeting `develop`; assert the remote ref exists (`git ls-remote`). Cover degrade: unrecognized remote → result carries branch names + advisory, no throw. Cover no-remote → throws `no remote`. Cover gitflow-disabled → throws. Cover the `.astrocode/state.json` conflict advisory text in the PR body.
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t1]

### t6 — Engine: `flowPR` (milestone feature → develop)
- **id:** t6
- **title:** Add `flowPR(root)`: gates; guard HEAD is on a `feature/<prefix>/m…` branch (else throw); require remote (OQ4); `git push -u <remote> <feature>`; if `pr` is `gh`/`glab` AND `forgePresent` → invoke `gh pr create`/`glab mr create` (base `develop`), else degrade to `parseCompareUrl(...,develop, feature)` (or branch-name fallback) with `⚠` advisory; include the `.astrocode/state.json` merge-conflict advisory in the returned PR body/message. Return `{ ok, branch, base, url|null, advisory? }`. Makes t5 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t2, t5]

### t7 — Test: `flowRelease` (develop→main PR) + wrong-branch guard
- **id:** t7
- **title:** Extend tests: from `develop` on a `withRegistry` repo, `flowRelease(root)` pushes `develop` and returns the develop→main compare URL; asserts it does NOT create any tag. Cover guard: running from a feature branch throws `must be on "develop"`. Cover no-remote → throws.
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t5]

### t8 — Engine: `flowRelease` (develop → main PR, no tag)
- **id:** t8
- **title:** Add `flowRelease(root)`: gates; assert `git symbolic-ref HEAD` === `refs/heads/<develop>` (else throw, naming current branch); require remote; `git push -u <remote> <develop>`; forge-or-URL for base `main`, head `develop` (same plumbing as t6). Never tags here (OQ2). Return `{ ok, base:'main', head:'develop', url|null }`. Makes t7 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t6, t7]

### t9 — Test: `flowTag` post-merge tag of `v<N>` on main
- **id:** t9
- **title:** Extend tests: after merging `develop` into `main` on a `withRegistry` repo, `flowTag(root)` fetches main, verifies the develop tip is an ancestor of `origin/main`, creates annotated tag `v<N>` on `origin/main`, and pushes the tag refspec (assert via `git ls-remote --tags`). Cover refusal: when `main` does not yet contain the merge → throws `main does not yet contain`.
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t7]

### t10 — Engine: `flowTag` (verify-then-tag `v<N>`)
- **id:** t10
- **title:** Add `flowTag(root, version?)`: gates; require remote; `git fetch <remote> <main> --tags --quiet`; resolve `N` (active milestone) → `v<N>` unless an explicit version arg given; verify via `git merge-base --is-ancestor <develop-sha> <remote>/<main>` (else throw refusal); `git tag -a v<N> -m 'Release v<N>' <remote>/<main>`; push `refs/tags/v<N>:refs/tags/v<N>`. Return `{ ok, tag, commit }`. Makes t9 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t8, t9]

### t11 — Test: `flowHotfixStart` off main
- **id:** t11
- **title:** Extend tests: `flowHotfixStart(root, 'fix-auth')` creates+switches to `hotfix/fix-auth` off `main`; HEAD matches; result carries the collision advisory text (user-supplied name → push may reject). Cover `check-ref-format` rejection for an invalid name. Cover offline success (no remote required for start). Cover gitflow-disabled → throws.
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t9]

### t12 — Engine: `flowHotfixStart` (branch off main)
- **id:** t12
- **title:** Add `flowHotfixStart(root, name)`: gates; require non-empty `name`; `git check-ref-format --branch hotfix/<name>` (else throw); require `main` exists; `git switch -c <prefix.hotfix>/<name> <main>` (or switch if it exists — idempotent like `flowBranch`); return `{ ok, branch, created, advisory }` where advisory warns the name is user-supplied and push may reject on collision. Makes t11 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t10, t11]

### t13 — Test: `flowHotfixFinish` dual-land + patch tag + rejection recovery
- **id:** t13
- **title:** Extend tests (pr:none): after `flowHotfixStart` + a commit, `flowHotfixFinish(root)` merges `--no-ff` into both `main` and `develop` (assert merge commits via `git log --merges`), tags `v<N>.<k>` on the main merge commit (assert `v3.1`, and `v3.2` after a pre-existing `v3.1` remote tag + `fetch --tags`), and pushes both branches + tag. Cover push-rejection: bare remote with a pre-receive hook rejecting `develop` → throws an actionable recovery message, no silent half-apply. Cover no-remote → throws.
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t11]

### t14 — Engine: `flowHotfixFinish` (dual-land + `v<N>.<k>` tag)
- **id:** t14
- **title:** Add `flowHotfixFinish(root)`: gates; require remote; resolve `N`; assert HEAD is a `hotfix/*` branch; `git fetch --tags --quiet`; compute `nextPatchTag(git tag -l "v<N>.*", N)`. `pr:none` path → `git switch <main>` + `merge --no-ff <hotfix>`, `git tag -a v<N>.<k>` on main HEAD, `git switch <develop>` + `merge --no-ff <hotfix>`, then `git push <remote> <main> <develop> refs/tags/v<N>.<k>:...`; detect push rejection (non-zero + stderr `rejected`) → throw recovery message naming the manual step. `pr:gh`/`pr:glab` path → push hotfix branch + open two PRs (main, develop) and instruct `ac flow tag v<N>.<k>` after the main PR merges (no auto-tag). Return `{ ok, tag?, mergedMain, mergedDevelop, prs? }`. Makes t13 pass.
- **file:** `lib/flow.mjs`
- **depends_on:** [t12, t13]

### t15 — Test: CLI dispatch for new `ac flow` subcommands + HELP entries
- **id:** t15
- **title:** Add CLI tests via the `ac(args, cwd)` helper: `ac flow pr` reaches `flowPR` (exits 0, prints URL), `ac flow release` reaches `flowRelease`, `ac flow tag` reaches `flowTag`, `ac flow hotfix start <name>` reaches `flowHotfixStart` (HEAD on `hotfix/<name>`), `ac flow hotfix finish` reaches `flowHotfixFinish`, unknown subcommand still `die`s. Extend the HELP test to assert the new entries (`ac flow pr`, `ac flow release`, `ac flow tag`, `ac flow hotfix start`, `ac flow hotfix finish`) appear.
- **file:** `tests/flow_cli.test.mjs`
- **depends_on:** [t11]

### t16 — CLI: dispatcher + HELP wiring in bin/ac.mjs
- **id:** t16
- **title:** Extend `import … from '../lib/flow.mjs'` (line 19) with `flowPR, flowRelease, flowTag, flowHotfixStart, flowHotfixFinish`; add `else if` branches under `case 'flow'` for `pr`, `release`, `tag`, and nested `hotfix` (`pos[1]` → `start <pos[2]>` / `finish`), each printing the result message + `⚠`/`•` advisories and translating thrown Errors to `die()`; keep the existing `else die(...)` for unknown subs (update its usage hint). Add the five HELP lines (lines 65–98). Makes t15 pass.
- **file:** `bin/ac.mjs`
- **depends_on:** [t14, t15]

---

## Wave shape

- **Wave 1 (parallel):** t1, t3 — failing tests in two distinct files (`flow.test.mjs`, `flow_tags.test.mjs`).
- **Wave 2:** t2 (engine helpers; t1 green) — t4 follows once t2+t3 land.
- The remaining engine/test/CLI pairs serialize through `lib/flow.mjs`, `tests/flow.test.mjs`, and `bin/ac.mjs` (single-owner-per-wave): t5→t6→t7→t8→t9→t10→t11→t12→t13→t14, with t15 (own file `flow_cli.test.mjs`) and t16 closing.

**Single-file ownership note:** all `lib/flow.mjs` engine tasks (t2,t4,t6,t8,t10,t12,t14)
are chained via `depends_on` so they never co-schedule. All `tests/flow.test.mjs` tasks
(t1,t5,t7,t9,t11,t13) are likewise chained. `tests/flow_tags.test.mjs` (t3) and
`tests/flow_cli.test.mjs` (t15) are separate files. `bin/ac.mjs` is touched only by t16.
