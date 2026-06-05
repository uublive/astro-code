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

import { git, gitOk } from './git.mjs';
import { loadConfig } from './config.mjs';
import { loadState } from './state.mjs';
import { loadRoadmap, slugify } from './roadmap.mjs';
import { readRegistry, registryBranch } from './registry.mjs';

// Default gitflow config block — must stay in sync with the template added in
// t2 (`templates/config.json`) so `loadFlowConfig` always returns a fully
// populated object regardless of whether the user has the key in config.json.
const FLOW_DEFAULTS = {
  enabled: false,
  main: 'main',
  develop: 'develop',
  prefixes: { feature: 'feature', release: 'release', hotfix: 'hotfix' },
  pr: 'none',
};

// Returns the merged gitflow config: project config.json.gitflow overrides
// FLOW_DEFAULTS. Callers can safely destructure { enabled, main, develop,
// prefixes } without null-checking. The `prefixes` sub-object is shallow-merged
// so a partial override (e.g. just `feature`) still yields all three keys.
export function loadFlowConfig(root) {
  const raw = (loadConfig(root) || {}).gitflow || {};
  return {
    ...FLOW_DEFAULTS,
    ...raw,
    prefixes: { ...FLOW_DEFAULTS.prefixes, ...(raw.prefixes || {}) },
  };
}

// flowInit — ensure that the GitFlow long-lived branches exist.
//
// Creates `develop` off `main` if it does not yet exist. Idempotent: a second
// call when both branches are present is a no-op success. If `develop` already
// exists but shares no common ancestor with `main` (unrelated history), the
// function returns a ⚠ warning result rather than failing — the repo may have
// been set up manually and the user knows what they are doing.
//
// Stub — real logic lands in t4.
export function flowInit(root) {
  throw new Error('flowInit: not yet implemented');
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
//
// Stub — real logic lands in t4.
export function flowBranch(root) {
  throw new Error('flowBranch: not yet implemented');
}
