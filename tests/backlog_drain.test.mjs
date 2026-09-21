// RED: the CLI wiring t7 has not landed yet — the backlog engine (lib/backlog.mjs)
// and the `ac backlog` verb group (t5) both already ship, so every import here is an
// ALREADY-SHIPPED module and this file loads fine (ADR-018). What is missing is the
// status-line segment, the declined-match warning on `ac phase add`, and the
// accept-drain / reject-revert wiring in `bin/ac.mjs` (t7) — so these tests fail RED
// on assertions, never on a module-load crash, driven exactly like
// tests/backlog_cli.test.mjs: a real subprocess against a real scratch project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { initRegistry } from '../lib/registry.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

const run = (args, cwd) =>
  spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-backlog-drain-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: 'backlogdrainproj' });
  return dir;
}

function addBacklog(dir, title) {
  const res = run(['backlog', 'add', title], dir);
  assert.strictEqual(res.status, 0, res.stderr);
}

function backlogIdFor(dir, title) {
  const items = JSON.parse(run(['backlog', 'list', '--all', '--json'], dir).stdout);
  const item = items.find((i) => i.title === title);
  assert.ok(item, `expected a captured item titled "${title}"`);
  return item.id;
}

function claimPhase(dir, name) {
  const before = JSON.parse(run(['registry', 'show'], dir).stdout).claims.length;
  const res = run(['phase', 'add', name], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  const number = Number((res.stdout.match(/phase (\d+)/) || [])[1]);
  assert.ok(Number.isInteger(number), `phase add must report a claimed number: ${res.stdout}`);
  const after = JSON.parse(run(['registry', 'show'], dir).stdout).claims.length;
  assert.strictEqual(after, before + 1, 'phase add must claim exactly one new number');
  return number;
}

// ── C2 — link/drain on accept, revert on reject ──────────────────────────────

test('C2: an item linked to a phase that is accepted leaves the open list and reports absorbed, naming the phase that closed it', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  addBacklog(dir, 'a linked idea that should absorb on acceptance');
  const id = backlogIdFor(dir, 'a linked idea that should absorb on acceptance');

  const number = claimPhase(dir, 'the phase that absorbs the idea');

  const linked = run(['backlog', 'link', id, '--phase', String(number)], dir);
  assert.strictEqual(linked.status, 0, linked.stderr);

  const accepted = run(['phase', 'accept', String(number), '--by', 'v', '--force'], dir);
  assert.strictEqual(accepted.status, 0, accepted.stderr);
  assert.match(accepted.stdout, new RegExp(id), 'the accept output must name the drained backlog item');

  const openAfter = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout);
  assert.ok(!openAfter.some((i) => i.id === id), 'the item must leave the open list once its phase is accepted');

  const shown = JSON.parse(run(['backlog', 'show', id], dir).stdout);
  assert.strictEqual(shown.status, 'absorbed', 'the closed status must be exactly "absorbed"');
  assert.ok(shown.linked_by, 'the record must still name which phase closed it');
});

test('C2: an item linked to a phase that is rejected reverts to open and is then promotable, and an unlinked item is untouched by either', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  addBacklog(dir, 'a linked idea whose phase will be rejected');
  const id = backlogIdFor(dir, 'a linked idea whose phase will be rejected');
  addBacklog(dir, 'an unlinked idea nobody touches');
  const untouchedId = backlogIdFor(dir, 'an unlinked idea nobody touches');

  const number = claimPhase(dir, 'the phase that gets rejected');

  const linked = run(['backlog', 'link', id, '--phase', String(number)], dir);
  assert.strictEqual(linked.status, 0, linked.stderr);

  const rejected = run(['phase', 'reject', String(number), '--reason', 'not the right approach'], dir);
  assert.strictEqual(rejected.status, 0, rejected.stderr);
  assert.match(rejected.stdout, new RegExp(id), 'the reject output must name the reopened backlog item');

  const openAfter = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout);
  assert.ok(openAfter.some((i) => i.id === id), 'the item must be open again after its phase is rejected');

  const untouched = JSON.parse(run(['backlog', 'show', untouchedId], dir).stdout);
  assert.strictEqual(untouched.status, 'open', 'an item never linked to the rejected phase must be untouched');
  assert.strictEqual(untouched.linked_by, undefined);

  // Now promotable — the revert must not have left it stuck in some other state.
  const promoted = run(['backlog', 'promote', id], dir);
  assert.strictEqual(promoted.status, 0, promoted.stderr);
});

// ── C6 — `ac status` tracks the open count, silent at zero, silent when absent ──

test('C6: `ac status` prints no backlog line on an empty backlog, then tracks 3 open down to 1 across an archive and a promotion', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  const empty = run(['status'], dir);
  assert.strictEqual(empty.status, 0, empty.stderr);
  assert.doesNotMatch(empty.stdout, /Backlog:/, 'an empty backlog must print no backlog line');

  addBacklog(dir, 'first tracked idea');
  addBacklog(dir, 'second tracked idea');
  addBacklog(dir, 'third tracked idea');

  const withThree = run(['status'], dir);
  assert.strictEqual(withThree.status, 0, withThree.stderr);
  assert.match(withThree.stdout, /Backlog:.*3 open/, 'the count must be 3 after three captures');

  const firstId = backlogIdFor(dir, 'first tracked idea');
  const archived = run(['backlog', 'archive', firstId, '--kind', 'obsolete', '--reason', 'no longer relevant'], dir);
  assert.strictEqual(archived.status, 0, archived.stderr);

  const secondId = backlogIdFor(dir, 'second tracked idea');
  const promoted = run(['backlog', 'promote', secondId], dir);
  assert.strictEqual(promoted.status, 0, promoted.stderr);

  const withOne = run(['status'], dir);
  assert.strictEqual(withOne.status, 0, withOne.stderr);
  assert.match(withOne.stdout, /Backlog:.*1 open/, 'the count must track down to 1 after an archive and a promotion');
});

test('C6: `ac status` exits 0, prints no backlog line, and prints no error in a project with no backlog.json at all', () => {
  const dir = mkWorkdir(null);
  const res = run(['status'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.doesNotMatch(res.stdout, /Backlog:/, 'a legacy project must print no backlog line');
  assert.strictEqual(res.stderr, '', 'a legacy project with no backlog.json must raise no error');
});

// ── C5 (plan half) — a declined match warns with its reason; obsolete stays silent ──

test('C5 (plan half): `ac phase add` warns with the reason on a name resembling a declined item, and never on an obsolete one, exiting 0 and claiming a phase either way', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  addBacklog(dir, 'switch the queue to batch retries');
  const declinedId = backlogIdFor(dir, 'switch the queue to batch retries');
  const declineRes = run(
    ['backlog', 'archive', declinedId, '--kind', 'declined', '--reason', 'tried this already, made latency worse'],
    dir,
  );
  assert.strictEqual(declineRes.status, 0, declineRes.stderr);

  addBacklog(dir, 'rewrite the onboarding email in markdown');
  const obsoleteId = backlogIdFor(dir, 'rewrite the onboarding email in markdown');
  const obsoleteRes = run(
    ['backlog', 'archive', obsoleteId, '--kind', 'obsolete', '--reason', 'the world moved on'],
    dir,
  );
  assert.strictEqual(obsoleteRes.status, 0, obsoleteRes.stderr);

  const claimsBefore = JSON.parse(run(['registry', 'show'], dir).stdout).claims.length;

  const declinedMatch = run(['phase', 'add', 'switch queue to batch retry'], dir);
  assert.strictEqual(declinedMatch.status, 0, declinedMatch.stderr, 'a declined match must never block phase creation');
  assert.match(declinedMatch.stdout, /⚠/, 'a declined match must be surfaced');
  assert.match(declinedMatch.stdout, /switch the queue to batch retries/, 'the warning must name the declined item');
  assert.match(declinedMatch.stdout, /tried this already, made latency worse/, 'the warning must carry the reason');

  const obsoleteMatch = run(['phase', 'add', 'rewrite the onboarding email in markdown, redux'], dir);
  assert.strictEqual(obsoleteMatch.status, 0, obsoleteMatch.stderr);
  assert.doesNotMatch(obsoleteMatch.stdout, /⚠/, 'an obsolete match must raise no warning at all');

  const claimsAfter = JSON.parse(run(['registry', 'show'], dir).stdout).claims.length;
  assert.strictEqual(claimsAfter, claimsBefore + 2, 'both phase adds must succeed and claim a number, warning or not');
});
