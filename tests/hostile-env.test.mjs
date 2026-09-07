// Hostile-environment matrix — astro-code's real bugs cluster in DEGRADED setups
// (no worktree support, no remote, dirty tree, detached HEAD), not the happy path.
// These real-git integration tests deliberately break the world and assert graceful,
// loud degradation: a clear refusal or a documented fallback, never a silent wrong thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON, atomicWriteJSON } from '../lib/util.mjs';
import { flowBranch } from '../lib/flow.mjs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
import { claim } from '../lib/registry.mjs';

// A real git repo on `main` with one commit (so HEAD is valid), scaffolded with
// .astrocode/ and gitflow enabled + a `develop` branch — the baseline a flow needs.
function repoReadyForFlow() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-hostile-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', 'hostile@example.com'], { cwd: dir });
  git(['config', 'user.name', 'Hostile Test'], { cwd: dir });
  git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  initPlanning(dir, { name: 'hostile-proj' });
  const p = paths(dir);
  const cfg = readJSON(p.config) || {};
  cfg.gitflow = { enabled: true, main: 'main', develop: 'develop', prefixes: { feature: 'feature' }, pr: 'none' };
  atomicWriteJSON(p.config, cfg);
  git(['branch', 'develop', 'main'], { cwd: dir }); // flowBranch forks off develop
  return dir;
}

// ── detached HEAD ──────────────────────────────────────────────────────────
// Worktrees and feature branches fork from HEAD; a detached HEAD means there is no
// branch context, so flowBranch must refuse rather than create a branch off a floating commit.
test('flowBranch refuses on a detached HEAD with a clear message', () => {
  const dir = repoReadyForFlow();
  const sha = git(['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  git(['checkout', '--quiet', sha], { cwd: dir }); // detach
  assert.throws(() => flowBranch(dir), /detached/i, 'a detached HEAD must be refused, not silently branched');
});

// ── dirty-tree detection excludes .astrocode/ but nothing else ───────────────
// The planner scaffolds .astrocode/ as untracked files that ride the feature branch, so
// they must NOT count as a dirty tree — otherwise normal `ac flow` usage is blocked. Any
// OTHER untracked/modified file, though, is a real dirty tree and must block the switch.
test('flowBranch treats untracked .astrocode/ as clean (rides the branch)', () => {
  const dir = repoReadyForFlow();
  writeFileSync(join(paths(dir).dir, 'phases', 'scratch.md'), 'untracked planning file');
  const res = flowBranch(dir); // must NOT throw despite untracked .astrocode/ content
  assert.equal(res.ok, true);
  assert.match(res.branch, /^feature\/m1/, 'lands on the milestone feature branch');
});

test('flowBranch still refuses when a NON-.astrocode file makes the tree dirty', () => {
  const dir = repoReadyForFlow();
  writeFileSync(join(dir, 'rogue.txt'), 'an untracked source file outside .astrocode/');
  assert.throws(() => flowBranch(dir), /dirty/i, 'a real dirty tree must still block, and name the file');
  assert.throws(() => flowBranch(dir), /rogue\.txt/, 'the offending file is surfaced');
});

// ── no remote → hard error, NOT a silent local number ────────────────────────
// The registry is the single source of truth (lib/registry.mjs): numbers allocated
// locally before an origin exists would never reach the shared registry and would later
// collide. So claiming without a remote must fail loudly with an actionable hint — this
// locks that contract (and is why the README must not promise a "local fallback").
test('claim() refuses with an actionable hint when there is no remote (no silent local fallback)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-hostile-noremote-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', 'hostile@example.com'], { cwd: dir });
  git(['config', 'user.name', 'Hostile Test'], { cwd: dir });
  git(['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  initPlanning(dir, { name: 'hostile-proj' });

  const res = claim({ root: dir, type: 'phase', milestone: 1, name: 'x' });
  assert.equal(res.source, 'error', 'no remote must be an error, not a number');
  assert.equal(res.number, null, 'no number is allocated without the shared registry');
  assert.match(res.error, /remote|registry/i, 'the error points at the missing remote/registry');
});

// --- Windows: no stray console windows ---------------------------------------
// Node defaults `windowsHide` to false, so on Windows EVERY spawn can flash or
// leave an empty console window. The status line shells out on every render, so
// the symptom users actually report is "empty terminals keep appearing while I
// work". This scans the source rather than trusting review: a new spawn added
// without the flag reintroduces the bug silently on a platform we don't test on.
test('every child_process spawn sets windowsHide (no stray consoles on Windows)', () => {
  const files = [
    'hooks/astro-statusline.mjs', 'hooks/astro-update.mjs', 'hooks/astro-update-worker.mjs',
    'lib/git.mjs', 'lib/flow.mjs', 'bin/ac.mjs',
  ];
  const offenders = [];
  for (const rel of files) {
    const src = readFileSync(join(FRAMEWORK, rel), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\bspawnSync\(|\bspawn\(/.test(line)) return;
      if (/^\s*(\/\/|\*)/.test(line)) return;          // a comment mentioning spawn
      if (/^import\b/.test(line.trim())) return;        // the import itself
      // the options object may span the next few lines
      const window = lines.slice(i, i + 14).join('\n');
      if (!window.includes('windowsHide')) {
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 70)}`);
      }
    });
  }
  assert.deepEqual(offenders, [],
    `these spawns would open a console window on Windows:\n${offenders.join('\n')}`);
});
