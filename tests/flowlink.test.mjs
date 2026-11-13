// Phase 58 — flowLink / flowUnlink / autoTie against a real bare remote and two clones.
// HOME points at a scratch dir so the owner's real ~/.astro is never read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { updateConfig } from '../lib/config.mjs';
import { initRegistry, claim, readRegistry } from '../lib/registry.mjs';

process.env.HOME = mkdtempSync(join(tmpdir(), 'ac-fl-home-'));
process.env.XDG_CONFIG_HOME = join(process.env.HOME, '.config');
const mod = () => import('../lib/flowlink.mjs');

async function fixture({ flow = true } = {}) {
  const bare = mkdtempSync(join(tmpdir(), 'ac-fl-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const mk = async (email) => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-fl-'));
    git(['init', '--quiet', '-b', 'develop'], { cwd: dir });
    git(['config', 'user.email', email], { cwd: dir });
    git(['config', 'user.name', email], { cwd: dir });
    git(['remote', 'add', 'origin', bare], { cwd: dir });
    initPlanning(dir, { name: 'fl' });
    git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
    if (flow) await updateConfig(dir, (c) => ({ ...c, gitflow: { enabled: true } }));
    return dir;
  };
  const a = await mk('me@example.test');
  const b = await mk('alex@example.test');
  assert.equal(initRegistry({ root: a }).ok, true);
  const pa = claim({ root: a, type: 'phase', milestone: 1, name: 'one' }).number;
  const pa2 = claim({ root: a, type: 'phase', milestone: 1, name: 'two' }).number;
  const pb = claim({ root: b, type: 'phase', milestone: 1, name: 'three' }).number;
  return { a, b, pa, pa2, pb };
}
const claimOf = (root, type, number) => readRegistry(root).registry.claims.find((c) => c.type === type && c.number === number);
const branches = (root) => git(['branch', '--list'], { cwd: root }).stdout;
const head = (root) => git(['symbolic-ref', '--short', 'HEAD'], { cwd: root }).stdout.trim();

test('link, re-link to move, milestone link and unlink are each visible from the other clone', async () => {
  const { flowLink, flowUnlink } = await mod();
  const { a, b, pa } = await fixture();
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  assert.equal(flowLink(a, String(pa)).message, `✓ phase ${pa} tied to feature/alpha`);
  assert.equal(claimOf(b, 'phase', pa).feature_branch, 'feature/alpha');
  assert.equal(flowLink(a, String(pa)).message, `✓ phase ${pa} already tied to feature/alpha`);
  git(['switch', '-q', '-c', 'feature/beta'], { cwd: a });
  assert.equal(flowLink(a, String(pa)).message, `✓ phase ${pa} moved from feature/alpha to feature/beta`);
  assert.equal(claimOf(b, 'phase', pa).feature_branch, 'feature/beta');
  assert.equal(flowLink(a, 'm1').message, '✓ milestone 1 tied to feature/beta');
  assert.equal(claimOf(b, 'milestone', 1).feature_branch, 'feature/beta');
  assert.equal(flowUnlink(a, String(pa)).message, `✓ phase ${pa} untied`);
  assert.equal(claimOf(b, 'phase', pa).feature_branch, null);
  assert.equal(flowUnlink(a, 'm1').message, '✓ milestone 1 untied');
  assert.ok(!('feature_branch' in claimOf(b, 'milestone', 1)));
});

test('link refuses: flow off, main, develop, detached HEAD, no registry, unreachable, unknown claim', async () => {
  const { flowLink, flowUnlink } = await mod();
  const off = await fixture({ flow: false });
  git(['switch', '-q', '-c', 'feature/x'], { cwd: off.a });
  assert.throws(() => flowLink(off.a, String(off.pa)), /gitflow is disabled/);
  assert.throws(() => flowUnlink(off.a, String(off.pa)), /gitflow is disabled/);

  const { a, pa } = await fixture();
  assert.throws(() => flowLink(a, String(pa)), /cannot tie to develop/);
  git(['switch', '-q', '-c', 'main'], { cwd: a });
  assert.throws(() => flowLink(a, String(pa)), /cannot tie to main/);
  git(['switch', '-q', '-c', 'feature/x'], { cwd: a });
  git(['checkout', '-q', '--detach'], { cwd: a });
  assert.throws(() => flowLink(a, String(pa)), /detached/);
  git(['switch', '-q', 'feature/x'], { cwd: a });
  assert.throws(() => flowLink(a, '9999'), /no claim/);
  assert.throws(() => flowLink(a, 'no-such-slug'), /no phase or milestone/);
  git(['remote', 'set-url', 'origin', join(a, 'nowhere.git')], { cwd: a });
  assert.throws(() => flowLink(a, String(pa)), /cannot reach/);

  // no registry on the remote at all
  const bare = mkdtempSync(join(tmpdir(), 'ac-fl-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const c = mkdtempSync(join(tmpdir(), 'ac-fl-'));
  git(['init', '--quiet', '-b', 'feature/c'], { cwd: c });
  git(['remote', 'add', 'origin', bare], { cwd: c });
  initPlanning(c, { name: 'fl' });
  await updateConfig(c, (cfg) => ({ ...cfg, gitflow: { enabled: true } }));
  assert.throws(() => flowLink(c, '1'), /ac registry init/);
});

test('link never creates or switches a branch', async () => {
  const { flowLink } = await mod();
  const { a, pa } = await fixture();
  git(['switch', '-q', '-c', 'feature/alpha'], { cwd: a });
  const before = [head(a), branches(a)];
  flowLink(a, String(pa));
  assert.deepEqual([head(a), branches(a)], before);
});

test('autoTie: ties an untied, mine phase on feature/x with one stderr line', async () => {
  const { autoTie } = await mod();
  const { a, b, pa } = await fixture();
  git(['switch', '-q', '-c', 'feature/x'], { cwd: a });
  const before = [head(a), branches(a)];
  assert.deepEqual(autoTie(a, pa), { line: `• phase ${pa} tied to feature/x` });
  assert.equal(claimOf(b, 'phase', pa).feature_branch, 'feature/x');
  assert.deepEqual([head(a), branches(a)], before, 'never git switch/branch');
  assert.deepEqual(autoTie(a, pa), { line: null }, 'already tied here: silence');
});

test('autoTie: no-op on develop and on a non-feature branch', async () => {
  const { autoTie } = await mod();
  const { a, b, pa } = await fixture();
  assert.deepEqual(autoTie(a, pa), { line: null });
  git(['switch', '-q', '-c', 'bugfix/y'], { cwd: a });
  assert.deepEqual(autoTie(a, pa), { line: null });
  assert.ok(!('feature_branch' in claimOf(b, 'phase', pa)));
});

test('autoTie: never overwrites a tie elsewhere (and says so), respects an explicit unlink, yields to a milestone tie', async () => {
  const { autoTie, flowLink, flowUnlink } = await mod();
  const { a, pa, pa2 } = await fixture();
  git(['switch', '-q', '-c', 'feature/x'], { cwd: a });
  flowLink(a, String(pa));
  git(['switch', '-q', '-c', 'feature/y'], { cwd: a });
  readRegistry(a);
  assert.equal(autoTie(a, pa).line, `⚠ phase ${pa} is tied to feature/x — \`ac flow link ${pa}\` moves it`);
  assert.equal(claimOf(a, 'phase', pa).feature_branch, 'feature/x');
  flowUnlink(a, String(pa2));
  readRegistry(a);
  assert.deepEqual(autoTie(a, pa2), { line: null });
  assert.equal(claimOf(a, 'phase', pa2).feature_branch, null);
  // milestone tied to feature/x: a third phase on feature/y is refused with the milestone's tie named
  const p3 = claim({ root: a, type: 'phase', milestone: 1, name: 'three' }).number;
  git(['switch', '-q', 'feature/x'], { cwd: a });
  flowLink(a, 'm1');
  git(['switch', '-q', 'feature/y'], { cwd: a });
  readRegistry(a);
  assert.match(autoTie(a, p3).line, /tied to feature\/x/);
});

test('autoTie: skips a teammate\'s claim and a gitflow-off project; unreachable is one warning line', async () => {
  const { autoTie } = await mod();
  const { a, b, pa, pb } = await fixture();
  git(['switch', '-q', '-c', 'feature/x'], { cwd: a });
  readRegistry(a);
  assert.deepEqual(autoTie(a, pb), { line: null });
  assert.ok(!('feature_branch' in claimOf(b, 'phase', pb)));

  const off = await fixture({ flow: false });
  git(['switch', '-q', '-c', 'feature/x'], { cwd: off.a });
  assert.deepEqual(autoTie(off.a, off.pa), { line: null });

  git(['remote', 'set-url', 'origin', join(a, 'nowhere.git')], { cwd: a });
  git(['update-ref', '-d', 'refs/remotes/origin/astro-registry'], { cwd: a });
  const r = autoTie(a, pa);
  assert.match(r.line, /^⚠ could not tie phase \d+ to feature\/x: /);
});
