// ADR-094 (phase 57 t13): `ac status --json` and the band mark a phase verified in fast mode whose milestone
// full check has not passed yet. The key is absent when there is nothing pending (the `deferred_fixes` posture).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const band = () => import('../mods/astro-mods/hooks/lib/band.js');
const OK = 'node -e "process.exit(0)"';

async function project() {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ac-fcband-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'bproj' });
  await addPhase(dir, { number: 1, name: 'One', milestone: 1 });
  const slug = findPhase(dir, '1').slug;
  put(dir, `.astrocode/phases/${slug}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${OK}\`\n`);
  const cfgFile = join(dir, '.astrocode', 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), verify: { suite_command: OK } }));
  commit(dir, 'init');
  put(dir, 'docs.md', 'docs\n');
  commit(dir, 'docs (phase 01 t1)');
  assert.equal((await recordVerdict(dir, slug, { mode: 'full', criteria: [{ id: 'C1', passed: true }] })).passed, true);
  await setPhaseStatus(dir, slug, 'verified');
  commit(dir, 'status');
  return { dir, slug };
}

test('statusJson marks the fast-verified phase pending, and drops both keys after a passing check', async () => {
  const { statusJson } = await import('../lib/nextstep.mjs');
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const p = await project();
  let j = statusJson(p.dir, Math.floor(Date.now() / 1000));
  assert.deepEqual(j.full_check_pending, [1]);
  assert.equal(j.phases.find((x) => x.number === 1).full_check_pending, true);
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  assert.equal((await runFullCheck(p.dir, { spawn: (c, o) => spawnSync(c, { ...o, env }) })).passed, true);
  j = statusJson(p.dir, Math.floor(Date.now() / 1000));
  assert.equal('full_check_pending' in j, false);
  assert.equal('full_check_pending' in j.phases.find((x) => x.number === 1), false);
});

test('bandView draws one FULL CHECK pending row when the key is present, none when absent or empty', async () => {
  const { bandView } = await band();
  const STATUS = {
    root: '/p', project: 'p', milestone: 12, phase: { number: 57, slug: '57-x', name: 'X', status: 'verified' },
    next: '/astro-accept 57', siblings: [],
    phases: [{ number: 57, name: 'X', slug: '57-x', status: 'verified', planned: true, discussed: true }], activity: null,
  };
  const withKey = bandView({ ...STATUS, full_check_pending: [57, 58] }, null, {});
  assert.equal(withKey.lines.filter((l) => l.startsWith('FULL CHECK')).length, 1);
  assert.ok(withKey.lines.includes('FULL CHECK pending 57 58'));
  assert.equal(bandView(STATUS, null, {}).lines.some((l) => l.startsWith('FULL CHECK')), false);
  assert.equal(bandView({ ...STATUS, full_check_pending: [] }, null, {}).lines.some((l) => l.startsWith('FULL CHECK')), false);
});
