// RED: the CLI surface for the backlog register (ADR-056), driven exactly like
// tests/flags.test.mjs — a real subprocess against a real scratch project, never
// against the engine directly. `ac backlog` does not exist on `bin/ac.mjs` yet
// (t7 wires it), so every invocation below currently dies with "unknown command"
// (a non-zero exit from `main()`'s `default:` case) rather than crashing at module
// load — the imports here are all ALREADY-SHIPPED modules (`lib/git.mjs`,
// `lib/planning.mjs`, `lib/paths.mjs`, `lib/registry.mjs`), so this file loads fine
// and simply fails RED until t7 lands (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { initRegistry } from '../lib/registry.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const STATUSLINE = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');

const run = (args, cwd) =>
  spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-backlog-cli-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: 'backlogcliproj' });
  return dir;
}

// The statusline segment, rendered exactly as tests/statusline.test.mjs does it —
// a real spawn of the shipped hook against a fake Claude stdin blob, pointed at the
// scratch project's `src/` so `findAstroRoot` resolves it.
function statuslineOutput(dir) {
  const home = mkdtempSync(join(tmpdir(), 'ac-backlog-cli-home-'));
  return spawnSync(process.execPath, [STATUSLINE, join(home, '.claude')], {
    input: JSON.stringify({ session_id: 'x', workspace: { current_dir: dir } }),
    env: { ...process.env, HOME: home, NO_COLOR: '1' },
    encoding: 'utf8',
  }).stdout;
}

// ── C1 — capture with no remote, no registry: readable back, roadmap untouched ──

test('C1: two captures in a project with no remote and no registry come back with text intact, distinct ids, and the roadmap untouched', () => {
  const dir = mkWorkdir(null);
  const p = paths(dir);
  const roadmapBefore = readFileSync(p.roadmap, 'utf8');
  // A fresh project has never rendered ROADMAP.md at all — a capture must not be
  // the thing that conjures it into existence, so "byte-identical" means "still
  // absent" when it started absent.
  const roadmapMdExistedBefore = existsSync(p.roadmapMd);
  const roadmapMdBefore = roadmapMdExistedBefore ? readFileSync(p.roadmapMd, 'utf8') : null;

  const a = run(['backlog', 'add', 'batch retries for the webhook queue'], dir);
  assert.strictEqual(a.status, 0, a.stderr);
  const b = run(['backlog', 'add', 'a completely unrelated idea about onboarding'], dir);
  assert.strictEqual(b.status, 0, b.stderr);

  // A SECOND process, so this proves the capture actually persisted to disk.
  const listed = run(['backlog', 'list', '--json'], dir);
  assert.strictEqual(listed.status, 0, listed.stderr);
  const items = JSON.parse(listed.stdout);
  assert.strictEqual(items.length, 2);
  const titles = items.map((i) => i.title).sort();
  assert.deepStrictEqual(titles, [
    'a completely unrelated idea about onboarding',
    'batch retries for the webhook queue',
  ].sort());
  const ids = items.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, 2, 'two distinct ids');

  assert.strictEqual(readFileSync(p.roadmap, 'utf8'), roadmapBefore, 'roadmap.json must be byte-identical');
  if (roadmapMdExistedBefore) {
    assert.strictEqual(readFileSync(p.roadmapMd, 'utf8'), roadmapMdBefore, 'ROADMAP.md must be byte-identical');
  } else {
    assert.strictEqual(existsSync(p.roadmapMd), false, 'capture must not conjure ROADMAP.md into existence');
  }

  // Re-running the listing in a fresh process again returns the same two items.
  const listedAgain = run(['backlog', 'list', '--json'], dir);
  assert.strictEqual(listedAgain.status, 0);
  assert.strictEqual(JSON.parse(listedAgain.stdout).length, 2, 'no vanishing, no duplication on a second listing');
});

// ── C5 (capture half) — a resembling OPEN item warns but never blocks ───────────

test('C5 (capture half): capturing an idea that resembles an open one prints a warning naming it, and still exits 0 with the new item recorded', () => {
  const dir = mkWorkdir(null);
  const first = run(['backlog', 'add', 'switch the queue to batch retries'], dir);
  assert.strictEqual(first.status, 0, first.stderr);

  const second = run(['backlog', 'add', 'switch queue to batch retry'], dir);
  assert.strictEqual(second.status, 0, second.stderr, 'a resemblance must never block capture');
  assert.match(second.stdout, /⚠/, 'the resemblance must be surfaced');
  assert.match(second.stdout, /switch the queue to batch retries/, 'the warning must NAME the resembling item');

  const items = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout);
  assert.strictEqual(items.length, 2, 'the new item is recorded alongside the one it resembles');
});

// ── C4 — archive requires kind + reason; retrievable verbatim; refusals leave it untouched ──

test('C4: an archived item answers "why not" verbatim, and a refused archive leaves the item open and unchanged', () => {
  const dir = mkWorkdir(null);
  const add = run(['backlog', 'add', 'an idea someone might archive'], dir);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout)[0].id;

  const ok = run(['backlog', 'archive', id, '--kind', 'declined', '--reason', 'tried this already, made latency worse'], dir);
  assert.strictEqual(ok.status, 0, ok.stderr);

  const shown = run(['backlog', 'show', id], dir);
  assert.strictEqual(shown.status, 0, shown.stderr);
  const item = JSON.parse(shown.stdout);
  assert.strictEqual(item.archive_kind, 'declined');
  assert.strictEqual(item.archive_reason, 'tried this already, made latency worse');

  const allListed = JSON.parse(run(['backlog', 'list', '--all', '--json'], dir).stdout);
  const fromAll = allListed.find((i) => i.id === id);
  assert.ok(fromAll, 'an archived item must still be visible via `list --all`');
  assert.strictEqual(fromAll.archive_kind, 'declined');
  assert.strictEqual(fromAll.archive_reason, 'tried this already, made latency worse');
});

test('C4: archiving without a reason, without a kind, or with kind "absorbed" each exit non-zero and leave the item open and unchanged', () => {
  const dir = mkWorkdir(null);
  run(['backlog', 'add', 'an item that must not be archived by accident'], dir);
  const id = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout)[0].id;

  const noReason = run(['backlog', 'archive', id, '--kind', 'declined'], dir);
  assert.notStrictEqual(noReason.status, 0, 'a missing reason must refuse');

  const noKind = run(['backlog', 'archive', id, '--reason', 'because'], dir);
  assert.notStrictEqual(noKind.status, 0, 'a missing kind must refuse');

  const absorbedKind = run(['backlog', 'archive', id, '--kind', 'absorbed', '--reason', 'because'], dir);
  assert.notStrictEqual(absorbedKind.status, 0, '"absorbed" is never a human-typed kind');

  const item = JSON.parse(run(['backlog', 'show', id], dir).stdout);
  assert.strictEqual(item.status, 'open', 'every refusal above must have left the item open');
  assert.strictEqual(item.archive_kind, undefined);
  assert.strictEqual(item.archive_reason, undefined);
});

// ── C3 — promotion starts a real, still-undiscussed phase carrying the note ─────

test('C3: promoting an item claims a phase, seeds CONTEXT.md with the captured sentinel, stays "stub", closes the item, and a second promote refuses without claiming a second number', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  const sentinel = 'a sentinel sentence a verifier would recognise';
  const add = run(['backlog', 'add', 'promote this idea', '--note', sentinel], dir);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout)[0].id;

  const before = JSON.parse(run(['registry', 'show'], dir).stdout);
  const claimsBefore = (before.claims || []).length;

  const promoted = run(['backlog', 'promote', id], dir);
  assert.strictEqual(promoted.status, 0, promoted.stderr);
  const number = Number((promoted.stdout.match(/phase (\d+)/) || [])[1]);
  assert.ok(Number.isInteger(number), `promote must report the claimed phase number: ${promoted.stdout}`);

  const after = JSON.parse(run(['registry', 'show'], dir).stdout);
  assert.strictEqual(after.claims.length, claimsBefore + 1, 'promotion must claim exactly one new phase number');

  const rm = JSON.parse(readFileSync(paths(dir).roadmap, 'utf8'));
  const ph = rm.phases.find((p) => p.number === number);
  assert.ok(ph, 'the roadmap must gain the promoted phase');

  const ctxPath = join(paths(dir).phases, ph.slug, 'CONTEXT.md');
  assert.match(readFileSync(ctxPath, 'utf8'), new RegExp(sentinel), 'CONTEXT.md must carry the captured sentinel verbatim');

  const status = run(['phase', 'context', String(number)], dir);
  assert.strictEqual(status.status, 0, status.stderr);
  assert.strictEqual(status.stdout.trim(), 'stub', 'a promoted seed must still owe a real /astro-discuss round');

  const openAfter = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout);
  assert.ok(!openAfter.some((i) => i.id === id), 'the promoted item must leave the open list');

  const again = run(['backlog', 'promote', id], dir);
  assert.notStrictEqual(again.status, 0, 'a second promote of the same id must refuse');
  const afterSecond = JSON.parse(run(['registry', 'show'], dir).stdout);
  assert.strictEqual(afterSecond.claims.length, after.claims.length, 'a refused second promote must claim no second number');
});

// ── C7 — ideas stay out of debt, debt score, and the statusline ─────────────────

test('C7: debt score --json, debt list --json, and the statusline segment are byte-identical before and after capturing 5 items and archiving 1', () => {
  const dir = mkWorkdir(null);

  const scoreBefore = run(['debt', 'score', '--json'], dir).stdout;
  const listBefore = run(['debt', 'list', '--json'], dir).stdout;
  const statuslineBefore = statuslineOutput(dir);

  for (let i = 0; i < 5; i += 1) {
    const res = run(['backlog', 'add', `idea number ${i} about something unrelated`], dir);
    assert.strictEqual(res.status, 0, res.stderr);
  }
  const id = JSON.parse(run(['backlog', 'list', '--json'], dir).stdout)[0].id;
  const archived = run(['backlog', 'archive', id, '--kind', 'obsolete', '--reason', 'the world moved on'], dir);
  assert.strictEqual(archived.status, 0, archived.stderr);

  const scoreAfter = run(['debt', 'score', '--json'], dir).stdout;
  const listAfter = run(['debt', 'list', '--json'], dir).stdout;
  const statuslineAfter = statuslineOutput(dir);

  assert.strictEqual(scoreAfter, scoreBefore, '`ac debt score --json` must be untouched by backlog activity');
  assert.strictEqual(listAfter, listBefore, '`ac debt list --json` must be untouched by backlog activity');
  assert.strictEqual(statuslineAfter, statuslineBefore, 'the statusline must render identically — no backlog segment exists (out of scope)');

  const item = JSON.parse(run(['backlog', 'show', id], dir).stdout);
  assert.strictEqual(item.priority, undefined);
  assert.strictEqual(item.rank, undefined);
  assert.strictEqual(item.score, undefined);
});

// `ac backlog note` — the CLI half of setBacklogNote.
test('ac backlog note reads, writes and clears; the title is never editable', async () => {
  const root = mkWorkdir();
  run(['backlog', 'add', 'An idea to refine', '--note', 'first pass'], root);
  const id = JSON.parse(run(['backlog', 'list', '--json'], root).stdout)[0].id;

  // READ
  const read = run(['backlog', 'note', id], root);
  assert.equal(read.status, 0, read.stderr);
  assert.match(read.stdout, /first pass/);

  // WRITE
  assert.equal(run(['backlog', 'note', id, 'sharper second pass'], root).status, 0);
  assert.match(run(['backlog', 'note', id], root).stdout, /sharper second pass/);
  assert.doesNotMatch(run(['backlog', 'note', id], root).stdout, /first pass/);

  // CLEAR
  assert.equal(run(['backlog', 'note', id, ''], root).status, 0);
  assert.equal(run(['backlog', 'note', id], root).stdout.trim(), '');

  // the title survives all of it — it seeds the id and the declined-match check
  const after = JSON.parse(run(['backlog', 'list', '--json'], root).stdout)[0];
  assert.equal(after.title, 'An idea to refine');
  assert.equal(after.id, id);
});

test('ac backlog note refuses an archived item and leaves it untouched', async () => {
  const root = mkWorkdir();
  run(['backlog', 'add', 'Doomed idea', '--note', 'original'], root);
  const id = JSON.parse(run(['backlog', 'list', '--json'], root).stdout)[0].id;
  run(['backlog', 'archive', id, '--kind', 'declined', '--reason', 'we chose otherwise'], root);

  const res = run(['backlog', 'note', id, 'rewritten after the fact'], root);
  assert.notEqual(res.status, 0, 'a closed record must not be editable');

  const after = JSON.parse(run(['backlog', 'list', '--all', '--json'], root).stdout)[0];
  assert.equal(after.note, 'original');
  assert.equal(after.archive_reason, 'we chose otherwise');
});

// #62 — `ac backlog note` with an unknown id crashed on a null item; it now refuses like
// show/link/promote/archive do.
test('#62: `ac backlog note` on an unknown id refuses instead of crashing', () => {
  const dir = mkWorkdir(null);
  assert.equal(run(['backlog', 'add', 'Idea one', '--note', 'n'], dir).status, 0);
  for (const args of [['backlog', 'note', 'nope'], ['backlog', 'note', 'nope', 'x']]) {
    const res = run(args, dir);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /no such backlog item: nope/);
    assert.doesNotMatch(res.stderr, /Cannot read properties/);
  }
});

// #63 — `ac backlog note` checked no flags: a typo was accepted, and `--note` (the flag
// `backlog add` takes) turned an attempted write into a silent read.
test('#63: `ac backlog note` rejects unknown flags, and --note is refused with the right form', () => {
  const dir = mkWorkdir(null);
  assert.equal(run(['backlog', 'add', 'Idea one', '--note', 'original'], dir).status, 0);
  const id = JSON.parse(readFileSync(join(paths(dir).dir, 'backlog.json'), 'utf8')).backlog[0].id;

  const typo = run(['backlog', 'note', id, 'rewritten', '--typo'], dir);
  assert.notEqual(typo.status, 0);
  assert.match(typo.stderr, /unknown flag for `ac backlog note`: --typo/);

  const viaFlag = run(['backlog', 'note', id, '--note', 'via a flag'], dir);
  assert.notEqual(viaFlag.status, 0, 'an attempted write must not exit 0 as a read');
  assert.match(viaFlag.stderr, /takes the text as an argument, not --note/);
  assert.match(viaFlag.stderr, new RegExp(`ac backlog note ${id} "<text>"`));

  assert.equal(run(['backlog', 'note', id], dir).stdout.trim(), 'original', 'neither call changed the note');
  assert.equal(run(['backlog', 'note', id, 'rewritten'], dir).status, 0, 'the documented form still writes');
  assert.equal(run(['backlog', 'note', id], dir).stdout.trim(), 'rewritten');
});
