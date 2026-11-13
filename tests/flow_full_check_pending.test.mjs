// ADR-094 (phase 57 t14): release notes mark fast-verified phases whose milestone full check has not passed.
// Real git with a local bare remote. `flowRelease` returns `notes` (and the PR body is the same text),
// and `flowTag` carries the same lines in the annotated tag message.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'

import { git } from '../lib/git.mjs'
import { initPlanning } from '../lib/planning.mjs'
import { paths } from '../lib/paths.mjs'
import { readJSON, atomicWriteJSON } from '../lib/util.mjs'
import { initRegistry } from '../lib/registry.mjs'
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs'
import { flowInit } from '../lib/flow.mjs'

const OK = 'node -e "process.exit(0)"'
const LINE = 'Full check pending (fast-verified, ADR-094): phase 1 One'
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body) }
const commit = (dir, msg) => { git(['add', '-A'], { cwd: dir }); git(['commit', '-qm', msg], { cwd: dir }) }
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV })
const GITHUB_TEST_URL = 'https://github.com/test-owner/test-repo.git'

// A gitflow project on develop with one phase verified in fast mode (a docs-only phase: no linked tests).
async function project() {
  const { recordVerdict } = await import('../lib/verdict.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'ac-flowfc-'))
  git(['init', '--quiet', '-b', 'main'], { cwd: dir })
  git(['config', 'user.email', 'flow-test@example.com'], { cwd: dir })
  git(['config', 'user.name', 'Flow Test'], { cwd: dir })
  git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  initPlanning(dir, { name: 'flow-fc-proj' })
  await addPhase(dir, { number: 1, name: 'One', milestone: 1 })
  const slug = findPhase(dir, '1').slug
  put(dir, `.astrocode/phases/${slug}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${OK}\`\n`)
  const p = paths(dir)
  const cfg = readJSON(p.config) || {}
  cfg.gitflow = { enabled: true, main: 'main', develop: 'develop', prefixes: { feature: 'feature', release: 'release', hotfix: 'hotfix' }, pr: 'none' }
  cfg.verify = { suite_command: OK }
  atomicWriteJSON(p.config, cfg)
  commit(dir, 'scaffold')
  const bare = mkdtempSync(join(tmpdir(), 'ac-flowfc-origin-')) + '/origin.git'
  git(['init', '--quiet', '--bare', bare])
  git(['config', 'core.hooksPath', join(bare, 'hooks')], { cwd: bare })
  git(['remote', 'add', 'origin', bare], { cwd: dir })
  git(['push', '-u', 'origin', 'main'], { cwd: dir })
  assert.equal(initRegistry({ root: dir }).ok, true)
  flowInit(dir)
  git(['switch', 'develop'], { cwd: dir })
  put(dir, 'docs.md', 'docs\n')
  commit(dir, 'docs (phase 01 t1)')
  assert.equal((await recordVerdict(dir, slug, { mode: 'full', criteria: [{ id: 'C1', passed: true }] })).passed, true)
  await setPhaseStatus(dir, slug, 'verified')
  commit(dir, 'status')
  git(['remote', 'set-url', 'origin', GITHUB_TEST_URL], { cwd: dir })
  git(['config', `url.${bare}.insteadOf`, GITHUB_TEST_URL], { cwd: dir })
  return { dir, bare }
}

test('flowRelease notes and PR body name the fast-verified phase; after a passing check on the tip there is no such line', async () => {
  const { flowRelease } = await import('../lib/flow.mjs')
  const { runFullCheck } = await import('../lib/fullcheck.mjs')
  const { dir } = await project()
  const res = flowRelease(dir)
  assert.equal(res.ok, true)
  assert.ok(res.notes.includes(LINE), res.notes)
  assert.equal(res.notes.split('\n').filter((l) => l.startsWith('Full check pending')).length, 1)
  assert.equal((await runFullCheck(dir, { spawn })).passed, true)
  const after = flowRelease(dir)
  assert.ok(!after.notes.includes('Full check pending'))
})

test('flowTag carries the same lines in the annotated tag message', async () => {
  const { flowRelease, flowTag } = await import('../lib/flow.mjs')
  const { dir } = await project()
  flowRelease(dir)
  git(['switch', 'main'], { cwd: dir })
  git(['merge', '--no-ff', '-m', 'Merge develop', 'develop'], { cwd: dir })
  git(['push', 'origin', 'main'], { cwd: dir })
  const res = flowTag(dir)
  assert.equal(res.ok, true)
  const msg = git(['tag', '-n99', res.tag], { cwd: dir }).stdout
  assert.ok(msg.includes(LINE), msg)
})
