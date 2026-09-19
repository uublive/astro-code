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
import { addDecision, canonPull, canonPush } from '../lib/canon.mjs';

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
// PHASE-18 REPRODUCTION — asserts the BUG; flipped by t6.
test('PHASE-18 REPRODUCTION: a diverged local CONVENTIONS.md edit is silently clobbered by pull', () => {
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

  // TODAY: bob's diverged edit is gone, replaced by alice's copy, and the call
  // still reports it as a normal successful pull — the exact silent-clobber incident.
  assert.notEqual(after, before, 'BUG: local edit was overwritten');
  assert.equal(after, readFileSync(paths(alice).conventions, 'utf8'), 'BUG: registry copy won silently');
  assert.ok(res.pulled.includes('CONVENTIONS.md'), 'BUG: reported as a plain successful pull, indistinguishable from a clean one');
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
