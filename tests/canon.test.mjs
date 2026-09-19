// Phase 18 — reproductions of the two production incidents against a REAL bare
// remote (never stubs; CONVENTIONS.md "Testing"). Each test asserts today's WRONG
// behaviour so the fix (t5/t6) can flip it in place and "reproduced before fixed"
// is a fact in the commit history, not a claim.
//
// Harness copied from `tests/registry.test.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addDecision, canonPull, canonPush, canonDedupe } from '../lib/canon.mjs';

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

// ── 1. CONVENTIONS clobber — lib/canon.mjs canonPull, the unconditional
//    `writeFileSync(p.conventions, …)` (no comparison, no notion of "local-only") ──
//
// FIXED by t6 (D1/D7): a diverged CONVENTIONS.md is left byte-identical and the pull
// REFUSES, naming both supported ways out. `force: true` is the only way past it other
// than publishing first.
test('a diverged local CONVENTIONS.md edit refuses a pull, and force replaces it', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  const push = canonPush(alice);
  assert.equal(push.ok, true, push.error || '');

  // bob syncs once so his copy matches the registry...
  const firstPull = canonPull(bob);
  assert.equal(firstPull.ok, true);

  // ...then diverges deliberately.
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Max 120 lines per file.\n');
  const before = readFileSync(paths(bob).conventions, 'utf8');

  const res = canonPull(bob);
  const after = readFileSync(paths(bob).conventions, 'utf8');

  // Bob's diverged edit survives byte-for-byte, and the refusal is reported per file —
  // never indistinguishable from a clean pull (D7).
  assert.equal(after, before, "bob's local edit must be left byte-identical");
  assert.notEqual(after, readFileSync(paths(alice).conventions, 'utf8'), 'the registry copy must not win silently');
  assert.ok(!res.pulled.includes('CONVENTIONS.md'), 'a refusal must not be reported as pulled');
  assert.equal(res.files['CONVENTIONS.md'].status, 'refused');
  assert.equal(res.refused.length, 1);
  assert.equal(res.refused[0].file, 'CONVENTIONS.md');
  assert.ok(res.refused[0].fixes.some((f) => f.includes('canon push')), 'must name publishing yours as a way out');
  assert.ok(res.refused[0].fixes.some((f) => f.includes('--force')), 'must name the explicit force as a way out');

  // The explicit force route actually resolves the refusal.
  const forced = canonPull(bob, { force: true });
  assert.ok(forced.pulled.includes('CONVENTIONS.md'), 'a forced pull must replace the local copy');
  assert.equal(
    readFileSync(paths(bob).conventions, 'utf8'),
    readFileSync(paths(alice).conventions, 'utf8'),
    'force must take the registry copy',
  );
});

// ── 2. ADR-142 false positive, DASH VARIANT — lib/canon.mjs's old private `norm()`
//    stripped only an em dash (`—?`), so a plain-hyphen heading of the SAME decision
//    normalized differently and was treated as a genuine collision ──
//
// FIXED by t5: `mergeDecisions` now routes through `lib/decisions.mjs`'s
// `sameDecision`, whose dash class tolerates em dash, en dash and plain hyphen alike.
// This is the variant that actually reproduced (see commit message).
test('the same decision recorded with a hyphen instead of an em dash converges to one entry on pull', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Cap file length', why: 'readability', date: '2026-09-18' });
  assert.equal(a.source, 'remote', a.error || '');

  // bob never pulled — he wrote the SAME decision by hand, same id, same body,
  // but with a plain hyphen where the registry copy has an em dash.
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} - Cap file length\n_2026-09-18_\n\n**Why:** readability\n\n`
  );

  const res = canonPull(bob);
  const ids = [...readFileSync(paths(bob).decisions, 'utf8').matchAll(/^##\s+(ADR-\d+)/gm)].map((m) => m[1]);

  assert.equal(ids.length, 1, 'the same decision, differing only by dash style, must converge to one entry');
  assert.deepEqual(res.collisions, [], 'a dash-style difference must never be reported as a collision');
});

// ── 3. ADR-142 false positive, DATE STAMP ONLY — `buildDecision` stamps a
//    `_date_` line into the body and the old `norm()` never excluded it ──
//
// FIXED by t5: `normalizeDecision` (lib/decisions.mjs) strips the `_YYYY-MM-DD_`
// line as its own anchored step, so the same decision recorded on two machines on
// two different days converges instead of colliding.
test('the same decision recorded on two machines on different days converges to one entry on pull', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Never hand-edit state.json', why: 'locks', date: '2026-09-17' });
  assert.equal(a.source, 'remote', a.error || '');

  // bob never pulled — same id, same title/body, identical em-dash heading style,
  // ONLY the date stamp differs (a second machine recording it a day later).
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} — Never hand-edit state.json\n_2026-09-18_\n\n**Why:** locks\n\n`
  );

  const res = canonPull(bob);
  const ids = [...readFileSync(paths(bob).decisions, 'utf8').matchAll(/^##\s+(ADR-\d+)/gm)].map((m) => m[1]);

  assert.equal(ids.length, 1, 'the same decision, differing only by recording date, must converge to one entry');
  assert.deepEqual(res.collisions, [], 'a date-stamp-only difference must never be reported as a collision');
});

// ── 4. Silent renumbering — a genuine same-id/different-content collision was
//    "resolved" by moving the local entry to a fresh id instead of surfacing the
//    conflict (the third open debt item this phase closes) ──
//
// FIXED by t5 (D5): a genuine collision REFUSES — nothing is renumbered, nothing is
// moved, and the heading set on both sides is unchanged. The collision is reported
// naming both decisions instead.
test('a genuine same-id collision refuses instead of renumbering, and the heading set is unchanged', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Use worktrees', why: 'isolation', date: '2026-09-17' });
  assert.equal(a.source, 'remote', a.error || '');

  // bob never pulled — a GENUINELY different decision landed locally under the
  // same id (the true collision case, not a formatting artifact).
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} — Ban worktrees\n_2026-09-17_\n\n**Why:** confusion\n\n`
  );
  const before = readFileSync(paths(bob).decisions, 'utf8');

  const res = canonPull(bob);
  const after = readFileSync(paths(bob).decisions, 'utf8');
  const ids = [...after.matchAll(/^##\s+(ADR-\d+)/gm)].map((m) => m[1]);

  assert.equal(after, before, 'DECISIONS.md must be left byte-identical on a genuine collision');
  assert.equal(ids.length, 1, 'no new ADR-0NN heading may appear — nothing is renumbered or moved');
  assert.equal(ids[0], a.id, 'the id must not change');
  assert.equal(res.collisions.length, 1, 'the collision must be reported, not silently resolved');
  assert.equal(res.collisions[0].id, a.id);
  assert.equal(res.collisions[0].kind, 'independent', 'different titles on each side — not the same-title edit case');
  assert.equal(res.collisions[0].localTitle, 'Ban worktrees');
  assert.equal(res.collisions[0].remoteTitle, 'Use worktrees');
});

// ── t6: the untouched scaffold is adopted, not refused ────────────────────────
//
// Without this, D1's refusal fires on the FIRST pull of every fresh clone (the
// unedited templates/CONVENTIONS.md "differs from the registry" just as genuinely as
// a real edit does) — worse than the clobber bug it replaces.
test('the untouched CONVENTIONS.md scaffold is adopted on pull rather than refused', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob'); // bob never edits his scaffold at all

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(canonPush(alice).ok, true);

  const res = canonPull(bob);

  assert.equal(res.files['CONVENTIONS.md'].status, 'updated', 'the untouched scaffold must be adopted, not refused');
  assert.equal(res.refused.length, 0);
  assert.equal(readFileSync(paths(bob).conventions, 'utf8'), readFileSync(paths(alice).conventions, 'utf8'));
});

// ── t6: per-file reporting distinguishes "nothing changed" from "I wrote something" ──
test('a no-op pull reports both files as unchanged, per file (D7)', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');

  const bob = mkWorkdir(bare, 'bob');
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(canonPush(bob).ok, true);
  await addDecision(bob, { title: 'Keep the registry authoritative' }); // mirrors DECISIONS.md locally too

  // alice has never touched either file, so her first pull actually writes both.
  const first = canonPull(alice);
  assert.equal(first.files['CONVENTIONS.md'].status, 'updated');
  assert.equal(first.files['DECISIONS.md'].status, 'updated');

  const second = canonPull(alice);
  assert.equal(second.files['CONVENTIONS.md'].status, 'unchanged');
  assert.equal(second.files['DECISIONS.md'].status, 'unchanged');
  assert.deepEqual(second.pulled, [], 'a no-op pull must not claim anything was pulled');
  assert.ok(second.unchanged.includes('CONVENTIONS.md'));
  assert.ok(second.unchanged.includes('DECISIONS.md'));
});

// ── t7: `ac decision add` also publishes CONVENTIONS.md (D3) ─────────────────
//
// FIXES the root cause of the "nothing publishes CONVENTIONS.md" incident: a local
// edit made without `ac canon push` used to sit unpublished forever, so the next
// unrelated `decision add` elsewhere plus a `canon pull` reverted it.
test('recording a decision also publishes a locally-edited CONVENTIONS.md', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  // alice edits CONVENTIONS.md but never runs `ac canon push` — the exact gap D3 closes.
  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  const res = await addDecision(alice, { title: 'Cap file length', why: 'readability' });
  assert.equal(res.source, 'remote', res.error || '');
  assert.equal(res.publishedConventions, true, 'the edited CONVENTIONS.md must be published as a side effect');

  // bob, who never touched CONVENTIONS.md, now receives alice's edit on pull.
  const pull = canonPull(bob);
  assert.equal(pull.files['CONVENTIONS.md'].status, 'updated');
  assert.equal(readFileSync(paths(bob).conventions, 'utf8'), readFileSync(paths(alice).conventions, 'utf8'));

  // a second, convention-unrelated add does NOT republish an unchanged file.
  const res2 = await addDecision(alice, { title: 'Something unrelated' });
  assert.equal(res2.publishedConventions, false, 'an unchanged CONVENTIONS.md is not republished');
});

// ── t7: `ac decision add` refuses on a genuine same-id collision ─────────────
test('decision add refuses when a local entry collides with a different registry decision', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Use worktrees', why: 'isolation', date: '2026-09-17' });
  assert.equal(a.source, 'remote', a.error || '');

  // bob never pulled — a genuinely DIFFERENT decision lives locally under the same id.
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} — Ban worktrees\n_2026-09-17_\n\n**Why:** confusion\n\n`,
  );
  const before = readFileSync(paths(bob).decisions, 'utf8');

  const res = await addDecision(bob, { title: 'Unrelated new decision' });
  const after = readFileSync(paths(bob).decisions, 'utf8');

  assert.equal(res.ok, false);
  assert.equal(res.refused, 'decision-collision');
  assert.equal(res.collisions.length, 1);
  assert.equal(res.collisions[0].id, a.id);
  assert.equal(res.collisions[0].kind, 'independent');
  assert.equal(after, before, 'nothing may be renumbered or moved on a refusal');
});

// ── t7: `ac decision add` refuses when a published decision was edited locally ──
test('decision add refuses when a locally-edited published decision collides with its own registry copy', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Registry is CAS-based', why: 'content addressing', date: '2026-09-17' });
  assert.equal(a.source, 'remote', a.error || '');
  assert.equal(canonPull(bob).ok, true);

  // bob edits the BODY of the already-published decision, keeping id and title.
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} — Registry is CAS-based\n_2026-09-17_\n\n**Why:** something else entirely\n\n`,
  );

  const res = await addDecision(bob, { title: 'Unrelated two' });

  assert.equal(res.ok, false);
  assert.equal(res.refused, 'decision-collision');
  assert.equal(res.collisions.length, 1);
  assert.equal(res.collisions[0].id, a.id);
  assert.equal(res.collisions[0].kind, 'edited-published', 'same title on both sides — an edit, not an independent clash');
});

// ── t8: already-duplicated canon is reported on every sync, collapsed only on request ──
test('a pre-existing duplicate pair is reported on every pull, and only collapsed by the explicit repair', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(canonPush(alice).ok, true);

  // bob already has a content-identical duplicate pair on disk — different numbers and
  // date stamps, same title and body — planted directly (not via `decision add`).
  writeFileSync(
    paths(bob).decisions,
    '# Decisions\n\n' +
      '## ADR-001 — Never hand-edit state.json\n_2026-09-10_\n\n**Why:** locks\n\n' +
      '## ADR-002 — Never hand-edit state.json\n_2026-09-15_\n\n**Why:** locks\n\n',
  );

  const first = canonPull(bob);
  assert.equal(first.duplicates.length, 1, 'a plain sync must report the pre-existing duplicate pair');
  assert.deepEqual(first.duplicates[0].ids.sort(), ['ADR-001', 'ADR-002']);
  let onDisk = readFileSync(paths(bob).decisions, 'utf8');
  assert.equal((onDisk.match(/^##\s+ADR-00[12]\b/gm) || []).length, 2, 'a plain sync must not collapse anything');

  // detection is not one-shot — a second sync reports it again.
  const second = canonPull(bob);
  assert.equal(second.duplicates.length, 1, 'duplicate detection must not be one-shot');

  // the explicit repair verb collapses it.
  const repaired = canonDedupe(bob);
  assert.equal(repaired.ok, true);
  assert.equal(repaired.removed.length, 1);
  assert.equal(repaired.removed[0].keptId, 'ADR-001', 'the lowest-numbered id survives');
  assert.equal(repaired.removed[0].id, 'ADR-002');
  onDisk = readFileSync(paths(bob).decisions, 'utf8');
  assert.equal((onDisk.match(/^##\s+ADR-00[12]\b/gm) || []).length, 1, 'exactly one of the pair remains');
  assert.match(onDisk, /Never hand-edit state\.json/, "the survivor's body is intact");
});

// ── t8: near-duplicates are never collapsed, by pull OR by the explicit repair ──
test('near-duplicate decisions survive both a pull and the explicit repair verb', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  await addDecision(alice, { title: 'Unrelated decision', why: 'keeps the registry non-empty' });

  writeFileSync(
    paths(bob).decisions,
    '# Decisions\n\n' +
      '## ADR-011 — Use locks\n_2026-09-10_\n\n**Why:** locks prevent races\n\n' +
      '## ADR-012 — Use locks\n_2026-09-15_\n\n**Why:** locks prevent retries\n\n',
  );

  canonPull(bob);
  let onDisk = readFileSync(paths(bob).decisions, 'utf8');
  assert.match(onDisk, /locks prevent races/, 'a plain sync must never collapse a near-duplicate');
  assert.match(onDisk, /locks prevent retries/);

  const repaired = canonDedupe(bob);
  assert.equal(repaired.removed.length, 0, 'a single meaningful word difference must never be collapsed');
  onDisk = readFileSync(paths(bob).decisions, 'utf8');
  assert.match(onDisk, /locks prevent races/);
  assert.match(onDisk, /locks prevent retries/);
});
