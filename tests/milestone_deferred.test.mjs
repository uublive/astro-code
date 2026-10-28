// Phase 54 t13 (C6, D3): `ac milestone complete` refuses while a deferred fix of the closing
// milestone is open, before anything is moved or written, and --force does not bypass it. A fix
// deferred from a phase outside the closing milestone does not block. Real git and the real CLI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';
import { addFix, acceptFix } from '../lib/fixes.mjs';
import { loadRoadmap } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (args, cwd) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mdef-'));
  git(['init', '--quiet', '-b', 'main'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  git(['commit', '--quiet', '--allow-empty', '-m', 'init'], { cwd: dir });
  assert.equal(ac(['init', '--name', 'Def'], dir).status, 0);
  const bare = mkdtempSync(join(tmpdir(), 'ac-mdef-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  git(['push', '--quiet', '-u', 'origin', 'main'], { cwd: dir });
  assert.equal(ac(['registry', 'init'], dir).status, 0);
  assert.equal(ac(['phase', 'add', 'Demo work'], dir).status, 0);
  return dir;
}
const slugOf = (dir) => loadRoadmap(dir).phases[0].slug;

test('completeMilestone refuses naming the open deferred fix, and nothing is moved or written', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const dir = fixture();
  const slug = slugOf(dir);
  const fix = await addFix(dir, { title: 'deferred: phase 1 C2', deferredFrom: { phase: slug, criterion: 'C2', run: 1, commit: 'abc' } });
  await assert.rejects(completeMilestone(dir), (e) => e.message.includes(fix.id) && /deferred fix/.test(e.message));
  assert.equal(existsSync(join(paths(dir).dir, 'milestones')), false, 'no archive dir');
  assert.ok(existsSync(join(paths(dir).phases, slug)), 'the phase dir is still in place');
  assert.equal(loadRoadmap(dir).phases.length, 1, 'the roadmap is untouched');
});

test('the CLI exits non-zero naming the fix even with --force; once the fix is accepted the close proceeds', async () => {
  const dir = fixture();
  const slug = slugOf(dir);
  const fix = await addFix(dir, { title: 'deferred: phase 1 C2', deferredFrom: { phase: slug, criterion: 'C2' } });
  const r = ac(['milestone', 'complete', '--force'], dir);
  assert.notEqual(r.status, 0);
  assert.ok((r.stderr + r.stdout).includes(fix.id), r.stderr);
  assert.equal(existsSync(join(paths(dir).dir, 'milestones')), false);
  await acceptFix(dir, fix.id, { by: 'me' });
  const ok = ac(['milestone', 'complete', '--force'], dir);
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(readdirSync(join(paths(dir).dir, 'milestones')).length > 0);
});

test('a deferred fix of a phase outside the closing milestone does not block', async () => {
  const { completeMilestone } = await import('../lib/milestone.mjs');
  const dir = fixture();
  await addFix(dir, { title: 'deferred: elsewhere', deferredFrom: { phase: '99-elsewhere', criterion: 'C1' } });
  const out = await completeMilestone(dir);
  assert.equal(out.archived, 1);
});
