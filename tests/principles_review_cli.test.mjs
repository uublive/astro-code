// CLI tests for the review surface (P6, D1–D7, ADR-057/058/059) — subprocess-driven
// against a real, isolated store, exactly like tests/principles_cli.test.mjs's harness,
// but every home/store pair below is its own `mkdtempSync` dir and `ASTRO_PRINCIPLES_DIR`
// is always set explicitly (never left to the `$HOME` default), per this task's own
// instruction. None of `match | sight | reopen | merge` exist on `bin/ac.mjs` yet, and
// propose-time dedupe (t7), sightings (t2/t6), `merged` (t3) and the D7 accept fix (t5)
// are not implemented either — so every invocation below currently either dies with
// "unknown: ac principles …" (a non-zero exit from `main()`'s `case 'principles':` final
// `die()`, never a crash) or runs the OLD, pre-dedupe behaviour. This file loads fine and
// simply fails RED until t8/t10/t12 land (ADR-018). Every import here is already-shipped
// (`node:fs`, `node:child_process`, …), so no dynamic import is needed for THIS file,
// matching tests/principles_cli.test.mjs and tests/principles_sync_cli.test.mjs: the CLI
// RED file drives `bin/ac.mjs` as a subprocess, so a missing verb is a non-zero exit, not
// a load crash.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

// ── harness — copied locally, not imported from tests/principles_cli.test.mjs ──────────

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-review-home-'));
}

function mkStore() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-review-store-'));
}

function mkCwd() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-review-cwd-'));
}

function envFor(home, store, extra = {}) {
  const env = {
    ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store,
    GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
  };
  Object.assign(env, extra);
  return env;
}

// Stdin is closed for every call (C11) — `input: ''` never blocks on a TTY-less pipe and
// never lets a prompt hang the test.
function run(args, cwd, home, store, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, input: '', encoding: 'utf8', env: envFor(home, store, extraEnv),
  });
}

function extractId(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\b/);
  return m && m[1];
}

function showJSON(id, home, store, dir) {
  const r = run(['principles', 'show', id, '--json'], dir, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function listJSON(args, home, store, dir) {
  const r = run(['principles', 'list', ...args, '--json'], dir, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function propose(home, store, dir, statement, extra = []) {
  const r = run(['principles', 'add', statement, '--kind', 'preference', '--propose', '--why', 'Seen more than once.', ...extra], dir, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  return { result: r, id: extractId(r.stdout) };
}

function addAccepted(home, store, dir, statement, extra = []) {
  const r = run(['principles', 'add', statement, '--kind', 'pattern', ...extra], dir, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  const id = extractId(r.stdout);
  assert.ok(id, `add must print an id, got: ${r.stdout}`);
  return id;
}

// A phase-22-canonical literal entry file — the exact shape `renderPrinciple` writes on
// `develop` today (no `sighting:`/`merged-into:` keys, header order id, kind, strength,
// status, created). Written straight to disk so C9 can prove old entries still read.
function writeLegacyEntry(store, id, { statement = 'A legacy accepted principle from before this phase', why = 'Recorded before phase 24 shipped.' } = {}) {
  mkdirSync(store, { recursive: true });
  const text = [
    '<!-- astro-principle -->',
    `id: ${id}`,
    'kind: principle',
    'strength: default',
    'status: accepted',
    'created: 2026-01-01T00:00:00.000Z',
    '---',
    '',
    `# ${statement}`,
    '',
    why,
    '',
  ].join('\n');
  writeFileSync(join(store, `${id}.md`), text);
}

// ── C1 — a repeat proposal in the same wording is a sighting, never a second entry ─────

test('C1: re-proposing a normalised-equal statement prints "seen again" and stays one entry with sightingCount 3', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id } = propose(home, store, dir, 'Always use pnpm, never npm, for lockfiles', [
    '--from-project', 'p0', '--excerpt', 'first',
  ]);
  assert.ok(id, 'the first proposal must print an id');

  const variants = [
    ['always use PNPM — never npm for lockfiles.', 'p1'],
    ['Always  use pnpm - never npm, for lockfiles', 'p2'],
    ['always use pnpm, never npm, for lockfiles!', 'p3'],
  ];
  for (const [statement, project] of variants) {
    const r = run([
      'principles', 'add', statement, '--kind', 'preference', '--propose',
      '--why', 'Seen more than once.', '--from-project', project, '--excerpt', `seen via ${project}`,
    ], dir, home, store);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /seen again/, `a repeat must report "seen again": ${r.stdout}`);
  }

  const proposed = listJSON(['--proposed'], home, store, dir);
  assert.strictEqual(proposed.length, 1, 'a repeat must never mint a second proposed entry');
  assert.strictEqual(proposed[0].id, id);
  assert.strictEqual(proposed[0].sightingCount, 3, 'sightingCount counts only the REPEATS, not the original');
});

// ── C3 — a repeat of a REJECTED statement is a sighting, never a re-queue ───────────────

test('C3: `show --json` of a rejected entry reports sightingCount 3, status rejected, and the reason', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id } = propose(home, store, dir, 'Ship on Fridays');
  const reject = run(['principles', 'reject', id, '--reason', 'too risky'], dir, home, store);
  assert.strictEqual(reject.status, 0, reject.stderr);

  for (const project of ['a', 'b', 'c']) {
    const r = run([
      'principles', 'add', 'ship on fridays.', '--kind', 'preference', '--propose',
      '--why', 'Seen more than once.', '--from-project', project,
    ], dir, home, store);
    assert.strictEqual(r.status, 0, r.stderr);
  }

  const proposed = listJSON(['--proposed'], home, store, dir);
  assert.strictEqual(proposed.length, 0, 'a rejected wording must never re-enter the proposed queue');

  const entry = showJSON(id, home, store, dir);
  assert.strictEqual(entry.status, 'rejected');
  assert.match(entry.reason, /too risky/);
  assert.strictEqual(entry.sightingCount, 3);
});

// ── C4 — overlap candidates are surfaced, explainable, deterministic, never acted on ────

test('C4: `match --json` names the overlapping entry and the shared tokens, deterministically', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const acceptedId = addAccepted(home, store, dir, 'Use pnpm for every lockfile in JS repos');

  const overlap = run(['principles', 'match', 'Commit the pnpm lockfile on every dependency change', '--json'], dir, home, store);
  assert.strictEqual(overlap.status, 0, overlap.stderr);
  const overlapAgain = run(['principles', 'match', 'Commit the pnpm lockfile on every dependency change', '--json'], dir, home, store);
  assert.strictEqual(overlapAgain.status, 0, overlapAgain.stderr);
  assert.strictEqual(overlap.stdout, overlapAgain.stdout, 'two runs of match must be byte-identical (no scoring, no timestamps)');

  const parsed = JSON.parse(overlap.stdout);
  const hit = (parsed.overlap || []).find((c) => c.id === acceptedId);
  assert.ok(hit, `the accepted entry must appear as an overlap candidate: ${overlap.stdout}`);
  assert.ok(hit.shared.includes('pnpm'), `shared tokens must include pnpm: ${JSON.stringify(hit.shared)}`);
  assert.ok(hit.shared.includes('lockfile'), `shared tokens must include lockfile: ${JSON.stringify(hit.shared)}`);

  const unrelated = run(['principles', 'match', 'Name tests as full sentences', '--json'], dir, home, store);
  assert.strictEqual(unrelated.status, 0, unrelated.stderr);
  const unrelatedParsed = JSON.parse(unrelated.stdout);
  assert.strictEqual((unrelatedParsed.exact || []).length, 0);
  assert.strictEqual((unrelatedParsed.overlap || []).length, 0);

  // proposing the overlapping statement must remain a distinct proposal — similarity
  // alone never merges or suppresses (ADR-053 precedent).
  const { id: overlapProposedId } = propose(home, store, dir, 'Commit the pnpm lockfile on every dependency change');
  assert.notStrictEqual(overlapProposedId, acceptedId);
  const proposed = listJSON(['--proposed'], home, store, dir);
  assert.ok(proposed.some((e) => e.id === overlapProposedId), 'the overlapping statement must still be queued as its own proposal');

  const textMatch = run(['principles', 'match', 'Commit the pnpm lockfile on every dependency change'], dir, home, store);
  assert.strictEqual(textMatch.status, 0, textMatch.stderr);
  assert.match(textMatch.stdout, /matched on:/);
});

// ── sight — an explicit sighting on a named entry ───────────────────────────────────────

test('`sight <id>` records an explicit sighting and increments sightingCount', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const id = addAccepted(home, store, dir, 'Write tests before code');
  const before = showJSON(id, home, store, dir);
  assert.strictEqual(before.sightingCount || 0, 0);

  const sight = run(['principles', 'sight', id, '--from-project', 'p', '--excerpt', 'e'], dir, home, store);
  assert.strictEqual(sight.status, 0, sight.stderr);

  const after = showJSON(id, home, store, dir);
  assert.strictEqual(after.sightingCount, (before.sightingCount || 0) + 1);
});

// ── C6 — reopen is the only way back from rejected, and it needs a reason ───────────────

test('C6: `reopen` needs a reason, only reverses rejected → proposed, and keeps the rejection in history', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id } = propose(home, store, dir, 'Adopt a monorepo');
  const reject = run(['principles', 'reject', id, '--reason', 'not yet'], dir, home, store);
  assert.strictEqual(reject.status, 0, reject.stderr);

  const noReason = run(['principles', 'reopen', id], dir, home, store);
  assert.notStrictEqual(noReason.status, 0, 'reopen without a reason must be refused');
  assert.strictEqual(showJSON(id, home, store, dir).status, 'rejected', 'a refused reopen changes nothing');

  const reopened = run(['principles', 'reopen', id, '--reason', 'changed my mind'], dir, home, store);
  assert.strictEqual(reopened.status, 0, reopened.stderr);
  const entry = showJSON(id, home, store, dir);
  assert.strictEqual(entry.status, 'proposed');
  assert.strictEqual(entry.id, id, 'reopen keeps the same id — never a copy');
  const historyText = JSON.stringify(entry.history);
  assert.match(historyText, /reopen/i);
  assert.match(historyText, /changed my mind/);
  assert.match(historyText, /not yet/, 'the earlier rejection reason must stay in history');

  const proposed = listJSON(['--proposed'], home, store, dir);
  assert.ok(proposed.some((e) => e.id === id), 'a reopened entry must be back in the proposed queue');

  // reopen is refused on anything that is not rejected
  const acceptedId = addAccepted(home, store, dir, 'Use trunk-based development');
  const badReopenAccepted = run(['principles', 'reopen', acceptedId, '--reason', 'x'], dir, home, store);
  assert.notStrictEqual(badReopenAccepted.status, 0, 'reopen of an accepted entry must be refused');

  const { id: stillProposedId } = propose(home, store, dir, 'Prefer composition over inheritance');
  const badReopenProposed = run(['principles', 'reopen', stillProposedId, '--reason', 'x'], dir, home, store);
  assert.notStrictEqual(badReopenProposed.status, 0, 'reopen of an already-proposed entry must be refused');
});

// ── C7 — merge keeps one survivor, folds evidence, deletes nothing ─────────────────────

test('C7: `merge B --into A` keeps A, folds B\'s evidence in, and B stays citable as merged', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id: idA } = propose(home, store, dir, 'Prefer feature flags to gate risky changes', ['--from-project', 'proj-a']);
  const { id: idB } = propose(home, store, dir, 'Gate risky changes behind feature flags', ['--from-project', 'proj-b']);

  const merge = run(['principles', 'merge', idB, '--into', idA], dir, home, store);
  assert.strictEqual(merge.status, 0, merge.stderr);
  assert.match(merge.stdout, new RegExp(idA), `the report must name what was kept: ${merge.stdout}`);

  const entryB = showJSON(idB, home, store, dir);
  assert.strictEqual(entryB.status, 'merged');
  assert.strictEqual(entryB.mergedInto, idA);

  const entryA = showJSON(idA, home, store, dir);
  assert.strictEqual(entryA.statement, 'Prefer feature flags to gate risky changes', 'the survivor\'s text is untouched');
  assert.ok(entryA.sightingCount >= 1, 'the survivor must gain B\'s evidence as a sighting');

  const proposed = listJSON(['--proposed'], home, store, dir);
  assert.ok(!proposed.some((e) => e.id === idB), 'B must no longer sit in the proposed queue');

  // re-proposing B's exact original wording afterwards lands on the survivor — a merge
  // is not treated as a rejection (D6).
  const reProposeB = run(['principles', 'add', 'Gate risky changes behind feature flags', '--kind', 'preference', '--propose', '--why', 'Seen more than once.'], dir, home, store);
  assert.strictEqual(reProposeB.status, 0, reProposeB.stderr);
  const afterReproposeA = showJSON(idA, home, store, dir);
  assert.ok(afterReproposeA.sightingCount >= 2, 'the redirect must land the new sighting on the survivor A, not B');
});

// ── C10 — an edited acceptance records both the edit and the acceptance ────────────────

test('C10: `accept --statement` records an `edited` history line with the prior text, then `accepted`', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id } = propose(home, store, dir, 'use tabs');
  const accept = run(['principles', 'accept', id, '--statement', 'Use two-space indentation'], dir, home, store);
  assert.strictEqual(accept.status, 0, accept.stderr);

  const entry = showJSON(id, home, store, dir);
  assert.strictEqual(entry.status, 'accepted');
  assert.strictEqual(entry.statement, 'Use two-space indentation');
  const actions = entry.history.map((h) => h.action);
  const editedIdx = actions.indexOf('edited');
  const acceptedIdx = actions.indexOf('accepted');
  assert.ok(editedIdx !== -1, `history must contain an "edited" action: ${JSON.stringify(entry.history)}`);
  assert.ok(acceptedIdx !== -1, `history must contain an "accepted" action: ${JSON.stringify(entry.history)}`);
  assert.ok(editedIdx < acceptedIdx, 'the edit must be recorded before the acceptance');
  assert.match(JSON.stringify(entry.history[editedIdx]), /use tabs/, 'the edited line must carry the PRIOR statement');
});

// ── C11 — the whole review is scriptable, with every datum a reviewer needs ────────────

test('C11: `list --proposed --json` carries statement/why/kind/strength/scopes/source/sightingCount/matches, and `reject` needs a reason', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id: rejectedId } = propose(home, store, dir, 'Deploy directly from a laptop');
  const reject = run(['principles', 'reject', rejectedId, '--reason', 'no audit trail'], dir, home, store);
  assert.strictEqual(reject.status, 0, reject.stderr);

  const { id: overlappingId } = propose(home, store, dir, 'Deploy straight from a personal laptop', [
    '--stack', 'node', '--from-project', 'proj', '--excerpt', 'we did this again',
  ]);
  // a sighting so sightingCount > 0 too
  const sight = run(['principles', 'sight', overlappingId, '--from-project', 'proj2', '--excerpt', 'again'], dir, home, store);
  assert.strictEqual(sight.status, 0, sight.stderr);

  const proposed = listJSON(['--proposed'], home, store, dir);
  const item = proposed.find((e) => e.id === overlappingId);
  assert.ok(item, `the overlapping proposal must be in the queue: ${JSON.stringify(proposed)}`);
  assert.strictEqual(item.statement, 'Deploy straight from a personal laptop');
  assert.ok(item.why, 'why must be present');
  assert.strictEqual(item.kind, 'preference');
  assert.strictEqual(item.strength, 'default');
  assert.ok(item.scopes && Array.isArray(item.scopes.stack), 'scopes must round-trip');
  assert.ok(item.source && item.source.excerpt, 'the source excerpt must be present');
  assert.ok(item.sightingCount >= 1, 'the sighting recorded via `sight` must be counted');
  assert.ok(Array.isArray(item.matches), 'matches must be an array');
  const rejectedMatch = item.matches.find((m) => m.id === rejectedId);
  assert.ok(rejectedMatch, `matches must name the rejected entry: ${JSON.stringify(item.matches)}`);
  assert.strictEqual(rejectedMatch.status, 'rejected');
  assert.match(rejectedMatch.reason, /no audit trail/);

  const rejectNoReason = run(['principles', 'reject', overlappingId], dir, home, store);
  assert.notStrictEqual(rejectNoReason.status, 0, 'reject without a reason must be refused');
});

// ── unknown flags on each new verb die (ADR-029) ────────────────────────────────────────

test('an unknown flag on match/sight/reopen/merge is refused, not silently ignored', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const { id: propId } = propose(home, store, dir, 'A statement to reference in flag checks');

  const cases = [
    ['principles', 'match', 'anything', '--typo-flag', 'oops'],
    ['principles', 'sight', propId, '--typo-flag', 'oops'],
    ['principles', 'reopen', propId, '--reason', 'x', '--typo-flag', 'oops'],
    ['principles', 'merge', propId, '--into', propId, '--typo-flag', 'oops'],
  ];
  for (const args of cases) {
    const r = run(args, dir, home, store);
    assert.notStrictEqual(r.status, 0, `must refuse an unknown flag: ${args.join(' ')}`);
  }
});

// ── C9 — pre-phase entries still read, act on, and get damage-checked correctly ────────

test('C9: a phase-22-canonical entry (no sighting/merged keys) still reads, can be sighted, and out-of-order headers are reported as damage', () => {
  const home = mkHome();
  const store = mkStore();
  const dir = mkCwd();

  const legacyId = '2026-01-01-legacy-canonical-entry-a1b2';
  writeLegacyEntry(store, legacyId);

  const list = run(['principles', 'list', '--all', '--json'], dir, home, store);
  assert.strictEqual(list.status, 0, list.stderr);
  assert.doesNotMatch(list.stderr, /⚠ damaged/, `a canonical legacy entry must never be reported as damaged: ${list.stderr}`);
  const items = JSON.parse(list.stdout);
  assert.ok(items.some((e) => e.id === legacyId), 'the legacy entry must be listed');

  const sight = run(['principles', 'sight', legacyId, '--from-project', 'p', '--excerpt', 'seen again'], dir, home, store);
  assert.strictEqual(sight.status, 0, sight.stderr);

  const entry = showJSON(legacyId, home, store, dir);
  assert.strictEqual(entry.id, legacyId);
  assert.strictEqual(entry.status, 'accepted');
  assert.strictEqual(entry.sightingCount, 1);

  // a hand-mangled header key order — `strength` and `kind` swapped — is damage, not a
  // silent parse.
  const damagedId = '2026-01-01-legacy-damaged-entry-c3d4';
  mkdirSync(store, { recursive: true });
  const mangled = [
    '<!-- astro-principle -->',
    `id: ${damagedId}`,
    'strength: default',
    'kind: principle',
    'status: accepted',
    'created: 2026-01-01T00:00:00.000Z',
    '---',
    '',
    '# An entry with its header keys out of order',
    '',
  ].join('\n');
  writeFileSync(join(store, `${damagedId}.md`), mangled);

  const listAgain = run(['principles', 'list', '--all'], dir, home, store);
  assert.match(listAgain.stdout + listAgain.stderr, /⚠ damaged entry/, 'a hand-mangled header order must be reported as damage');
  assert.match(listAgain.stdout + listAgain.stderr, new RegExp(damagedId));
});
