// Milestones get a lifecycle (#37): planned → active → complete. A milestone can be
// declared as a destination without moving the project, activated as a separate step,
// and work can only be put into a milestone the registry has claimed — which also closes
// #32's add case. The explicit-number repair ratifies a milestone the roadmap already uses
// and nothing else. Designed with the reporter on #37.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON } from '../lib/util.mjs';
import { readRegistry } from '../lib/registry.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mlife-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  assert.equal(ac(['init', '--name', 'Life'], dir).status, 0);
  const bare = mkdtempSync(join(tmpdir(), 'ac-mlife-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  git(['push', '--quiet', '-u', 'origin', 'main'], { cwd: dir });
  assert.equal(ac(['registry', 'init'], dir).status, 0);
  return dir;
}
const msClaim = (dir, n) => readRegistry(dir).registry.claims.find((c) => c.type === 'milestone' && c.number === n);
const activeMilestone = (dir) => readJSON(paths(dir).state).active_milestone ?? readJSON(paths(dir).roadmap).milestone;

test('#37: `milestone new --planned` declares a destination without moving the project', () => {
  const dir = fixture();
  const r = ac(['milestone', 'new', '--planned', '--name', 'Extension'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /milestone 2 "Extension" planned .* the project stays on milestone 1/);
  assert.equal(msClaim(dir, 2).status, 'planned');
  assert.equal(activeMilestone(dir), 1, 'the active milestone is untouched');

  assert.equal(ac(['phase', 'add', 'Extension work', '--milestone', '2'], dir).status, 0, 'work can be assigned to it');
  assert.match(ac(['status'], dir).stdout, /Planned: {3}milestone 2 "Extension" — phases 1/);
});

test('#37: `milestone activate` moves into a planned milestone (instead of `new` claiming another)', () => {
  const dir = fixture();
  assert.equal(ac(['milestone', 'new', '--planned', '--name', 'Consolidation'], dir).status, 0);
  assert.equal(ac(['phase', 'add', 'open in m1'], dir).status, 0);
  const r = ac(['milestone', 'activate', '2'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /milestone 2 "Consolidation" is now active/);
  assert.match(r.stdout, /milestone 1 still has 1 unfinished phase\(s\): 1/, 'says what is left behind');
  assert.equal(activeMilestone(dir), 2);
  assert.equal(msClaim(dir, 2).status, 'active');

  assert.match(ac(['milestone', 'activate', '2'], dir).stdout, /already the active one/);
  assert.match(ac(['milestone', 'activate', '7'], dir).stderr, /milestone 7 is not claimed/);
});

test('#37: plain `milestone new` still claims and starts the next one, and points at planned ones', () => {
  const dir = fixture();
  assert.equal(ac(['milestone', 'new', '--planned', '--name', 'Later'], dir).status, 0);
  const r = ac(['milestone', 'new', '--name', 'Now'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(activeMilestone(dir), 3);
  assert.match(r.stdout, /note: milestone 2 "Later" is planned — `ac milestone activate 2`/);
});

test('#37/#32: work cannot target an unclaimed or a closed milestone', async () => {
  const dir = fixture();
  const add = ac(['phase', 'add', 'x', '--milestone', '4'], dir);
  assert.notEqual(add.status, 0);
  assert.match(add.stderr, /milestone 4 is not claimed — declare it first: `ac milestone new --planned/);
  assert.equal(readJSON(paths(dir).roadmap).phases.length, 0, 'nothing added');
  assert.equal(readRegistry(dir).registry.claims.filter((c) => c.type === 'phase').length, 0, 'no phase number spent');

  assert.equal(ac(['phase', 'add', 'done'], dir).status, 0);
  const { setPhaseStatus, findPhase } = await import('../lib/roadmap.mjs');
  await setPhaseStatus(dir, findPhase(dir, '1').slug, 'complete');
  assert.equal(ac(['milestone', 'complete'], dir).status, 0);
  assert.match(ac(['phase', 'add', 'late', '--milestone', '1'], dir).stderr, /milestone 1 is closed/);

  assert.equal(ac(['backlog', 'add', 'an idea'], dir).status, 0);
  const id = readJSON(join(paths(dir).dir, 'backlog.json')).backlog[0].id;
  assert.match(ac(['backlog', 'promote', id, '--milestone', '9'], dir).stderr, /milestone 9 is not claimed/);
});

test('#37: `backlog promote --milestone N` promotes straight into a planned milestone', () => {
  const dir = fixture();
  assert.equal(ac(['milestone', 'new', '--planned', '--name', 'Extension'], dir).status, 0);
  assert.equal(ac(['backlog', 'add', 'an extension idea'], dir).status, 0);
  const id = readJSON(join(paths(dir).dir, 'backlog.json')).backlog[0].id;
  const r = ac(['backlog', 'promote', id, '--milestone', '2'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(milestone 2\)/);
  assert.equal(readJSON(paths(dir).roadmap).phases[0].milestone, 2);
});

test('#37: the --number repair ratifies a milestone the roadmap already uses, and says why', async () => {
  const dir = fixture();
  // the #32 shape: phases under milestone 4 that nobody ever claimed
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(dir, { number: 13, name: 'audit a', milestone: 4 });
  await addPhase(dir, { number: 15, name: 'audit b', milestone: 4 });
  assert.match(ac(['status'], dir).stdout, /milestone 4 is not claimed on the registry, but phases 13, 15 reference it/);

  const r = ac(['milestone', 'new', '--planned', '--number', '4', '--name', 'Audit'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /claiming 4: referenced by phases 13, 15/);
  assert.equal(msClaim(dir, 4).status, 'planned');
  assert.doesNotMatch(ac(['status'], dir).stdout, /milestone 4 is not claimed/);
  assert.equal(activeMilestone(dir), 1, 'the repair declares; it does not activate');
});

test('#37: the --number repair refuses anything but that exact case', async () => {
  const dir = fixture();
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(dir, { number: 1, name: 'in m1', milestone: 1 });

  const noRefs = ac(['milestone', 'new', '--planned', '--number', '7'], dir);
  assert.notEqual(noRefs.status, 0);
  assert.match(noRefs.stderr, /no phase on the roadmap references milestone 7.*next free number \(2\)/);
  assert.match(ac(['milestone', 'new', '--planned', '--number', '1'], dir).stderr, /milestone 1 is already claimed/);
  assert.match(ac(['milestone', 'new', '--number', '4'], dir).stderr, /--number is only for `ac milestone new --planned`/);
  assert.match(ac(['milestone', 'new', '--plannd'], dir).stderr, /unknown flag/);
});
