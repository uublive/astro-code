// Verify the install layout: home at ~/.astro/code, commands/agents symlinked into
// the Claude config dir (~/.claude OR $CLAUDE_CONFIG_DIR), and uninstall reverses it.
// Runs against a throwaway $HOME and a controlled $CLAUDE_CONFIG_DIR so it never
// touches the real user/profile directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

test('install → ~/.astro/code + symlinks into ~/.claude (default); uninstall reverses it', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  await withEnv({ home: fakeHome, configDir: undefined }, async () => {
    const { installClaude, uninstallClaude } = await import(`../lib/install.mjs?d=${encodeURIComponent(fakeHome)}`);
    const res = installClaude(FRAMEWORK);
    assert.ok(res.commands > 0 && res.agents > 0 && res.workflows > 0);
    assert.ok(existsSync(join(fakeHome, '.astro', 'code', 'workflows', 'execute-phase.mjs')));

    const link = join(fakeHome, '.claude', 'commands', 'astro-status.md');
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.ok(readlinkSync(link).startsWith(join(fakeHome, '.astro', 'code')));

    const un = uninstallClaude();
    assert.ok(un.removed > 0);
    assert.ok(!existsSync(link));
    assert.ok(!existsSync(join(fakeHome, '.astro', 'code')));
  });
});

test('install honors CLAUDE_CONFIG_DIR (profile manager) for command discovery', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const profile = join(fakeHome, '.claude-myprofile');
  await withEnv({ home: fakeHome, configDir: profile }, async () => {
    const { installClaude } = await import(`../lib/install.mjs?p=${encodeURIComponent(profile)}`);
    installClaude(FRAMEWORK);
    // commands must land in the ACTIVE profile dir, not ~/.claude
    const link = join(profile, 'commands', 'astro-status.md');
    assert.ok(lstatSync(link).isSymbolicLink(), 'command should be linked into CLAUDE_CONFIG_DIR');
    assert.ok(!existsSync(join(fakeHome, '.claude', 'commands', 'astro-status.md')), 'should NOT use ~/.claude when a profile is set');
  });
});
