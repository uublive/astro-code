// Bugfixes as peers of phases.
//
// The whole point of this object is that a bug does NOT consume milestone
// scope, so most of these tests are about what a fix must NOT touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addFix, acceptFix, setFixStatus, findFix, openFixes, loadFixes,
  fixId, today, FIX_STATUSES, validateFixStatus,
} from '../lib/fixes.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { loadRoadmap } from '../lib/roadmap.mjs';
import { paths } from '../lib/paths.mjs';
import { readContext } from '../hooks/_astro-ctx.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-fix-'));
  initPlanning(root, { name: 'fixdemo' });
  return root;
}
const NOW = new Date('2026-09-17T08:00:00.000Z');

// --- identity -------------------------------------------------------------------

test('a fix id is date-prefixed so it sorts chronologically everywhere', () => {
  assert.equal(fixId('auth 401', NOW), '2026-09-17-auth-401');
  assert.equal(today(NOW), '2026-09-17');
  // ids sort chronologically as plain strings — that is what makes the archive,
  // the registry and `ls` all agree without extra machinery
  const ids = ['2026-01-05-b', '2026-09-17-a', '2025-12-31-c'].sort();
  assert.deepEqual(ids, ['2025-12-31-c', '2026-01-05-b', '2026-09-17-a']);
});

test('a long title is cut on a word boundary, never mid-word or trailing-dash', () => {
  const id = fixId('auth token refresh returns a 401 after the session has been idle', NOW);
  assert.ok(id.length <= 11 + 40, `too long: ${id}`);
  assert.ok(!id.endsWith('-'), 'no trailing dash');
  assert.match(id, /^2026-09-17-/);
});

// --- the core promise: a fix is not milestone scope -----------------------------

test('opening a fix does NOT touch the roadmap or claim a phase number', () => {
  const root = project();
  const before = loadRoadmap(root);
  return addFix(root, { title: 'registry drift', now: NOW }).then(() => {
    const after = loadRoadmap(root);
    assert.deepEqual(after.phases, before.phases, 'no phase was added');
    assert.equal(after.milestone, before.milestone);
    // and the fix is NOT stored in roadmap.json, which is archived per-milestone
    assert.ok(!('fixes' in after), 'fixes must not live in the archived-per-milestone file');
    assert.ok(existsSync(paths(root).fixes), 'they live in their own file');
  });
});

test('a fix has no number — identity is the dated slug alone', async () => {
  const root = project();
  const fix = await addFix(root, { title: 'a bug', now: NOW });
  assert.ok(!('number' in fix), 'numbers coordinate planned scope; a bug is not scope');
  assert.equal(fix.id, '2026-09-17-a-bug');
});

// --- lifecycle ------------------------------------------------------------------

test('the fix lifecycle has a diagnosing step a phase never has', () => {
  assert.deepEqual(FIX_STATUSES, ['open', 'diagnosing', 'executing', 'verified', 'accepted', 'rejected']);
  assert.throws(() => validateFixStatus('complete'),
    /unknown fix status/, 'accepted, not complete — accepting ARCHIVES a fix');
});

test('accepting a fix archives its directory and closes the record', async () => {
  const root = project();
  const fix = await addFix(root, { title: 'auth 401', now: NOW });
  const dir = join(paths(root).fixes_dir, fix.id);
  assert.ok(existsSync(dir));

  await setFixStatus(root, fix.id, 'verified');
  const done = await acceptFix(root, fix.id, { now: NOW });

  assert.equal(done.status, 'accepted');
  assert.ok(done.archived);
  assert.ok(!existsSync(dir), 'the active dir is gone');
  assert.ok(existsSync(join(paths(root).fixes_dir, 'archive', fix.id)), 'it moved to the archive');
  // the RECORD survives: what broke and when is the useful part
  const stored = loadFixes(root).fixes.find((f) => f.id === fix.id);
  assert.equal(stored.status, 'accepted');
  assert.ok(stored.accepted_at, 'and carries when it was closed');
});

test('accepted fixes drop out of the open list but stay in history', async () => {
  const root = project();
  await addFix(root, { title: 'one', now: NOW });
  const two = await addFix(root, { title: 'two', now: new Date('2026-09-18T08:00:00Z') });
  await acceptFix(root, two.id);

  assert.deepEqual(openFixes(root).map((f) => f.title), ['one']);
  assert.equal(loadFixes(root).fixes.length, 2, 'history is never discarded');
});

test('a same-day duplicate is refused loudly, not silently merged', async () => {
  const root = project();
  await addFix(root, { title: 'auth 401', now: NOW });
  await assert.rejects(() => addFix(root, { title: 'auth 401', now: NOW }), /already exists/,
    'two people reporting the same bug should collide, which is how they find each other');
});

test('a fix is findable by id, by bare slug, or by fragment', async () => {
  const root = project();
  const fix = await addFix(root, { title: 'auth token 401', now: NOW });
  assert.equal(findFix(root, fix.id)?.id, fix.id);
  assert.equal(findFix(root, 'auth-token-401')?.id, fix.id, 'without the date prefix');
  assert.equal(findFix(root, '401')?.id, fix.id, 'by fragment');
  assert.equal(findFix(root, 'nothing-like-this'), null);
});

test('a slug or fragment that names more than one fix resolves to nothing, never the first hit (phase 41)', async () => {
  const root = project();
  const mine = await addFix(root, { title: 'sample bug', now: NOW });
  const other = await addFix(root, { title: 'other sample bug', now: NOW });
  assert.equal(findFix(root, 'sample-bug'), null, 'ends both ids: ambiguous');
  assert.equal(findFix(root, 'sample-bug'), null, 'findFix still returns null when ambiguous (phase 46: resolveFix reports why)');
  assert.equal(findFix(root, mine.id)?.id, mine.id, 'the full id still works');
  assert.equal(findFix(root, 'other-sample-bug')?.id, other.id, 'a slug unique to one fix still works');
});

// --- the status line ------------------------------------------------------------

test('an open fix surfaces in the context WITHOUT hiding the phase', async () => {
  const root = project();
  let ctx = readContext(root, 0);
  assert.equal(ctx.fix, null, 'no fix, no noise');

  await addFix(root, { title: 'auth 401', now: NOW });
  ctx = readContext(root, 0);
  assert.equal(ctx.fix.id, '2026-09-17-auth-401');
  assert.equal(ctx.fix.status, 'open');
  assert.equal(ctx.openFixes, 1);
  // a fix INTERRUPTS a phase — the milestone context must still be there
  assert.equal(ctx.milestone, 1, 'the phase context survives the interruption');
});

test('the newest open fix wins, and accepted ones never show', async () => {
  const root = project();
  await addFix(root, { title: 'older', now: new Date('2026-09-01T08:00:00Z') });
  const newer = await addFix(root, { title: 'newer', now: NOW });
  assert.equal(readContext(root, 0).fix.id, newer.id, 'date-sorted, newest first');

  await acceptFix(root, newer.id);
  assert.equal(readContext(root, 0).fix.title, 'older', 'accepted drops out');
});

test('a project with no fixes.json reads cleanly — this is additive', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-nofix-'));
  mkdirSync(join(root, '.astrocode'), { recursive: true });
  const ctx = readContext(root, 0);
  assert.equal(ctx.fix, null);
  assert.equal(ctx.openFixes, 0);
});

test('completing a milestone archives phases and leaves fixes untouched', async () => {
  // The reason fixes live in their own file rather than roadmap.json: that file
  // is archived WHOLESALE into .astrocode/milestones/<N>/, so a fixes array
  // there would be copied into every milestone archive forever — recreating the
  // exact entanglement this object exists to remove.
  const root = project();
  const fix = await addFix(root, { title: 'still open', now: NOW });
  const { completeMilestone } = await import('../lib/milestone.mjs');
  await completeMilestone(root);

  assert.equal(openFixes(root).length, 1, 'an open fix survives a milestone boundary');
  assert.ok(existsSync(join(paths(root).fixes_dir, fix.id)), 'its directory is still live');

  // and the archived roadmap copy carries no trace of it
  const archived = JSON.parse(
    readFileSync(join(paths(root).dir, 'milestones', '1', 'roadmap.json'), 'utf8'));
  assert.ok(!('fixes' in archived), 'the milestone archive is about the milestone only');
});

// --- who signed (ADR-033 parity with phases) ------------------------------------

test('a plain accept records a HUMAN signature', async () => {
  const root = project();
  const fix = await addFix(root, { title: 'a bug', now: NOW });
  const done = await acceptFix(root, fix.id, { by: 'matteo@example.com' });
  assert.equal(done.accepted_kind, 'human');
  assert.equal(done.accepted_by, 'matteo@example.com');
});

test('an agent accepting on the operator\'s behalf must say so', async () => {
  // ADR-033: astro-code cannot tell a human sign-off from a machine one — when
  // the operator accepts, their assistant runs this same command. The record is
  // only honest if the signer declares it. It matters MORE for a bug than a
  // phase: a bug wrongly marked fixed stops being looked for.
  const root = project();
  const fix = await addFix(root, { title: 'a bug', now: NOW });
  const done = await acceptFix(root, fix.id, { agent: 'Claude Opus 5' });
  assert.equal(done.accepted_kind, 'agent');
  assert.equal(done.accepted_by, 'Claude Opus 5');

  const stored = loadFixes(root).fixes.find((f) => f.id === fix.id);
  assert.equal(stored.accepted_kind, 'agent', 'and it survives to the durable record');
});

// --- ADR-074: witnessed evidence on the accept record ----------------------------

test('ADR-074: acceptFix stores accepted_evidence only when given, and it survives a reload', async () => {
  const root = project();
  const a = await addFix(root, { title: 'seen at the composer', now: NOW });
  await acceptFix(root, a.id, { by: 'dev', evidence: 'composer' });
  const kept = loadFixes(root).fixes.find((f) => f.id === a.id);
  assert.equal(kept.accepted_evidence, 'composer');
  assert.equal(kept.accepted_kind, 'human');

  const b = await addFix(root, { title: 'declared only', now: NOW });
  await acceptFix(root, b.id, { by: 'dev' });
  assert.equal('accepted_evidence' in loadFixes(root).fixes.find((f) => f.id === b.id), false);
});

test('ADR-074: acceptFix refuses evidence together with a declared agent', async () => {
  const root = project();
  const a = await addFix(root, { title: 'contradiction', now: NOW });
  await assert.rejects(() => acceptFix(root, a.id, { agent: 'x', evidence: 'composer' }));
  assert.notEqual(loadFixes(root).fixes.find((f) => f.id === a.id).status, 'accepted');
});

// --- phase 46 (C12): an ambiguous slug says so, and accepts nothing ---------------

test('phase 46: the CLI names an ambiguous fix slug instead of saying "no such fix"', async () => {
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const AC = join(fileURLToPath(new URL('..', import.meta.url)), 'bin', 'ac.mjs');
  const root = project();
  const a = await addFix(root, { title: 'foo', now: new Date('2026-10-01T08:00:00Z') });
  const b = await addFix(root, { title: 'foo', now: new Date('2026-10-02T08:00:00Z') });
  const ac = (args) => spawnSync(process.execPath, [AC, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root } });

  const amb = ac(['fix', 'accept', 'foo']);
  assert.notEqual(amb.status, 0);
  assert.equal(amb.stderr.trim().split('\n').length, 1, amb.stderr);
  assert.match(amb.stderr, /ambiguous fix "foo".*matches .*-foo, .*-foo/);
  assert.equal(openFixes(root).length, 2, 'nothing was accepted');

  const none = ac(['fix', 'accept', 'no-such-slug']);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /no such fix/);

  const one = ac(['fix', 'accept', a.id]);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(openFixes(root).map((f) => f.id), [b.id], 'exactly the named fix was accepted');
});

// --- phase 54 t4: a deferred fix carries its link and its reproduction ---------------

test('addFix persists a redacted, truncated repro and deferred_from; a plain addFix is unchanged', async () => {
  const root = project();
  const { deferredFixes } = await import('../lib/fixes.mjs');
  const plain = await addFix(root, { title: 'plain bug', now: NOW });
  const dbPlain = loadFixes(root).fixes.find((f) => f.id === plain.id);
  assert.equal('repro' in dbPlain, false);
  assert.equal('deferred_from' in dbPlain, false);

  const from = { phase: '54-x', criterion: 'C2', run: 3, commit: 'abc1234' };
  const secret = 'token=ghp_' + 'a'.repeat(36);
  const f = await addFix(root, { title: 'deferred: phase 54 C2 — x', report: `cmd\n${secret}\n` + 'z'.repeat(5000), deferredFrom: from, now: NOW });
  const stored = loadFixes(root).fixes.find((x) => x.id === f.id);
  assert.deepEqual(stored.deferred_from, from);
  assert.ok(stored.repro.length <= 4000);
  assert.ok(!stored.repro.includes('ghp_' + 'a'.repeat(36)), 'secret redacted');
  assert.ok(stored.repro.startsWith('cmd'));
  assert.equal(typeof deferredFixes, 'function');
});

test('deferredFixes lists open deferred fixes only, filters by phase, and drops a fix once accepted', async () => {
  const root = project();
  const { deferredFixes } = await import('../lib/fixes.mjs');
  await addFix(root, { title: 'plain', now: NOW });
  const a = await addFix(root, { title: 'deferred a', deferredFrom: { phase: '54-x', criterion: 'C2' }, now: NOW });
  const b = await addFix(root, { title: 'deferred b', deferredFrom: { phase: '55-y', criterion: 'C1' }, now: NOW });
  assert.deepEqual(deferredFixes(root).map((f) => f.id).sort(), [a.id, b.id].sort());
  assert.deepEqual(deferredFixes(root, { phases: ['54-x'] }).map((f) => f.id), [a.id]);
  assert.deepEqual(deferredFixes(root, { phases: [] }), []);
  await acceptFix(root, a.id, { now: NOW, by: 'me' });
  assert.deepEqual(deferredFixes(root).map((f) => f.id), [b.id]);
});
