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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addDecision, canonPull, canonPush, canonDedupe } from '../lib/canon.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const runCli = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

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

// ── t10: CLI-level proof the two runs are distinguishable (D7/C9) ────────────
//
// Both production incidents printed the SAME success line whether a pull changed
// anything or not. These tests exercise `bin/ac.mjs` as a subprocess — never the
// library directly — so a regression that only breaks the CLI's own formatting
// (as opposed to `canonPull`'s return value) is caught here too.
test('CLI: an actual pull and a no-op pull print different output', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(runCli(['canon', 'push'], alice).status, 0);

  const real = runCli(['canon', 'pull'], bob);
  const noop = runCli(['canon', 'pull'], bob);

  assert.equal(real.status, 0);
  assert.equal(noop.status, 0);
  assert.notEqual(real.stdout + real.stderr, noop.stdout + noop.stderr, 'a real pull and a no-op pull must not print the same thing');
  assert.match(real.stdout, /updated/i, 'the real pull must say something changed');
  assert.match(noop.stdout, /already up to date/i, 'the no-op pull must plainly say nothing changed');
  assert.doesNotMatch(noop.stdout, /updated/i, 'a no-op run must never claim anything was updated');
});

// ── t10: a refused pull is distinguishable from BOTH a clean pull and a no-op ──
test('CLI: a refused pull prints output distinct from a clean pull, and both escapes actually resolve it', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(runCli(['canon', 'push'], alice).status, 0);

  const clean = runCli(['canon', 'pull'], bob); // bob's first pull — a real, non-refused update
  assert.equal(clean.status, 0);
  assert.doesNotMatch(clean.stdout, /refused/i);

  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Max 120 lines per file.\n');
  const before = readFileSync(paths(bob).conventions, 'utf8');
  const refused = runCli(['canon', 'pull'], bob);

  assert.notEqual(
    clean.stdout + clean.stderr,
    refused.stdout + refused.stderr,
    'a refusal must not print the same thing as the earlier clean pull',
  );
  assert.match(refused.stdout + refused.stderr, /refused|NOT overwritten/i);
  assert.match(refused.stdout + refused.stderr, /canon push/, 'must name publishing yours as a way out');
  assert.match(refused.stdout + refused.stderr, /--force/, 'must name the explicit force as a way out');
  assert.equal(readFileSync(paths(bob).conventions, 'utf8'), before, 'the refusal must leave the local file untouched');

  // escape (a): the documented force route actually resolves it.
  const forced = runCli(['canon', 'pull', '--force'], bob);
  assert.equal(forced.status, 0);
  assert.equal(readFileSync(paths(bob).conventions, 'utf8'), readFileSync(paths(alice).conventions, 'utf8'));
});

// ── t10: a genuine collision and a duplicate report are each distinguishable
//    from a clean pull ─────────────────────────────────────────────────────
test('CLI: a decision collision and a duplicate report never look like a clean pull', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Use worktrees', why: 'isolation', date: '2026-09-17' });
  assert.equal(a.source, 'remote', a.error || '');
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ${a.id} — Ban worktrees\n_2026-09-17_\n\n**Why:** confusion\n\n`,
  );

  const clean = runCli(['canon', 'pull'], mkWorkdir(bare, 'carol')); // an ordinary clean pull, for comparison
  const collided = runCli(['canon', 'pull'], bob);

  assert.notEqual(clean.stdout + clean.stderr, collided.stdout + collided.stderr);
  assert.match(collided.stdout + collided.stderr, /collision/i);
  assert.match(collided.stdout + collided.stderr, /Use worktrees/);
  assert.match(collided.stdout + collided.stderr, /Ban worktrees/, 'both colliding decisions must be named');

  // a plain duplicate-report run is also distinguishable, and the CLI dedupe verb
  // is what actually reports the removal.
  const dave = mkWorkdir(bare, 'dave');
  writeFileSync(
    paths(dave).decisions,
    '# Decisions\n\n' +
      '## ADR-070 — Never hand-edit state.json\n_2026-09-10_\n\n**Why:** locks\n\n' +
      '## ADR-071 — Never hand-edit state.json\n_2026-09-15_\n\n**Why:** locks\n\n',
  );
  const dupReport = runCli(['canon', 'pull'], dave);
  assert.notEqual(clean.stdout + clean.stderr, dupReport.stdout + dupReport.stderr);
  assert.match(dupReport.stdout + dupReport.stderr, /duplicate/i);

  const dedupe = runCli(['canon', 'dedupe'], dave);
  assert.equal(dedupe.status, 0);
  assert.match(dedupe.stdout, /ADR-070|ADR-071/);
  const noDupes = runCli(['canon', 'dedupe'], dave);
  assert.match(noDupes.stdout, /no exact-duplicate/i);
});

// ── remediation: staleness (nobody edited MY copy) must fast-forward, not refuse ──
//
// The refusal added for C1/D1 compared local against the LIVE registry, which reads
// identically whether local was genuinely EDITED or is simply STALE — the registry
// moved on since this copy's own last successful sync, but nothing here ever touched
// the file. A pull from an unmodified copy stalling on that refusal, with the tool's
// own advertised fix (`ac canon push`) then republishing the stale copy and erasing
// the teammate's edit, is exactly the C2 failure mode.
test('a pull from an unmodified copy fast-forwards past a registry that moved on since its own last sync, and never refuses', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(canonPush(alice).ok, true);

  assert.equal(canonPull(bob).ok, true); // bob syncs, never edits locally afterwards

  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Max 300 lines per file.\n- Prefer pure functions.\n');
  assert.equal(canonPush(bob).ok, true); // the registry has now moved on since alice's last sync

  const res = canonPull(alice); // alice never touched her copy since her own publish

  assert.equal(res.refused.length, 0, 'an unedited copy must never refuse a pull just because the registry moved on');
  assert.equal(res.files['CONVENTIONS.md'].status, 'updated');
  assert.equal(
    readFileSync(paths(alice).conventions, 'utf8'),
    readFileSync(paths(bob).conventions, 'utf8'),
    'alice must fast-forward to the newer registry content',
  );
});

// ── remediation: the same decision under a DIFFERENT id must converge, not duplicate ──
//
// C3's exact reproduction: bob hand-writes the SAME decision alice published, but
// under a DIFFERENT ADR number (not the same id with a dash/date variant, which t5
// already covered) — the ordinary case of two machines that never coordinated
// numbers. `mergeDecisions` only ever compared same-id entries, so this landed as a
// "local-only" preservation (a second copy) instead of a convergence.
test('the same decision hand-written under a DIFFERENT ADR number converges to one entry, not two', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Never hand-edit state.json', why: 'locks', date: '2026-09-10' });
  assert.equal(a.source, 'remote', a.error || '');
  assert.notEqual(a.id, 'ADR-007');

  // bob never pulled — same title/body, but hand-written under a DIFFERENT id, a
  // different date stamp, and a plain hyphen instead of an em dash.
  writeFileSync(
    paths(bob).decisions,
    `# Decisions\n\n## ADR-007 - Never hand-edit state.json\n_2026-09-11_\n\n**Why:** locks\n\n`,
  );
  // a genuinely local-only decision bob has that alice's side has never seen.
  writeFileSync(
    paths(bob).decisions,
    readFileSync(paths(bob).decisions, 'utf8') +
      '\n## ADR-009 — Bob-only decision\n_2026-09-11_\n\n**Why:** local to bob\n\n',
  );

  const res = canonPull(bob);
  assert.deepEqual(res.collisions, [], 'a different-number hand-written copy of the same decision is not a collision');
  assert.deepEqual(res.duplicates, [], 'converging must not leave a duplicate pair behind');
  assert.deepEqual(res.preserved, ['ADR-009'], 'only the genuinely local-only decision is preserved, not the converged one');

  await addDecision(bob, { title: 'Something else' });
  const bobText = readFileSync(paths(bob).decisions, 'utf8');
  assert.equal(
    (bobText.match(/Never hand-edit state\.json/g) || []).length,
    1,
    'exactly one entry for the converged decision on bob\'s side',
  );

  assert.equal(canonPull(alice).ok, true);
  const aliceText = readFileSync(paths(alice).decisions, 'utf8');
  assert.equal(
    (aliceText.match(/Never hand-edit state\.json/g) || []).length,
    1,
    'exactly one entry for the converged decision on alice\'s side too',
  );
});

// ── remediation: an unrelated `decision add` must never republish a STALE copy ──
//
// C7's exact reproduction: bob publishes a newer CONVENTIONS.md; alice's own copy is
// unedited since HER last publish (just behind the registry). Recording an unrelated
// decision compared alice's local copy against the LIVE registry — which now differs
// because bob moved it on, not because alice edited anything — and republished
// alice's stale copy, discarding bob's edit from the registry entirely.
test('recording a decision never republishes a stale CONVENTIONS.md over a teammate\'s newer publish', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Max 300 lines per file.\n');
  assert.equal(canonPush(alice).ok, true); // alice's own last sync — her copy matches the registry

  assert.equal(canonPull(bob).ok, true);
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Max 300 lines per file.\n- Prefer pure functions.\n');
  assert.equal(canonPush(bob).ok, true); // the registry now holds bob's line; alice's copy is merely stale

  const res = await addDecision(alice, { title: 'Unrelated three' });
  assert.equal(res.source, 'remote', res.error || '');
  assert.equal(res.publishedConventions, false, 'alice never edited her copy — recording a decision must not publish it');

  // the registry must still hold bob's line — read it via a fresh clone that has
  // never touched CONVENTIONS.md at all, so its pull reflects the registry exactly.
  const carol = mkWorkdir(bare, 'carol');
  assert.equal(canonPull(carol).ok, true);
  assert.match(
    readFileSync(paths(carol).conventions, 'utf8'),
    /Prefer pure functions/,
    "bob's published line must still be on the registry — alice's stale copy must not have overwritten it",
  );
});

// ── remediation: a LOCAL edit must not clobber a teammate's newer publish either ──
//
// The sibling of the stale case above, and the half C7 still failed on. `editedLocally`
// was the ONLY signal the D3 side-effect publish consulted, so when alice's copy was both
// behind the registry AND edited, a last-writer-wins push sent a file that has never
// contained bob's line over bob's published edit — deleting it, with no ⚠ anywhere and a
// ✓ published line on stdout. Recording a decision must never be a destructive act on a
// file the caller did not mention: the decision is still recorded, the implicit publish
// stops, and the skip is REPORTED (silence is what made both incidents invisible).
test("recording a decision never publishes over a teammate's newer convention edit it has never seen", async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Shared base rule.\n');
  assert.equal(canonPush(alice).ok, true); // alice's last sync == the registry
  assert.equal(canonPull(bob).ok, true); // bob starts in sync with alice

  // bob publishes a convention alice has never seen...
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Shared base rule.\n- BOB: prefer pure functions.\n');
  assert.equal(canonPush(bob).ok, true);

  // ...and alice, still on the old base, edits her own copy and records an unrelated decision.
  const aliceText = '# Conventions\n\n- Shared base rule.\n- ALICE: max 300 lines per file.\n';
  writeFileSync(paths(alice).conventions, aliceText);
  const res = await addDecision(alice, { title: 'Cap file length', why: 'readability' });

  assert.equal(res.source, 'remote', res.error || '');
  assert.ok(res.id, 'the decision itself must still be recorded');
  assert.equal(res.publishedConventions, false, "a publish that would delete bob's line must not happen");
  assert.ok(res.conventionsRefused, 'the skipped publish must be REPORTED, never silent');
  assert.equal(res.conventionsRefused.file, 'CONVENTIONS.md');
  assert.ok(
    res.conventionsRefused.fixes.some((f) => f.includes('canon push')),
    'the report must name how to publish deliberately',
  );
  assert.equal(readFileSync(paths(alice).conventions, 'utf8'), aliceText, "alice's own file is left byte-identical");

  // The registry must still hold bob's line — read through a clone that has never
  // touched CONVENTIONS.md, so its pull reflects the registry exactly.
  const carol = mkWorkdir(bare, 'carol');
  assert.equal(canonPull(carol).ok, true);
  const carolText = readFileSync(paths(carol).conventions, 'utf8');
  assert.match(carolText, /BOB: prefer pure functions/, "bob's published convention must survive alice's add");
  assert.doesNotMatch(carolText, /ALICE: max 300/, "alice's unpublished edit must not have replaced it");
});

// ── remediation: the refused publish is visible at the CLI, not only in the return value ──
test('CLI: an add that skips a clobbering CONVENTIONS.md publish warns on stderr and still records the decision', () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Shared base rule.\n');
  assert.equal(canonPush(alice).ok, true);
  assert.equal(canonPull(bob).ok, true);
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Shared base rule.\n- BOB: prefer pure functions.\n');
  assert.equal(canonPush(bob).ok, true);

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Shared base rule.\n- ALICE: max 300 lines per file.\n');
  const run = runCli(['decision', 'add', 'Cap file length', '--why', 'readability'], alice);

  assert.equal(run.status, 0, run.stderr); // the decision was recorded — only the publish stopped
  assert.match(run.stdout, /✓ ADR-\d+ — Cap file length/);
  assert.doesNotMatch(run.stdout, /published CONVENTIONS\.md/, 'it must not claim a publish that did not happen');
  assert.match(run.stderr, /⚠/, 'the skipped publish must be warned about');
  assert.match(run.stderr, /CONVENTIONS\.md/);
  assert.match(run.stderr, /canon push/, 'the warning must name the deliberate route');
});

// ── 3. The two defects the phase-18 verifier reproduced after the first fixes landed ──
//
// Both were live with a fully green suite, which is the point: the existing tests
// covered only the guarded branch of each path.

// C5 — lib/decisions.mjs `parseDecisions` keyed by id and resolved every lookup to the
// FIRST occurrence, so a second entry under the same id was invisible to the merge and
// was DESTROYED when the merged text was written. Duplicate ids are exactly the state a
// project arrives in after the renumbering bug this phase exists to fix.
test('a second local decision sharing an id is never dropped by a pull — the merge refuses instead', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  const a = await addDecision(alice, { title: 'Use worktrees', why: 'isolated trees', date: '2026-09-10' });
  assert.equal(canonPush(alice).ok, true);
  assert.equal(canonPull(bob).ok, true);

  // bob hand-writes a DIFFERENT decision under the SAME id — the shape ADR-034's own
  // note records agents producing, and the shape a renumber incident leaves behind.
  const bobDecisions = readFileSync(paths(bob).decisions, 'utf8');
  writeFileSync(
    paths(bob).decisions,
    `${bobDecisions.trimEnd()}\n\n## ${a.id} — Ban worktrees\n_2026-09-11_\n\n**Why:** they confuse the integrator\n`,
  );

  const pull = canonPull(bob);
  const after = readFileSync(paths(bob).decisions, 'utf8');

  assert.ok(
    after.includes('Ban worktrees'),
    'the second same-id entry must survive — dropping it is silent data loss',
  );
  assert.ok(after.includes('Use worktrees'), 'the registry entry must survive too');
  assert.ok(
    (pull.collisions || []).some((c) => c.id === a.id && c.kind === 'duplicate-id'),
    'the duplicate id must be surfaced as a collision, not resolved by discarding one side',
  );
});

// C7 — the implicit D3 publish was gated on `registryMoved`, which required a sync
// baseline. A copy that has never pulled or pushed has none, so the guard read false and
// the publish fired unconditionally over a teammate's published copy. Every fresh clone
// starts in that state: `.conventions-synced` is local-only and never committed.
test('a never-synced copy refuses to publish CONVENTIONS.md over a teammate, instead of clobbering it', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');

  // bob publishes a convention. alice has never pulled or pushed, so she has no baseline.
  writeFileSync(paths(bob).conventions, '# Conventions\n\n- Bob rule.\n');
  assert.equal(canonPush(bob).ok, true);

  writeFileSync(paths(alice).conventions, '# Conventions\n\n- Alice rule.\n');
  const res = await addDecision(alice, { title: 'Something unrelated', why: 'nothing to do with conventions', date: '2026-09-20' });

  assert.equal(
    res.publishedConventions,
    false,
    'an unrelated decision must never be the thing that publishes over a teammate',
  );
  assert.ok(res.conventionsRefused, 'the refusal must be reported, not silent');

  // bob's published convention is still the registry's copy, and survives his next pull.
  assert.equal(canonPull(bob).ok, true);
  assert.ok(
    readFileSync(paths(bob).conventions, 'utf8').includes('Bob rule.'),
    "bob's published convention must survive an unrelated decision recorded elsewhere",
  );
});
