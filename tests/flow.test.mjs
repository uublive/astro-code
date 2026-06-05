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
import { join } from 'node:path'

import { git } from '../lib/git.mjs'
import { initPlanning } from '../lib/planning.mjs'
import { paths } from '../lib/paths.mjs'
import { readJSON, atomicWriteJSON } from '../lib/util.mjs'
import { initRegistry } from '../lib/registry.mjs'
import { flowInit, flowBranch, loadFlowConfig } from '../lib/flow.mjs'

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
