// The roadmap and the shared registry both record which milestone a phase belongs to,
// and several commands used to update only one of them. These pin the reconciliation,
// each following the clean-fixture reproduction in its issue:
//
//   #32  `ac phase milestone` moves the registry claim too (or refuses, or says it is
//        local-only); `ac debt pay --as phase --milestone N`; `ac status` reports drift.
//   #29  `ac milestone complete` gates on, and archives, only the closing milestone's
//        own phases — later-milestone phases stay scheduled.
//   #45  `ac canon dedupe` collapses the registry's DECISIONS.md too, so neither a pull
//        nor the next `decision add` brings the duplicate back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON } from '../lib/util.mjs';
import { readRegistry } from '../lib/registry.mjs';
import { transact } from '../lib/shared.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function fixture({ remote = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-msync-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  assert.equal(ac(['init', '--name', 'Fixture'], dir).status, 0);
  if (remote) {
    const bare = mkdtempSync(join(tmpdir(), 'ac-msync-origin-')) + '/origin.git';
    git(['init', '--quiet', '--bare', bare]);
    git(['remote', 'add', 'origin', bare], { cwd: dir });
    git(['push', '--quiet', '-u', 'origin', 'main'], { cwd: dir });
    const init = ac(['registry', 'init'], dir);
    assert.equal(init.status, 0, init.stderr);
  }
  return dir;
}

// #37 — work can only target a claimed milestone now: declare 2..n as planned, the way a
// user schedules ahead (the fixture's registry init claims milestone 1).
function planUpTo(dir, n) {
  for (let m = 2; m <= n; m++) {
    const r = ac(['milestone', 'new', '--planned', '--name', `M${m}`], dir);
    assert.equal(r.status, 0, r.stderr);
  }
}

const phaseClaim = (dir, n) =>
  readRegistry(dir).registry.claims.find((c) => c.type === 'phase' && c.number === n);
const roadmapPhase = (dir, n) => readJSON(paths(dir).roadmap).phases.find((p) => p.number === n);

// ── #32: the move case ───────────────────────────────────────────────────────

test('#32: `ac phase milestone` moves the registry claim along with the roadmap', () => {
  const dir = fixture();
  assert.equal(ac(['phase', 'add', 'A phase misfiled under M1', '--milestone', '1'], dir).status, 0);
  assert.equal(phaseClaim(dir, 1).milestone, 1);
  planUpTo(dir, 3);

  const r = ac(['phase', 'milestone', '1', '3'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /registry claim moved: milestone 1 → 3/);
  assert.equal(roadmapPhase(dir, 1).milestone, 3);
  assert.equal(phaseClaim(dir, 1).milestone, 3, 'the claim must follow the roadmap');
  assert.doesNotMatch(ac(['status'], dir).stdout, /⚠ phase 1 is milestone/, 'no drift after a sanctioned move');
});

test('#32: an unreachable registry refuses the move and changes nothing', () => {
  const dir = fixture();
  assert.equal(ac(['phase', 'add', 'p', '--milestone', '1'], dir).status, 0);
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-msync-gone', 'missing.git')], { cwd: dir });

  const r = ac(['phase', 'milestone', '1', '3'], dir);
  assert.notEqual(r.status, 0, 'a half move must not report success');
  assert.match(r.stderr, /cannot reach/);
  assert.match(r.stderr, /nothing was changed/);
  assert.equal(roadmapPhase(dir, 1).milestone, 1, 'the roadmap must not move without the claim');
});

test('#32: with no shared registry the move is local and says so', async () => {
  const dir = fixture({ remote: false });
  // no registry → `phase add` cannot claim, so seed the roadmap through the lib
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(dir, { number: 1, name: 'local', milestone: 1 });
  const r = ac(['phase', 'milestone', '1', '2'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no shared registry in use — only the local roadmap moved/);
  assert.equal(roadmapPhase(dir, 1).milestone, 2);
});

test('#32: `ac status` reports a phase whose roadmap and registry milestones differ', async () => {
  const dir = fixture();
  assert.equal(ac(['phase', 'add', 'drifted', '--milestone', '1'], dir).status, 0);
  planUpTo(dir, 3);
  // the pre-fix state: roadmap moved, claim left behind
  const { setPhaseMilestone } = await import('../lib/roadmap.mjs');
  await setPhaseMilestone(dir, roadmapPhase(dir, 1).slug, 3);

  const s = ac(['status'], dir);
  assert.match(s.stdout, /⚠ phase 1 is milestone 3 in the roadmap but 1 on the registry/);
  assert.match(s.stdout, /ac phase milestone 1 3/, 'names the command that realigns them');

  assert.equal(ac(['phase', 'milestone', '1', '3'], dir).status, 0);
  assert.equal(phaseClaim(dir, 1).milestone, 3, 'the named command repairs existing drift');
  assert.doesNotMatch(ac(['status'], dir).stdout, /⚠ phase 1 is milestone/);
});

// ── #32: the debt-pay route ──────────────────────────────────────────────────

test('#32: `ac debt pay --as phase --milestone N` claims the phase under N', () => {
  const dir = fixture();
  assert.equal(ac(['debt', 'add', 'which emulator each system targets'], dir).status, 0);
  planUpTo(dir, 3);
  const id = JSON.parse(readFileSync(join(paths(dir).dir, 'debt.json'), 'utf8')).debt[0].id;

  const r = ac(['debt', 'pay', id, '--as', 'phase', '--milestone', '3'], dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\(milestone 3\)/);
  assert.equal(phaseClaim(dir, 1).milestone, 3, 'claimed under the requested milestone, not the active one');
  assert.equal(roadmapPhase(dir, 1).milestone, 3);

  assert.notEqual(ac(['debt', 'pay', id, '--as', 'fix', '--milestone', '3'], dir).status, 0, 'a fix has no milestone');
});

// ── #29 follow-up: a close owns only its own milestone's phases ─────────────

test('#29: a later-milestone phase neither blocks the close nor gets archived by it', () => {
  const dir = fixture();
  assert.equal(ac(['phase', 'add', 'done in m1'], dir).status, 0);
  planUpTo(dir, 2);
  assert.equal(ac(['phase', 'add', 'planned for m2', '--milestone', '2'], dir).status, 0);
  assert.equal(ac(['phase', 'verify', '1'], dir).status, 0);
  assert.equal(ac(['phase', 'accept', '1'], dir).status, 0);

  const r = ac(['milestone', 'complete'], dir);
  assert.equal(r.status, 0, `m1's own phases are all complete — no --force needed:\n${r.stderr}`);
  assert.match(r.stdout, /archived 1 phase\(s\)/);
  assert.match(r.stdout, /kept 1 phase\(s\) scheduled for a later milestone/);

  const left = readJSON(paths(dir).roadmap).phases;
  assert.deepEqual(left.map((p) => p.number), [2], 'the m2 phase stays on the roadmap');
  const archived = readdirSync(join(paths(dir).dir, 'milestones', '1', 'phases'));
  assert.ok(!archived.some((d) => /planned-for-m2/.test(d)), 'and is not filed under milestone 1');
  const snap = readJSON(join(paths(dir).dir, 'milestones', '1', 'roadmap.json'));
  assert.deepEqual(snap.phases.map((p) => p.number), [1], 'the archive snapshot records only m1');
});

test('#29: an unfinished phase of the closing milestone still refuses', () => {
  const dir = fixture();
  assert.equal(ac(['phase', 'add', 'still open in m1'], dir).status, 0);
  planUpTo(dir, 2);
  assert.equal(ac(['phase', 'add', 'planned for m2', '--milestone', '2'], dir).status, 0);
  const r = ac(['milestone', 'complete'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /1 phase\(s\) are not complete/);
  assert.match(r.stderr, /still open in m1/);
  assert.doesNotMatch(r.stderr, /planned for m2/, 'a later-milestone phase is not listed as unfinished');
});

// ── #45: dedupe reaches the registry ────────────────────────────────────────

const DUP =
  '# Decisions\n\n' +
  '## ADR-001 — Keep one copy\n_2026-09-10_\n\n**Why:** because\n\n' +
  '## ADR-002 — Keep one copy\n_2026-09-11_\n\n**Why:** because\n';

const registryDecisions = (dir) => {
  let text = '';
  transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'read' }, (files) => {
    text = files['DECISIONS.md'] || '';
    return { updates: {} };
  });
  return text;
};
// full copies only: heading + date line. A collapsed duplicate stays as a heading-only
// stub (#36), so its number is never reused — it is not a copy of the decision.
const copies = (text) => (text.match(/^## ADR-\d+ — Keep one copy\n_/gm) || []).length;

test('#45: dedupe collapses the registry copy, so pull and decision add no longer restore it', () => {
  const dir = fixture();
  // the state the pre-#12 renumbering left behind: two identical entries on the registry
  assert.equal(transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'plant' }, () => ({ updates: { 'DECISIONS.md': DUP } })).ok, true);
  assert.match(ac(['canon', 'pull'], dir).stderr, /duplicate decision/);
  assert.equal(copies(readFileSync(paths(dir).decisions, 'utf8')), 2);

  const d = ac(['canon', 'dedupe'], dir);
  assert.equal(d.status, 0, d.stderr);
  assert.match(d.stdout, /removed ADR-002 — duplicate of ADR-001 .*\[astro-registry \+ local\]/);
  assert.equal(copies(registryDecisions(dir)), 1, 'the registry copy is collapsed');
  assert.equal(copies(readFileSync(paths(dir).decisions, 'utf8')), 1);

  const pull = ac(['canon', 'pull'], dir);
  assert.doesNotMatch(pull.stderr, /duplicate decision/, 'a pull no longer brings it back');
  assert.equal(copies(readFileSync(paths(dir).decisions, 'utf8')), 1);

  assert.equal(ac(['decision', 'add', 'Another decision'], dir).status, 0);
  assert.equal(copies(registryDecisions(dir)), 1, 'nor does the next decision add');
  assert.equal(copies(readFileSync(paths(dir).decisions, 'utf8')), 1);
});

test('#45: an unreachable registry refuses the dedupe rather than collapsing only locally', () => {
  const dir = fixture();
  assert.equal(transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'plant' }, () => ({ updates: { 'DECISIONS.md': DUP } })).ok, true);
  ac(['canon', 'pull'], dir);
  git(['remote', 'set-url', 'origin', join(tmpdir(), 'ac-msync-gone', 'missing.git')], { cwd: dir });

  const d = ac(['canon', 'dedupe'], dir);
  assert.notEqual(d.status, 0);
  assert.match(d.stderr, /Nothing was collapsed/);
  assert.equal(copies(readFileSync(paths(dir).decisions, 'utf8')), 2, 'local untouched');
});

test('a transaction with nothing to write moves no tip (no empty commits on the shared branch)', () => {
  const dir = fixture();
  const tip = () => git(['ls-remote', 'origin', 'refs/heads/astro-registry'], { cwd: dir }).stdout.split('\t')[0];
  const before = tip();
  const res = transact(dir, { remote: 'origin', branch: 'astro-registry', message: 'nothing' }, () => ({ updates: {}, result: 'x' }));
  assert.equal(res.ok, true);
  assert.equal(res.result, 'x', 'the callback result still comes back');
  assert.equal(tip(), before, 'an update-free transaction must not push a commit');
  assert.equal(ac(['canon', 'dedupe'], dir).status, 0);
  assert.equal(tip(), before, 'nor may a dedupe with nothing to collapse');
  assert.ok(existsSync(paths(dir).roadmap));
});
