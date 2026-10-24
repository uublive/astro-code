// git attribution helpers for `ac decision renumber` (phase 53 t10, ADR-087 D5).
// Real repos; the new exports are reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/git.mjs';

const lib = () => import('../lib/git.mjs');

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'ac-attr-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: d });
  git(['config', 'user.email', 't@example.com'], { cwd: d });
  git(['config', 'user.name', 't'], { cwd: d });
  git(['config', 'commit.gpgsign', 'false'], { cwd: d });
  writeFileSync(join(d, 'base.txt'), 'base\n');
  git(['add', '-A'], { cwd: d });
  git(['commit', '--quiet', '-m', 'base'], { cwd: d });
  return d;
}
const sha = (d, rev = 'HEAD') => git(['rev-parse', rev], { cwd: d }).stdout.trim();
function commitFile(d, name, text = 'x\n') {
  writeFileSync(join(d, name), text);
  git(['add', '-A'], { cwd: d });
  git(['commit', '--quiet', '-m', `add ${name}`], { cwd: d });
  return sha(d);
}

test('a commit merged via a merge commit maps to that merge\'s second-parent side', async () => {
  const { addingCommit, branchSideOf } = await lib();
  const d = repo();
  git(['checkout', '--quiet', '-b', 'feature'], { cwd: d });
  const f1 = commitFile(d, 'a.txt');
  const f2 = commitFile(d, 'b.txt');
  git(['checkout', '--quiet', 'main'], { cwd: d });
  const mainOnly = commitFile(d, 'm.txt');
  git(['merge', '--quiet', '--no-ff', '-m', 'merge feature', 'feature'], { cwd: d });
  const side = branchSideOf(d, addingCommit(d, 'a.txt'));
  assert.equal(side.kind, 'merged');
  assert.deepEqual([...side.commits].sort(), [f1, f2].sort());
  assert.ok(!side.commits.has(mainOnly));
  assert.equal(side.merge, sha(d));
});

test('a commit on an unmerged feature branch maps to default..HEAD', async () => {
  const { branchSideOf, addingCommit } = await lib();
  const d = repo();
  git(['checkout', '--quiet', '-b', 'feature'], { cwd: d });
  const f1 = commitFile(d, 'a.txt');
  const side = branchSideOf(d, addingCommit(d, 'a.txt'));
  assert.equal(side.kind, 'unmerged');
  assert.deepEqual([...side.commits], [f1]);
});

test('a squash-merged change is unattributable', async () => {
  const { branchSideOf } = await lib();
  const d = repo();
  git(['checkout', '--quiet', '-b', 'feature'], { cwd: d });
  commitFile(d, 'a.txt');
  commitFile(d, 'b.txt');
  git(['checkout', '--quiet', 'main'], { cwd: d });
  git(['merge', '--quiet', '--squash', 'feature'], { cwd: d });
  git(['commit', '--quiet', '-m', 'squash'], { cwd: d });
  const squashed = sha(d);
  const side = branchSideOf(d, squashed);
  assert.equal(side.kind, 'unattributable');
  assert.ok(side.reason);
  // the squashed content now lives on main only: no merge side for it
  assert.equal(branchSideOf(d, sha(d, 'feature~1')).kind, 'unattributable');
});

test('a post-merge commit on default is not on either side', async () => {
  const { branchSideOf } = await lib();
  const d = repo();
  git(['checkout', '--quiet', '-b', 'feature'], { cwd: d });
  const f1 = commitFile(d, 'a.txt');
  git(['checkout', '--quiet', 'main'], { cwd: d });
  commitFile(d, 'm.txt');
  git(['merge', '--quiet', '--no-ff', '-m', 'merge', 'feature'], { cwd: d });
  const after = commitFile(d, 'later.txt');
  const side = branchSideOf(d, after);
  assert.equal(side.kind, 'unattributable');
  assert.equal(branchSideOf(d, f1).kind, 'merged');
  assert.ok(!branchSideOf(d, f1).commits.has(after));
});

test('blameCommits marks uncommitted lines with the zero SHA and returns null for an untracked path', async () => {
  const { blameCommits } = await lib();
  const d = repo();
  const c1 = commitFile(d, 'f.txt', 'one\ntwo\n');
  appendFileSync(join(d, 'f.txt'), 'three\n');
  assert.deepEqual(blameCommits(d, 'f.txt'), [c1, c1, '0'.repeat(40)]);
  writeFileSync(join(d, 'untracked.txt'), 'u\n');
  assert.equal(blameCommits(d, 'untracked.txt'), null);
  assert.equal(blameCommits(d, 'nope.txt'), null);
});

test('defaultBranch reads origin/HEAD, then main/master/develop, else null', async () => {
  const { defaultBranch } = await lib();
  const d = repo();
  assert.equal(defaultBranch(d), 'main');
  git(['branch', '-m', 'main', 'develop'], { cwd: d });
  assert.equal(defaultBranch(d), 'develop');
  git(['branch', '-m', 'develop', 'trunk'], { cwd: d });
  assert.equal(defaultBranch(d), null);
  // origin/HEAD wins
  const bare = mkdtempSync(join(tmpdir(), 'ac-attr-origin-')) + '/o.git';
  git(['init', '--quiet', '--bare', bare]);
  git(['remote', 'add', 'origin', bare], { cwd: d });
  git(['push', '--quiet', 'origin', 'trunk'], { cwd: d });
  git(['fetch', '--quiet', 'origin'], { cwd: d });
  git(['remote', 'set-head', 'origin', 'trunk'], { cwd: d });
  assert.equal(defaultBranch(d), 'trunk');
});
