// Integration test for the inviolable numbering principle.
// We stand up a real bare git repo as "origin" and prove that:
//   1. claims land on the orphan registry branch (pure git, no server),
//   2. numbers increment monotonically per type (phases are global, not per-milestone),
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

test('claims land on the orphan branch; phases number globally (never restart per milestone)', () => {
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

  // the next milestone is 2, but its first phase continues the GLOBAL phase
  // sequence — it is 3 (after m1's phases 1 and 2), not a reset to 1.
  const m2 = claim({ root: dir, type: 'milestone' });
  assert.equal(m2.number, 2);
  const p1m2 = claim({ root: dir, type: 'phase', milestone: 2 });
  assert.equal(p1m2.number, 3);

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

// ── ADR-042: a base that cannot be read must never become a base of "nothing" ──
//
// Twice, `ac decision add` destroyed a live shared registry: registry.json (172 claims) and
// DECISIONS.md (109 ADRs) deleted, every step reporting success. Cause: readTree returned an
// empty Map when `ls-tree` FAILED, which transact could not distinguish from "no files". It
// built the next tree from that empty base, added only its own update, and committed it WITH
// the real tip as parent — so the push fast-forwarded cleanly and was accepted.

test('ADR-042: readTree returns null when the tree cannot be read, never an empty map', async () => {
  const { readTree } = await import('../lib/shared.mjs');
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'reader');
  // A well-formed sha that is not in the object store: ls-tree fails.
  const bogus = '0'.repeat(40);
  assert.strictEqual(readTree(dir, bogus), null, 'an unreadable tree must be null — empty means "this branch has no files"');
  // And a falsy tip is genuinely "nothing here yet", which IS an empty map.
  assert.ok(readTree(dir, null) instanceof Map, 'no tip is a real empty state, not a failure');
  assert.strictEqual(readTree(dir, null).size, 0);
});

test('ADR-042: transact refuses to write when the existing tree reads as empty', async () => {
  const { transact } = await import('../lib/shared.mjs');
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  // Reproduce the incident's shape: a tip that exists but whose tree holds nothing.
  const empty = git(['mktree'], { cwd: dir, input: '' }).stdout.trim();
  const commit = git(['commit-tree', empty, '-m', 'wiped'], { cwd: dir }).stdout.trim();
  git(['push', '--force', bare, `${commit}:refs/heads/astro-registry`], { cwd: dir });

  const res = transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'should refuse' },
    () => ({ updates: { 'DECISIONS.md': '# Decisions\n\n## ADR-001 — only me\n' } }));

  assert.strictEqual(res.ok, false, 'writing onto an apparently-empty registry must be refused, not committed');
  assert.match(res.error, /reads as empty|could not be read/i);
  assert.match(res.error, /partial fetch|unreadable/i, 'the error must name the likely cause, not just say no');
});

test('ADR-042: a genuinely new branch is still writable', async () => {
  const { transact } = await import('../lib/shared.mjs');
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'bob');
  // No registry init: the branch does not exist at all, which is a real empty state.
  const res = transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'first write' },
    () => ({ updates: { 'registry.json': '{"version":1,"claims":[]}\n' } }));
  assert.strictEqual(res.ok, true, 'bootstrapping a brand-new branch must still work — the guard is about UNREADABLE, not absent');
});

test('ADR-042: a normal write preserves every sibling file', async () => {
  const { transact, snapshot } = await import('../lib/shared.mjs');
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'carol');
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'seed' },
    () => ({ updates: { 'CONVENTIONS.md': '# Conventions\n', 'DECISIONS.md': '# Decisions\n' } }));

  transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'touch one file' },
    () => ({ updates: { 'DECISIONS.md': '# Decisions\n\n## ADR-001 — x\n' } }));

  const { files } = snapshot(dir, { remote: 'origin', branch: 'astro-registry' });
  assert.ok(files['registry.json'], 'registry.json must survive a DECISIONS.md write — this is what was destroyed');
  assert.ok(files['CONVENTIONS.md'], 'CONVENTIONS.md must survive too');
  assert.match(files['DECISIONS.md'], /ADR-001/);
});

// ── ADR-043: drift must not hand out a number the roadmap is already using ──
//
// SALESCRAFT's registry.json was deleted from the orphan branch by an ADR-042-era write.
// The branch still existed and still held DECISIONS.md, so every guard passed — but the
// registry now parsed as zero claims while the local roadmaps ran to phase 46. The next
// allocation was phase 1, and `addPhase` did not even reject it, because milestones 1-2
// were archived on another machine and nothing local held a 1 to collide with.

test('ADR-043: allocation floors on the local roadmaps, so a gutted registry cannot reissue a used number', async () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare, 'alice');
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  // Grow the roadmap the way a real project does, through the registry.
  for (let i = 0; i < 3; i++) claim({ root: dir, type: 'phase', milestone: 1, name: `p${i}` });
  const rmPath = paths(dir).roadmap;
  const rm = JSON.parse(readFileSync(rmPath, 'utf8'));
  rm.phases = [1, 2, 3].map((n) => ({ number: n, name: `p${n}`, slug: `0${n}-p${n}`, status: 'complete' }));
  writeFileSync(rmPath, JSON.stringify(rm, null, 2));

  // Now reproduce the incident: registry.json deleted, siblings intact, branch healthy.
  const { transact, snapshot } = await import('../lib/shared.mjs');
  const wipe = transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'simulate ADR-042 loss' },
    () => ({ updates: { 'registry.json': null, 'DECISIONS.md': '# Decisions\n' } }));
  assert.strictEqual(wipe.ok, true);
  assert.strictEqual(snapshot(dir, { remote: 'origin', branch: 'astro-registry' }).files['registry.json'], undefined);

  // Pre-fix this returned 1 — a duplicate of a phase the roadmap already owns.
  const next = claim({ root: dir, type: 'phase', milestone: 1, name: 'after the loss' });
  assert.strictEqual(next.source, 'remote', next.error || '');
  assert.strictEqual(next.number, 4, 'must clear the local high-water mark (3), not restart at 1');
});

test('ADR-043: an unreachable remote is not reported as an uninitialised registry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-unreachable-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'x@example.com'], { cwd: dir });
  git(['config', 'user.name', 'x'], { cwd: dir });
  // A configured remote that cannot be contacted — the expired-credential case.
  git(['remote', 'add', 'origin', join(dir, 'does-not-exist.git')], { cwd: dir });
  initPlanning(dir, { name: 'proj-unreachable' });

  const res = claim({ root: dir, type: 'phase', milestone: 1, name: 'anything' });
  assert.strictEqual(res.source, 'error');
  assert.strictEqual(res.unreachable, true);
  assert.ok(!res.needsInit, 'an unreachable remote must not be flagged as needing init');
  assert.match(res.error, /cannot reach/i);
  assert.match(res.error, /do NOT run `ac registry init`/i, 'the message must steer away from the destructive command');

  // And init itself must refuse rather than rebuild a possibly-intact registry from disk.
  const bad = initRegistry({ root: dir });
  assert.strictEqual(bad.ok, false, 'init must refuse when it could not read the remote');
  assert.match(bad.error, /refusing to initialize/i);
  const forced = initRegistry({ root: dir, force: true });
  assert.strictEqual(forced.ok, false, '--force must refuse too — force is exactly the panic reaction to this state');

  const reg = readRegistry(dir);
  assert.strictEqual(reg.available, false, 'an unread remote must never present as an empty registry');
  assert.strictEqual(reg.unreachable, true);
});
