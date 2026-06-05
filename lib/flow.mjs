// GitFlow branch automation — Option A (ADR-007, ADR-009, ADR-010).
//
// OPT-IN MODEL (ADR-009): every function in this module gates on
// `loadFlowConfig(root).enabled`. Lifecycle commands (`ac milestone new`,
// `ac phase add`) are NEVER touched — GitFlow is exposed exclusively via
// explicit `ac flow …` subcommands. This keeps branching orthogonal to
// planning so teams that don't want GitFlow pay zero cost.
//
// OPTION A MAPPING (ADR-007):
//   milestone  →  feature/m<N>-<theme>  branch off `develop`
//   phases     →  commits on the milestone branch
//   milestone complete  →  PR from feature/m<N> to `develop` (phase 4)
// The `.astrocode` state (roadmap.json, state.json) rides the feature branch
// and merges to develop at close — NOT moved to the orphan registry branch
// yet (that migration is a later phase; ADR-010 defers it deliberately).
//
// WORKTREE BASE NOTE (todo #6 / CONTEXT.md risk 1):
//   `workflows/execute-phase.mjs` forks one git worktree per task, branching
//   from HEAD at execution time. In GitFlow mode you MUST be on the feature
//   branch before running `/astro-execute`; otherwise worktrees fork from
//   whatever HEAD is, which could be main or develop. Run `ac flow` first to
//   land on `feature/m<N>-<theme>`, then execute. This module does NOT
//   auto-switch inside execute — it documents the requirement so the CLI
//   (bin/ac.mjs, t5) can print the reminder.
//
// ORPHAN BRANCH RULE (CONTEXT.md risk 2):
//   The `astro-registry` orphan branch is NEVER a target of any flow command.
//   `flowInit` and `flowBranch` only operate on ordinary code refs (`main`,
//   `develop`, `feature/…`). A registry-branch guard in each function
//   explicitly refuses if the configured main or develop name collides with
//   `registryBranch(root)`. This prevents an accidental `git branch develop`
//   or `git switch` from corrupting the shared numbering store.
//
// PURE LOCAL GIT, ANY REMOTE (ADR-002 ethos / CONTEXT.md risk 4):
//   No forge API (no `gh`, no `glab`) in this module. All operations are
//   plain `git` subcommands that work against any remote or no remote at all.
//   Phase 4 adds forge integration (PRs, tagging) — this phase is local only.
//
// LEAN ETHOS (ADR-001 / CONTEXT.md risk 3):
//   Named function exports only, no classes. `node:` builtins. Zero deps.
//   Every error surfaces via a thrown Error so the CLI (`bin/ac.mjs`) can
//   translate it to `die(msg)` with the correct glyph — `die()` never lives
//   here. Functions return a plain `{ ok: true, … }` result on success so
//   callers can print branch names and status without re-parsing stderr.

import { git, gitOk } from './git.mjs'
import { loadConfig } from './config.mjs'
import { loadState } from './state.mjs'
import { loadRoadmap, slugify } from './roadmap.mjs'
import { readRegistry, registryBranch } from './registry.mjs'

// Default gitflow config block — must stay in sync with the template added in
// t2 (`templates/config.json`) so `loadFlowConfig` always returns a fully
// populated object regardless of whether the user has the key in config.json.
const FLOW_DEFAULTS = {
  enabled: false,
  main: 'main',
  develop: 'develop',
  prefixes: { feature: 'feature', release: 'release', hotfix: 'hotfix' },
  pr: 'none',
}

// Returns the merged gitflow config: project config.json.gitflow overrides
// FLOW_DEFAULTS. Callers can safely destructure { enabled, main, develop,
// prefixes } without null-checking. The `prefixes` sub-object is shallow-merged
// so a partial override (e.g. just `feature`) still yields all three keys.
export function loadFlowConfig(root) {
  const raw = (loadConfig(root) || {}).gitflow || {}
  return {
    ...FLOW_DEFAULTS,
    ...raw,
    prefixes: { ...FLOW_DEFAULTS.prefixes, ...(raw.prefixes || {}) },
  }
}

// branchExists — cheap check: does the named local branch ref exist?
// Using rev-parse --verify refs/heads/<name> (exits 0 only when the ref
// resolves) rather than `git branch --list` to avoid parsing tabular output.
function branchExists(name, cwd) {
  return gitOk(['rev-parse', '--verify', `refs/heads/${name}`], { cwd })
}

// assertFlowEnabled — throws if gitflow.enabled is false. Every flow function
// must call this first so projects that have not opted in get a clear message
// rather than silent git mutations.
function assertFlowEnabled(cfg) {
  if (!cfg.enabled) {
    throw new Error(
      'gitflow is disabled — set gitflow.enabled=true (ac config set gitflow.enabled true)',
    )
  }
}

// assertNoRegistryCollision — throws if main or develop is configured to the
// same name as the orphan astro-registry branch. Prevents a `git branch` or
// `git switch` from accidentally overwriting the shared numbering store.
function assertNoRegistryCollision(root, cfg) {
  const rb = registryBranch(root)
  if (cfg.main === rb || cfg.develop === rb) {
    throw new Error(
      `flow config error: "${cfg.main === rb ? 'main' : 'develop'}" is configured to "${rb}" which is the orphan registry branch — choose a different branch name`,
    )
  }
}

// flowInit — ensure that the GitFlow long-lived branches exist.
//
// Creates `develop` off `main` if it does not yet exist. Idempotent: a second
// call when both branches are present is a no-op success. If `develop` already
// exists but shares no common ancestor with `main` (unrelated history), the
// function returns a ⚠ warning result rather than failing — the repo may have
// been set up manually and the user knows what they are doing.
//
// WHY ref-parse instead of git switch: creating `develop` off `main` without
// switching to it avoids losing the caller's current working position. We only
// manipulate refs here, not HEAD.
export function flowInit(root) {
  const cfg = loadFlowConfig(root)
  assertFlowEnabled(cfg)
  assertNoRegistryCollision(root, cfg)

  const { main, develop } = cfg
  const cwd = root

  // main must exist — without it we have no base to fork develop from
  if (!branchExists(main, cwd)) {
    throw new Error(
      `"${main}" branch does not exist — initialize the repo and make at least one commit first`,
    )
  }

  if (!branchExists(develop, cwd)) {
    // Create develop at the same commit as main without switching to it.
    // `git branch <develop> <main>` is the canonical way to do this; no
    // checkout side-effect, no working-tree interference.
    const r = git(['branch', develop, main], { cwd })
    if (r.status !== 0) {
      throw new Error(`failed to create "${develop}" off "${main}": ${r.stderr.trim()}`)
    }
    return { ok: true, created: true, message: `✓ created "${develop}" off "${main}"` }
  }

  // develop already exists — verify shared history with main so we can warn
  // about unrelated histories (e.g., an orphan develop set up manually).
  // `git merge-base` exits non-zero when there is no common ancestor.
  const mb = git(['merge-base', main, develop], { cwd })
  if (mb.status !== 0) {
    // Non-fatal: warn and succeed. The user may have intentionally set up an
    // unrelated develop (unusual but valid). Returning warn:true lets the CLI
    // print a ⚠ advisory without aborting the workflow.
    return {
      ok: true,
      warn: true,
      message: `⚠ "${develop}" exists but shares no common ancestor with "${main}" (unrelated history) — verify this is intentional`,
    }
  }

  // Both branches exist and share history — idempotent success.
  return { ok: true, created: false, message: `✓ "${develop}" already exists` }
}

// flowBranch — create and switch to the milestone feature branch.
//
// Derives the branch name from the active milestone in state/roadmap:
//   `${prefixes.feature}/m${N}-${slug}`
// where `slug` is `slugify(milestone.name)` or bare `m${N}` as fallback.
//
// Guards (prevent silent failures — each guard has a specific failure mode it
// stops):
//   • gitflow.enabled false  →  reject with config hint (don't accidentally
//     create branches in projects that haven't opted in)
//   • dirty working tree  →  list dirty files and reject (git switch would
//     refuse anyway, but we surface a cleaner message)
//   • detached HEAD  →  reject (no branch context means worktree base unknown)
//   • develop missing  →  reject with "run ac flow init" hint
//   • no active milestone  →  reject with actionable hint
//   • configured main/develop collides with registryBranch  →  reject (orphan
//     branch guard)
// On success: if branch already exists, switch to it (idempotent); otherwise
// create it off develop. Returns `{ ok: true, branch, created: bool }`.
export function flowBranch(root) {
  const cfg = loadFlowConfig(root)
  assertFlowEnabled(cfg)
  assertNoRegistryCollision(root, cfg)

  const { develop, prefixes } = cfg
  const cwd = root

  // Guard: detached HEAD — symbolic-ref exits non-zero when HEAD is detached.
  // Worktrees fork from HEAD; a detached HEAD means the branch context is lost.
  const symref = git(['symbolic-ref', 'HEAD'], { cwd })
  if (symref.status !== 0) {
    throw new Error('HEAD is detached — check out a branch before running ac flow')
  }

  // Guard: dirty working tree — detect modified/staged tracked files and any
  // untracked non-ignored files that are NOT under .astrocode/ (which is
  // intentionally living on the branch and is never committed before the first
  // flow operation). We parse `git status --porcelain` and exclude lines whose
  // path starts with `.astrocode/` — the planner scaffolds that dir after the
  // initial commit, so it will always appear as `??` until the first commit on
  // the feature branch. Excluding it prevents false "dirty" rejections during
  // normal `ac flow` usage. All other untracked/modified files are surfaced
  // because `git switch` would fail on tracked modifications anyway, and
  // surfacing untracked files early gives the user a cleaner message.
  const porcelain = git(['status', '--porcelain'], { cwd })
  if (porcelain.stdout.trim()) {
    const dirtyFiles = porcelain.stdout
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.replace(/^..\s+/, '').startsWith('.astrocode/'))
    if (dirtyFiles.length > 0) {
      const files = dirtyFiles.map((l) => l.replace(/^..\s+/, '')).join(', ')
      throw new Error(`working tree is dirty — clean or stash changes first: ${files}`)
    }
  }

  // Guard: develop must exist before we can fork from it. If it doesn't, we
  // give the user a concrete next step rather than a cryptic git error.
  if (!branchExists(develop, cwd)) {
    throw new Error(`"${develop}" branch does not exist — run \`ac flow init\` first`)
  }

  // Resolve the active milestone number: state.json.active_milestone is the
  // primary source; roadmap.json.milestone is the fallback for repos where
  // state hasn't been written yet. Both should agree in practice.
  const state = loadState(root) || {}
  const roadmap = loadRoadmap(root) || {}
  const N = state.active_milestone ?? roadmap.milestone ?? null
  if (N == null) {
    throw new Error(
      'no active milestone — add a milestone with `ac milestone new <name>` first',
    )
  }

  // Resolve the milestone name from the registry so the branch slug is derived
  // from the human-readable title (not just the number). Falls back to bare
  // `m${N}` if no registry claim carries a name (e.g., name was empty on claim).
  let slug = `m${N}` // safe bare fallback
  try {
    const { registry } = readRegistry(root)
    const msClaim = registry.claims.find(
      (c) => c.type === 'milestone' && c.number === N,
    )
    if (msClaim && msClaim.name) {
      const s = slugify(msClaim.name)
      if (s) slug = s
    }
  } catch {
    // Registry unavailable (no remote, etc.) — use the bare fallback.
    // This is intentional: flowBranch must work even without a remote so
    // offline devs aren't blocked.
  }

  const branchName = `${prefixes.feature}/m${N}-${slug}`

  // Validate the derived name against git's own rules so we surface the error
  // before attempting a `git switch` that would fail opaquely.
  const refCheck = git(['check-ref-format', '--branch', branchName])
  if (refCheck.status !== 0) {
    throw new Error(
      `derived branch name "${branchName}" is not git-valid: ${refCheck.stderr.trim()} — rename the milestone to avoid special characters`,
    )
  }

  if (branchExists(branchName, cwd)) {
    // Idempotent: branch already exists — switch to it without recreating.
    // Using `git switch` (not `git checkout`) because switch is the modern,
    // branch-specific command that cannot accidentally detach HEAD.
    const sw = git(['switch', branchName], { cwd })
    if (sw.status !== 0) {
      throw new Error(`failed to switch to existing "${branchName}": ${sw.stderr.trim()}`)
    }
    return { ok: true, branch: branchName, created: false }
  }

  // Branch does not exist — create it off develop and switch to it.
  // `git switch -c <branch> <base>` is atomic: creates and checks out in one
  // step, so we never end up on develop if the create fails mid-way.
  const sw = git(['switch', '-c', branchName, develop], { cwd })
  if (sw.status !== 0) {
    throw new Error(`failed to create "${branchName}" off "${develop}": ${sw.stderr.trim()}`)
  }
  return { ok: true, branch: branchName, created: true }
}
