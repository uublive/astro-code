// Phase 58 end to end (CRITERIA C1-C8): a real bare remote, clones A (me@example.test) and B
// (alex@example.test), registry initialised, gitflow on. Every `ac` call runs with HOME pointed at a
// scratch dir. "The band" is band.js fed what phase-band.js feeds it at a turn boundary: the clone's
// `ac status --json` and the full branch name from HEAD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { updateConfig } from '../lib/config.mjs';
import { addPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { initRegistry, claim, readRegistry } from '../lib/registry.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const HOME = mkdtempSync(join(tmpdir(), 'ac-e2e-home-'));
const ENV = { ...process.env, HOME, XDG_CONFIG_HOME: join(HOME, '.config') };
const ac = (cwd, ...args) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: ENV });
const status = (cwd) => { const r = ac(cwd, 'status', '--json'); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const row = (cwd, n) => status(cwd).phases.find((p) => p.number === n);
const branchOf = (cwd) => git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd }).stdout.trim() || null;
const band = async (cwd) => (await import('../mods/astro-mods/hooks/lib/band.js')).bandView(status(cwd), null, { branch: branchOf(cwd) });
const shown = (v) => (/ROADMAP/.test(v.lines[0]) ? v.lines[0] : '').match(/\d+/g)?.map(Number) ?? [];
const countLine = (v) => v.lines.filter((l) => /\+\d+ (elsewhere|by others)/.test(l)).map((l) => l.trim());

async function world({ flow = true } = {}) {
  const bare = mkdtempSync(join(tmpdir(), 'ac-e2e-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const mk = async (email) => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-e2e-'));
    git(['init', '--quiet', '-b', 'develop'], { cwd: dir });
    git(['config', 'user.email', email], { cwd: dir });
    git(['config', 'user.name', email], { cwd: dir });
    git(['remote', 'add', 'origin', bare], { cwd: dir });
    initPlanning(dir, { name: 'e2e' });
    git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
    if (flow) await updateConfig(dir, (c) => ({ ...c, gitflow: { enabled: true } }));
    return dir;
  };
  const a = await mk('me@example.test');
  const b = await mk('alex@example.test');
  assert.equal(initRegistry({ root: a }).ok, true);
  const names = {};
  const mkPhase = async (dir, name, milestone, { toRoadmap = [] } = {}) => {
    const n = claim({ root: dir, type: 'phase', milestone, name }).number;
    names[name] = n;
    for (const d of [dir, ...toRoadmap]) await addPhase(d, { number: n, name, milestone });
    return n;
  };
  // milestone 1: A's one (complete), two and three (open); B's one and two, claimed while B sits on develop
  // (their claim `branch` is develop, which is never a tie). Milestone 2: A's four.
  const p = {};
  p.a1 = await mkPhase(a, 'Alpha one', 1);
  p.a2 = await mkPhase(a, 'Alpha two', 1);
  p.a3 = await mkPhase(a, 'Alpha three', 1);
  p.b1 = await mkPhase(b, 'Bravo one', 1, { toRoadmap: [a] });
  p.b2 = await mkPhase(b, 'Bravo two', 1, { toRoadmap: [a] });
  const m2 = claim({ root: a, type: 'milestone', name: 'second' }).number;
  p.a4 = await mkPhase(a, 'Alpha four', m2);
  p.m2 = m2;
  await setPhaseStatus(a, '01-alpha-one', 'complete');
  readRegistry(a); readRegistry(b);
  return { bare, a, b, p, names };
}
const slugOf = (cwd, n) => status(cwd).phases.find((x) => x.number === n).slug;

test('C1 + C3: link, move, milestone link and unlink are shared; rows carry owner, tie, mine and onBranch', async () => {
  const { a, b, p } = await world();
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const l = ac(a, 'flow', 'link', String(p.a2));
  assert.equal(l.status, 0, l.stderr);
  assert.equal(l.stdout.trim().split('\n').length, 1);
  assert.equal(ac(a, 'flow', 'link', String(p.b1)).status, 0, 'a teammate\'s phase can be tied by hand too');
  readRegistry(b);
  assert.equal(row(b, p.a2).feature_branch, 'feature/alpha');

  const ja = status(a);
  const r2 = ja.phases.find((x) => x.number === p.a2);
  assert.deepEqual([r2.owner, r2.mine, r2.feature_branch, r2.onBranch], ['me@example.test', true, 'feature/alpha', true]);
  const rb = ja.phases.find((x) => x.number === p.b1);
  assert.deepEqual([rb.owner, rb.mine, rb.owner_tag, rb.onBranch], ['alex@example.test', false, 'a', true]);
  assert.equal(ja.phases.filter((x) => x.onBranch).length, 2);
  assert.ok(!('feature_branch' in ja.phases.find((x) => x.number === p.a3)));
  assert.equal(ja.branch, 'feature/alpha');

  git(['switch', '-q', '-c', 'feature/beta'], { cwd: a });
  assert.equal(ac(a, 'flow', 'link', String(p.a2)).status, 0);
  readRegistry(b);
  assert.equal(row(b, p.a2).feature_branch, 'feature/beta');
  assert.equal(ac(a, 'flow', 'link', `m${p.m2}`).status, 0);
  readRegistry(b);
  assert.deepEqual([row(b, p.a4).feature_branch, row(b, p.a4).tied_by], ['feature/beta', 'milestone']);
  assert.equal(ac(a, 'flow', 'unlink', String(p.a2)).status, 0);
  readRegistry(b);
  assert.ok(!('feature_branch' in row(b, p.a2)));

  git(['switch', '-q', 'develop'], { cwd: a });
  assert.ok(status(a).phases.every((x) => x.onBranch === false), 'nothing is on develop');
  assert.ok(!('feature_branch' in status(a).phases.find((x) => x.number === p.b2)), 'a historic develop claim is untied');
});

test('C2: discuss, plan and execute steps tie on a feature branch, never on develop, never over a tie', async () => {
  const { a, b, p } = await world();
  const extra = [];
  for (const nm of ['Gamma one', 'Gamma two', 'Gamma three']) {
    const n = claim({ root: a, type: 'phase', milestone: 1, name: nm }).number;
    await addPhase(a, { number: n, name: nm, milestone: 1 });
    extra.push(n);
  }
  readRegistry(a);
  // on develop: nothing is tied
  assert.equal(ac(a, 'phase', 'context', String(extra[0]), '--author').stderr, '');
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const slug = (n) => slugOf(a, n);
  assert.equal(ac(a, 'phase', 'context', String(extra[0]), '--author').status, 0); // discuss step 5b
  assert.equal(ac(a, 'phase', 'context', String(extra[1])).status, 0); // plan step 2
  assert.equal(ac(a, 'state', 'set', 'active_phase', slug(extra[2])).status, 0); // execute step 2
  readRegistry(b);
  for (const n of extra) assert.equal(row(b, n).feature_branch, 'feature/alpha');
  // on develop an existing tie stays, and another branch never overwrites it
  git(['switch', '-q', 'develop'], { cwd: a });
  ac(a, 'phase', 'context', String(extra[0]));
  git(['switch', '-q', '-c', 'feature/other'], { cwd: a });
  const again = ac(a, 'phase', 'context', String(extra[0]));
  assert.match(again.stderr, /^⚠ phase \d+ is tied to feature\/alpha/);
  readRegistry(b);
  assert.equal(row(b, extra[0]).feature_branch, 'feature/alpha');
  assert.ok(!git(['branch', '--list'], { cwd: a }).stdout.includes('feature/m'), 'no branch was created');
});

test('C5: on a feature branch the band shows only the tied work and one +N elsewhere line', async () => {
  const { a, p } = await world();
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  for (const n of [p.a2, p.a3]) assert.equal(ac(a, 'flow', 'link', String(n)).status, 0);
  assert.equal(ac(a, 'flow', 'link', `m${p.m2}`).status, 0);
  readRegistry(a);
  const { trackedPhases } = await import('../mods/astro-mods/hooks/lib/band.js');
  const s = status(a);
  const v = await band(a);
  assert.deepEqual(shown(v).sort((x, y) => x - y), [p.a2, p.a3, p.a4].sort((x, y) => x - y), v.lines[0]);
  assert.equal(v.title, `M${p.m2}`);
  assert.deepEqual(v.meter && [v.meter.done, v.meter.total], [0, 3]);
  const hidden = trackedPhases(s).filter((x) => ![p.a2, p.a3, p.a4].includes(x.number)).length;
  assert.deepEqual(countLine(v), [`+${hidden} elsewhere`]);
  assert.ok(hidden >= 3, 'the complete, the other M1 and the teammate rows are counted');
  for (const b of v.buttons) assert.ok([p.a2, p.a3, p.a4].includes(Number(b.command.match(/(\d+)$/)[1])), b.command);
  assert.ok(!shown(v).includes(p.b1) && !shown(v).includes(p.b2));
});

test('C6: develop, main and an empty feature branch show only my open work across milestones, with flow on and off', async () => {
  for (const flow of [true, false]) {
    const { a, p } = await world({ flow });
    for (const br of ['develop', 'main', 'feature/empty']) {
      git(['switch', '-q', ...(br === 'develop' ? [] : ['-c']), br], { cwd: a });
      const v = await band(a);
      assert.deepEqual(shown(v).sort((x, y) => x - y), [p.a2, p.a3, p.a4].sort((x, y) => x - y), `${br} flow=${flow}: ${v.lines[0]}`);
      assert.deepEqual(countLine(v), ['+2 by others'], br);
      for (const b of v.buttons) assert.ok([p.a2, p.a3, p.a4].includes(Number(b.command.match(/(\d+)$/)[1])), b.command);
      git(['switch', '-q', 'develop'], { cwd: a });
    }
  }
});

test('C4: a personal alias makes a third-email claim mine, in the status rows and the band; remove reverts; user.email counts', async () => {
  const { bare, a, b, p } = await world();
  const c = mkdtempSync(join(tmpdir(), 'ac-e2e-'));
  git(['init', '--quiet', '-b', 'develop'], { cwd: c });
  git(['config', 'user.email', 'me-old@example.test'], { cwd: c });
  git(['remote', 'add', 'origin', bare], { cwd: c });
  initPlanning(c, { name: 'e2e' });
  const n = claim({ root: c, type: 'phase', milestone: 1, name: 'Old laptop work' }).number;
  readRegistry(a);
  const before = git(['status', '--porcelain'], { cwd: a }).stdout;
  assert.equal(row(a, n).mine, false);
  assert.ok(!shown(await band(a)).includes(n));
  assert.equal(ac(a, 'identity', 'alias', 'add', 'me-old@example.test').status, 0);
  assert.equal(row(a, n).mine, true);
  assert.ok(shown(await band(a)).includes(n), 'the band lists it among my rows');
  assert.equal(git(['status', '--porcelain'], { cwd: a }).stdout, before);
  assert.equal(ac(a, 'identity', 'alias', 'remove', 'me-old@example.test').status, 0);
  assert.equal(row(a, n).mine, false);
  git(['config', 'user.email', 'alex@example.test'], { cwd: a });
  assert.equal(row(a, p.b1).mine, true);
  assert.equal(row(a, p.a2).mine, false);
});

test('C7: no readable registry ref gives the full view; a branch gone from the remote still renders', async () => {
  const { a, p } = await world();
  const { trackedPhases } = await import('../mods/astro-mods/hooks/lib/band.js');
  git(['switch', '-q', '-c', 'feature/gone'], { cwd: a });
  const mine = await band(a);
  assert.ok(!/unavailable/.test(mine.lines[0]));
  assert.deepEqual(countLine(mine), ['+2 by others']);

  for (const ref of ['refs/remotes/origin/astro-registry']) git(['update-ref', '-d', ref], { cwd: a });
  const packed = git(['pack-refs', '--all'], { cwd: a });
  assert.equal(packed.status, 0);
  git(['update-ref', '-d', 'refs/remotes/origin/astro-registry'], { cwd: a });
  const s = status(a);
  assert.ok(!('registry' in s));
  for (const br of ['feature/gone', 'develop']) {
    git(['switch', '-q', br], { cwd: a });
    const v = await band(a);
    assert.deepEqual(countLine(v), [], 'nothing is hidden behind a count');
    assert.deepEqual(shown(v).sort((x, y) => x - y), trackedPhases(status(a)).map((x) => x.number).sort((x, y) => x - y));
    assert.ok(shown(v).includes(p.b1) && shown(v).includes(p.b2));
  }
});

test('C8: text ac status still lists every phase, other people\'s included', async () => {
  const { a, p } = await world();
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  ac(a, 'flow', 'link', String(p.a2));
  const out = ac(a, 'status');
  assert.equal(out.status, 0, out.stderr);
  for (const name of ['Alpha one', 'Alpha two', 'Alpha three', 'Bravo one', 'Bravo two']) assert.match(out.stdout, new RegExp(name), name);
});
