// Decisions get a lifecycle (#36) and a prose-correction path (#35), and the local
// mirror gets a gate (#35). Two developers share one bare registry here, because the
// interesting failures are cross-copy: a revision made by one must reach the other as a
// newer revision, never as the "same id, different text" collision sync refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';
import { transact } from '../lib/shared.mjs';
import { normalizeDecision, decisionStatus, inForceText } from '../lib/decisions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const ac = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function bareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-rev-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}
function dev(bare, name, { init = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `ac-rev-${name}-`));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', `${name}@example.com`], { cwd: dir });
  git(['config', 'user.name', name], { cwd: dir });
  git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  assert.equal(ac(['init', '--name', 'Rev'], dir).status, 0);
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  if (init) assert.equal(ac(['registry', 'init'], dir).status, 0);
  return dir;
}
const local = (dir) => readFileSync(paths(dir).decisions, 'utf8');
const inForce = (dir) => readFileSync(paths(dir).decisionsInForce, 'utf8');
const registry = (dir) => {
  let text = '';
  transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'read' }, (files) => {
    text = files['DECISIONS.md'] || '';
    return { updates: {} };
  });
  return text;
};

// ── #36: supersede / retire ────────────────────────────────────────────────

test('#36: supersede keeps the entry for audit, and agents get a stub naming the successor and date', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['decision', 'add', 'Use a custom folder', '--why', 'old reason'], a).status, 0);
  assert.equal(ac(['decision', 'add', 'Use the standard folder', '--why', 'new reason'], a).status, 0);

  const r = ac(['decision', 'supersede', 'ADR-001', '--by', 'ADR-002', '--reason', 'reversed'], a);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ADR-001 superseded by ADR-002 \[shared: astro-registry\]/);

  for (const text of [local(a), registry(a)]) {
    assert.match(text, /old reason/, 'the full entry stays in the log');
    assert.match(text, /\*\*Status:\*\* superseded by ADR-002 \(\d{4}-\d{2}-\d{2}\) — reversed/);
  }
  const view = inForce(a);
  assert.doesNotMatch(view, /old reason/, 'a superseded body no longer reaches agents');
  assert.match(view, /- ADR-001 — Use a custom folder · superseded by ADR-002 \(\d{4}-\d{2}-\d{2}\)/);
  assert.match(view, /## ADR-002 — Use the standard folder[\s\S]*new reason/);
  assert.match(ac(['decision', 'list'], a).stdout, /Not in force/);
  assert.match(ac(['decision', 'list', '--all'], a).stdout, /old reason/);
});

test('#36: a teammate\'s supersede reaches the other copy as a newer revision, never a collision', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  const b = dev(bare, 'bob');
  assert.equal(ac(['decision', 'add', 'First'], a).status, 0);
  assert.equal(ac(['decision', 'add', 'Second'], a).status, 0);
  assert.equal(ac(['canon', 'pull'], b).status, 0);
  assert.equal(ac(['decision', 'supersede', 'ADR-001', '--by', 'ADR-002'], a).status, 0);

  // bob's copy of ADR-001 is now an older revision: add and pull must both converge
  const add = ac(['decision', 'add', 'Third'], b);
  assert.equal(add.status, 0, `bob's add must not be refused as a collision:\n${add.stderr}`);
  assert.match(local(b), /\*\*Status:\*\* superseded by ADR-002/);
  assert.equal(ac(['canon', 'check'], b).status, 0, 'and bob\'s copy now matches the registry');
});

test('#36: retire needs a reason; revisions refuse nonsense and never double-apply', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['decision', 'add', 'Only'], a).status, 0);
  assert.match(ac(['decision', 'retire', 'ADR-001'], a).stderr, /needs a reason/);
  assert.match(ac(['decision', 'supersede', 'ADR-001', '--by', 'ADR-009'], a).stderr, /no such decision: ADR-009/);
  assert.match(ac(['decision', 'supersede', 'ADR-001', '--by', 'ADR-001'], a).stderr, /cannot supersede itself/);
  assert.equal(ac(['decision', 'retire', 'ADR-001', '--reason', 'moot'], a).status, 0);
  assert.match(ac(['decision', 'retire', 'ADR-001', '--reason', 'again'], a).stderr, /already retired/);
  assert.match(ac(['decision', 'retire', 'ADR-001', '--reasn', 'typo'], a).stderr, /unknown flag/);
  assert.match(inForce(a), /- ADR-001 — Only · retired \(\d{4}-\d{2}-\d{2}\): moot/);
});

test('#36/#45: collapsing the newest duplicate leaves a stub, so its number is never reused', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  const DUP = '# Decisions\n\n## ADR-001 — Keep one copy\n_2026-09-10_\n\n**Why:** because\n\n' +
    '## ADR-002 — Keep one copy\n_2026-09-11_\n\n**Why:** because\n';
  assert.equal(transact(a, { remote: 'origin', branch: 'astro-registry', message: 'plant' }, () => ({ updates: { 'DECISIONS.md': DUP } })).ok, true);
  ac(['canon', 'pull'], a);
  assert.equal(ac(['canon', 'dedupe'], a).status, 0);
  const add = ac(['decision', 'add', 'Another decision'], a);
  assert.match(add.stdout, /ADR-003 — Another decision/, `the collapsed ADR-002 must not be reissued:\n${add.stdout}`);
  assert.match(inForce(a), /- ADR-002 — Keep one copy · duplicate of ADR-001/);
});

// ── #35: amend, recorded commit, canon check ───────────────────────────────

test('#35: amend fixes the prose, keeps id/title/date, records the amendment, and reaches the teammate', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  const b = dev(bare, 'bob');
  assert.equal(ac(['decision', 'add', 'Cite the design doc', '--why', 'see docs/old/design.md'], a).status, 0);
  ac(['canon', 'pull'], b);
  const before = local(a);

  const r = ac(['decision', 'amend', 'ADR-001', '--why', 'see docs/design.md', '--reason', 'the old doc was archived'], a);
  assert.equal(r.status, 0, r.stderr);
  const after = local(a);
  assert.match(after, /## ADR-001 — Cite the design doc\n_\d{4}-\d{2}-\d{2}/, 'same id, same title, date line kept');
  assert.equal(after.match(/^_\d{4}-\d{2}-\d{2}.*_$/m)[0], before.match(/^_\d{4}-\d{2}-\d{2}.*_$/m)[0]);
  assert.match(after, /\*\*Why:\*\* see docs\/design\.md/);
  assert.doesNotMatch(after, /docs\/old/);
  assert.match(after, /_Amended \d{4}-\d{2}-\d{2}: the old doc was archived_/);
  assert.equal(registry(a), after, 'registry and mirror carry the same amended text');

  assert.equal(ac(['canon', 'pull'], b).status, 0);
  assert.match(local(b), /docs\/design\.md/, 'the amendment reaches the other copy as a newer revision');
  assert.equal(ac(['decision', 'add', 'Next'], b).status, 0, 'and does not block its next add');
});

test('#35: amend refuses when the two copies already differ, and when nothing would change', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['decision', 'add', 'Stable', '--why', 'w'], a).status, 0);
  assert.match(ac(['decision', 'amend', 'ADR-001', '--why', 'w', '--reason', 'r'], a).stderr, /nothing to amend/);
  assert.match(ac(['decision', 'amend', 'ADR-001', '--why', 'x'], a).stderr, /needs a reason/);
  // the drift luigi reconciled by hand: a body edited locally, never published
  writeFileSync(paths(a).decisions, local(a).replace('**Why:** w', '**Why:** hand-edited'));
  const r = ac(['decision', 'amend', 'ADR-001', '--why', 'y', '--reason', 'r'], a);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ADR-001 differs between your local DECISIONS\.md and astro-registry — nothing was changed/);
});

test('#35: a new decision records the commit it was made at, and that stamp is not part of its identity', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  const head = git(['rev-parse', '--short', 'HEAD'], { cwd: a }).stdout.trim();
  assert.equal(ac(['decision', 'add', 'Pinned'], a).status, 0);
  assert.match(local(a), new RegExp(`## ADR-001 — Pinned\\n_\\d{4}-\\d{2}-\\d{2} · at ${head}_`));
  // the same decision recorded at two commits on two days is still the same decision
  assert.equal(
    normalizeDecision('## ADR-001 — X\n_2026-09-01 · at abc1234_\n\n**Why:** y'),
    normalizeDecision('## ADR-007 — X\n_2026-09-20 · at def5678_\n\n**Why:** y'),
  );
});

test('#35: `ac canon check` reports per decision, byte-exact, and names the kind', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['decision', 'add', 'One', '--why', 'w'], a).status, 0);
  assert.equal(ac(['decision', 'add', 'Two'], a).status, 0);
  assert.match(ac(['canon', 'check'], a).stdout, /local canon matches astro-registry/);

  writeFileSync(paths(a).decisions, local(a).replace('**Why:** w', '**Why:**  w') + '\n## ADR-009 — Local only\n_2026-09-01_\n');
  const r = ac(['canon', 'check'], a);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /ADR-001: changed body/, 'a whitespace change inside a body is drift');
  assert.match(r.stderr, /ADR-009: missing from the registry/);
  assert.doesNotMatch(r.stderr, /ADR-002/, 'untouched decisions are not named');
  assert.match(ac(['status'], a).stdout, /canon differs from the registry: 2 decision\(s\)/);
});

test('#35: CONVENTIONS.md is one byte-compared file, ignoring only the final newline', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  writeFileSync(paths(a).conventions, '# Conventions\n\n- rule\n');
  assert.equal(ac(['canon', 'push'], a).status, 0);
  writeFileSync(paths(a).conventions, '# Conventions\n\n- rule\n\n\n');
  assert.equal(ac(['canon', 'check'], a).status, 0, 'a trailing-newline difference is not drift');
  writeFileSync(paths(a).conventions, '# Conventions\n\n- rule changed\n');
  assert.match(ac(['canon', 'check'], a).stderr, /CONVENTIONS\.md: differs/);
});

// ── #36: what agents are handed ─────────────────────────────────────────────

test('#36: `ac canon stats` shows the injected size shrinking when a decision is retired', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['decision', 'add', 'Big', '--why', 'x'.repeat(4000)], a).status, 0);
  assert.equal(ac(['decision', 'add', 'Small'], a).status, 0);
  const tokens = (out) => Number(out.match(/≈ ([\d,]+) tokens/)[1].replace(/,/g, ''));
  const before = ac(['canon', 'stats'], a).stdout;
  assert.match(before, /2 in force · 0 superseded · 0 retired/);
  assert.equal(ac(['decision', 'retire', 'ADR-001', '--reason', 'obsolete'], a).status, 0);
  const after = ac(['canon', 'stats'], a).stdout;
  assert.match(after, /1 in force · 0 superseded · 1 retired/);
  assert.ok(tokens(after) < tokens(before) - 800, `retiring a 4 KB decision must shrink the injection:\n${before}\n${after}`);
});

test('#36: the workflows point agents at the in-force view, not the full log', () => {
  for (const f of ['workflows/execute-phase.mjs', 'workflows/plan-phase.mjs', 'agents/astro-criteria-author.md']) {
    const src = readFileSync(join(ROOT, f), 'utf8');
    assert.match(src, /DECISIONS\.in-force\.md/, `${f} must reference the in-force view`);
    assert.match(src, /Not in force/, `${f} must say what the stubs mean`);
  }
});

test('#36: a status line this code did not write never hides a decision', () => {
  assert.deepEqual(decisionStatus('## ADR-001 — X\n_2026-09-01_\n\n**Status:** under review'), { state: 'live' });
  assert.match(inForceText('# Decisions\n\n## ADR-001 — X\n_2026-09-01_\n\n**Status:** under review\n'), /## ADR-001 — X/);
  assert.ok(existsSync(AC));
});

test('#35: the untouched init template is not drift; an edited, never-pushed CONVENTIONS.md is', () => {
  const bare = bareRemote();
  const a = dev(bare, 'alice', { init: true });
  assert.equal(ac(['canon', 'check'], a).status, 0, 'a fresh project is in sync');
  writeFileSync(paths(a).conventions, readFileSync(paths(a).conventions, 'utf8') + '\n- a real rule\n');
  assert.match(ac(['canon', 'check'], a).stderr, /CONVENTIONS\.md: missing from the registry/);
});
