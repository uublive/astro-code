// ADR-094 (phase 57 t12): `completeMilestone` refuses without a passing full check on the current tip, and
// changes nothing when it refuses. Modelled on tests/milestone_deferred.test.mjs; real scratch git repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { paths } from '../lib/paths.mjs';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV });
const OK = 'node -e "process.exit(0)"';
const BAD = 'node -e "process.exit(1)"';

async function project({ fast = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mfc-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'mproj' });
  await addPhase(dir, { number: 1, name: 'One', milestone: 1 });
  const slug = findPhase(dir, '1').slug;
  put(dir, `.astrocode/phases/${slug}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${OK}\`\n`);
  const cfgFile = join(dir, '.astrocode', 'config.json');
  writeFileSync(cfgFile, JSON.stringify({ ...JSON.parse(readFileSync(cfgFile, 'utf8')), verify: { suite_command: OK } }));
  commit(dir, 'init');
  if (fast) {
    const { recordVerdict } = await import('../lib/verdict.mjs');
    put(dir, 'docs.md', 'docs\n');
    commit(dir, 'docs (phase 01 t1)');
    assert.equal((await recordVerdict(dir, slug, { mode: 'full', criteria: [{ id: 'C1', passed: true }] })).passed, true);
    await setPhaseStatus(dir, slug, 'verified');
    commit(dir, 'status');
  }
  return { dir, slug, roadmap: () => readFileSync(paths(dir).roadmap, 'utf8') };
}
const untouched = (p, before) => {
  assert.equal(existsSync(join(paths(p.dir).dir, 'milestones')), false, 'no archive dir');
  assert.equal(p.roadmap(), before, 'the roadmap is unchanged');
  assert.ok(existsSync(join(paths(p.dir).phases, p.slug)), 'the phase dir is in place');
};

test('(a) no full check: close refuses naming ac milestone verify, and changes nothing', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const p = await project();
  const before = p.roadmap();
  await assert.rejects(completeMilestone(p.dir), /ac milestone verify/);
  untouched(p, before);
});

test('(b) a failing check with an open fix refuses naming the fix, and changes nothing', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const { fullCheckFixes } = await import('../lib/fixes.mjs');
  const p = await project();
  put(p.dir, `.astrocode/phases/${p.slug}/CRITERIA.md`, `### C1 — claim\n- **Cheap:** \`${BAD}\`\n`);
  commit(p.dir, 'break');
  assert.equal((await runFullCheck(p.dir, { spawn })).passed, false);
  const [fix] = fullCheckFixes(p.dir, { milestone: 1 });
  const before = p.roadmap();
  await assert.rejects(completeMilestone(p.dir), (e) => e.message.includes(fix.id));
  untouched(p, before);
});

test('(c) a passing check on the tip lets the close through', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const p = await project();
  assert.equal((await runFullCheck(p.dir, { spawn })).passed, true);
  const out = await completeMilestone(p.dir);
  assert.equal(out.archived, 1);
});

test('(d) a new commit after the check needs a new check', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const { runFullCheck } = await import('../lib/fullcheck.mjs');
  const p = await project();
  assert.equal((await runFullCheck(p.dir, { spawn })).passed, true);
  put(p.dir, 'more.md', 'more\n');
  commit(p.dir, 'more');
  const before = p.roadmap();
  await assert.rejects(completeMilestone(p.dir), /not the current tip/);
  untouched(p, before);
});

test('C6: a milestone with no fast verdict closes as before', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const p = await project({ fast: false });
  assert.equal((await completeMilestone(p.dir)).archived, 1);
});
