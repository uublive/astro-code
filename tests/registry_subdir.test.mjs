// Regression: a project whose root is a SUBDIRECTORY of its git repo (e.g. a kit converted
// in place at <repo>/kit/<kit-id>/). `git ls-tree <tip>` run from a subdirectory lists only
// that subpath, so the registry branch's root-level files read as absent: the first decision
// created the branch, then every later write refused with "tree reads as empty".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { claim, readRegistry, initRegistry } from '../lib/registry.mjs';
import { addDecision } from '../lib/canon.mjs';

function mkSubdirProject() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  const repo = mkdtempSync(join(tmpdir(), 'ac-work-subdir-'));
  git(['init', '--quiet'], { cwd: repo });
  git(['config', 'user.email', 'dev@example.com'], { cwd: repo });
  git(['config', 'user.name', 'dev'], { cwd: repo });
  git(['remote', 'add', 'origin', bare], { cwd: repo });
  const dir = join(repo, 'kit', 'my-kit');
  mkdirSync(dir, { recursive: true });
  initPlanning(dir, { name: 'my-kit' });
  return dir;
}

test('registry works when the project root is a subdirectory of the git repo', async () => {
  const dir = mkSubdirProject();

  const a = await addDecision(dir, { title: 'First' });
  assert.equal(a.source, 'remote', a.error || '');

  const b = await addDecision(dir, { title: 'Second' });
  assert.equal(b.source, 'remote', b.error || '');
  assert.equal(b.id, 'ADR-002');

  const init = initRegistry({ root: dir });
  assert.equal(init.ok, true, init.error || '');

  const p1 = claim({ root: dir, type: 'phase', milestone: 1, name: 'Recipe' });
  assert.equal(p1.source, 'remote', p1.error || '');
  assert.equal(p1.number, 1);

  // nothing already on the branch was lost along the way
  assert.equal(readRegistry(dir).available, true);
  const decisions = readFileSync(paths(dir).decisions, 'utf8');
  assert.match(decisions, /ADR-001 — First/);
  assert.match(decisions, /ADR-002 — Second/);
});
