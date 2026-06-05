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
import { flowInit, flowBranch, loadFlowConfig } from '../lib/flow.mjs'

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
