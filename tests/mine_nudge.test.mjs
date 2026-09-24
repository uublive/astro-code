// Phase 26 t9 — RED: nudge + "never runs by itself" hook tests (P7, C10/C11). Hooks run
// as subprocesses with sandbox env; new `hooks/_astro-ctx.mjs` exports (added in t2) are
// already real, so only the wiring THIS task adds (t12, in renderSegmentParts/renderBanner)
// is what fails RED here.
process.env.NO_COLOR = '1';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, openSync, ftruncateSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-mn-proj-'));
  const ac = join(root, '.astrocode');
  mkdirSync(ac, { recursive: true });
  writeFileSync(join(ac, 'state.json'), JSON.stringify({ project: 'demo' }));
  writeFileSync(join(ac, 'roadmap.json'), JSON.stringify({
    milestone: 1,
    phases: [{ number: 1, slug: 'demo', name: 'Demo', status: 'executing' }],
  }));
  return root;
}

function seedUnswept(claudeDir, root, n, { sizeEach = 5000 } = {}) {
  const slug = root.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(claudeDir, 'projects', slug);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `sess-${i}.jsonl`), 'x'.repeat(sizeEach));
  }
  return dir;
}

// The outer session this test runs inside may itself export CLAUDE_CONFIG_DIR (a real
// jean-claude profile) — inherited verbatim it would silently override the fake $HOME's
// .claude dir and read the developer's own real transcripts. Every spawn below strips it
// (and CODEX_HOME/ASTRO_PRINCIPLES_DIR for the same reason) so only `HOME` decides.
function cleanEnv(fakeHome, extra = {}) {
  const env = { ...process.env, HOME: fakeHome, NO_COLOR: '1', ...extra };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  delete env.ASTRO_PRINCIPLES_DIR;
  return env;
}

function runStatusline(root, fakeHome) {
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  return spawnSync(process.execPath, [hook, join(fakeHome, '.claude')], {
    input: JSON.stringify({ workspace: { current_dir: root } }),
    env: cleanEnv(fakeHome),
    encoding: 'utf8',
    windowsHide: true,
  });
}

function runUpdateBanner(root, fakeHome) {
  const hook = join(FRAMEWORK, 'hooks', 'astro-update.mjs');
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ cwd: root }),
    env: cleanEnv(fakeHome),
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('C11 a: 9 unswept sessions → no hint on the statusline', () => {
  const root = project();
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  seedUnswept(join(fakeHome, '.claude'), root, 9);
  const r = runStatusline(root, fakeHome);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('/astro-mine'), 'below MINE_NUDGE_SESSIONS must show no hint');
});

test('C11 b: 12 unswept sessions → exactly one statusline segment and one banner line', () => {
  const root = project();
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  seedUnswept(join(fakeHome, '.claude'), root, 12);

  const sl = runStatusline(root, fakeHome);
  assert.equal(sl.status, 0, sl.stderr);
  const matches = sl.stdout.match(/12 unswept → \/astro-mine/g) || [];
  assert.equal(matches.length, 1, `expected exactly one segment, got: ${sl.stdout}`);

  const banner = runUpdateBanner(root, fakeHome);
  assert.equal(banner.status, 0, banner.stderr);
  const out = JSON.parse(banner.stdout || '{}');
  const lines = (out.systemMessage || '').split('\n').filter((l) => l.includes('/astro-mine'));
  assert.equal(lines.length, 1, `expected exactly one banner line, got: ${out.systemMessage}`);
});

test('C11 c: 12 unswept sessions for another project only → no hint here', () => {
  const root = project();
  const other = mkdtempSync(join(tmpdir(), 'ac-mn-other-'));
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  seedUnswept(join(fakeHome, '.claude'), other, 12);
  const r = runStatusline(root, fakeHome);
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes('/astro-mine'));
});

test('C11 d: a watermark covering all sessions → no hint', () => {
  const root = project();
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  const dir = seedUnswept(join(fakeHome, '.claude'), root, 12, { sizeEach: 5000 });
  const slug = root.replace(/[^a-zA-Z0-9]/g, '-');
  const storeDir = join(fakeHome, '.astro', 'principles');
  const filesPath = join(storeDir, '.local', 'mine', 'files', `${slug}.json`);
  mkdirSync(join(filesPath, '..'), { recursive: true });
  const files = {};
  for (const f of readdirSync(dir)) files[join(dir, f)] = { offset: 5000 };
  writeFileSync(filesPath, JSON.stringify({ version: 1, files }));

  const r = runStatusline(root, fakeHome);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('/astro-mine'), 'a watermark covering every session must silence the hint');
});

test('Cheapness: 12 sparse ~600MB files → the statusline still finishes quickly and shows the hint', () => {
  const root = project();
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  const slug = root.replace(/[^a-zA-Z0-9]/g, '-');
  const dir = join(fakeHome, '.claude', 'projects', slug);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 12; i++) {
    const fd = openSync(join(dir, `sess-${i}.jsonl`), 'w');
    ftruncateSync(fd, 600 * 1024 * 1024);
    closeSync(fd);
  }
  const start = Date.now();
  const r = runStatusline(root, fakeHome);
  const elapsed = Date.now() - start;
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('/astro-mine'));
  assert.ok(elapsed < 3000, `statusline took ${elapsed}ms — unsweptSessions must stay stat-only`);
});

test('C10: every wired hook runs without ever writing under .local/mine/, and leaves the store untouched', () => {
  const root = project();
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-mn-home-'));
  seedUnswept(join(fakeHome, '.claude'), root, 12);
  const storeDir = join(fakeHome, '.astro', 'principles');
  mkdirSync(storeDir, { recursive: true });
  writeFileSync(join(storeDir, 'existing.md'), '<!-- astro-principle -->\n');

  runStatusline(root, fakeHome);
  runUpdateBanner(root, fakeHome);
  spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-precompact.mjs')], {
    input: JSON.stringify({ cwd: root }), env: { ...process.env, HOME: fakeHome }, encoding: 'utf8', windowsHide: true,
  });
  spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-session-state.mjs'), 'prompt'], {
    input: JSON.stringify({ session_id: 'abc' }), env: { ...process.env, HOME: fakeHome }, encoding: 'utf8', windowsHide: true,
  });
  spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-session-state.mjs'), 'stop'], {
    input: JSON.stringify({ session_id: 'abc' }), env: { ...process.env, HOME: fakeHome }, encoding: 'utf8', windowsHide: true,
  });

  assert.ok(!existsSync(join(storeDir, '.local', 'mine')), 'no hook may ever write under .local/mine/');
  const mdFiles = readdirSync(storeDir).filter((f) => f.endsWith('.md'));
  assert.deepEqual(mdFiles, ['existing.md'], 'the store\'s .md count must be unchanged');
});
