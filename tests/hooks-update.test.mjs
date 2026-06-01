// Verify the update-notification wiring: installClaude registers a SessionStart
// banner + a composing statusline into each config dir's settings.json, and
// uninstallClaude restores it. Also checks the worker's behind-count against a
// real throwaway clone+remote. Runs against a fake $HOME/$CLAUDE_CONFIG_DIR so it
// never touches the user's settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

function withEnv({ home, configDir }, fn) {
  const prev = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR };
  process.env.HOME = home;
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = configDir;
  return Promise.resolve(fn()).finally(() => {
    for (const k of ['HOME', 'CLAUDE_CONFIG_DIR']) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });
}

test('install registers SessionStart banner + composes statusline; uninstall restores it', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-hooks-'));
  const cfg = join(fakeHome, '.claude');
  mkdirSync(cfg, { recursive: true });
  // pre-existing statusline (e.g. GSD's) we must NOT clobber
  const original = { type: 'command', command: '"node" "/some/gsd-statusline.js"' };
  writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ statusLine: original, env: { KEEP: '1' } }));

  await withEnv({ home: fakeHome, configDir: cfg }, async () => {
    const { installClaude, uninstallClaude } = await import(`../lib/install.mjs?h=${encodeURIComponent(fakeHome)}`);
    const res = installClaude(FRAMEWORK);
    assert.ok(res.hooks > 0, 'hooks copied into the home');

    const settings = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    // SessionStart banner registered
    const ss = settings.hooks.SessionStart.flatMap((e) => e.hooks).map((h) => h.command);
    assert.ok(ss.some((c) => c.includes('astro-update.mjs')), 'SessionStart banner registered');
    // statusline now points at our wrapper, and the original is stashed in the chain map
    assert.ok(settings.statusLine.command.includes('astro-statusline.mjs'), 'statusline composed');
    assert.equal(settings.env.KEEP, '1', 'unrelated settings preserved');
    const chain = JSON.parse(readFileSync(join(fakeHome, '.astro', 'code', 'statusline-chain.json'), 'utf8'));
    assert.deepEqual(chain[cfg], original, 'original statusline stashed for restore');

    // idempotent: a second install must not stack a duplicate SessionStart entry
    installClaude(FRAMEWORK);
    const again = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    const banners = again.hooks.SessionStart.flatMap((e) => e.hooks).filter((h) => h.command.includes('astro-update.mjs'));
    assert.equal(banners.length, 1, 'no duplicate banner on re-install');

    uninstallClaude();
    const restored = JSON.parse(readFileSync(join(cfg, 'settings.json'), 'utf8'));
    assert.deepEqual(restored.statusLine, original, 'original statusline restored');
    assert.ok(!restored.hooks || !restored.hooks.SessionStart, 'banner removed');
  });
});

test('install skips a config dir whose settings.json is unparseable (no clobber)', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-hooks-bad-'));
  const cfg = join(fakeHome, '.claude');
  mkdirSync(cfg, { recursive: true });
  writeFileSync(join(cfg, 'settings.json'), '{ not valid json ');

  await withEnv({ home: fakeHome, configDir: cfg }, async () => {
    const { installClaude } = await import(`../lib/install.mjs?b=${encodeURIComponent(fakeHome)}`);
    const res = installClaude(FRAMEWORK);
    const t = res.targets.find((x) => x.dir === cfg);
    assert.equal(t.hooks, false, 'registration reported as skipped');
    // file left byte-for-byte untouched
    assert.equal(readFileSync(join(cfg, 'settings.json'), 'utf8'), '{ not valid json ');
  });
});

test('worker computes behind-count + version against a real clone/upstream', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ac-clone-'));
  const remote = join(dir, 'remote.git');
  const clone = join(dir, 'clone');
  const home = join(dir, 'home');
  mkdirSync(home, { recursive: true });
  const git = (args, cwd) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  git(['init', '--bare', '-b', 'main', remote], dir);
  git(['clone', remote, clone], dir);
  for (const [k, v] of [['user.email', 'a@b.c'], ['user.name', 'Test']]) git(['config', k, v], clone);
  writeFileSync(join(clone, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  git(['add', '.'], clone); git(['commit', '-m', 'v0.1.0'], clone); git(['push', '-u', 'origin', 'main'], clone);

  // advance origin by two commits (one bumps the version) WITHOUT pulling into the clone
  const up = join(dir, 'up');
  git(['clone', remote, up], dir);
  for (const [k, v] of [['user.email', 'a@b.c'], ['user.name', 'Test']]) git(['config', k, v], up);
  writeFileSync(join(up, 'x.txt'), 'hi'); git(['add', '.'], up); git(['commit', '-m', 'c1'], up);
  writeFileSync(join(up, 'package.json'), JSON.stringify({ version: '0.2.0' }));
  git(['add', '.'], up); git(['commit', '-m', 'v0.2.0'], up); git(['push'], up);

  writeFileSync(join(home, 'source'), clone + '\n');
  const worker = join(FRAMEWORK, 'hooks', 'astro-update-worker.mjs');
  const r = spawnSync(process.execPath, [worker], { env: { ...process.env, ASTRO_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0);
  const cache = JSON.parse(readFileSync(join(home, 'update-check.json'), 'utf8'));
  assert.equal(cache.update_available, true);
  assert.equal(cache.behind, 2, 'two commits behind upstream');
  assert.equal(cache.installed, '0.1.0');
  assert.equal(cache.latest, '0.2.0');
});
