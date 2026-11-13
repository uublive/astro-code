// Teammates' phases in the bar (hooks/_astro-team.mjs): read from the LOCAL registry ref, tagged
// with who claimed them (`P84(a)`), never fetched. Real git repos, no stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const NOW = 1_700_000_000;
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** A repo whose roadmap holds phases 47 and 48 (mine) and whose registry ref holds `claims`. */
function repo(claims, { email = 'me@x.io', packed = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ac-team-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', email);
  sh(root, 'config', 'user.name', 'Me');
  const ac = join(root, '.astrocode');
  mkdirSync(ac, { recursive: true });
  writeFileSync(join(ac, 'state.json'), JSON.stringify({ project: 't', active_phase: '47-a' }));
  writeFileSync(join(ac, 'roadmap.json'), JSON.stringify({ milestone: 13, phases: [
    { number: 47, slug: '47-a', name: 'A', status: 'executing' },
    { number: 48, slug: '48-b', name: 'B', status: 'pending' },
  ] }));
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ version: 1, claims }));
  sh(root, 'add', 'registry.json');
  sh(root, 'commit', '-q', '-m', 'registry');
  sh(root, 'update-ref', 'refs/remotes/origin/astro-registry', 'HEAD');
  if (packed) sh(root, 'pack-refs', '--all');
  return root;
}
const claim = (number, owner, o = {}) => ({ type: 'phase', number, milestone: 13, name: `P${number}`, owner, status: 'active', ...o });
const done = (root) => rmSync(root, { recursive: true, force: true });

test('a teammate\'s claimed phase shows in the bar tagged with their initial; mine stay plain', async () => {
  const { readContext, phaseTrack } = await import('../hooks/_astro-ctx.mjs');
  const root = repo([claim(47, 'me@x.io'), claim(48, 'me@x.io'), claim(84, 'alex@team.io')]);
  try {
    const ctx = readContext(root, NOW);
    assert.deepEqual(ctx.phases.map((p) => [p.number, p.owner ?? null, !!p.remote]), [[47, null, false], [48, null, false], [84, 'a', true]]);
    assert.equal(ctx.total, 2, 'progress counts stay this roadmap\'s');
    assert.equal(strip(phaseTrack(ctx, 3)), '(P47) P48 P84(a)');
  } finally { done(root); }
});

test('a teammate\'s phase already merged into the roadmap is tagged too, and closed claims are not added', async () => {
  const { readContext } = await import('../hooks/_astro-ctx.mjs');
  const root = repo([claim(47, 'me@x.io'), claim(48, 'alex@team.io'), claim(90, 'alex@team.io', { status: 'complete' }), claim(91, 'alex@team.io', { milestone: 12 })]);
  try {
    const ctx = readContext(root, NOW);
    assert.deepEqual(ctx.phases.map((p) => [p.number, p.owner ?? null]), [[47, null], [48, 'a']]);
  } finally { done(root); }
});

test('two teammates sharing an initial get longer tags; packed refs are read too', async () => {
  const { readContext } = await import('../hooks/_astro-ctx.mjs');
  const { ownerTags } = await import('../hooks/_astro-team.mjs');
  assert.deepEqual([...ownerTags(['alex@a.io', 'anna@b.io', 'bob@c.io'])], [['alex@a.io', 'al'], ['anna@b.io', 'an'], ['bob@c.io', 'b']]);
  const root = repo([claim(84, 'alex@a.io'), claim(85, 'anna@b.io')], { packed: true });
  try {
    assert.ok(!existsSync(join(root, '.git', 'refs', 'remotes', 'origin', 'astro-registry')), 'the ref is packed');
    assert.deepEqual(readContext(root, NOW).phases.filter((p) => p.remote).map((p) => `${p.number}(${p.owner})`), ['84(al)', '85(an)']);
  } finally { done(root); }
});

test('no repo, no registry ref or a broken registry leaves the bar as the local roadmap', async () => {
  const { readContext } = await import('../hooks/_astro-ctx.mjs');
  const root = repo([claim(84, 'alex@team.io')]);
  try {
    sh(root, 'update-ref', '-d', 'refs/remotes/origin/astro-registry');
    assert.deepEqual(readContext(root, NOW).phases.map((p) => p.number), [47, 48]);
    rmSync(join(root, '.git'), { recursive: true, force: true });
    assert.deepEqual(readContext(root, NOW).phases.map((p) => p.number), [47, 48]);
  } finally { done(root); }
});

test('the claims cache is local and git-ignored, and follows the ref when it moves', async () => {
  const { readContext } = await import('../hooks/_astro-ctx.mjs');
  const root = repo([claim(84, 'alex@team.io')]);
  try {
    readContext(root, NOW);
    const cache = join(root, '.astrocode', '.local', 'team-claims.json');
    assert.ok(existsSync(cache));
    assert.equal(sh(root, 'check-ignore', '-q', cache).status, 0);
    writeFileSync(join(root, 'registry.json'), JSON.stringify({ version: 1, claims: [claim(84, 'alex@team.io'), claim(86, 'bob@team.io')] }));
    sh(root, 'commit', '-q', '-am', 'more');
    sh(root, 'update-ref', 'refs/remotes/origin/astro-registry', 'HEAD');
    assert.deepEqual(readContext(root, NOW + 1).phases.filter((p) => p.remote).map((p) => `${p.number}(${p.owner})`), ['84(a)', '86(b)']);
  } finally { done(root); }
});

test('ac status --json carries the tags and the registry-only phases, never as a next step', async () => {
  const { statusJson } = await import('../lib/nextstep.mjs');
  const root = repo([claim(47, 'me@x.io'), claim(84, 'alex@team.io')]);
  try {
    const s = statusJson(root, NOW);
    const p84 = s.phases.find((p) => p.number === 84);
    // phase 58: `owner` is the claim's full email; the short tag moved to `owner_tag`
    assert.deepEqual({ owner: p84.owner, owner_tag: p84.owner_tag, mine: p84.mine, remote: p84.remote }, { owner: 'alex@team.io', owner_tag: 'a', mine: false, remote: true });
    assert.ok(![s.next, ...s.siblings].some((c) => /\b84\b/.test(c ?? '')), 'a teammate\'s phase is never offered');
  } finally { done(root); }
});

// --- phase 58: ownership, ties, aliases, headBranch -------------------------------
const scratchHome = () => mkdtempSync(join(tmpdir(), 'ac-team-home-'));

test('the v2 cache keeps raw owner, tri-state tie and milestoneTies; an older cache is rebuilt', async () => {
  const { teamClaims } = await import('../hooks/_astro-team.mjs');
  const root = repo([
    claim(47, 'Me@X.io', { feature_branch: 'feature/a', branch: 'develop' }),
    claim(48, 'me@x.io', { feature_branch: null }),
    claim(49, 'alex@team.io', { branch: 'develop' }),
    { type: 'milestone', number: 13, owner: 'me@x.io', status: 'active', feature_branch: 'feature/m' },
    { type: 'milestone', number: 12, owner: 'me@x.io', status: 'active' },
  ]);
  const home = scratchHome();
  try {
    const cache = join(root, '.astrocode', '.local', 'team-claims.json');
    mkdirSync(join(root, '.astrocode', '.local'), { recursive: true });
    writeFileSync(cache, JSON.stringify({ sha: 'x', claims: [{ number: 1 }], me: 'old', me_at: NOW }));
    const t = teamClaims(root, NOW, { home });
    assert.deepEqual(t.claims.map((c) => [c.number, c.owner, 'tie' in c ? c.tie : 'absent']), [[47, 'Me@X.io', 'feature/a'], [48, 'me@x.io', null], [49, 'alex@team.io', 'absent']]);
    assert.deepEqual(t.milestoneTies, { 13: 'feature/m' });
    assert.equal(JSON.parse(readFileSync(cache, 'utf8')).v, 2);
    assert.ok(t.refPath.endsWith(join('refs', 'remotes', 'origin', 'astro-registry')));
  } finally { done(root); done(home); }
});

test('ownership: git email plus aliases is me; an empty owner is mine; null with no ref', async () => {
  const { ownership, isMine } = await import('../hooks/_astro-team.mjs');
  const root = repo([claim(47, 'me@x.io'), claim(84, 'me-old@x.io')]);
  const home = scratchHome();
  try {
    let o = ownership(root, NOW, { home });
    assert.ok(isMine('ME@x.io ', o.me));
    assert.ok(!isMine('me-old@x.io', o.me));
    assert.ok(isMine('', o.me) && isMine(undefined, o.me), 'an unattributable claim is mine');
    mkdirSync(join(home, '.astro'), { recursive: true });
    writeFileSync(join(home, '.astro', 'config.json'), JSON.stringify({ identity: { aliases: ['Me-Old@x.io'] } }));
    o = ownership(root, NOW + 1, { home });
    assert.ok(isMine('me-old@x.io', o.me), 'an alias is re-read without waiting for the ttl');
    assert.ok(isMine('me@x.io', o.me), 'the alias adds to the git email');
    sh(root, 'update-ref', '-d', 'refs/remotes/origin/astro-registry');
    assert.equal(ownership(root, NOW + 2, { home }), null);
  } finally { done(root); done(home); }
});

test('a changed user.email is seen on the next call, without waiting for the ttl', async () => {
  const { ownership } = await import('../hooks/_astro-team.mjs');
  const root = repo([claim(47, 'me@x.io')]);
  const home = scratchHome();
  try {
    assert.ok(ownership(root, NOW, { home }).me.has('me@x.io'));
    sh(root, 'config', 'user.email', 'alex@team.io');
    const me = ownership(root, NOW + 1, { home }).me;
    assert.ok(me.has('alex@team.io') && !me.has('me@x.io'));
  } finally { done(root); done(home); }
});

test('teamPhases does not tag my own phase claimed under an alias', async () => {
  const { teamPhases } = await import('../hooks/_astro-team.mjs');
  const root = repo([claim(84, 'me-old@x.io'), claim(85, 'alex@team.io')]);
  const prev = process.env.HOME;
  const home = scratchHome();
  try {
    mkdirSync(join(home, '.astro'), { recursive: true });
    writeFileSync(join(home, '.astro', 'config.json'), JSON.stringify({ identity: { aliases: ['me-old@x.io'] } }));
    process.env.HOME = home;
    assert.deepEqual(Object.keys(teamPhases(root, 13, new Set([47, 48]), NOW).owners), ['85']);
  } finally { process.env.HOME = prev; done(root); done(home); }
});

test('headBranch: slash names stay whole; detached is null; a worktree .git file reads its own HEAD', async () => {
  const { headBranch } = await import('../hooks/_astro-team.mjs');
  const root = repo([claim(47, 'me@x.io')]);
  const wt = join(mkdtempSync(join(tmpdir(), 'ac-team-wt-')), 'wt');
  try {
    sh(root, 'switch', '-q', '-c', 'feature/v0-full-walk');
    assert.equal(headBranch(root), 'feature/v0-full-walk');
    sh(root, 'worktree', 'add', '-q', '-b', 'feature/other', wt);
    assert.equal(headBranch(wt), 'feature/other');
    assert.equal(headBranch(root), 'feature/v0-full-walk');
    sh(root, 'checkout', '-q', '--detach');
    assert.equal(headBranch(root), null);
    assert.equal(headBranch(join(tmpdir(), 'ac-no-such-dir')), null);
  } finally { sh(root, 'worktree', 'remove', '--force', wt); done(root); }
});
