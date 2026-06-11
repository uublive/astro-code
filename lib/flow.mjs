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

import { spawnSync } from 'node:child_process'
import { git, gitOk, hasRemote } from './git.mjs'
import { loadConfig } from './config.mjs'
import { loadState } from './state.mjs'
import { loadRoadmap, slugify } from './roadmap.mjs'
import { readRegistry, registryBranch, registryRemote } from './registry.mjs'

// getRemoteUrl — read the push/fetch URL for a named remote from git.
//
// WHY exported: callers (`flowPR`, `flowRelease`, `flowHotfixFinish`) all need
// the remote URL for compare-URL construction; centralizing the call makes the
// lookup testable in isolation and avoids repeated boilerplate.
// Returns the URL string (stdout trimmed) on success, or null if the remote
// does not exist or the git call fails. Never throws — callers decide how to
// handle an absent remote (usually: throw "no remote" to the user).
export function getRemoteUrl(remote, cwd) {
  const r = git(['remote', 'get-url', remote], { cwd })
  return r.status === 0 ? r.stdout.trim() : null
}

// parseCompareUrl — derive a browser-navigable PR compare URL from a git remote URL.
//
// WHY pure: URL construction is deterministic string manipulation — no git call,
// no network, no filesystem access. Keeping it pure makes it trivially testable
// (no tmp-dir setup) and usable in any context (offline, CI, etc.).
//
// SUPPORTED REMOTE FORMS — all three standard git remote forms are handled:
//   HTTPS:    https://<host>/<owner>/<repo>.git   (trailing .git optional)
//   SCP SSH:  git@<host>:<owner>/<repo>.git       (colon separator, not slash)
//   ssh://    ssh://git@<host>/<owner>/<repo>.git
//
// HOST DETECTION — two forge families are recognized by hostname substring:
//   GitHub: hostname contains "github" → /compare/<base>...<head>
//           This covers github.com, GHES (github.example.com), and custom
//           subdomains that start with "github." (e.g. github.corp.example.com).
//   GitLab: hostname contains "gitlab" → /-/compare/<base>...<head>
//           This covers gitlab.com, self-hosted (gitlab.acme.com), and any host
//           with "gitlab" in the name. Checked AFTER GitHub so a host with both
//           strings (exotic, but defensive) gets the more specific GitHub path.
//   Unknown: returns null — the caller degrades to printing branch names.
//
// BRANCH ENCODING: branch names (base, head) may contain slashes (e.g.
// "feature/m1-foo"). They are percent-encoded (`/` → `%2F`) so the URL is
// safe for web navigation and CLI tools (curl, xdg-open). Encoding is
// minimal — only `/` is encoded; other chars are kept as-is to preserve
// readability (forge UIs decode them anyway).
export function parseCompareUrl(remoteUrl, base, head) {
  if (!remoteUrl) return null

  let host, path

  // Parse all three remote forms into (host, path) pair.
  // Strip leading protocol and user@ prefix, then split host from path.
  if (remoteUrl.startsWith('https://') || remoteUrl.startsWith('http://')) {
    // HTTPS form: https://<host>/<path>
    const withoutScheme = remoteUrl.replace(/^https?:\/\//, '')
    const slashIdx = withoutScheme.indexOf('/')
    if (slashIdx === -1) return null
    host = withoutScheme.slice(0, slashIdx)
    path = withoutScheme.slice(slashIdx + 1)
  } else if (remoteUrl.startsWith('ssh://')) {
    // ssh:// form: ssh://git@<host>/<path>
    const withoutScheme = remoteUrl.replace(/^ssh:\/\/[^@]*@?/, '')
    const slashIdx = withoutScheme.indexOf('/')
    if (slashIdx === -1) return null
    host = withoutScheme.slice(0, slashIdx)
    path = withoutScheme.slice(slashIdx + 1)
  } else if (remoteUrl.includes('@') && remoteUrl.includes(':')) {
    // SCP SSH form: git@<host>:<path>  (colon separates host from path)
    // The colon (not slash) distinguishes SCP from other forms.
    const atIdx = remoteUrl.indexOf('@')
    const colonIdx = remoteUrl.indexOf(':', atIdx)
    if (colonIdx === -1) return null
    host = remoteUrl.slice(atIdx + 1, colonIdx)
    path = remoteUrl.slice(colonIdx + 1)
  } else {
    return null
  }

  // Strip trailing .git suffix so repo URL paths are clean.
  path = path.replace(/\.git$/, '')

  // Encode slashes in branch names: forge URLs embed the branch in the path
  // segment, so a literal slash would be misinterpreted as a path separator.
  const enc = (b) => b.replace(/\//g, '%2F')
  const baseEnc = enc(base)
  const headEnc = enc(head)

  // Host detection: GitHub before GitLab (defensive ordering).
  if (host.includes('github')) {
    return `https://${host}/${path}/compare/${baseEnc}...${headEnc}`
  }
  if (host.includes('gitlab')) {
    return `https://${host}/${path}/-/compare/${baseEnc}...${headEnc}`
  }

  // Unrecognized forge — caller decides how to handle (usually prints branch names).
  return null
}

// forgePresent — test whether a forge CLI tool is installed and executable.
//
// WHY spawnSync + --version: the only reliable cross-platform way to check CLI
// presence is to run it. `--version` is universally supported (gh, glab, git…)
// and exits 0 when the binary is healthy. We capture status only — output is
// intentionally discarded (stdio: 'pipe' via encoding) to keep this silent.
//
// WHY ENOENT-safe: on a machine without the tool, spawnSync sets `res.error`
// to an Error with code ENOENT (or ENOENT-like). We check `!res.error` first
// so the ENOENT case short-circuits to false without an uncaught exception.
// Any other error (permission denied, OOM) also returns false — same result:
// "tool not available, degrade gracefully."
//
// Returns true iff the command exits with status 0 and no spawn error.
// Never throws — callers MUST NOT gate forge calls on this alone (tool could
// exit 0 but behave unexpectedly); it is a best-effort presence hint only.
export function forgePresent(cmd) {
  const res = spawnSync(cmd, ['--version'], { encoding: 'utf8' })
  return !res.error && res.status === 0
}

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

// ---------------------------------------------------------------------------
// PR plumbing — shared by flowPR, flowRelease, flowHotfixFinish (phase 4)
// ---------------------------------------------------------------------------

// STATE_JSON_CONFLICT_ADVISORY — the text that goes into every feature→develop PR
// body to warn reviewers that .astrocode/state.json will likely conflict at merge
// time. Both the feature branch and develop advance this file independently (one
// tracks phase progress, the other accumulates merged phase results), so a conflict
// is almost certain. Surfaces this early so the reviewer isn't surprised by the
// GitHub/GitLab merge conflict block.
const STATE_JSON_CONFLICT_ADVISORY =
  '> ⚠ **Merge note:** `.astrocode/state.json` on this feature branch will ' +
  'likely conflict with `develop` at merge time — both sides update it ' +
  'independently. Accept the `develop` side (or manually merge both progress ' +
  'fields) when resolving the conflict.'

// flowPR — push the current milestone feature branch to origin and open (or
// print the URL of) a PR targeting develop.
//
// FLOW (pr:none path, which is the default):
//   1. Gate: gitflow.enabled, no registry collision
//   2. Guard: HEAD must be on a feature/m<N>-* branch (not main/develop/hotfix)
//   3. Require remote (OQ4: no silent half-success without a remote)
//   4. git push -u <remote> <feature>
//   5. parseCompareUrl(remoteUrl, develop, feature)
//      - github/gitlab → return compare URL with develop as base
//      - unrecognized  → degrade: return { ok, branch, base, url:null, advisory }
//   6. Include STATE_JSON_CONFLICT_ADVISORY in the returned body
//
// FORGE PATH (pr:gh or pr:glab + CLI present):
//   Not integration-tested (requires network + token) — detection/degrade only.
//   When the CLI is absent or pr is "none", always falls through to the URL path.
//
// Returns { ok:true, branch, base, url|null, body, advisory? } on success.
// Throws on gate failure, missing remote, or non-feature HEAD.
export function flowPR(root) {
  const cfg = loadFlowConfig(root)
  assertFlowEnabled(cfg)
  assertNoRegistryCollision(root, cfg)

  const { develop, prefixes } = cfg
  const remote = registryRemote(root)
  const cwd = root

  // Guard: HEAD must be on a feature branch. `git symbolic-ref HEAD` gives us
  // the full ref path (refs/heads/<name>); strip the prefix to get the branch.
  const symref = git(['symbolic-ref', 'HEAD'], { cwd })
  if (symref.status !== 0) {
    throw new Error('HEAD is detached — check out the feature branch before running ac flow pr')
  }
  const headBranch = symref.stdout.trim().replace(/^refs\/heads\//, '')
  const featurePrefix = `${prefixes.feature}/`
  if (!headBranch.startsWith(featurePrefix)) {
    throw new Error(
      `HEAD is on "${headBranch}", not a feature branch — switch to your feature/m<N>-* branch first`,
    )
  }

  // OQ4: require a remote before attempting the push. Fail fast with a clear
  // actionable message so the user knows exactly what is missing.
  if (!hasRemote(remote, cwd)) {
    throw new Error(
      `no remote "${remote}" — add one (\`git remote add ${remote} <url>\`) and retry`,
    )
  }

  // Push the feature branch to origin, setting the upstream tracking ref so
  // subsequent `git push` invocations are unambiguous.
  const push = git(['push', '-u', remote, headBranch], { cwd })
  if (push.status !== 0) {
    throw new Error(`push of "${headBranch}" to "${remote}" failed: ${push.stderr.trim()}`)
  }

  // Derive the compare URL. The remote URL comes from `git remote get-url` (the
  // fetch URL), which is what forge-hosting platforms expose for link generation.
  const remoteUrl = getRemoteUrl(remote, cwd)
  const body = STATE_JSON_CONFLICT_ADVISORY
  const prCfg = cfg.pr || 'none'

  // Forge CLI path: attempt gh/glab only when explicitly configured AND present.
  //
  // WHY NOT integration-tested: invoking a real forge CLI requires network access
  // and a valid auth token, neither of which is available in the test environment.
  // The detection/degrade logic (forgePresent returning false → URL fallback) IS
  // tested. When the CLI exits non-zero we degrade to the compare-URL path with a
  // ⚠ advisory — never throw after a successful push (ADR-011 degrade ethos).
  //
  // TITLE DERIVATION: strip the "feature/" prefix, replace hyphens/underscores with
  // spaces, title-case the first word — e.g. "feature/m3-auth-revamp" becomes
  // "m3 auth revamp". This is best-effort; the user can edit the PR title on the forge.
  //
  // BODY: pass STATE_JSON_CONFLICT_ADVISORY so the reviewer sees the conflict warning
  // on the forge UI, not just in the CLI output.
  const prTitle = headBranch
    .replace(/^[^/]+\//, '')   // strip "feature/" prefix
    .replace(/[-_]/g, ' ')    // hyphens/underscores → spaces (readable title)

  if (prCfg === 'gh' && forgePresent('gh')) {
    // `gh pr create` prints the PR URL on stdout (trimmed) when it succeeds.
    // We pass --base, --head, --title, --body. If it exits non-zero (auth failure,
    // PR already exists, network error) we degrade rather than throwing — the
    // push already landed and we must not leave the user with a broken state.
    const ghResult = spawnSync(
      'gh',
      ['pr', 'create',
        '--base', develop,
        '--head', headBranch,
        '--title', prTitle,
        '--body', body,
      ],
      { cwd, encoding: 'utf8' },
    )
    if (!ghResult.error && ghResult.status === 0) {
      // Success: stdout is the PR URL (gh prints it on its own line).
      const forgeUrl = ghResult.stdout.trim()
      return { ok: true, branch: headBranch, base: develop, url: forgeUrl, body }
    }
    // Non-zero exit: degrade gracefully. The push succeeded; we must not throw.
    // Capture the failure reason so the advisory is actionable.
    const ghErr = (ghResult.stderr || ghResult.stdout || '').trim()
    const forgeAdvisory = `⚠ gh pr create failed (${ghErr || 'non-zero exit'}) — open a PR from "${headBranch}" → "${develop}" manually`
    // fall through to URL path below, augmenting the advisory
    const fallbackUrl = parseCompareUrl(remoteUrl, develop, headBranch)
    return {
      ok: true,
      branch: headBranch,
      base: develop,
      url: fallbackUrl,
      body,
      advisory: forgeAdvisory,
    }
  }

  if (prCfg === 'glab' && forgePresent('glab')) {
    // `glab mr create` prints the MR URL on stdout when it succeeds.
    // Same degrade-on-failure contract as the gh path above.
    const glabResult = spawnSync(
      'glab',
      ['mr', 'create',
        '--base', develop,
        '--head', headBranch,
        '--title', prTitle,
        '--description', body,
        '--yes',          // skip the interactive confirmation prompt
      ],
      { cwd, encoding: 'utf8' },
    )
    if (!glabResult.error && glabResult.status === 0) {
      // glab prints the MR URL on the last non-empty line of stdout.
      const lines = glabResult.stdout.trim().split('\n').filter(Boolean)
      const forgeUrl = lines[lines.length - 1]?.trim() || glabResult.stdout.trim()
      return { ok: true, branch: headBranch, base: develop, url: forgeUrl, body }
    }
    // Non-zero exit: degrade gracefully, same contract as gh path.
    const glabErr = (glabResult.stderr || glabResult.stdout || '').trim()
    const forgeAdvisory = `⚠ glab mr create failed (${glabErr || 'non-zero exit'}) — open an MR from "${headBranch}" → "${develop}" manually`
    const fallbackUrl = parseCompareUrl(remoteUrl, develop, headBranch)
    return {
      ok: true,
      branch: headBranch,
      base: develop,
      url: fallbackUrl,
      body,
      advisory: forgeAdvisory,
    }
  }

  // URL path (pr:none or forge CLI absent): construct the compare URL from the
  // remote URL. On unrecognized hosts parseCompareUrl returns null and we degrade.
  const url = parseCompareUrl(remoteUrl, develop, headBranch)
  if (!url) {
    // Degrade gracefully: return branch names + advisory so the user can open
    // the PR manually. Never throw — the push already succeeded.
    return {
      ok: true,
      branch: headBranch,
      base: develop,
      url: null,
      body,
      advisory: `⚠ unrecognized remote host — open a PR from "${headBranch}" → "${develop}" manually`,
    }
  }

  return { ok: true, branch: headBranch, base: develop, url, body }
}

// nextPatchTag — compute the next free `v<N>.<k>` hotfix patch tag.
//
// WHY pure: the only input is the raw stdout of `git tag -l "v<N>.*"` — a
// newline-separated list of strings. No git call, no filesystem access. This
// keeps the function trivially testable (no tmp-dir setup) and usable offline
// (the caller fetches tags once, then passes the stdout in).
//
// WHY parseInt / Math.max (OQ3): lexicographic sort breaks at .10 ("10" < "2"
// alphabetically). We parse each patch suffix as a base-10 integer and take
// the numeric maximum, so v3.10 correctly beats v3.9 and yields v3.11.
//
// FILTERING STRATEGY:
//   1. Split on newlines, trim each line.
//   2. Accept only lines that match /^v<N>\.\d+$/ — this simultaneously
//      enforces the correct milestone prefix AND rejects malformed patches
//      (empty suffix, non-digit suffix like "foo"). Lines for other milestones
//      never match the prefix so they fall through silently.
//   3. Parse the suffix with parseInt (radix 10) and collect into an array.
//   4. Empty array (no valid tags) → first patch is 1. Populated → max + 1.
//
// Returns the tag string `v<N>.<max+1>`. Never throws — malformed/empty input
// is handled by the filtering step above.
export function nextPatchTag(tagListStdout, milestoneN) {
  // Build the exact prefix string for this milestone so we can match strictly.
  // Using a template literal (not a regex) for the prefix comparison avoids
  // the need to escape milestoneN and keeps the logic readable.
  const prefix = `v${milestoneN}.`

  const patches = tagListStdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      // Must start with the exact milestone prefix (e.g. "v3.").
      if (!l.startsWith(prefix)) return false
      // The suffix (everything after "v<N>.") must be one or more digits.
      // Empty suffix ("v3.") and non-digit suffix ("v3.foo") are rejected.
      const suffix = l.slice(prefix.length)
      return /^\d+$/.test(suffix)
    })
    .map((l) => parseInt(l.slice(prefix.length), 10))

  const max = patches.length === 0 ? 0 : Math.max(...patches)
  return `v${milestoneN}.${max + 1}`
}
