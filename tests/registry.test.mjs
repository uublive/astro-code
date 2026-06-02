// Integration test for the inviolable numbering principle.
// We stand up a real bare git repo as "origin" and prove that:
//   1. claims land on the orphan registry branch (pure git, no server),
//   2. numbers increment monotonically per type/milestone,
//   3. two independent working copies sharing one remote never collide.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { claim, readRegistry, markComplete, findNameMatches, initRegistry } from '../lib/registry.mjs';
import { addDecision, canonPull } from '../lib/canon.mjs';

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare, name) {
  const dir = mkdtempSync(join(tmpdir(), `ac-work-${name}-`));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', `${name}@example.com`], { cwd: dir });
  git(['config', 'user.name', name], { cwd: dir });
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: `proj-${name}` });
  return dir;
}

test('claims land on the orphan branch and increment per milestone', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');
  // `ac registry init` creates the orphan branch and backfills milestone 1 from
  // the init-time roadmap. The first milestone exists from project creation.
  const init = initRegistry({ root: dir });
  assert.equal(init.ok, true, init.error || '');

  // milestone 1's phases number from 1 — no phantom auto-reserved phase 1
  const p1 = claim({ root: dir, type: 'phase', milestone: 1 });
  assert.equal(p1.source, 'remote', p1.error || '');
  assert.equal(p1.number, 1);

  const p2 = claim({ root: dir, type: 'phase', milestone: 1 });
  assert.equal(p2.number, 2);

  // the next milestone is 2, and its phases also start at 1
  const m2 = claim({ root: dir, type: 'milestone' });
  assert.equal(m2.number, 2);
  const p1m2 = claim({ root: dir, type: 'phase', milestone: 2 });
  assert.equal(p1m2.number, 1);

  // registry is readable and well-formed
  const reg = readRegistry(dir);
  assert.equal(reg.available, true);
  const milestones = reg.registry.claims.filter((c) => c.type === 'milestone').map((c) => c.number).sort();
  assert.deepEqual(milestones, [1, 2]);
});

test('two independent working copies on one remote never collide', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');
  initRegistry({ root: alice }); // seeds milestone 1 once, on the shared branch

  // Both start a NEW milestone; whoever pushes second is rejected and recomputes.
  const a = claim({ root: alice, type: 'milestone' });
  const b = claim({ root: bob, type: 'milestone' });
  assert.equal(a.source, 'remote', a.error || '');
  assert.equal(b.source, 'remote', b.error || '');
  assert.notEqual(a.number, b.number);
  assert.deepEqual([a.number, b.number].sort(), [2, 3]);

  // Both add a phase to milestone 1; numbers stay distinct.
  const pa = claim({ root: alice, type: 'phase', milestone: 1 });
  const pb = claim({ root: bob, type: 'phase', milestone: 1 });
  assert.notEqual(pa.number, pb.number);
});

test('decisions are shared on the orphan branch without ADR collisions', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Pure git registry', why: 'no deps' });
  assert.equal(a.source, 'remote', a.error || '');
  assert.equal(a.id, 'ADR-001');

  // bob computes the next ADR from the SHARED state → no collision
  const b = await addDecision(bob, { title: 'Markdown commands' });
  assert.equal(b.id, 'ADR-002');

  // alice pulls and sees bob's decision too
  const pull = canonPull(alice);
  assert.ok(pull.pulled.includes('DECISIONS.md'));
  const local = readFileSync(paths(alice).decisions, 'utf8');
  assert.match(local, /ADR-001 — Pure git registry/);
  assert.match(local, /ADR-002 — Markdown commands/);
});

test('registry claims preserve shared canon (no tree wipe)', async () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');

  await addDecision(dir, { title: 'Keep me' });
  const c = claim({ root: dir, type: 'milestone' }); // writes registry.json on the same branch
  assert.equal(c.source, 'remote');

  // both files coexist on the branch
  assert.equal(readRegistry(dir).registry.claims.length >= 1, true);
  const pull = canonPull(dir);
  assert.ok(pull.pulled.includes('DECISIONS.md'));
  assert.match(readFileSync(paths(dir).decisions, 'utf8'), /ADR-001 — Keep me/);
});

test('name tracking flags duplicate work across devs', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  initRegistry({ root: alice }); // creates the branch + seeds milestone 1
  const a = claim({ root: alice, type: 'phase', milestone: 1, name: 'User Authentication' });
  assert.equal(a.source, 'remote', a.error || '');

  // exact match (case-insensitive) by another dev
  const exact = findNameMatches(bob, { type: 'phase', name: 'user authentication' });
  assert.equal(exact.available, true);
  assert.equal(exact.matches.length, 1);
  assert.equal(exact.matches[0].match, 'exact');
  assert.equal(exact.matches[0].owner, 'alice@example.com');

  // a similar (token-overlap) name is flagged too
  const similar = findNameMatches(bob, { type: 'phase', name: 'Authentication' });
  assert.equal(similar.matches[0]?.match, 'similar');

  // an unrelated name is not flagged
  assert.equal(findNameMatches(bob, { type: 'phase', name: 'Billing' }).matches.length, 0);

  // claim() also surfaces the matches it saw
  const b = claim({ root: bob, type: 'phase', milestone: 1, name: 'User Authentication' });
  assert.ok(b.matches.some((m) => m.owner === 'alice@example.com' && m.match === 'exact'));
});

test('markComplete retires a milestone\'s claims', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');

  initRegistry({ root: dir }); // milestone 1
  claim({ root: dir, type: 'phase', milestone: 1 }); // phase 1
  const res = markComplete({ root: dir, milestone: 1 });
  assert.equal(res.ok, true);
  assert.ok(res.changed >= 2);

  const active = readRegistry(dir).registry.claims.filter((c) => c.status === 'active');
  assert.equal(active.length, 0);
});

test('numbers are never reused after a milestone completes (monotonic)', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');

  initRegistry({ root: dir }); // milestone 1 (active)
  markComplete({ root: dir, milestone: 1 }); // retire it
  const m = claim({ root: dir, type: 'milestone' });
  assert.equal(m.number, 2); // NOT reused as 1, even though no active milestone remains
});

test('claims refuse to run before `ac registry init`', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice'); // origin present, but registry never initialized
  const res = claim({ root: dir, type: 'milestone' });
  assert.equal(res.source, 'error');
  assert.equal(res.needsInit, true);
  assert.match(res.error, /registry init/);
});

test('`ac registry init` backfills archived milestones as complete and continues numbering', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');

  // simulate a milestone 1 that was archived locally (before any registry existed)
  const arch = join(paths(dir).dir, 'milestones', '1');
  mkdirSync(arch, { recursive: true });
  writeFileSync(join(arch, 'roadmap.json'), JSON.stringify({
    milestone: 1,
    phases: [{ number: 1, slug: '01-a', name: 'A' }, { number: 2, slug: '02-b', name: 'B' }],
  }));

  const res = initRegistry({ root: dir });
  assert.equal(res.created, true);

  const claims = readRegistry(dir).registry.claims;
  const m1 = claims.find((c) => c.type === 'milestone' && c.number === 1);
  assert.equal(m1.status, 'complete'); // archive wins over the live roadmap's active milestone 1
  assert.equal(claims.filter((c) => c.type === 'phase' && c.milestone === 1).length, 2);

  // the next milestone skips the archived number instead of resetting to 1
  const m = claim({ root: dir, type: 'milestone' });
  assert.equal(m.number, 2);
});
