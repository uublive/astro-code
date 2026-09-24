// RED tests for the offline-first sync engine (P9, lib/principlesync.mjs — t10).
// Real bare git repos as remotes, two independent store directories ("machines")
// sharing one, exactly like tests/registry.test.mjs's harness for the orphan
// registry branch. `lib/principlesync.mjs` does not exist yet on this branch, so
// every test dynamic-imports it inside the test body (ADR-018) — this file is
// meant to fail (RED) until t10 lands, paired by the same `depends_on: t4`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git, gitOk } from '../lib/git.mjs';
import { renderPrinciple } from '../lib/principlemd.mjs';

function mkBareRemote() {
  const parent = mkdtempSync(join(tmpdir(), 'ac-principles-origin-'));
  const bare = join(parent, 'origin.git');
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkStoreDir(name) {
  return mkdtempSync(join(tmpdir(), `ac-principles-${name}-`));
}

function identityEnv(name) {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: `${name}@example.com`,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: `${name}@example.com`,
  };
}

// `lib/principlesync.mjs`'s functions read the ambient environment for git
// identity (mirrors `mkWorkdir`'s `git config user.*` in registry.test.mjs, but
// these stores are only turned into repos by `setRemote` itself, so identity has
// to travel as env rather than a pre-existing `git config` call).
async function withIdentity(name, fn) {
  const env = identityEnv(name);
  const prior = {};
  for (const k of Object.keys(env)) {
    prior[k] = process.env[k];
    process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(env)) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
  }
}

let seq = 0;
function mkEntry(overrides = {}) {
  seq += 1;
  const id = overrides.id || `2026-09-24-sync-test-entry-${seq}`;
  return {
    id,
    kind: 'principle',
    strength: 'default',
    status: 'accepted',
    created: '2026-09-24T08:30:00.000Z',
    scopes: { stack: [], files: [], work: [] },
    statement: `statement ${id}`,
    why: '',
    promotions: [],
    history: [],
    ...overrides,
    id, // id must stay in sync with the filename regardless of overrides ordering
  };
}

function writeEntry(dir, entry) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${entry.id}.md`), renderPrinciple(entry));
  return entry;
}

test('no .git => state local, nothing created, even when the store sits inside another repo (dotfiles trap)', async () => {
  const { syncPrinciples, isStoreRepo } = await import('../lib/principlesync.mjs');

  const parent = mkdtempSync(join(tmpdir(), 'ac-principles-parent-'));
  git(['init', '--quiet'], { cwd: parent });
  git(['config', 'user.email', 'dotfiles@example.com'], { cwd: parent });
  git(['config', 'user.name', 'dotfiles'], { cwd: parent });
  writeFileSync(join(parent, 'README.md'), '# dotfiles\n');
  git(['add', '-A'], { cwd: parent });
  git(['commit', '--quiet', '-m', 'seed'], { cwd: parent });
  const statusBefore = git(['status', '--porcelain'], { cwd: parent }).stdout;

  const store = join(parent, '.astro', 'principles');
  const entry = mkEntry();
  writeEntry(store, entry);
  assert.equal(existsSync(join(store, '.git')), false);

  const result = await syncPrinciples(store);
  assert.equal(result.state, 'local');
  assert.equal(existsSync(join(store, '.git')), false);
  assert.equal(await isStoreRepo(store), false);

  const statusAfter = git(['status', '--porcelain'], { cwd: parent }).stdout;
  assert.equal(statusAfter, statusBefore, 'the parent repo must see no new/changed files');
});

test('setRemote seeds a fresh bare remote; a second machine setRemote pulls it in via unrelated-history merge', async () => {
  const { setRemote, isStoreRepo } = await import('../lib/principlesync.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a2');
  const entryA = writeEntry(a, mkEntry({ statement: 'always use pnpm, never npm' }));

  await withIdentity('alice', () => setRemote(a, bare));
  assert.equal(await isStoreRepo(a), true);

  const b = mkStoreDir('b2');
  const entryB = writeEntry(b, mkEntry({ statement: 'never mock the database in integration tests' }));
  await withIdentity('bob', () => setRemote(b, bare));

  assert.equal(existsSync(join(b, `${entryA.id}.md`)), true, "B's store must hold A's entry after setRemote");
  assert.equal(existsSync(join(b, `${entryB.id}.md`)), true, "B's own entry must survive the merge");
});

test('entries edited on both machines converge with no conflicts (different files)', async () => {
  const { setRemote, syncPrinciples } = await import('../lib/principlesync.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a3');
  const b = mkStoreDir('b3');
  const shared = writeEntry(a, mkEntry({ statement: 'shared baseline entry' }));

  await withIdentity('alice', () => setRemote(a, bare));
  await withIdentity('bob', () => setRemote(b, bare));

  const entryA2 = writeEntry(a, mkEntry({ statement: 'alice added this one' }));
  const syncA1 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA1.conflicts, []);

  const entryB2 = writeEntry(b, mkEntry({ statement: 'bob added this one' }));
  const syncB1 = await withIdentity('bob', () => syncPrinciples(b));
  assert.deepEqual(syncB1.conflicts, []);

  const syncA2 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA2.conflicts, []);

  for (const id of [shared.id, entryA2.id, entryB2.id]) {
    const fa = readFileSync(join(a, `${id}.md`), 'utf8');
    const fb = readFileSync(join(b, `${id}.md`), 'utf8');
    assert.equal(fa, fb, `entry ${id} must match byte-for-byte on both machines`);
  }
});

test('an unreachable remote reports state unreachable and touches nothing; reconnecting resumes without rewinding the remote tip', async () => {
  const { setRemote, syncPrinciples } = await import('../lib/principlesync.mjs');

  const bareParent = mkdtempSync(join(tmpdir(), 'ac-principles-origin-'));
  const bare = join(bareParent, 'origin.git');
  git(['init', '--quiet', '--bare', bare]);

  const a = mkStoreDir('a4');
  const e1 = writeEntry(a, mkEntry({ statement: 'first entry, before the outage' }));
  await withIdentity('alice', () => setRemote(a, bare));
  const tipBefore = git(['rev-parse', 'main'], { cwd: bare }).stdout.trim();

  const movedAside = join(bareParent, 'moved.git');
  renameSync(bare, movedAside);

  const e2 = writeEntry(a, mkEntry({ statement: 'second entry, written during the outage' }));
  const unreachableResult = await withIdentity('alice', () => syncPrinciples(a));
  assert.equal(unreachableResult.state, 'unreachable');
  assert.equal(existsSync(join(a, `${e1.id}.md`)), true);
  assert.equal(existsSync(join(a, `${e2.id}.md`)), true);
  // the local commit made during the outage must still be there, not discarded
  const localCommits = git(['log', '--oneline'], { cwd: a }).stdout;
  assert.notEqual(localCommits.trim(), '');

  renameSync(movedAside, bare);
  const reconnectResult = await withIdentity('alice', () => syncPrinciples(a));
  assert.equal(reconnectResult.state, 'synced');

  const tipAfter = git(['rev-parse', 'main'], { cwd: bare }).stdout.trim();
  assert.equal(
    gitOk(['merge-base', '--is-ancestor', tipBefore, tipAfter], { cwd: bare }),
    true,
    'the pre-outage remote tip must still be an ancestor of the post-reconnect tip — never rewritten',
  );
});

test('divergent offline edits to the same entry are reported as a conflict, never silently overwritten', async () => {
  const { setRemote, syncPrinciples, openConflicts, resolveConflict } = await import('../lib/principlesync.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a5');
  const b = mkStoreDir('b5');
  const base = writeEntry(a, mkEntry({ statement: 'x: original wording' }));

  await withIdentity('alice', () => setRemote(a, bare));
  await withIdentity('bob', () => setRemote(b, bare));

  const aEdit = writeEntry(a, {
    ...base,
    statement: 'x: alice reworded this',
    history: [{ at: '2026-09-24T09:00:00.000Z', action: 'amended', reason: 'alice offline edit', statement: base.statement, why: base.why }],
  });
  const bEdit = writeEntry(b, {
    ...base,
    statement: 'x: bob reworded this',
    history: [{ at: '2026-09-24T09:05:00.000Z', action: 'amended', reason: 'bob offline edit', statement: base.statement, why: base.why }],
  });

  const syncA = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA.conflicts, []); // alice pushes first, nothing to reconcile yet

  const syncB = await withIdentity('bob', () => syncPrinciples(b));
  assert.equal(syncB.conflicts.length, 1);
  assert.equal(syncB.conflicts[0].id, base.id);

  // bob's own file keeps his version, parses cleanly, no conflict markers
  const bFile = readFileSync(join(b, `${base.id}.md`), 'utf8');
  assert.match(bFile, /^<!-- astro-principle -->/);
  assert.doesNotMatch(bFile, /^(<{7}|={7}|>{7})/m);
  assert.match(bFile, /bob reworded/);

  const bConflictsAfterB = await openConflicts(b);
  assert.equal(bConflictsAfterB.length, 1);
  assert.equal(bConflictsAfterB[0].id, base.id);

  // one more sync on alice's side surfaces the same conflict there too
  const syncA2 = await withIdentity('alice', () => syncPrinciples(a));
  assert.equal(syncA2.conflicts.length, 1);
  const aConflicts = await openConflicts(a);
  assert.equal(aConflicts.length, 1);
  assert.equal(aConflicts[0].id, base.id);

  // resolve both ways
  await withIdentity('bob', () => resolveConflict(b, base.id, { take: 'theirs' }));
  const bResolved = readFileSync(join(b, `${base.id}.md`), 'utf8');
  assert.match(bResolved, /alice reworded/);
  assert.equal((await openConflicts(b)).length, 0);

  await withIdentity('alice', () => resolveConflict(a, base.id, { take: 'mine' }));
  assert.equal((await openConflicts(a)).length, 0);
});

test('a strict-prefix revision (only one side changed) merges silently — no conflict reported', async () => {
  const { setRemote, syncPrinciples } = await import('../lib/principlesync.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a6');
  const b = mkStoreDir('b6');
  const base = writeEntry(a, mkEntry({ statement: 'x: unchanged on bob' }));

  await withIdentity('alice', () => setRemote(a, bare));
  await withIdentity('bob', () => setRemote(b, bare));

  const newer = writeEntry(a, {
    ...base,
    statement: 'x: reworded on alice only',
    history: [{ at: '2026-09-24T09:00:00.000Z', action: 'amended', reason: 'clarify', statement: base.statement, why: base.why }],
  });
  const syncA = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA.conflicts, []);

  const syncB = await withIdentity('bob', () => syncPrinciples(b));
  assert.deepEqual(syncB.conflicts, []);
  const bFile = readFileSync(join(b, `${base.id}.md`), 'utf8');
  assert.match(bFile, /reworded on alice only/);
});

test('C8: sightings recorded on two machines by re-proposing the same entry merge cleanly, no conflict', async () => {
  const { setRemote, syncPrinciples, openConflicts } = await import('../lib/principlesync.mjs');
  const { proposePrinciple } = await import('../lib/principles.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a8');
  const b = mkStoreDir('b8');

  const created = await withIdentity('alice', () => proposePrinciple(a, {
    statement: 'Always use pnpm, never npm.',
    kind: 'pattern',
    why: 'consistent lockfile across the team',
    source: { project: 'origin' },
  }));
  assert.equal(created.created, true);
  const id = created.entry.id;

  await withIdentity('alice', () => setRemote(a, bare));
  await withIdentity('bob', () => setRemote(b, bare));
  assert.equal(existsSync(join(b, `${id}.md`)), true, "bob's store must hold alice's entry after setRemote");

  // Offline from each other: A re-proposes an exact (normalised-equal) variant from
  // project px, B re-proposes another from project py — both should be recorded as
  // sightings on the SAME entry, not new proposals.
  const sightedA = await withIdentity('alice', () => proposePrinciple(a, {
    statement: 'always use pnpm, never npm',
    kind: 'pattern',
    why: 'consistent lockfile across the team',
    source: { project: 'px' },
  }));
  assert.equal(sightedA.sighted, true);
  assert.equal(sightedA.created, false);
  assert.equal(sightedA.matched.id, id);

  const sightedB = await withIdentity('bob', () => proposePrinciple(b, {
    statement: 'ALWAYS USE PNPM, NEVER NPM',
    kind: 'pattern',
    why: 'consistent lockfile across the team',
    source: { project: 'py' },
  }));
  assert.equal(sightedB.sighted, true);
  assert.equal(sightedB.created, false);
  assert.equal(sightedB.matched.id, id);

  const syncA1 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA1.conflicts, []);
  const syncB1 = await withIdentity('bob', () => syncPrinciples(b));
  assert.deepEqual(syncB1.conflicts, []);
  const syncA2 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA2.conflicts, []);

  const fileA = readFileSync(join(a, `${id}.md`), 'utf8');
  const fileB = readFileSync(join(b, `${id}.md`), 'utf8');
  assert.equal(fileA, fileB, 'the entry must be byte-identical on both machines');
  assert.match(fileA, /"project":"px"/);
  assert.match(fileA, /"project":"py"/);
  assert.doesNotMatch(fileA, /^(<{7}|={7}|>{7})/m);

  assert.equal((await openConflicts(a)).length, 0);
  assert.equal((await openConflicts(b)).length, 0);
  assert.equal(existsSync(join(a, 'conflicts')), false);
  assert.equal(existsSync(join(b, 'conflicts')), false);
});

test('C8: one machine accepts while the other sights the same entry offline; both converge accepted with the sighting', async () => {
  const { setRemote, syncPrinciples, openConflicts } = await import('../lib/principlesync.mjs');
  const { proposePrinciple, acceptPrinciple, recordSighting, loadPrinciples } = await import('../lib/principles.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a9');
  const b = mkStoreDir('b9');

  const created = await withIdentity('alice', () => proposePrinciple(a, {
    statement: 'never mock the database in integration tests',
    kind: 'pattern',
    why: 'catches real driver bugs',
    source: { project: 'origin' },
  }));
  const id = created.entry.id;

  await withIdentity('alice', () => setRemote(a, bare));
  await withIdentity('bob', () => setRemote(b, bare));
  assert.equal(existsSync(join(b, `${id}.md`)), true);

  await withIdentity('alice', () => acceptPrinciple(a, id));
  await withIdentity('bob', () => recordSighting(b, id, { source: { project: 'py2', excerpt: 'seen it again here' } }));

  const syncA1 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA1.conflicts, []);
  const syncB1 = await withIdentity('bob', () => syncPrinciples(b));
  assert.deepEqual(syncB1.conflicts, []);
  const syncA2 = await withIdentity('alice', () => syncPrinciples(a));
  assert.deepEqual(syncA2.conflicts, []);

  const fileA = readFileSync(join(a, `${id}.md`), 'utf8');
  const fileB = readFileSync(join(b, `${id}.md`), 'utf8');
  assert.equal(fileA, fileB, 'the entry must be byte-identical on both machines');

  const entryA = loadPrinciples(a).entries.find((e) => e.id === id);
  const entryB = loadPrinciples(b).entries.find((e) => e.id === id);
  assert.equal(entryA.status, 'accepted');
  assert.equal(entryB.status, 'accepted');
  assert.equal((entryA.sightings || []).length, 1);
  assert.equal((entryB.sightings || []).length, 1);

  assert.equal((await openConflicts(a)).length, 0);
  assert.equal((await openConflicts(b)).length, 0);
});

test('a file dropped in by another helper (not syncPrinciples) is committed by the next sync', async () => {
  const { setRemote, syncPrinciples } = await import('../lib/principlesync.mjs');

  const bare = mkBareRemote();
  const a = mkStoreDir('a7');
  writeEntry(a, mkEntry({ statement: 'seed entry' }));
  await withIdentity('alice', () => setRemote(a, bare));

  // simulate e.g. `node -e` writing an entry straight to disk, bypassing any lib helper
  writeEntry(a, mkEntry({ statement: 'written directly to disk by a helper' }));
  const dirtyBefore = git(['status', '--porcelain'], { cwd: a }).stdout;
  assert.notEqual(dirtyBefore.trim(), '');

  const result = await withIdentity('alice', () => syncPrinciples(a));
  assert.equal(result.state, 'synced');
  const dirtyAfter = git(['status', '--porcelain'], { cwd: a }).stdout;
  assert.equal(dirtyAfter.trim(), '');
});
