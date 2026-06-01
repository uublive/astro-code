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

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { claim, readRegistry, markComplete } from '../lib/registry.mjs';

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

  const m1 = claim({ root: dir, type: 'milestone' });
  assert.equal(m1.source, 'remote', m1.error || '');
  assert.equal(m1.number, 1);

  // milestone claim auto-reserves phase 1, so the next phase is 2
  const p2 = claim({ root: dir, type: 'phase', milestone: 1 });
  assert.equal(p2.source, 'remote');
  assert.equal(p2.number, 2);

  const p3 = claim({ root: dir, type: 'phase', milestone: 1 });
  assert.equal(p3.number, 3);

  // a second milestone is independent
  const m2 = claim({ root: dir, type: 'milestone' });
  assert.equal(m2.number, 2);
  const p2m2 = claim({ root: dir, type: 'phase', milestone: 2 });
  assert.equal(p2m2.number, 2); // milestone 2 already has its auto phase 1

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

  // Both start a milestone; whoever pushes second is rejected and recomputes.
  const a = claim({ root: alice, type: 'milestone' });
  const b = claim({ root: bob, type: 'milestone' });
  assert.equal(a.source, 'remote');
  assert.equal(b.source, 'remote');
  assert.notEqual(a.number, b.number);
  assert.deepEqual([a.number, b.number].sort(), [1, 2]);

  // Both add a phase to milestone 1 (claimed by alice); numbers stay distinct.
  const pa = claim({ root: alice, type: 'phase', milestone: 1 });
  const pb = claim({ root: bob, type: 'phase', milestone: 1 });
  assert.notEqual(pa.number, pb.number);
});

test('markComplete retires a milestone\'s claims', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');

  claim({ root: dir, type: 'milestone' }); // milestone 1 + phase 1
  claim({ root: dir, type: 'phase', milestone: 1 }); // phase 2
  const res = markComplete({ root: dir, milestone: 1 });
  assert.equal(res.ok, true);
  assert.ok(res.changed >= 3);

  const active = readRegistry(dir).registry.claims.filter((c) => c.status === 'active');
  assert.equal(active.length, 0);
});
