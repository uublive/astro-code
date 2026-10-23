// Fix 2026-10-23-a-decisions-collision-refusal-prints-a: a same-id DECISIONS.md collision refused
// with `fixes: []`, so the CLI printed the dangling "… was found. Fix: ." — no way out named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addDecision } from '../lib/canon.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
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

test('a same-id decision collision names real ways out, never a dangling "Fix: ."', async () => {
  const bare = mkBareRemote();
  const alice = mkWorkdir(bare, 'alice');
  const bob = mkWorkdir(bare, 'bob');
  const a = await addDecision(alice, { title: 'Use worktrees', why: 'isolation', date: '2026-09-17' });
  writeFileSync(paths(bob).decisions, `# Decisions\n\n## ${a.id} — Ban worktrees\n_2026-09-17_\n\n**Why:** confusion\n\n`);
  const r = spawnSync(process.execPath, [AC, 'canon', 'pull'], { cwd: bob, encoding: 'utf8' });
  const out = r.stdout + r.stderr;
  assert.match(out, /DECISIONS\.md was NOT overwritten/);
  assert.doesNotMatch(out, /Fix: \./, 'no empty fix list');
  assert.match(out, /Fix: .*ac canon check/, 'the refusal names how to see both versions');
  assert.match(out, /ac decision add/, 'and how to keep the local one under a new id');
});
