# Plan — Phase 03: GitFlow branch automation (Option A)

Goal: add opt-in `ac flow` / `ac flow init` commands that, when `gitflow.enabled`,
ensure `main`+`develop` exist and create+switch to `feature/m<N>-<theme>` off
`develop` derived from the active milestone. Pure local git, any remote, no forge.
Lifecycle commands stay untouched (ADR-009). `.astrocode` state stays on the branch
(ADR-010). The orphan `astro-registry` branch is never touched.

Conventions in force (CONVENTIONS.md + CONTEXT.md): ESM `.mjs`, named function
exports only, `node:` builtins, zero deps, `die()`/glyph CLI output, every `git()`
call checks `.status`, high-density "why" comments, `node:test` + real git.

## Wave shape

- Wave 1 (parallel, no deps): t1, t2
- Wave 2 (depends on t1): t3 (tests, written first against the lib surface)
- Wave 3 (depends on t1, t3): t4 (lib implementation made to pass the tests)
- Wave 4 (depends on t4): t5 (CLI wiring)
- Wave 5 (depends on t5): t6 (help text), t7 (manual smoke / doc note)

> t2 (template config) is independent of the lib/CLI work and runs in wave 1.
> t3 is written first (test-first for behavior, per canon) and pins the
> `lib/flow.mjs` export surface so t4 implements to a fixed contract.

---

## Tasks

### t1 — Stub `lib/flow.mjs` export surface + module header
- **id:** t1
- **file:** `lib/flow.mjs`
- **depends_on:** []
- **what:** Create `lib/flow.mjs` with the named-export skeleton and a high-density
  module header explaining the GitFlow Option A mapping, the opt-in gate, the
  pure-local-git / no-forge stance, the "never touch the orphan astro-registry
  branch" rule, and the worktree-base note (run `ac flow` so you are ON the feature
  branch before `/astro-execute`, since worktrees fork from HEAD — see todo #6).
  Exports (throwing/stub bodies only here, real logic lands in t4):
    - `loadFlowConfig(root)` → `loadConfig(root).gitflow` merged over defaults
      `{ enabled:false, main:'main', develop:'develop',
      prefixes:{feature:'feature',release:'release',hotfix:'hotfix'}, pr:'none' }`.
    - `flowInit(root)` — ensure `main`+`develop` exist.
    - `flowBranch(root)` — create+switch to the milestone feature branch.
  Import from `../lib/git.mjs` (`git`, `gitOk`), `./config.mjs` (`loadConfig`),
  `./state.mjs` (`loadState`), `./roadmap.mjs` (`loadRoadmap`, `slugify`),
  `./registry.mjs` (`readRegistry`, `registryBranch`). Establishing the export
  names first lets t3 import them.

### t2 — Add the `gitflow` block to the config template
- **id:** t2
- **file:** `templates/config.json`
- **depends_on:** []
- **what:** Append the opt-in `gitflow` block so newly `ac init`'d projects scaffold
  it disabled by default:
  ```json
  "gitflow": {
    "enabled": false,
    "main": "main",
    "develop": "develop",
    "prefixes": { "feature": "feature", "release": "release", "hotfix": "hotfix" },
    "pr": "none"
  }
  ```
  Valid JSON (no trailing comma). `release`/`hotfix` prefixes are scaffolded now but
  only consumed in phase 4. Defaults must match `loadFlowConfig` defaults in t1/t4.

### t3 — Tests first: `tests/flow.test.mjs` against real git
- **id:** t3
- **file:** `tests/flow.test.mjs`
- **depends_on:** [t1]
- **what:** Behavior spec for `lib/flow.mjs`, mirroring `registry.test.mjs` scaffolding
  (`mkdtempSync` + `git init --quiet` + `user.email`/`user.name`, an initial commit on
  `main`, then `initPlanning`/`initRegistry` so an active milestone exists). No bare
  remote needed (branch ops are local). Import the named exports from `../lib/flow.mjs`.
  Sentence-form test names. Cases:
    1. `flowInit` creates `develop` off `main` on a repo that has only `main`.
    2. `flowInit` is idempotent — a second call does not error and does not move `develop`.
    3. `flowInit` warns (`⚠`, not fatal) when `develop` exists but shares no common
       ancestor with `main` (unrelated history) — still idempotent-success.
    4. `flowBranch` creates `feature/m<N>-<slug>` off `develop` and `HEAD` ends on it
       (assert `git rev-parse --abbrev-ref HEAD`).
    5. `flowBranch` is idempotent — when the feature branch already exists it switches
       to it and succeeds.
    6. `flowBranch`/`flowInit` refuse (throw / non-zero) when `gitflow.enabled` is false.
    7. `flowBranch` refuses with a clear hint when there is no active milestone.
    8. `flowBranch` refuses with the dirty-file list when the working tree is dirty.
    9. `flowBranch` refuses when `develop` is missing (hint: run `ac flow init`).
    10. Neither `flowInit` nor `flowBranch` ever creates/modifies the
        `registryBranch(root)` (`astro-registry`) ref — assert `git branch` set is
        unchanged w.r.t. that name before/after.
    11. A milestone name with unicode/special chars produces a git-valid branch name
        (assert `git check-ref-format --branch <name>` succeeds).
  Note: refusals are surfaced via the CLI as `die()`; the lib functions should signal
  failure in a way the tests can assert (e.g. throw an Error with the message, or return
  a `{ ok:false, error }` result) — t4 must implement whatever shape t3 asserts. Keep the
  lib side framework-free; `die()` lives only in `bin/ac.mjs` (t5).

### t4 — Implement `lib/flow.mjs` logic to pass t3
- **id:** t4
- **file:** `lib/flow.mjs`
- **depends_on:** [t1, t3]
- **what:** Fill in the real logic. Every `git()` call checks `.status` and reports
  `stderr`. Defensive guards (cheapest de-risking from research):
    - **Gate:** all flow actions require `loadFlowConfig(root).enabled` — else fail with
      `gitflow is disabled — set gitflow.enabled=true (ac config set gitflow.enabled true)`.
    - **Registry-branch guard:** if configured `main` or `develop` equals
      `registryBranch(root)`, fail — flow must never operate on the orphan ref.
    - `flowInit`: branch-exists check via `rev-parse --verify refs/heads/<b>`; create
      `develop` off `main` only if missing (`git branch develop <main>`); idempotent. If
      `develop` already exists, verify shared history with `main`
      (`git merge-base <main> develop`); on no common ancestor return a `⚠` warning
      result (non-fatal). `main` missing is a fatal error (init the repo / make a commit).
    - `flowBranch`: resolve `N` from `loadState(root).active_milestone` then fall back to
      `loadRoadmap(root).milestone`; fail with a hint if neither. Resolve the milestone
      `name` from the active registry claim
      (`readRegistry(root).registry.claims.find(c => c.type==='milestone' && c.number===N)`),
      `slugify` it for `<theme>` (bare `m<N>` fallback if no name). Build
      `${prefixes.feature}/m${N}-${slug}` and validate with `check-ref-format --branch`.
      Guard: refuse on dirty working tree (`git status --porcelain` non-empty → list
      files); refuse on detached HEAD (`git symbolic-ref HEAD` non-zero); refuse if
      `develop` missing (hint `ac flow init`). If the feature branch already exists,
      `git switch <branch>` (idempotent); else `git switch -c <branch> <develop>`.
      Return a result the CLI can print (branch name + created/switched).
  Comments explain *why* each guard exists (which silent failure it prevents), per Voice.

### t5 — Wire `ac flow` / `ac flow init` into `bin/ac.mjs`
- **id:** t5
- **file:** `bin/ac.mjs`
- **depends_on:** [t4]
- **what:** Import `flowInit`, `flowBranch` from `../lib/flow.mjs`. Add `case 'flow':`
  to the `switch (cmd)` before `default:`. Call `root()` first. Dispatch on `pos[0]`:
  `init` → `flowInit(root())`; no sub (or unknown) → `flow` create-branch path
  `flowBranch(root())` (unknown explicit sub → `die`). Translate lib failures into
  `die(msg)`; print success/info/warn with `✓`/`•`/`⚠` glyphs (human-facing, not
  `json()`). On success of `flowBranch`, also print the worktree reminder:
  `• you are now on <branch> — run /astro-execute from here`. No `process.exit(0)` —
  just `return`. Do not alter any lifecycle command (ADR-009).

### t6 — Document `ac flow` in the CLI HELP text
- **id:** t6
- **file:** `bin/ac.mjs`
- **depends_on:** [t5]
- **what:** Add two HELP lines in the `HELP` template string matching the existing
  column style:
  `ac flow init                        ensure main + develop exist (gitflow, opt-in)`
  `ac flow                             create+switch to feature/m<N> off develop`
  (Same file as t5 → serialized after it; do not co-schedule.)

### t7 — Full test run + lean smoke check
- **id:** t7
- **file:** (no source file — verification task, runs alone)
- **depends_on:** [t5]
- **what:** Run `node --test tests/` and confirm the whole suite (including the new
  `flow.test.mjs` and the existing `registry`/`workflows` contracts) is green. Manually
  smoke `ac flow init` then `ac flow` in a throwaway repo with `gitflow.enabled` true to
  confirm CLI glyph output and the worktree reminder. Confirm `git branch` shows no
  `astro-registry` mutation.
