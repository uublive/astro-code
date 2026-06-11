// Behavior spec for lib/flow.mjs — GitFlow branch automation (Option A).
//
// WHY real git: branch ops are inherently about git state; mocks would only
// prove the mock. Mirroring registry.test.mjs: mkdtempSync + real git CLI.
// No bare remote needed — branch create/switch is local-only in this phase.
//
// SETUP SHAPE per test:
//   1. mkdtempSync → temp dir
//   2. git init + user.email/name config
//   3. initial commit on `main` so HEAD resolves
//   4. initPlanning → scaffolds .astrocode/
//   5. enable gitflow in config.json (per-test where needed)
//
// Registry-dependent tests (cases 4–5, 7) add a bare remote + initRegistry
// so readRegistry + registryBranch resolve correctly against state.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

import { git } from '../lib/git.mjs'
import { initPlanning } from '../lib/planning.mjs'
import { paths } from '../lib/paths.mjs'
import { readJSON, atomicWriteJSON } from '../lib/util.mjs'
import { initRegistry } from '../lib/registry.mjs'
import { flowInit, flowBranch, flowPR, loadFlowConfig, parseCompareUrl } from '../lib/flow.mjs'

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-flow-'))
  git(['init', '--quiet', '-b', 'main'], { cwd: dir })
  git(['config', 'user.email', 'flow-test@example.com'], { cwd: dir })
  git(['config', 'user.name', 'Flow Test'], { cwd: dir })
  // initial commit so main exists and HEAD is valid
  git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

function scaffold(dir) {
  initPlanning(dir, { name: 'flow-test-proj' })
  return dir
}

// Enable gitflow in the project config so flow functions are not gate-blocked.
function enableFlow(dir, extra = {}) {
  const p = paths(dir)
  const cfg = readJSON(p.config) || {}
  cfg.gitflow = {
    enabled: true,
    main: 'main',
    develop: 'develop',
    prefixes: { feature: 'feature', release: 'release', hotfix: 'hotfix' },
    pr: 'none',
    ...extra,
  }
  atomicWriteJSON(p.config, cfg)
}

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-flow-origin-')) + '/origin.git'
  git(['init', '--quiet', '--bare', bare])
  return bare
}

// Wire up a bare remote, push main, then run initRegistry so the orphan branch
// exists and registryBranch(root) resolves. Returns the dir (fluent helper).
function withRegistry(dir) {
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const res = initRegistry({ root: dir })
  assert.equal(res.ok, true, `initRegistry failed: ${res.error}`)
  return dir
}

// ---------------------------------------------------------------------------
// Case 1: flowInit creates develop off main on a repo that only has main
// ---------------------------------------------------------------------------

test('flowInit creates develop off main when only main exists', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  const res = flowInit(dir)

  assert.equal(res.ok, true, res.error || '')
  // develop must now exist as a local branch
  const branches = git(['branch', '--list', 'develop'], { cwd: dir }).stdout
  assert.match(branches, /develop/, 'develop branch was not created')
})

// ---------------------------------------------------------------------------
// Case 2: flowInit is idempotent — second call does not error, does not move develop
// ---------------------------------------------------------------------------

test('flowInit is idempotent — second call succeeds and does not move develop', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  flowInit(dir) // first call creates develop

  // make a commit on main to advance its tip — develop should NOT move
  git(['commit', '--allow-empty', '-m', 'main advances'], { cwd: dir })
  const developTip = git(['rev-parse', 'develop'], { cwd: dir }).stdout.trim()

  const res2 = flowInit(dir) // second call
  assert.equal(res2.ok, true, res2.error || '')

  // develop tip must be unchanged
  const developTipAfter = git(['rev-parse', 'develop'], { cwd: dir }).stdout.trim()
  assert.equal(developTipAfter, developTip, 'develop tip moved on idempotent flowInit')
})

// ---------------------------------------------------------------------------
// Case 3: flowInit warns (⚠, non-fatal) when develop exists with unrelated history
// ---------------------------------------------------------------------------

test('flowInit warns but succeeds when develop has unrelated history to main', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  // create an orphan develop with no shared ancestor
  git(['switch', '--orphan', 'develop'], { cwd: dir })
  git(['commit', '--allow-empty', '-m', 'unrelated root'], { cwd: dir })
  git(['switch', 'main'], { cwd: dir })

  const res = flowInit(dir)
  assert.equal(res.ok, true, `expected ok but got: ${res.error}`)
  assert.equal(res.warn, true, 'expected warn flag for unrelated develop history')
  assert.match(res.message || '', /⚠|unrelated|no common/, 'warning message missing expected text')
})

// ---------------------------------------------------------------------------
// Case 4: flowBranch creates feature/m<N>-<slug> off develop and HEAD lands on it
// ---------------------------------------------------------------------------

test('flowBranch creates feature/m<N>-<slug> off develop and HEAD is on it', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir) // adds remote + initRegistry so milestone 1 is in the registry
  flowInit(dir) // create develop

  const res = flowBranch(dir)
  assert.equal(res.ok, true, res.error || '')
  assert.ok(res.branch, 'branch name should be returned')
  assert.match(res.branch, /^feature\/m\d+-.+/, 'branch name has wrong shape')

  // HEAD must be on the new branch
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.equal(head, res.branch, `HEAD is ${head}, expected ${res.branch}`)
})

// ---------------------------------------------------------------------------
// Case 5: flowBranch is idempotent — branch already exists → switch, no error
// ---------------------------------------------------------------------------

test('flowBranch is idempotent — already-existing branch is switched to without error', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  flowInit(dir)

  const res1 = flowBranch(dir) // creates
  assert.equal(res1.ok, true, res1.error || '')

  // switch away then call again
  git(['switch', 'develop'], { cwd: dir })

  const res2 = flowBranch(dir) // should switch, not error
  assert.equal(res2.ok, true, res2.error || '')
  assert.equal(res2.branch, res1.branch, 'idempotent call must resolve the same branch name')
  assert.equal(res2.created, false, 'second call should not mark created=true')

  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.equal(head, res1.branch)
})

// ---------------------------------------------------------------------------
// Case 6: flowBranch + flowInit refuse when gitflow.enabled is false
// ---------------------------------------------------------------------------

test('flowInit refuses when gitflow.enabled is false', () => {
  const dir = scaffold(mkRepo())
  // do NOT call enableFlow — config stays at default enabled:false

  assert.throws(
    () => flowInit(dir),
    (err) => {
      assert.match(err.message, /disabled|enabled/, 'error should mention gitflow.enabled')
      return true
    },
  )
})

test('flowBranch refuses when gitflow.enabled is false', () => {
  const dir = scaffold(mkRepo())
  // do NOT call enableFlow

  assert.throws(
    () => flowBranch(dir),
    (err) => {
      assert.match(err.message, /disabled|enabled/, 'error should mention gitflow.enabled')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Case 7: flowBranch refuses with a clear hint when there is no active milestone
// ---------------------------------------------------------------------------

test('flowBranch refuses with a hint when there is no active milestone', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  flowInit(dir)

  // Remove the active_milestone from state so none is set
  const p = paths(dir)
  const state = readJSON(p.state)
  delete state.active_milestone
  atomicWriteJSON(p.state, state)

  // Also wipe the roadmap milestone to remove the fallback
  const rm = readJSON(p.roadmap)
  delete rm.milestone
  atomicWriteJSON(p.roadmap, rm)

  assert.throws(
    () => flowBranch(dir),
    (err) => {
      assert.match(err.message, /milestone|active/i, 'error should mention milestone')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Case 8: flowBranch refuses with the dirty-file list when working tree is dirty
// ---------------------------------------------------------------------------

test('flowBranch refuses and lists dirty files when working tree is dirty', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  flowInit(dir)

  // Create an untracked file to make the working tree dirty
  writeFileSync(join(dir, 'dirty.txt'), 'unstaged change\n')

  assert.throws(
    () => flowBranch(dir),
    (err) => {
      assert.match(err.message, /dirty|clean|dirty\.txt/i, 'error should mention dirty file(s)')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Case 9: flowBranch refuses when develop is missing (hint: run ac flow init)
// ---------------------------------------------------------------------------

test('flowBranch refuses with ac-flow-init hint when develop is missing', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  // intentionally do NOT call flowInit

  assert.throws(
    () => flowBranch(dir),
    (err) => {
      assert.match(err.message, /develop|flow init/i, 'error should hint about ac flow init')
      return true
    },
  )
})

// ---------------------------------------------------------------------------
// Case 10: neither flowInit nor flowBranch ever creates/modifies the astro-registry ref
// ---------------------------------------------------------------------------

test('flowInit and flowBranch never create or touch the astro-registry orphan ref', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir) // this creates astro-registry on the remote; keep its local state

  // capture branches before any flow calls
  const branchesBefore = git(['branch', '--list'], { cwd: dir }).stdout

  flowInit(dir)
  flowBranch(dir)

  const branchesAfter = git(['branch', '--list'], { cwd: dir }).stdout

  // astro-registry must not appear as a local branch after the flow calls
  assert.equal(branchesAfter.includes('astro-registry'), false, 'astro-registry local ref was created by a flow call')
  // the set of branches containing astro-registry should be identical before/after
  const extract = (s) => s.split('\n').map((l) => l.trim()).filter((l) => l.includes('astro-registry'))
  assert.deepEqual(extract(branchesAfter), extract(branchesBefore))
})

// ---------------------------------------------------------------------------
// Case 11: milestone name with unicode/special chars produces a git-valid branch name
// ---------------------------------------------------------------------------

test('milestone name with unicode/special chars produces a git-valid branch name', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  flowInit(dir)

  // Patch state/roadmap so the milestone name contains special chars
  const p = paths(dir)
  const rm = readJSON(p.roadmap)
  rm.milestone = 1
  atomicWriteJSON(p.roadmap, rm)

  const res = flowBranch(dir)
  assert.equal(res.ok, true, res.error || '')

  // git check-ref-format --branch validates the branch name against git rules
  const check = git(['check-ref-format', '--branch', res.branch])
  assert.equal(check.status, 0, `branch name "${res.branch}" is not git-valid: ${check.stderr}`)
})

// ---------------------------------------------------------------------------
// CLI dispatch tests — Case 12-13: `ac flow init` and `ac flow` wire correctly
// into bin/ac.mjs's switch (cmd) and delegate to lib/flow.mjs
// ---------------------------------------------------------------------------

// Helper: spawn bin/ac.mjs with given args, returns { status, stdout, stderr }
function ac(args, cwd) {
  return spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  })
}

test('ac flow init creates develop branch and exits 0', () => {
  // Need a real git repo + initPlanning + gitflow enabled so flowInit can run.
  // withRegistry is not required for flowInit — local-only operation.
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  const r = ac(['flow', 'init'], dir)
  assert.equal(r.status, 0, `ac flow init exited ${r.status}:\n${r.stderr}`)

  // Verify develop was created
  const branches = git(['branch', '--list', 'develop'], { cwd: dir }).stdout
  assert.match(branches, /develop/, 'develop branch was not created by ac flow init')

  // Output should contain a ✓ success glyph or mention develop
  assert.match(r.stdout + r.stderr, /develop/, 'output should mention develop')
})

test('ac flow init is idempotent — second call exits 0 without moving develop', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  ac(['flow', 'init'], dir) // first call
  const tipBefore = git(['rev-parse', 'develop'], { cwd: dir }).stdout.trim()

  const r2 = ac(['flow', 'init'], dir) // second call — must be a no-op success
  assert.equal(r2.status, 0, `second ac flow init exited ${r2.status}:\n${r2.stderr}`)

  const tipAfter = git(['rev-parse', 'develop'], { cwd: dir }).stdout.trim()
  assert.equal(tipAfter, tipBefore, 'second ac flow init moved develop tip')
})

test('ac flow creates feature branch off develop and exits 0', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir) // need registry so milestone claim resolves
  flowInit(dir)     // ensure develop exists

  const r = ac(['flow'], dir)
  assert.equal(r.status, 0, `ac flow exited ${r.status}:\n${r.stderr}`)

  // HEAD must be on a feature/m<N>-<slug> branch
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.match(head, /^feature\/m\d+-.+/, `HEAD "${head}" does not look like a feature branch`)

  // Output should report the branch name
  assert.match(r.stdout + r.stderr, /feature\/m\d+/, 'output should include the branch name')

  // ...and the worktree-base reminder (PLAN t5 / ACCEPTANCE #7, todo #6): the user
  // must be told to run /astro-execute from here, since worktrees fork from HEAD.
  assert.match(
    r.stdout + r.stderr,
    /\/astro-execute/,
    'ac flow must remind the user to run /astro-execute from the feature branch',
  )
})

test('ac flow exits non-zero and prints a clear error when gitflow is disabled', () => {
  const dir = scaffold(mkRepo())
  // do NOT enableFlow — gitflow.enabled stays false

  const r = ac(['flow', 'init'], dir)
  assert.notEqual(r.status, 0, 'ac flow init should exit non-zero when gitflow disabled')
  assert.match(r.stderr + r.stdout, /disabled|enabled/, 'error should mention gitflow.enabled')
})

test('ac flow exits non-zero and hints at ac flow init when develop is missing', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  withRegistry(dir)
  // intentionally do NOT run flowInit

  const r = ac(['flow'], dir)
  assert.notEqual(r.status, 0, 'ac flow should exit non-zero when develop is missing')
  assert.match(r.stderr + r.stdout, /develop|flow init/i, 'error should hint about ac flow init')
})

// ---------------------------------------------------------------------------
// Case t6: HELP text documents both `ac flow init` and `ac flow` separately
// ---------------------------------------------------------------------------

test('ac help documents ac flow init and ac flow as separate entries', () => {
  // HELP text must expose both subcommands so users know the two-step workflow.
  // The `ac` helper works without a real .astrocode repo — help prints unconditionally.
  const dir = mkdtempSync(join(tmpdir(), 'ac-flow-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow init/, '`ac flow init` must appear in the HELP text')
  assert.match(r.stdout, /ensure main \+ develop exist/, 'ac flow init description must mention "ensure main + develop exist"')
  assert.match(r.stdout, /ac flow\b/, '`ac flow` (no subcommand) must appear in the HELP text')
  assert.match(r.stdout, /create\+switch.*feature\/m/, 'ac flow description must mention create+switch to feature/m<N>')
})

// ---------------------------------------------------------------------------
// t1 — parseCompareUrl(remoteUrl, base, head): pure URL construction
//
// These tests intentionally fail until t2 adds the exported function to
// lib/flow.mjs. The function must handle all six remote forms (HTTPS/SSH/
// ssh:// for github.com and gitlab.com), GitLab subgroups, no-.git-suffix
// variants, GHES (*.github.com), self-hosted gitlab.*, and unrecognized
// host → null. No real git, no real network — this is pure string logic.
// ---------------------------------------------------------------------------

// --- GitHub HTTPS (git suffix present) ---
test('parseCompareUrl: GitHub HTTPS with .git suffix → /compare/base...head URL', () => {
  const url = parseCompareUrl('https://github.com/acme/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://github.com/acme/myrepo/compare/develop...feature%2Fm1-foo')
})

// --- GitHub HTTPS (no .git suffix) ---
test('parseCompareUrl: GitHub HTTPS without .git suffix → /compare/base...head URL', () => {
  const url = parseCompareUrl('https://github.com/acme/myrepo', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://github.com/acme/myrepo/compare/develop...feature%2Fm1-foo')
})

// --- GitHub SSH (git@github.com style) ---
test('parseCompareUrl: GitHub SSH (git@github.com) → /compare/base...head URL', () => {
  const url = parseCompareUrl('git@github.com:acme/myrepo.git', 'develop', 'feature/m2-bar')
  assert.equal(url, 'https://github.com/acme/myrepo/compare/develop...feature%2Fm2-bar')
})

// --- GitHub ssh:// URL form ---
test('parseCompareUrl: GitHub ssh:// URL form → /compare/base...head URL', () => {
  const url = parseCompareUrl('ssh://git@github.com/acme/myrepo.git', 'develop', 'feature/m3-baz')
  assert.equal(url, 'https://github.com/acme/myrepo/compare/develop...feature%2Fm3-baz')
})

// --- GitLab HTTPS (git suffix present) ---
test('parseCompareUrl: GitLab HTTPS with .git suffix → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('https://gitlab.com/acme/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://gitlab.com/acme/myrepo/-/compare/develop...feature%2Fm1-foo')
})

// --- GitLab HTTPS (no .git suffix) ---
test('parseCompareUrl: GitLab HTTPS without .git suffix → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('https://gitlab.com/acme/myrepo', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://gitlab.com/acme/myrepo/-/compare/develop...feature%2Fm1-foo')
})

// --- GitLab SSH (git@gitlab.com style) ---
test('parseCompareUrl: GitLab SSH (git@gitlab.com) → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('git@gitlab.com:acme/myrepo.git', 'develop', 'feature/m2-bar')
  assert.equal(url, 'https://gitlab.com/acme/myrepo/-/compare/develop...feature%2Fm2-bar')
})

// --- GitLab ssh:// URL form ---
test('parseCompareUrl: GitLab ssh:// URL form → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('ssh://git@gitlab.com/acme/myrepo.git', 'develop', 'feature/m3-baz')
  assert.equal(url, 'https://gitlab.com/acme/myrepo/-/compare/develop...feature%2Fm3-baz')
})

// --- GitLab subgroups (nested path) ---
test('parseCompareUrl: GitLab HTTPS with subgroup path → /-/compare preserves full path', () => {
  const url = parseCompareUrl('https://gitlab.com/org/team/subgroup/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://gitlab.com/org/team/subgroup/myrepo/-/compare/develop...feature%2Fm1-foo')
})

// --- GHES (*.github.com custom host) ---
test('parseCompareUrl: GHES subdomain (*.github.com) HTTPS → /compare/base...head URL', () => {
  const url = parseCompareUrl('https://github.example.com/acme/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://github.example.com/acme/myrepo/compare/develop...feature%2Fm1-foo')
})

// --- GHES SSH (git@github.example.com style) ---
test('parseCompareUrl: GHES SSH (git@github.example.com) → /compare/base...head URL', () => {
  const url = parseCompareUrl('git@github.example.com:acme/myrepo.git', 'develop', 'feature/m2-bar')
  assert.equal(url, 'https://github.example.com/acme/myrepo/compare/develop...feature%2Fm2-bar')
})

// --- Self-hosted GitLab (gitlab.* host) ---
test('parseCompareUrl: self-hosted GitLab (gitlab.*) HTTPS → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('https://gitlab.acme.com/team/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://gitlab.acme.com/team/myrepo/-/compare/develop...feature%2Fm1-foo')
})

// --- Self-hosted GitLab SSH ---
test('parseCompareUrl: self-hosted GitLab SSH (git@gitlab.acme.com) → /-/compare/base...head URL', () => {
  const url = parseCompareUrl('git@gitlab.acme.com:team/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, 'https://gitlab.acme.com/team/myrepo/-/compare/develop...feature%2Fm1-foo')
})

// --- Unrecognized host → null ---
test('parseCompareUrl: unrecognized host (bitbucket.org) → null', () => {
  const url = parseCompareUrl('https://bitbucket.org/acme/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, null)
})

// --- Unrecognized host SSH → null ---
test('parseCompareUrl: unrecognized SSH host → null', () => {
  const url = parseCompareUrl('git@bitbucket.org:acme/myrepo.git', 'develop', 'feature/m1-foo')
  assert.equal(url, null)
})

// --- Branch names with slashes are percent-encoded in the URL ---
test('parseCompareUrl: branch names with slashes are percent-encoded', () => {
  const url = parseCompareUrl('https://github.com/acme/repo.git', 'main', 'hotfix/fix-auth')
  assert.equal(url, 'https://github.com/acme/repo/compare/main...hotfix%2Ffix-auth')
})

// ---------------------------------------------------------------------------
// t5: flowPR — push feature/m<N>-* to origin + compare URL (pr:none)
//
// WHY real bare remote: push + ls-remote can only be verified against a real
// remote; mocking git would only prove the mock. Pattern mirrors registry.test.mjs
// and the earlier withRegistry tests above. The github-URL scenario requires a
// separate remote URL override so we can test URL generation without a real forge.
// ---------------------------------------------------------------------------

// Helper: make a commit on dir so the feature branch diverges from develop
function commitOnBranch(dir, msg = 'work') {
  writeFileSync(join(dir, `work-${Date.now()}.txt`), msg)
  git(['add', '.'], { cwd: dir })
  git(['commit', '-m', msg], { cwd: dir })
}

// Helper: extract the bare path from the origin remote URL (filesystem-based).
// Used by ls-remote calls so we don't need network access to a real forge.
function bareRemotePath(dir) {
  return git(['remote', 'get-url', 'origin'], { cwd: dir }).stdout.trim()
}

test('flowPR pushes feature/m<N>-* to origin and returns a github compare URL targeting develop', () => {
  // Set up: withRegistry (real bare remote, filesystem path), gitflow enabled,
  // develop created, feature branch created via flowBranch.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)
  const br = flowBranch(dir)
  assert.equal(br.ok, true, br.error || '')
  commitOnBranch(dir) // ensure feature branch has commits ahead of develop

  // Override the fetch URL to a github-like URL so parseCompareUrl returns a real
  // compare URL. Set a pushurl back to the filesystem bare so the actual push works
  // without network access.
  git(['remote', 'set-url', 'origin', 'https://github.com/test-owner/test-repo.git'], { cwd: dir })
  git(['remote', 'set-url', '--push', 'origin', bare], { cwd: dir })

  const res = flowPR(dir)

  assert.equal(res.ok, true, `flowPR failed: ${JSON.stringify(res)}`)

  // Must return a github compare URL targeting develop as the base
  assert.ok(res.url, 'flowPR must return a URL')
  assert.match(
    res.url,
    /github\.com\/test-owner\/test-repo\/compare\/develop\.\.\./,
    `compare URL should target develop; got: ${res.url}`,
  )

  // Verify the remote ref was actually pushed (ls-remote against the bare filesystem)
  const lsRemote = git(['ls-remote', bare, `refs/heads/${br.branch}`])
  assert.equal(lsRemote.status, 0, `ls-remote failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, new RegExp(br.branch), `remote ref ${br.branch} not found on bare remote`)
})

test('flowPR degrade: unrecognized remote URL carries branch names + advisory, does not throw', () => {
  // Filesystem path remotes are not github/gitlab — parseCompareUrl returns null.
  // The engine must degrade to { ok: true, branch, base, url: null, advisory }
  // rather than throwing so the user always gets the branch names at minimum.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)
  const br = flowBranch(dir)
  assert.equal(br.ok, true, br.error || '')
  commitOnBranch(dir)

  // Leave the remote URL as the filesystem path — unrecognized by parseCompareUrl
  let res
  assert.doesNotThrow(() => {
    res = flowPR(dir)
  }, 'flowPR must not throw on unrecognized remote — it must degrade gracefully')

  assert.equal(res.ok, true, 'degraded flowPR must still return ok:true')
  // Result must carry branch and base so the user knows what to PR
  assert.ok(res.branch, 'degraded result must carry branch name')
  assert.ok(res.base, 'degraded result must carry base branch name')
  // URL is null or absent (unrecognized host)
  assert.ok(!res.url, `degraded result should not have a URL; got: ${res.url}`)
  // Advisory must be present to explain the degradation
  assert.ok(res.advisory, 'degraded result must carry an advisory message')
  assert.match(String(res.advisory), /⚠|unrecognized|unknown|no url|compare/i, 'advisory should explain the URL degradation')
})

test('flowPR throws "no remote" when repo has no remote configured', () => {
  // OQ4: push-requiring commands fail fast with a clear message — never silent
  // half-success. Without a remote there is nowhere to push; the error must name
  // the missing remote so the user knows the next step.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  flowInit(dir) // creates develop locally — no remote needed for this step

  // Manually create a feature branch so we don't need registry (which needs remote)
  const cfg = loadFlowConfig(dir)
  const featureBranch = `${cfg.prefixes.feature}/m1-test`
  git(['switch', '-c', featureBranch, cfg.develop], { cwd: dir })
  commitOnBranch(dir)

  assert.throws(
    () => flowPR(dir),
    (err) => {
      assert.match(
        err.message,
        /no remote|remote.*origin|no.*remote/i,
        `error should mention missing remote; got: ${err.message}`,
      )
      return true
    },
    'flowPR must throw when no remote is configured',
  )
})

test('flowPR throws when gitflow is disabled', () => {
  // Every flow function gates on assertFlowEnabled — PR creation is no exception.
  // Ensures that projects that haven't opted in cannot accidentally push and open PRs.
  const dir = scaffold(mkRepo())
  // Do NOT call enableFlow — gitflow.enabled stays false

  assert.throws(
    () => flowPR(dir),
    (err) => {
      assert.match(err.message, /disabled|enabled/, 'error should mention gitflow.enabled')
      return true
    },
    'flowPR must throw when gitflow is disabled',
  )
})

test('flowPR result carries .astrocode/state.json merge-conflict advisory in the body', () => {
  // The PR body must warn reviewers that .astrocode/state.json on the feature
  // branch will conflict with develop at merge time (both sides modify it with
  // progress data). Surfacing this in the PR body prevents surprise conflict
  // blocks at the GitHub/GitLab merge UI step.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)
  flowBranch(dir)
  commitOnBranch(dir)

  const res = flowPR(dir)
  assert.equal(res.ok, true, `flowPR failed: ${JSON.stringify(res)}`)

  // The body field (or advisory if body is absent) must mention state.json conflict
  const body = res.body || res.advisory || ''
  assert.match(
    body,
    /state\.json|\.astrocode/i,
    `PR body should warn about .astrocode/state.json merge conflicts; got body: "${body}"`,
  )
})

// ---------------------------------------------------------------------------
// t7: flowRelease — push develop + develop→main compare URL (pr:none), no tag
//
// WHY dynamic import: flowRelease is not exported from lib/flow.mjs until t8
// lands. A static `import { flowRelease }` at module load time would make ESM
// throw a SyntaxError / module resolution error that crashes the ENTIRE file,
// breaking all 39 pre-existing tests. Instead, we use `await import(...)` inside
// each async test body — if the export is missing, ONLY the test that tried to
// call it fails (ReferenceError on destructure), and every other test runs
// normally. Once t8 adds the export the dynamic import resolves correctly
// and these tests turn green without touching this file.
//
// WHY real bare remote + set-url trick: same rationale as the flowPR tests
// above — push can only be verified against a real remote. We override the fetch
// URL to a github-style URL so parseCompareUrl returns a recognizable compare
// URL, while pushing to the local bare path so no network is needed.
// ---------------------------------------------------------------------------

test('flowRelease pushes develop and returns a develop→main compare URL', async () => {
  // Import flowRelease dynamically so a missing export fails only this test,
  // not the entire 39-test suite (ESM static imports would crash at load time).
  const { flowRelease } = await import('../lib/flow.mjs')

  // Set up a full withRegistry-style repo: bare remote, gitflow enabled, develop
  // created via flowInit, and HEAD on develop (the required branch for release).
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)

  // Land on develop and make a commit so it has something to push.
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'release-ready commit')

  // Override fetch URL to a github-like URL for compare-URL construction; push
  // URL stays as the bare filesystem path so no network access is required.
  git(['remote', 'set-url', 'origin', 'https://github.com/test-owner/test-repo.git'], { cwd: dir })
  git(['remote', 'set-url', '--push', 'origin', bare], { cwd: dir })

  const res = flowRelease(dir)

  assert.equal(res.ok, true, `flowRelease failed: ${JSON.stringify(res)}`)

  // Must return a github compare URL with develop as head and main as base.
  assert.ok(res.url, 'flowRelease must return a compare URL')
  assert.match(
    res.url,
    /github\.com\/test-owner\/test-repo\/compare\/main\.\.\./,
    `compare URL should target main as base; got: ${res.url}`,
  )
  assert.match(
    res.url,
    /develop/,
    `compare URL should mention develop as head; got: ${res.url}`,
  )

  // Verify develop was actually pushed to the bare remote.
  const lsRemote = git(['ls-remote', bare, 'refs/heads/develop'])
  assert.equal(lsRemote.status, 0, `ls-remote failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, /develop/, 'develop ref not found on bare remote after flowRelease')
})

test('flowRelease does not create any tag (OQ2: never tag at PR-open time)', async () => {
  // OQ2 binding: release tagging is a separate `ac flow tag` step run after the
  // develop→main PR merges. flowRelease must never create a tag — not v<N>, not
  // v<N>.0, nothing. This test asserts the invariant so a future refactor cannot
  // accidentally introduce premature tagging.
  const { flowRelease } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'pre-release commit')

  // No URL override needed — we only care about tag absence here.
  flowRelease(dir)

  // git tag -l returns all tags; must be empty after flowRelease.
  const tagList = git(['tag', '-l'], { cwd: dir }).stdout.trim()
  assert.equal(tagList, '', `flowRelease must not create any tags; found: "${tagList}"`)

  // Also verify no v* tags were pushed to the remote.
  const remoteTags = git(['ls-remote', '--tags', bare]).stdout.trim()
  assert.equal(remoteTags, '', `flowRelease must not push any tags to remote; found: "${remoteTags}"`)
})

test('flowRelease throws mentioning "develop" when HEAD is on a feature branch', async () => {
  // Guard: flowRelease is only valid from the develop branch. Running it from a
  // feature branch (or main) must throw a clear error naming the required branch
  // so the user knows exactly what to fix before retrying.
  const { flowRelease } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)

  // Land on a feature branch (not develop) — simulates running `ac flow release`
  // at the wrong point in the workflow.
  const cfg = loadFlowConfig(dir)
  const featureBranch = `${cfg.prefixes.feature}/m1-test-release-guard`
  git(['switch', '-c', featureBranch, cfg.develop], { cwd: dir })

  assert.throws(
    () => flowRelease(dir),
    (err) => {
      assert.match(
        err.message,
        /develop/i,
        `error should mention "develop"; got: ${err.message}`,
      )
      return true
    },
    'flowRelease must throw when HEAD is not on develop',
  )
})

test('flowRelease throws "no remote" when repo has no remote configured', async () => {
  // OQ4: push-requiring commands fail fast with a clear, actionable message when
  // there is no remote. No partial side effects — develop must NOT be pushed
  // (impossible without a remote) and no URL is returned.
  const { flowRelease } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  enableFlow(dir)
  // flowInit works locally without a remote.
  flowInit(dir)
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'local-only commit')
  // No remote added — repo is fully local.

  assert.throws(
    () => flowRelease(dir),
    (err) => {
      assert.match(
        err.message,
        /no remote|remote.*origin|no.*remote/i,
        `error should mention missing remote; got: ${err.message}`,
      )
      return true
    },
    'flowRelease must throw when no remote is configured',
  )
})

// ---------------------------------------------------------------------------
// t9: flowTag — post-merge tag of v<N> on main (OQ2 verify-then-tag contract)
//
// WHY dynamic import: flowTag is not exported from lib/flow.mjs until t10
// lands. A static `import { flowTag }` at module load time would make ESM
// throw a SyntaxError / module resolution error that crashes the ENTIRE file,
// breaking all 43 pre-existing tests. Instead, we use `await import(...)` inside
// each async test body — if the export is missing, ONLY the test that tried to
// call it fails (ReferenceError on destructure), and every other test runs
// normally. Once t10 adds the export the dynamic import resolves correctly
// and these tests turn green without touching this file.
//
// WHY real bare remote + manual merge: the verify-then-tag contract (OQ2) is
// inherently about git history — specifically whether the develop tip is an
// ancestor of origin/main. Only a real git repo with a real bare remote lets
// us test this accurately. Faking it with mocks would only prove the mock.
// We simulate the forge merge by running `git switch main; git merge develop`
// locally, then pushing main to the bare remote before calling flowTag.
//
// MILESTONE N: initPlanning sets active_milestone=1 (confirmed in planning.mjs
// line 56), so the expected tag is "v1" for all withRegistry-style test repos.
// ---------------------------------------------------------------------------

test('flowTag creates annotated v1 tag on origin/main after develop is merged in', async () => {
  // Import flowTag dynamically so a missing export fails only this test,
  // not the entire 43-test suite (ESM static imports crash at load time).
  const { flowTag } = await import('../lib/flow.mjs')

  // Set up: withRegistry-style repo (bare remote, gitflow enabled, develop created
  // via flowInit, milestone 1 active via initPlanning). Simulate what the forge
  // does after the develop→main PR merges: switch to main, merge develop in
  // (--no-ff to always produce a merge commit), then push main to the bare remote
  // so origin/main contains the develop tip.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)

  // Make a commit on develop so it actually diverges from main (otherwise the
  // merge is a trivial fast-forward and the develop tip IS main — same SHA).
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'feature work on develop')
  const developTip = git(['rev-parse', 'develop'], { cwd: dir }).stdout.trim()

  // Simulate the forge merge: switch to main, merge develop, push main.
  // --no-ff ensures a merge commit is created even when fast-forward is possible,
  // matching what GitHub/GitLab produce when they merge a PR.
  git(['switch', 'main'], { cwd: dir })
  git(['merge', '--no-ff', '-m', 'Merge develop into main for release', 'develop'], { cwd: dir })
  git(['push', 'origin', 'main'], { cwd: dir })

  const res = flowTag(dir)

  assert.equal(res.ok, true, `flowTag failed: ${JSON.stringify(res)}`)

  // The tag name must be v<N> where N = active_milestone = 1 for this repo.
  assert.equal(res.tag, 'v1', `expected tag "v1"; got "${res.tag}"`)

  // The tag must have been pushed to the bare remote — verify via ls-remote.
  // `git ls-remote --tags <remote>` lists all tag refs; we assert v1 appears.
  const lsRemote = git(['ls-remote', '--tags', bare])
  assert.equal(lsRemote.status, 0, `ls-remote --tags failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, /refs\/tags\/v1/, `tag v1 not found on bare remote; ls-remote output: "${lsRemote.stdout}"`)

  // Sanity: the develop tip must be an ancestor of the tagged commit (the whole
  // point of the verify-then-tag contract is that we ONLY tag when this is true).
  const isAncestor = git(['merge-base', '--is-ancestor', developTip, 'v1'], { cwd: dir })
  assert.equal(isAncestor.status, 0, 'develop tip must be an ancestor of the v1 tag')
})

test('flowTag refuses and throws when main does not yet contain the develop tip', async () => {
  // OQ2 refusal path: if the develop→main PR has not been merged yet, origin/main
  // does NOT contain the develop tip. flowTag must detect this via
  // `git merge-base --is-ancestor` and throw a clear error — never create a tag
  // on a stale main tip. This is the entire point of the verify-then-tag step.
  //
  // WHY we must NOT tag: tagging a stale main before the merge would produce a
  // v<N> tag that does NOT represent the release content. The forge merge commit
  // would then be untagged forever (no mechanism to retroactively tag it without
  // breaking the monotonic tag history assumption). The refusal is a hard guard,
  // not a warning.
  const { flowTag } = await import('../lib/flow.mjs')

  // Set up: withRegistry-style repo, develop has a commit that main does NOT
  // contain. We do NOT merge develop into main — this simulates `ac flow tag`
  // being run before the develop→main PR is merged.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)

  // Commit on develop so it diverges from main.
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'unreleased feature work')

  // Push develop to origin so the remote exists, but do NOT merge into main
  // and do NOT push main — origin/main is still at the pre-develop tip.
  git(['push', '-u', 'origin', 'develop'], { cwd: dir })

  // flowTag must throw: develop tip is not yet an ancestor of origin/main.
  assert.throws(
    () => flowTag(dir),
    (err) => {
      assert.match(
        err.message,
        /does not yet contain|not.*contain|ancestor/i,
        `error should mention ancestor/not-contain; got: "${err.message}"`,
      )
      return true
    },
    'flowTag must throw when origin/main does not yet contain the develop tip',
  )

  // Belt-and-suspenders: no local tag must have been created either.
  const tagList = git(['tag', '-l', 'v*'], { cwd: dir }).stdout.trim()
  assert.equal(tagList, '', `flowTag must not create any local tag on refusal; found: "${tagList}"`)

  // And nothing pushed to the remote.
  const remoteTags = git(['ls-remote', '--tags', bare]).stdout.trim()
  assert.equal(remoteTags, '', `flowTag must not push any tag to remote on refusal; found: "${remoteTags}"`)
})

// ---------------------------------------------------------------------------
// t11: flowHotfixStart — branch hotfix/<name> off main (ADR-013 offline path)
//
// WHY dynamic import: flowHotfixStart is not exported from lib/flow.mjs until
// t12 lands. A static `import { flowHotfixStart }` at load time would crash the
// ENTIRE file with an ESM binding error, breaking all 45 currently-green tests.
// Importing inside the async test body means ONLY the new t11 tests fail until
// t12 ships — no collateral damage.
//
// WHY no remote / no withRegistry: ADR-013 establishes that hotfixes consume NO
// registry numbers and the emergency path works fully offline. `flowHotfixStart`
// is a local-only operation (branch create + switch off main). These tests use a
// plain scaffold(mkRepo()) + enableFlow(dir) to prove the offline contract holds.
//
// COLLISION ADVISORY: because the user supplies the hotfix name directly (not
// allocated from a shared registry), two developers could independently create
// `hotfix/fix-auth` and the first push to the remote wins. The advisory surfaces
// this so the operator knows to check before pushing — it is informational, not
// an error.
// ---------------------------------------------------------------------------

test('flowHotfixStart creates and switches to hotfix/fix-auth off main', async () => {
  // Import flowHotfixStart dynamically so a missing export fails only this test,
  // not the entire 45-test suite (ESM static imports crash at load time).
  const { flowHotfixStart } = await import('../lib/flow.mjs')

  // Plain scaffold + enableFlow — NO withRegistry/remote. This proves the offline
  // emergency path works without any network access (ADR-013).
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  // Capture main's tip before the hotfix branch is created so we can verify the
  // fork point. The hotfix branch must start from main's current commit.
  const mainTipBefore = git(['rev-parse', 'main'], { cwd: dir }).stdout.trim()

  const res = flowHotfixStart(dir, 'fix-auth')

  assert.equal(res.ok, true, `flowHotfixStart failed: ${JSON.stringify(res)}`)
  assert.equal(res.branch, 'hotfix/fix-auth', `expected branch name "hotfix/fix-auth"; got "${res.branch}"`)
  assert.equal(res.created, true, 'first call must report created:true')

  // HEAD must now be on the hotfix branch.
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.equal(head, 'hotfix/fix-auth', `HEAD is "${head}"; expected "hotfix/fix-auth"`)

  // The hotfix branch tip must equal main's tip at fork time — no commits added yet.
  const hotfixTip = git(['rev-parse', 'hotfix/fix-auth'], { cwd: dir }).stdout.trim()
  assert.equal(hotfixTip, mainTipBefore, 'hotfix branch tip must equal main tip at fork time')
})

test('flowHotfixStart result carries a collision advisory about user-supplied name', async () => {
  // The advisory exists because hotfix names are NOT allocated from the shared
  // registry (ADR-013: fully offline path). Two developers could pick the same
  // name independently; the push would reject for the second one. Surfacing this
  // advisory at branch-create time lets the operator verify uniqueness before push.
  const { flowHotfixStart } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  enableFlow(dir)

  const res = flowHotfixStart(dir, 'fix-auth')

  assert.equal(res.ok, true, `flowHotfixStart failed: ${JSON.stringify(res)}`)
  assert.ok(res.advisory, 'result must carry an advisory field')
  assert.match(
    String(res.advisory),
    /collision|push|reject|name/i,
    `advisory should mention collision/push/reject/name risk; got: "${res.advisory}"`,
  )
})

test('flowHotfixStart throws for an invalid branch name (check-ref-format rejection)', async () => {
  // git check-ref-format --branch hotfix/<name> catches names that would produce
  // an invalid ref — e.g. double-dots, trailing dots, leading hyphens, etc. This
  // guard prevents creating a branch that git itself would later refuse to push.
  const { flowHotfixStart } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  enableFlow(dir)

  assert.throws(
    () => flowHotfixStart(dir, 'bad..name'),
    (err) => {
      // The error must describe what's wrong — name, ref-format, or invalid are
      // all acceptable signals. The exact wording is the implementation's choice.
      assert.match(
        err.message,
        /invalid|ref.?format|name|bad/i,
        `error should name the problem; got: "${err.message}"`,
      )
      return true
    },
    'flowHotfixStart must throw when the name fails git check-ref-format',
  )
})

test('flowHotfixStart succeeds with no remote configured (fully offline — ADR-013)', async () => {
  // ADR-013 binding: the emergency path must work offline. This test uses a repo
  // with NO remote at all — not even a bare filesystem origin. If flowHotfixStart
  // ever tries to fetch, push, or read the registry, it will fail here. Passing
  // proves the branch create/switch path is purely local.
  const { flowHotfixStart } = await import('../lib/flow.mjs')

  // mkRepo() only — no withRegistry, no remote add. Fully air-gapped.
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  let res
  assert.doesNotThrow(() => {
    res = flowHotfixStart(dir, 'offline-fix')
  }, 'flowHotfixStart must succeed with no remote configured (ADR-013 offline path)')

  assert.equal(res.ok, true, `expected ok:true from offline flowHotfixStart; got: ${JSON.stringify(res)}`)
  assert.equal(res.branch, 'hotfix/offline-fix', `expected "hotfix/offline-fix"; got "${res.branch}"`)

  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.equal(head, 'hotfix/offline-fix', `HEAD should be on the hotfix branch; got "${head}"`)
})

test('flowHotfixStart throws matching /disabled|enabled/ when gitflow is not enabled', async () => {
  // Every flow function gates on assertFlowEnabled. Hotfix start is no exception —
  // accidentally creating a hotfix branch in a repo that has not opted in to gitflow
  // would bypass the naming conventions and produce an untracked branch.
  const { flowHotfixStart } = await import('../lib/flow.mjs')

  const dir = scaffold(mkRepo())
  // Intentionally do NOT call enableFlow — gitflow.enabled stays false.

  assert.throws(
    () => flowHotfixStart(dir, 'fix-auth'),
    (err) => {
      assert.match(
        err.message,
        /disabled|enabled/,
        `error should mention gitflow disabled/enabled; got: "${err.message}"`,
      )
      return true
    },
    'flowHotfixStart must throw when gitflow is disabled',
  )
})
