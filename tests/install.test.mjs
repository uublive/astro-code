// Verify the install layout: home at ~/.astro/code, commands/agents symlinked into
// ~/.claude, and uninstall reverses both. Runs against a throwaway $HOME so it
// never touches the real user directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

test('install populates ~/.astro/code + symlinks into ~/.claude; uninstall reverses it', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const prevHome = process.env.HOME;
  process.env.HOME = fakeHome; // uv_os_homedir() honors $HOME on POSIX
  try {
    // import AFTER HOME is set (cache-busted) so ASTRO_HOME resolves to fakeHome
    const { installClaude, uninstallClaude } = await import(`../lib/install.mjs?h=${encodeURIComponent(fakeHome)}`);

    const res = installClaude(FRAMEWORK);
    assert.ok(res.commands > 0 && res.agents > 0 && res.workflows > 0);

    // home holds the artifacts (incl. workflows)
    assert.ok(existsSync(join(fakeHome, '.astro', 'code', 'commands', 'astro-status.md')));
    assert.ok(existsSync(join(fakeHome, '.astro', 'code', 'workflows', 'execute-phase.mjs')));

    // ~/.claude has a symlink pointing back into the home
    const link = join(fakeHome, '.claude', 'commands', 'astro-status.md');
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.ok(readlinkSync(link).startsWith(join(fakeHome, '.astro', 'code')));

    // uninstall removes the links and the home
    const un = uninstallClaude();
    assert.ok(un.removed > 0);
    assert.ok(!existsSync(link));
    assert.ok(!existsSync(join(fakeHome, '.astro', 'code')));
  } finally {
    process.env.HOME = prevHome;
  }
});
