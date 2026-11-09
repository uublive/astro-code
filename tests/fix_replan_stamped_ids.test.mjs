// Fix 2026-11-09-a-re-plan-that-reuses-task-ids-is (GitHub #186): execute's Discover marks a task done
// when ANY commit on the branch carries its `(phase NN tK)` stamp, so a re-plan that numbers its new
// tasks t1..tN again is skipped as "already landed". The plan side now knows which ids are taken:
// `ac phase stamps <n>` lists them with the next free id, and `--check` names every PLAN.md id that
// collides with one, so a reused id is a stated choice, never a silent skip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', input: '' });

async function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-replan-'));
  sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'p' });
  await addPhase(dir, { number: 29, name: 'Parser' });
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  // the first plan landed t1..t8 (plus a remediation, which is not a task id)
  for (let i = 1; i <= 8; i++) sh(dir, 'commit', '-q', '--allow-empty', '-m', `first plan step ${i} (phase 29 t${i})`);
  sh(dir, 'commit', '-q', '--allow-empty', '-m', 'fix the gap (phase 29 remediate-c0)');
  return dir;
}
const slugOf = (dir) => JSON.parse(ac(dir, 'roadmap', 'list').stdout).phases[0].slug;
const plan = (dir, ids) => {
  const p = join(dir, '.astrocode/phases', slugOf(dir));
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'PLAN.md'), ids.map((id) => `### ${id} — task ${id}\n- **id:** ${id}\n- **files:** a.mjs\n- **depends_on:** []\n`).join('\n'));
};

test('#186: ac phase stamps lists the stamped task ids and the next free one', async () => {
  const dir = await project();
  const r = ac(dir, 'phase', 'stamps', '29', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.deepEqual(j.stamped, ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']);
  assert.equal(j.next, 't9');
  assert.match(ac(dir, 'phase', 'stamps', '29').stdout, /t1 … t8|t1, t2/);
});

test('#186: --check names a re-plan\'s ids that collide with landed stamps and exits non-zero', async () => {
  const dir = await project();
  plan(dir, ['t1', 't2', 't3']);
  const r = ac(dir, 'phase', 'stamps', '29', '--check');
  assert.notEqual(r.status, 0, 'a colliding plan is refused');
  assert.match(r.stdout + r.stderr, /t1, t2, t3/);
  assert.match(r.stdout + r.stderr, /t9/, 'it names the next free id');
  plan(dir, ['t9', 't10']);
  assert.equal(ac(dir, 'phase', 'stamps', '29', '--check').status, 0, 'fresh ids pass');
});

test('#186: a phase with nothing stamped has no taken ids and starts at t1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-replan0-'));
  sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'p' });
  await addPhase(dir, { number: 3, name: 'New' });
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', 'init');
  const j = JSON.parse(ac(dir, 'phase', 'stamps', '3', '--json').stdout);
  assert.deepEqual(j.stamped, []);
  assert.equal(j.next, 't1');
});
