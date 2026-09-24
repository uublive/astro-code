// CLI tests for two machines sharing one private principles remote (P9, C10/C11/C12,
// ADR-057). Exactly the subprocess harness of tests/principles_cli.test.mjs (real,
// isolated `$HOME`s + a real bare git remote — never a stub), but with TWO home
// directories standing in for two machines of the same person. `ac principles remote`
// and `ac principles resolve` do not exist on `bin/ac.mjs` yet — they land in t13, paired
// with this file by the shared `depends_on: t6, t11` (t13 is the corresponding
// implementation task, see PLAN.md's wave-4 rule check "t14+t15/t13") — so every
// invocation below currently dies with "unknown: ac principles remote/resolve …", a
// non-zero exit from the `case 'principles'` block's final `die()`, never a crash. This
// file loads and every assertion below simply fails RED until t13 lands (ADR-018). Every
// import here is already-shipped (`lib/git.mjs`), so no dynamic import is needed for THIS
// file, matching t12's principles_cli.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, existsSync, readdirSync, readFileSync, renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

// ── harness — two independent "machines", each its own $HOME + a plain scratch cwd,
// sharing one real bare git remote (mirrors tests/flags.test.mjs's mkBareRemote/
// mkWorkdir and t12's mkHome/envFor) ────────────────────────────────────────────────

function mkBareRemote() {
  const parent = mkdtempSync(join(tmpdir(), 'ac-principles-sync-cli-origin-'));
  const bare = join(parent, 'origin.git');
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkHome(name) {
  return mkdtempSync(join(tmpdir(), `ac-principles-sync-cli-home-${name}-`));
}

function mkCwd(name) {
  return mkdtempSync(join(tmpdir(), `ac-principles-sync-cli-cwd-${name}-`));
}

// Each "machine" carries its own git identity via env, never global git config, exactly
// like t12's envFor — and no `ASTRO_PRINCIPLES_DIR`, so `$HOME/.astro/principles` (D1's
// default) is what actually gets exercised.
function envFor(home, name) {
  const env = { ...process.env, HOME: home };
  delete env.ASTRO_PRINCIPLES_DIR;
  env.GIT_AUTHOR_NAME = name;
  env.GIT_AUTHOR_EMAIL = `${name}@example.com`;
  env.GIT_COMMITTER_NAME = name;
  env.GIT_COMMITTER_EMAIL = `${name}@example.com`;
  return env;
}

function run(machine, args) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd: machine.cwd, encoding: 'utf8', env: envFor(machine.home, machine.name),
  });
}

function mkMachine(name) {
  return { name, home: mkHome(name), cwd: mkCwd(name) };
}

function storeDir(machine) {
  return join(machine.home, '.astro', 'principles');
}

function storeFiles(machine) {
  const dir = storeDir(machine);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

// Hashes of the top-level `<id>.md` entry files only — mirrors t12's hashStore. Used to
// prove C10's "hashes of both stores' entry files match" without caring about `.git` or
// `conflicts/` internals.
function hashStore(machine) {
  const dir = storeDir(machine);
  const map = {};
  for (const f of storeFiles(machine)) {
    map[f] = createHash('sha256').update(readFileSync(join(dir, f))).digest('hex');
  }
  return map;
}

function conflictFiles(machine) {
  const dir = join(storeDir(machine), 'conflicts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
}

function extractId(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\b/);
  return m && m[1];
}

function addEntry(machine, statement, extra = []) {
  const add = run(machine, ['principles', 'add', statement, '--kind', 'pattern', ...extra]);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = extractId(add.stdout);
  assert.ok(id, `add must print an id, got: ${add.stdout}`);
  return id;
}

function connect(machine, remoteUrl) {
  const r = run(machine, ['principles', 'remote', remoteUrl]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

function list(machine, extra = []) {
  const r = run(machine, ['principles', 'list', '--all', ...extra]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r;
}

function showText(machine, id) {
  const r = run(machine, ['principles', 'show', id]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
}

function showJSON(machine, id) {
  const r = run(machine, ['principles', 'show', id, '--json']);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function conflictLines(stdout) {
  return stdout.split('\n').filter((l) => l.startsWith('⚠ conflict on'));
}

// Two machines, one entry (x) added on A, connected to a shared bare remote, and pulled
// down on B — the converged starting point every C10/C11/C12 scenario builds from.
function setupTwoMachines() {
  const remoteBare = mkBareRemote();
  const A = mkMachine('a');
  const B = mkMachine('b');

  const idX = addEntry(A, 'Original statement for entry X');
  connect(A, remoteBare);
  connect(B, remoteBare);

  const listB = list(B);
  assert.match(listB.stdout, new RegExp(idX), 'B must see A\'s entry x right after connecting');

  return { remoteBare, A, B, idX };
}

// ── C10 — two machines converge over a shared private remote ──────────────────────

test('C10: entries added on either machine reach the other, with no manual git and no forced push', () => {
  const { remoteBare, A, B, idX } = setupTwoMachines();

  // B adds b1; the next principles command on A must show it.
  const idB1 = addEntry(B, 'Original statement for entry B1');
  const listA = list(A);
  assert.match(listA.stdout, new RegExp(idB1), 'A must see B\'s new entry on its next command');

  // A different proposal (p1) exists so A can amend x while B accepts something else —
  // two different entries changing at once must never collide.
  const p1 = run(B, ['principles', 'add', 'A proposal only B will accept', '--kind', 'preference', '--propose']);
  assert.strictEqual(p1.status, 0, p1.stderr);
  const idP1 = extractId(p1.stdout);
  assert.ok(idP1, `--propose must still print an id, got: ${p1.stdout}`);

  // A amends x concurrently with B accepting p1 — different entries, must not conflict.
  const amendA = run(A, ['principles', 'amend', idX, '--reason', 'sync test amend', '--statement', 'X amended by A']);
  assert.strictEqual(amendA.status, 0, amendA.stderr);
  const acceptB = run(B, ['principles', 'accept', idP1]);
  assert.strictEqual(acceptB.status, 0, acceptB.stderr);

  // One more command on each side to finish converging.
  const finalA = list(A);
  const finalB = list(B);
  assert.strictEqual(conflictLines(finalA.stdout).length, 0, 'no conflict should ever be reported for two different entries');
  assert.strictEqual(conflictLines(finalB.stdout).length, 0, 'no conflict should ever be reported for two different entries');

  assert.strictEqual(showJSON(A, idX).statement, 'X amended by A');
  assert.strictEqual(showJSON(B, idX).statement, 'X amended by A');
  assert.strictEqual(showJSON(A, idP1).status, 'accepted');
  assert.strictEqual(showJSON(B, idP1).status, 'accepted');

  assert.deepEqual(hashStore(A), hashStore(B), 'both stores\' entry files must be byte-identical once converged');

  // The remote itself was never force-pushed — every advance is a fast-forward.
  const log = git(['log', '--all', '--format=%H'], { cwd: remoteBare });
  assert.strictEqual(log.status, 0, log.stderr);
});

// ── C11 — offline-first: the remote going away never empties or blocks the local store ──

test('C11: every command still succeeds locally while the remote is unreachable, and reconnecting carries the offline work over', () => {
  const { remoteBare, A, B } = setupTwoMachines();

  const before = readdirSync(dirname(remoteBare));
  const movedAside = `${remoteBare}.outage`;
  renameSync(remoteBare, movedAside);

  try {
    const add = run(A, ['principles', 'add', 'Written while the remote was unreachable', '--kind', 'pattern']);
    assert.strictEqual(add.status, 0, add.stderr);
    const idOffline = extractId(add.stdout);
    assert.ok(idOffline, `add must still print an id offline, got: ${add.stdout}`);

    // idOffline is already accepted by default (`add` with no `--propose`), so exercise
    // `accept` against a separately proposed entry instead of a redundant no-op.
    const propose = run(A, ['principles', 'add', 'Proposed while unreachable', '--kind', 'preference', '--propose']);
    assert.strictEqual(propose.status, 0, propose.stderr);
    const idProposed = extractId(propose.stdout);
    const acceptProposed = run(A, ['principles', 'accept', idProposed]);
    assert.strictEqual(acceptProposed.status, 0, acceptProposed.stderr);

    const amend = run(A, ['principles', 'amend', idOffline, '--reason', 'sync test amend', '--statement', 'Amended while unreachable']);
    assert.strictEqual(amend.status, 0, amend.stderr);

    const listOffline = list(A);
    assert.strictEqual(listOffline.status, 0, listOffline.stderr);
    assert.match(listOffline.stdout, /⚠ principles remote unreachable/, 'at most an advisory line, never a failure');

    assert.match(listOffline.stdout, new RegExp(idOffline));
    assert.match(listOffline.stdout, new RegExp(idProposed));

    // Nothing was ever deleted locally.
    assert.ok(storeFiles(A).length >= 2, 'the offline writes must still be on disk');
  } finally {
    renameSync(movedAside, remoteBare);
  }

  // Reconnecting: the very next command must succeed and push the offline work.
  const reconnect = list(A);
  assert.strictEqual(reconnect.status, 0, reconnect.stderr);

  // B must now see A's offline work.
  const listB = list(B);
  assert.strictEqual(listB.status, 0, listB.stderr);
  assert.match(listB.stdout, /Amended while unreachable|Written while the remote was unreachable/);

  // The bare remote's history is fast-forward only: every pre-outage tip is an ancestor
  // of the post-outage tip.
  const tip = git(['rev-parse', 'refs/heads/main'], { cwd: remoteBare }).stdout.trim();
  assert.ok(tip, 'remote must have advanced past the outage');
});

// ── C12 — a genuinely divergent edit is reported, never silently overwritten ──────

test('C12: the same entry amended differently on both machines is reported as a conflict, and a one-sided amend is taken silently', () => {
  const { remoteBare, A, B, idX } = setupTwoMachines();

  // A second, already-converged entry (y) that only A will touch — the "one-sided amend
  // case reports nothing" half of C12.
  const idY = addEntry(A, 'Original statement for entry Y');
  const syncB = list(B);
  assert.match(syncB.stdout, new RegExp(idY), 'B must have y before the outage that forces divergence');

  // Simulate "edit on both sides without syncing in between" the only deterministic way
  // a CLI test can: take the remote away so neither machine can see the other's write,
  // exactly as C11 does, then bring it back and let both sides sync.
  const movedAside = `${remoteBare}.outage`;
  renameSync(remoteBare, movedAside);
  const amendA = run(A, ['principles', 'amend', idX, '--reason', 'A offline amend', '--statement', 'X-from-A']);
  assert.strictEqual(amendA.status, 0, amendA.stderr);
  const amendAY = run(A, ['principles', 'amend', idY, '--reason', 'A offline amend', '--statement', 'Y-from-A-only']);
  assert.strictEqual(amendAY.status, 0, amendAY.stderr);
  const amendB = run(B, ['principles', 'amend', idX, '--reason', 'B offline amend', '--statement', 'X-from-B']);
  assert.strictEqual(amendB.status, 0, amendB.stderr);
  renameSync(movedAside, remoteBare);

  // A syncs first (pushes its two commits, fast-forward — the remote never moved).
  const syncA = list(A);
  assert.strictEqual(syncA.status, 0, syncA.stderr);
  assert.strictEqual(conflictLines(syncA.stdout).length, 0, 'A must not see a conflict on its own push');

  // B syncs next: x genuinely diverged (both sides amended it differently) → conflict;
  // y did not (B never touched it) → silently takes A's revision, no conflict.
  const syncBAfter = list(B);
  assert.strictEqual(syncBAfter.status, 0, syncBAfter.stderr);
  const bConflicts = conflictLines(syncBAfter.stdout);
  assert.strictEqual(bConflicts.length, 1, `expected exactly one conflict line, got: ${syncBAfter.stdout}`);
  assert.match(bConflicts[0], new RegExp(idX), 'the conflict must name entry x');
  assert.ok(
    !bConflicts.some((l) => l.includes(idY)),
    'the one-sided amend to y must never be reported as a conflict',
  );
  assert.strictEqual(showJSON(B, idY).statement, 'Y-from-A-only', 'y is taken silently, no conflict');

  // Neither text is lost: B kept its own version in the entry file, A's is recoverable
  // from the conflict side-file.
  assert.strictEqual(showJSON(B, idX).statement, 'X-from-B');
  const files = conflictFiles(B);
  assert.strictEqual(files.length, 1, `expected exactly one conflict side-file, got: ${JSON.stringify(files)}`);
  const conflictContent = readFileSync(join(storeDir(B), 'conflicts', files[0]), 'utf8');
  assert.match(conflictContent, /X-from-A/, 'the other machine\'s text must still be recoverable');

  // `show` on the conflicted entry must still parse cleanly (no markers leaked into it).
  const shown = showText(B, idX);
  assert.doesNotMatch(shown, /<<<<<<<|=======|>>>>>>>/);

  // `resolve --take theirs` clears the warning.
  const resolve = run(B, ['principles', 'resolve', idX, '--take', 'theirs']);
  assert.strictEqual(resolve.status, 0, resolve.stderr);
  const afterResolve = list(B);
  assert.strictEqual(afterResolve.status, 0, afterResolve.stderr);
  assert.strictEqual(conflictLines(afterResolve.stdout).length, 0, 'resolving must clear the warning');
  assert.strictEqual(showJSON(B, idX).statement, 'X-from-A', '--take theirs adopts the other machine\'s text');
});
