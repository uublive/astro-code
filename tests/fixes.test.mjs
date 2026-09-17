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
