// Teammates' phases in the bar (hooks/_astro-team.mjs): read from the LOCAL registry ref, tagged
// with who claimed them (`P84(a)`), never fetched. Real git repos, no stubs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
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
    assert.deepEqual({ owner: p84.owner, remote: p84.remote }, { owner: 'a', remote: true });
    assert.ok(![s.next, ...s.siblings].some((c) => /\b84\b/.test(c ?? '')), 'a teammate\'s phase is never offered');
  } finally { done(root); }
});
