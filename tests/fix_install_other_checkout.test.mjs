// Fix 2026-11-01-ac-update-writes-its-symlinks-into-the: a config dir's commands/ and agents/
// can be links into an astro-code source checkout OTHER than the one being installed (a dev
// repo dogfooded live, while `ac update` installs from its own clone). The self-hosted guard
// compared only against the install's own framework root, so symlinkInto deleted the dev
// repo's tracked files and replaced them with links (a wall of `git` typechanges).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, lstatSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

test('install never writes into a config subdir that is another astro-code checkout', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const dev = mkdtempSync(join(tmpdir(), 'ac-devrepo-')); // a second astro-code checkout
  writeFileSync(join(dev, 'package.json'), JSON.stringify({ name: 'astro-code', version: '0.0.0' }));
  mkdirSync(join(dev, 'bin'));
  writeFileSync(join(dev, 'bin', 'ac.mjs'), '');
  for (const d of ['commands', 'agents']) mkdirSync(join(dev, d));
  writeFileSync(join(dev, 'commands', 'astro-status.md'), '# dev source');
  writeFileSync(join(dev, 'agents', 'astro-executor.md'), '# dev agent');

  const cfg = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
  symlinkSync(join(dev, 'commands'), join(cfg, 'commands'));
  symlinkSync(join(dev, 'agents'), join(cfg, 'agents'));

  const prev = { HOME: process.env.HOME, CFG: process.env.CLAUDE_CONFIG_DIR, CURSOR: process.env.CURSOR_CONFIG_DIR, PATH: process.env.PATH };
  process.env.HOME = fakeHome;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  delete process.env.CURSOR_CONFIG_DIR;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'ac-no-cursor-'));
  try {
    const { installClaude } = await import(`../lib/install.mjs?other=${encodeURIComponent(cfg)}`);
    const res = installClaude(FRAMEWORK); // installs from a DIFFERENT checkout than dev

    const cmd = join(dev, 'commands', 'astro-status.md');
    assert.ok(!lstatSync(cmd).isSymbolicLink(), 'the dev checkout command stays a regular file');
    assert.equal(readFileSync(cmd, 'utf8'), '# dev source');
    const agt = join(dev, 'agents', 'astro-executor.md');
    assert.ok(!lstatSync(agt).isSymbolicLink(), 'the dev checkout agent stays a regular file');
    assert.equal(readFileSync(agt, 'utf8'), '# dev agent');

    const t = res.targets.find((x) => x.dir === cfg);
    assert.ok(t && t.selfHosted, 'target flagged selfHosted');
    assert.equal(t.commands, 0);
    assert.equal(t.agents, 0);
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['CLAUDE_CONFIG_DIR', prev.CFG], ['CURSOR_CONFIG_DIR', prev.CURSOR], ['PATH', prev.PATH]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
