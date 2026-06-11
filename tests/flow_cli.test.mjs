// CLI-level dispatch tests for the five new `ac flow` subcommands (phase 4 t15).
//
// WHY a separate file (not flow.test.mjs): single-file ownership — t15 and all
// the t11/t13 test additions live in their respective owner files so parallel
// executors cannot collide. This file owns only CLI dispatch; lib/flow.mjs
// unit tests remain in tests/flow.test.mjs.
//
// EXPECTED STATE DURING t15 (before t16 lands): the five new subcommands
// (`pr`, `release`, `tag`, `hotfix start`, `hotfix finish`) are NOT yet wired
// in bin/ac.mjs. Those tests will be RED (assertion failures — wrong exit code
// or missing output), which is the intended RED phase. The test FILE itself
// must not crash at load time; all failures must be assertion failures inside
// individual test bodies.
//
// SETUP PATTERN mirrors flow.test.mjs exactly — same mkRepo/scaffold/enableFlow/
// withRegistry helpers replicated locally (no cross-file imports) so this file
// is fully self-contained and can be executed in any order without depending on
// flow.test.mjs loading first.
//
// GITHUB URL + PUSHURL TRICK (from flow.test.mjs t5/t7 pattern):
//   git remote set-url origin https://github.com/… — fetch URL for compare-URL
//   git remote set-url --push origin <bare-path>    — push URL stays local
// This gives us a recognizable compare URL in assertions while the actual git
// push lands on the local bare filesystem (no network needed).

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
import { flowInit } from '../lib/flow.mjs'

// Absolute path to bin/ac.mjs derived from import.meta.url — same pattern used
// by statusline.test.mjs and the CLI dispatch tests inside flow.test.mjs.
const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// Helpers — local copies of the standard test helpers from flow.test.mjs.
// Replicated here (not imported) so this file is self-contained and the two
// test files never become co-dependent. Single-file ownership requires it.
// ---------------------------------------------------------------------------

function mkRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-'))
  git(['init', '--quiet', '-b', 'main'], { cwd: dir })
  git(['config', 'user.email', 'flow-cli-test@example.com'], { cwd: dir })
  git(['config', 'user.name', 'Flow CLI Test'], { cwd: dir })
  // initial commit so main exists and HEAD is valid
  git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

function scaffold(dir) {
  initPlanning(dir, { name: 'flow-cli-test-proj' })
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
  const bare = mkdtempSync(join(tmpdir(), 'ac-fc-origin-')) + '/origin.git'
  git(['init', '--quiet', '--bare', bare])
  // Override core.hooksPath so per-repo hooks take precedence over any global
  // hookspath the developer has set (e.g. Sourcetree). Mirrors the same guard
  // in flow.test.mjs so rejection tests work consistently.
  git(['config', 'core.hooksPath', join(bare, 'hooks')], { cwd: bare })
  return bare
}

// Wire up a bare remote, push main, run initRegistry. Returns dir (fluent).
function withRegistry(dir) {
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const res = initRegistry({ root: dir })
  assert.equal(res.ok, true, `initRegistry failed: ${res.error}`)
  return dir
}

// Wire up a bare remote with a github-style fetch URL so parseCompareUrl
// returns a recognizable URL, but keep the pushurl as the local bare path so
// no network is needed. Returns the bare path for ls-remote assertions.
function withRegistryAndGithubUrl(dir) {
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const res = initRegistry({ root: dir })
  assert.equal(res.ok, true, `initRegistry failed: ${res.error}`)
  // Override the fetch URL to a github-like URL for compare-URL construction.
  // The pushurl stays as the bare filesystem path so the actual push lands locally.
  git(['remote', 'set-url', 'origin', 'https://github.com/test-owner/test-repo.git'], { cwd: dir })
  git(['remote', 'set-url', '--push', 'origin', bare], { cwd: dir })
  return bare
}

// Make a commit on the current branch so it diverges from its base.
function commitOnBranch(dir, msg = 'work') {
  writeFileSync(join(dir, `work-${Date.now()}.txt`), msg)
  git(['add', '.'], { cwd: dir })
  git(['commit', '-m', msg], { cwd: dir })
}

// Spawn bin/ac.mjs with the given args from the given cwd.
// Returns { status, stdout, stderr } — same shape as in flow.test.mjs.
function ac(args, cwd) {
  return spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  })
}

// ---------------------------------------------------------------------------
// Unknown subcommand — exits non-zero with the ✖ usage hint.
//
// This test exercises the CURRENT `else die(...)` branch in the `case 'flow'`
// dispatcher. It should PASS before t16 lands because that branch already
// exists in bin/ac.mjs and only needs to stay intact after t16 updates it.
// ---------------------------------------------------------------------------

test('ac flow bogus exits non-zero and prints the ✖ usage hint', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  const r = ac(['flow', 'bogus'], dir)

  assert.notEqual(r.status, 0, 'unknown subcommand must exit non-zero')
  // The die() call always prepends ✖ — assert at least one of ✖ or "unknown"
  // so we're not over-specifying the exact wording (t16 updates this message).
  assert.match(
    r.stderr + r.stdout,
    /✖|unknown|usage/i,
    'error output should contain ✖, "unknown", or "usage"',
  )
})

// ---------------------------------------------------------------------------
// ac flow pr — pushes feature/m<N>-* to origin and prints a compare URL.
//
// EXPECTED: RED until t16 wires `else if (sub === 'pr')` in bin/ac.mjs.
// The test exits non-zero (unknown subcommand) until t16 lands; the assertion
// `r.status === 0` will fail with a clear assertion error, not a file crash.
// ---------------------------------------------------------------------------

test('ac flow pr exits 0 and prints a compare URL on a prepared feature branch', () => {
  // Full setup: bare remote (github-URL trick), gitflow enabled, registry
  // initialized (so milestone resolves), develop created, feature branch
  // created and advanced past develop so there is something to push.
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = withRegistryAndGithubUrl(dir)
  flowInit(dir)

  // Create a feature branch via the CLI so ac flow is tested end-to-end once.
  // We need to be on a feature/m<N>-* branch before calling ac flow pr.
  const brRes = ac(['flow'], dir)
  assert.equal(brRes.status, 0, `ac flow (create branch) failed: ${brRes.stderr}`)

  // Make a commit so the feature branch has work ahead of develop.
  commitOnBranch(dir, 'feature work for pr test')

  const r = ac(['flow', 'pr'], dir)

  assert.equal(r.status, 0, `ac flow pr failed (exit ${r.status}):\n${r.stderr}`)

  // Output must contain a github compare URL targeting develop as the base.
  assert.match(
    r.stdout + r.stderr,
    /github\.com\/test-owner\/test-repo\/compare\/develop\.\.\./,
    `output should contain a compare URL targeting develop; got:\n${r.stdout}${r.stderr}`,
  )

  // The feature branch must have been pushed to the bare remote.
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  const lsRemote = git(['ls-remote', bare, `refs/heads/${head}`])
  assert.equal(lsRemote.status, 0, `ls-remote failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, new RegExp(head.replace(/\//g, '\\/')), `remote ref ${head} not found after ac flow pr`)
})

// ---------------------------------------------------------------------------
// ac flow release — exits 0 and prints the develop→main compare URL.
//
// EXPECTED: RED until t16 wires `else if (sub === 'release')`.
// ---------------------------------------------------------------------------

test('ac flow release exits 0 and prints the develop→main compare URL', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = withRegistryAndGithubUrl(dir)
  flowInit(dir)

  // Switch to develop and make a commit so it has content to push.
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'release-ready commit')

  const r = ac(['flow', 'release'], dir)

  assert.equal(r.status, 0, `ac flow release failed (exit ${r.status}):\n${r.stderr}`)

  // Output must contain a compare URL with main as base and develop as head.
  assert.match(
    r.stdout + r.stderr,
    /github\.com\/test-owner\/test-repo\/compare\/main\.\.\./,
    `output should contain a compare URL with main as base; got:\n${r.stdout}${r.stderr}`,
  )
  assert.match(
    r.stdout + r.stderr,
    /develop/,
    `output should mention develop as the head branch; got:\n${r.stdout}${r.stderr}`,
  )

  // develop must have been pushed to the bare remote.
  const lsRemote = git(['ls-remote', bare, 'refs/heads/develop'])
  assert.equal(lsRemote.status, 0, `ls-remote failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, /develop/, 'develop ref not found on bare remote after ac flow release')
})

// ---------------------------------------------------------------------------
// ac flow tag — exits 0 and prints the v1 tag after develop is merged into main.
//
// EXPECTED: RED until t16 wires `else if (sub === 'tag')`.
// ---------------------------------------------------------------------------

test('ac flow tag exits 0 and prints the v1 tag after develop is merged into main', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = withRegistryAndGithubUrl(dir)
  flowInit(dir)

  // Make a commit on develop so it diverges from main.
  git(['switch', 'develop'], { cwd: dir })
  commitOnBranch(dir, 'release work on develop')

  // Simulate the forge PR merge: switch to main, merge develop --no-ff, push.
  git(['switch', 'main'], { cwd: dir })
  git(['merge', '--no-ff', '-m', 'Merge develop into main for release', 'develop'], { cwd: dir })
  git(['push', 'origin', 'main'], { cwd: dir })

  const r = ac(['flow', 'tag'], dir)

  assert.equal(r.status, 0, `ac flow tag failed (exit ${r.status}):\n${r.stderr}`)

  // Output must mention the tag (v1 for milestone 1).
  assert.match(
    r.stdout + r.stderr,
    /v1/,
    `output should mention tag v1; got:\n${r.stdout}${r.stderr}`,
  )

  // Tag must have been pushed to the bare remote.
  const lsRemote = git(['ls-remote', '--tags', bare])
  assert.equal(lsRemote.status, 0, `ls-remote --tags failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, /refs\/tags\/v1/, `tag v1 not found on bare remote; ls-remote: "${lsRemote.stdout}"`)
})

// ---------------------------------------------------------------------------
// ac flow hotfix start <name> — exits 0 and HEAD is on hotfix/<name>.
//
// EXPECTED: RED until t16 wires `else if (sub === 'hotfix')` with pos[1]==='start'.
// hotfix start is a local-only operation (ADR-013) so no remote is needed.
// ---------------------------------------------------------------------------

test('ac flow hotfix start fix-x exits 0 and leaves HEAD on hotfix/fix-x', () => {
  // ADR-013: hotfix start is local-only — no remote required.
  const dir = scaffold(mkRepo())
  enableFlow(dir)

  const r = ac(['flow', 'hotfix', 'start', 'fix-x'], dir)

  assert.equal(r.status, 0, `ac flow hotfix start fix-x failed (exit ${r.status}):\n${r.stderr}`)

  // HEAD must be on hotfix/fix-x after the command.
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir }).stdout.trim()
  assert.equal(head, 'hotfix/fix-x', `HEAD should be on hotfix/fix-x; got "${head}"`)

  // Output should confirm the branch name.
  assert.match(
    r.stdout + r.stderr,
    /hotfix\/fix-x/,
    `output should mention hotfix/fix-x; got:\n${r.stdout}${r.stderr}`,
  )
})

// ---------------------------------------------------------------------------
// ac flow hotfix finish — exits 0 and prints the v1.1 tag.
//
// EXPECTED: RED until t16 wires the nested `hotfix finish` path.
// ---------------------------------------------------------------------------

test('ac flow hotfix finish exits 0 and prints the v1.1 tag', () => {
  const dir = scaffold(mkRepo())
  enableFlow(dir)
  const bare = mkBareRemote()
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  const reg = initRegistry({ root: dir })
  assert.equal(reg.ok, true, `initRegistry failed: ${reg.error}`)
  flowInit(dir)

  // Push develop to the bare remote before hotfix finish tries to push it.
  git(['push', '-u', 'origin', 'develop'], { cwd: dir })

  // Start the hotfix branch via the CLI, make a commit so there is real content.
  const startR = ac(['flow', 'hotfix', 'start', 'fix-hotfinish'], dir)
  assert.equal(startR.status, 0, `ac flow hotfix start failed: ${startR.stderr}`)
  commitOnBranch(dir, 'hotfix: critical fix for finish test')

  const r = ac(['flow', 'hotfix', 'finish'], dir)

  assert.equal(r.status, 0, `ac flow hotfix finish failed (exit ${r.status}):\n${r.stderr}`)

  // Output must mention the patch tag (v1.1 for milestone 1, first hotfix).
  assert.match(
    r.stdout + r.stderr,
    /v1\.1/,
    `output should mention tag v1.1; got:\n${r.stdout}${r.stderr}`,
  )

  // Tag v1.1 must have been pushed to the bare remote.
  const lsRemote = git(['ls-remote', '--tags', bare])
  assert.equal(lsRemote.status, 0, `ls-remote --tags failed: ${lsRemote.stderr}`)
  assert.match(lsRemote.stdout, /refs\/tags\/v1\.1/, `tag v1.1 not found on bare remote; ls-remote: "${lsRemote.stdout}"`)
})

// ---------------------------------------------------------------------------
// HELP — ac help lists all five new subcommand entries.
//
// EXPECTED: RED until t16 adds the HELP lines in bin/ac.mjs (the HELP constant
// does not yet contain `ac flow pr`, `ac flow release`, etc.).
// The unknown-subcommand + pre-existing HELP assertions may pass before t16.
//
// WHY assert from this file rather than editing the existing HELP test in
// flow.test.mjs: single-file ownership — t15 owns only flow_cli.test.mjs.
// ---------------------------------------------------------------------------

test('ac help lists ac flow pr in the HELP text', () => {
  // HELP prints unconditionally — no real .astrocode repo needed.
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow pr/, '`ac flow pr` must appear in the HELP text')
})

test('ac help lists ac flow release in the HELP text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow release/, '`ac flow release` must appear in the HELP text')
})

test('ac help lists ac flow tag in the HELP text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow tag/, '`ac flow tag` must appear in the HELP text')
})

test('ac help lists ac flow hotfix start in the HELP text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow hotfix start/, '`ac flow hotfix start` must appear in the HELP text')
})

test('ac help lists ac flow hotfix finish in the HELP text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fc-help-'))
  const r = ac(['help'], dir)
  assert.equal(r.status, 0, `ac help exited ${r.status}:\n${r.stderr}`)
  assert.match(r.stdout, /ac flow hotfix finish/, '`ac flow hotfix finish` must appear in the HELP text')
})
