// Phase 58 — `ac flow link|unlink`, `ac identity`, and the automatic tie on `ac phase context` /
// `ac state set active_phase`, spawned for real against a bare remote and clones.
// HOME and XDG_CONFIG_HOME point at scratch dirs: the owner's real ~/.astro is never read or written.
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
import { addPhase } from '../lib/roadmap.mjs';
import { initRegistry, claim, readRegistry } from '../lib/registry.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const HOME = mkdtempSync(join(tmpdir(), 'ac-fc-home-'));
const ENV = { ...process.env, HOME, XDG_CONFIG_HOME: join(HOME, '.config') };
const ac = (cwd, ...args) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: ENV });
const status = (cwd) => JSON.parse(ac(cwd, 'status', '--json').stdout);
const row = (cwd, n) => status(cwd).phases.find((p) => p.number === n);

async function fixture() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-fc-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const mk = async (email) => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-fc-'));
    git(['init', '--quiet', '-b', 'develop'], { cwd: dir });
    git(['config', 'user.email', email], { cwd: dir });
    git(['config', 'user.name', email], { cwd: dir });
    git(['remote', 'add', 'origin', bare], { cwd: dir });
    initPlanning(dir, { name: 'fc' });
    git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
    await updateConfig(dir, (c) => ({ ...c, gitflow: { enabled: true } }));
    return dir;
  };
  const a = await mk('me@example.test');
  const b = await mk('alex@example.test');
  assert.equal(initRegistry({ root: a }).ok, true);
  const phase = async (dir, name) => {
    const n = claim({ root: dir, type: 'phase', milestone: 1, name }).number;
    const ph = await addPhase(dir, { number: n, name, milestone: 1 });
    return { n, slug: (ph && ph.slug) || `${String(n).padStart(2, '0')}-${name}` };
  };
  return { bare, a, b, phase };
}

test('flow link and unlink exit 0 with one line, and the other clone\'s status --json shows the tie', async () => {
  const { a, b, phase } = await fixture();
  const p = await phase(a, 'one');
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const link = ac(a, 'flow', 'link', String(p.n));
  assert.equal(link.status, 0, link.stderr);
  assert.equal(link.stdout.trim().split('\n').length, 1);
  assert.match(link.stdout, /tied to feature\/alpha/);
  readRegistry(b);
  assert.equal(row(b, p.n).feature_branch, 'feature/alpha');
  const ms = ac(a, 'flow', 'link', 'm1');
  assert.equal(ms.status, 0, ms.stderr);
  assert.match(ms.stdout, /milestone 1 tied to feature\/alpha/);
  const un = ac(a, 'flow', 'unlink', String(p.n));
  assert.equal(un.status, 0);
  assert.match(un.stdout, /untied/);
  readRegistry(b);
  assert.ok(!('feature_branch' in row(b, p.n)), 'an explicit unlink beats the milestone tie');
  assert.notEqual(ac(a, 'flow', 'link').status, 0);
  assert.match(ac(a, 'flow', 'bogus').stderr, /link <phase\|m<N>> \| unlink/);
});

test('flow link refuses on develop, and the help lists link and unlink with both argument forms', async () => {
  const { a, phase } = await fixture();
  const p = await phase(a, 'one');
  const r = ac(a, 'flow', 'link', String(p.n));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot tie to develop/);
  for (const args of [['help'], ['flow', '--help']]) {
    const out = ac(a, ...args).stdout;
    assert.match(out, /ac flow link <phase\|m<N>>/);
    assert.match(out, /ac flow unlink <phase\|m<N>>/);
  }
  for (const args of [['help'], ['identity', '--help']]) assert.match(ac(a, ...args).stdout, /ac identity alias add\|remove <email>/);
});

test('identity alias add makes a third-email claim mine, remove reverts it, and the project stays untouched', async () => {
  const { bare, a } = await fixture();
  const c = mkdtempSync(join(tmpdir(), 'ac-fc-'));
  git(['init', '--quiet', '-b', 'develop'], { cwd: c });
  git(['config', 'user.email', 'me-old@example.test'], { cwd: c });
  git(['remote', 'add', 'origin', bare], { cwd: c });
  initPlanning(c, { name: 'fc' });
  const n = claim({ root: c, type: 'phase', milestone: 1, name: 'old laptop' }).number;
  readRegistry(a);
  const mineOf = () => status(a).phases.find((p) => p.number === n).mine;
  const porcelain = () => git(['status', '--porcelain'], { cwd: a }).stdout;
  const before = porcelain();
  assert.equal(mineOf(), false);
  const add = ac(a, 'identity', 'alias', 'add', 'Me-Old@example.test');
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /^✓ /);
  assert.equal(mineOf(), true);
  const show = ac(a, 'identity');
  assert.match(show.stdout, /me: me@example\.test/);
  assert.match(show.stdout, /aliases: me-old@example\.test/);
  assert.equal(porcelain(), before, 'adding an alias changes nothing in the project');
  assert.equal(ac(a, 'identity', 'alias', 'remove', 'me-old@example.test').status, 0);
  assert.equal(mineOf(), false);
  assert.match(ac(a, 'identity').stdout, /aliases: none/);
  git(['config', 'user.email', 'me-old@example.test'], { cwd: a });
  assert.equal(mineOf(), true, 'the repo\'s own user.email still counts');
});

test('on a feature branch each verb ties an untied phase; stdout is unchanged and the tie line is on stderr', async () => {
  const { a, b, phase } = await fixture();
  const p1 = await phase(a, 'first');
  const p2 = await phase(a, 'second');
  const p3 = await phase(a, 'third');
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const before = git(['branch', '--list'], { cwd: a }).stdout;

  const author = ac(a, 'phase', 'context', String(p1.n), '--author');
  assert.equal(author.status, 0, author.stderr);
  assert.equal(author.stdout, 'none\n');
  assert.equal(author.stderr.trim(), `• phase ${p1.n} tied to feature/alpha`);

  const plain = ac(a, 'phase', 'context', String(p2.n));
  assert.equal(plain.stdout, 'missing\n');
  assert.equal(plain.stderr.trim(), `• phase ${p2.n} tied to feature/alpha`);

  const set = ac(a, 'state', 'set', 'active_phase', p3.slug);
  assert.equal(set.status, 0, set.stderr);
  assert.deepEqual(JSON.parse(set.stdout), { active_phase: p3.slug });
  assert.equal(set.stderr.trim(), `• phase ${p3.n} tied to feature/alpha`);

  readRegistry(b);
  for (const p of [p1, p2, p3]) assert.equal(row(b, p.n).feature_branch, 'feature/alpha');
  assert.equal(git(['branch', '--list'], { cwd: a }).stdout, before, 'never creates or switches a branch');
  // a second run is silent
  assert.equal(ac(a, 'phase', 'context', String(p1.n)).stderr, '');
});

test('on develop the verbs tie nothing and leave an existing tie intact', async () => {
  const { a, b, phase } = await fixture();
  const tied = await phase(a, 'tied');
  const loose = await phase(a, 'loose');
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  assert.equal(ac(a, 'flow', 'link', String(tied.n)).status, 0);
  git(['switch', '-q', 'develop'], { cwd: a });
  for (const p of [tied, loose]) {
    const r = ac(a, 'phase', 'context', String(p.n));
    assert.equal(r.stdout, 'missing\n');
    assert.equal(r.stderr, '');
  }
  assert.equal(ac(a, 'state', 'set', 'active_phase', loose.slug).stderr, '');
  readRegistry(b);
  assert.equal(row(b, tied.n).feature_branch, 'feature/alpha');
  assert.ok(!('feature_branch' in row(b, loose.n)));
});
