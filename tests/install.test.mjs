// Verify the install layout: home at ~/.astro/code, commands/agents symlinked into
// the Claude config dir (~/.claude OR $CLAUDE_CONFIG_DIR), and uninstall reverses it.
// Runs against a throwaway $HOME and a controlled $CLAUDE_CONFIG_DIR so it never
// touches the real user/profile directories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, lstatSync, readlinkSync, mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
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
    // the templates TREE ships too (nested dirs) — /astro-new-kit reads it via `ac path templates`
    assert.ok(existsSync(join(fakeHome, '.astro', 'code', 'templates', 'kit', 'kit.json.tmpl')));
    assert.ok(existsSync(join(fakeHome, '.astro', 'code', 'templates', 'kit', 'tools', 'build_kit.sh')));

    const link = join(fakeHome, '.claude', 'commands', 'astro-status.md');
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.ok(readlinkSync(link).startsWith(join(fakeHome, '.astro', 'code')));

    // the PreCompact continuity hook is wired into settings.json (additive)
    const settingsFile = join(fakeHome, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
    const preCompact = JSON.stringify(settings.hooks?.PreCompact || []);
    assert.match(preCompact, /astro-precompact\.mjs/, 'PreCompact hook registered');

    // the busy/idle dot hooks are wired into the turn-boundary events
    assert.match(JSON.stringify(settings.hooks?.UserPromptSubmit || []), /astro-session-state\.mjs\S* prompt/, 'UserPromptSubmit → busy');
    assert.match(JSON.stringify(settings.hooks?.Stop || []), /astro-session-state\.mjs\S* stop/, 'Stop → idle');

    const un = uninstallClaude();
    assert.ok(un.removed > 0);
    assert.ok(!existsSync(link));
    assert.ok(!existsSync(join(fakeHome, '.astro', 'code')));
    // uninstall removed our PreCompact + busy/idle entries, reversibly
    const after = JSON.parse(readFileSync(settingsFile, 'utf8'));
    assert.doesNotMatch(JSON.stringify(after.hooks?.PreCompact || []), /astro-precompact/, 'PreCompact hook removed on uninstall');
    assert.doesNotMatch(JSON.stringify(after.hooks || {}), /astro-session-state/, 'busy/idle hooks removed on uninstall');
  });
});

test('install does NOT symlink over commands/agents that ARE the framework source (shared subdir via bind mount / symlink)', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const clone = mkdtempSync(join(tmpdir(), 'ac-clone-')); // the framework checkout
  for (const d of ['commands', 'agents', 'workflows', 'hooks']) mkdirSync(join(clone, d), { recursive: true });
  writeFileSync(join(clone, 'commands', 'astro-status.md'), '# real source');
  writeFileSync(join(clone, 'agents', 'astro-verifier.md'), '# real agent');

  // The config dir is a DIFFERENT top-level path whose commands/ and agents/ ARE the
  // clone's (symlinked subdirs stand in for the sandbox's bind mount — same dev+inode,
  // different path). This is the case a resolve()/path-equality guard silently misses.
  const cfg = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
  symlinkSync(join(clone, 'commands'), join(cfg, 'commands'));
  symlinkSync(join(clone, 'agents'), join(cfg, 'agents'));

  await withEnv({ home: fakeHome, configDir: cfg }, async () => {
    const { installClaude } = await import(`../lib/install.mjs?self=${encodeURIComponent(cfg)}`);
    const res = installClaude(clone); // framework root != config dir, but the subdirs coincide

    // the clone's real source files stay REGULAR — never clobbered through the shared subdir
    const cmd = join(clone, 'commands', 'astro-status.md');
    assert.ok(!lstatSync(cmd).isSymbolicLink(), 'source command file must stay a regular file');
    assert.equal(readFileSync(cmd, 'utf8'), '# real source', 'content preserved');
    assert.ok(!lstatSync(join(clone, 'agents', 'astro-verifier.md')).isSymbolicLink(), 'source agent file stays regular');

    const self = res.targets.find((t) => t.dir === cfg);
    assert.ok(self && self.selfHosted, 'target flagged selfHosted (shared source subdir)');
    assert.equal(self.commands, 0, 'no command symlinks written into the source');
    assert.equal(self.agents, 0, 'no agent symlinks written into the source');
  });
});

test('install honors a bare CLAUDE_CONFIG_DIR (no jean-claude)', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const profile = join(fakeHome, '.claude-myprofile');
  await withEnv({ home: fakeHome, configDir: profile }, async () => {
    const { installClaude } = await import(`../lib/install.mjs?p=${encodeURIComponent(profile)}`);
    installClaude(FRAMEWORK);
    assert.ok(lstatSync(join(profile, 'commands', 'astro-status.md')).isSymbolicLink());
  });
});

test('install fans out to the base AND every jean-claude profile', async () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const base = join(fakeHome, '.claude');
  const p1 = join(fakeHome, '.claude-alpha');
  const p2 = join(fakeHome, '.claude-beta');
  // write a jean-claude registry under the base
  mkdirSync(join(base, '.jean-claude'), { recursive: true });
  writeFileSync(join(base, '.jean-claude', 'meta.json'), JSON.stringify({ claudeConfigPath: base }));
  writeFileSync(
    join(base, '.jean-claude', 'profiles.json'),
    JSON.stringify({ profiles: { alpha: { configDir: p1 }, beta: { configDir: p2 } } }),
  );

  await withEnv({ home: fakeHome, configDir: undefined }, async () => {
    const { installClaude, uninstallClaude } = await import(`../lib/install.mjs?j=${encodeURIComponent(fakeHome)}`);
    installClaude(FRAMEWORK);

    // commands linked into the base and BOTH profiles
    for (const dir of [base, p1, p2]) {
      const link = join(dir, 'commands', 'astro-status.md');
      assert.ok(lstatSync(link).isSymbolicLink(), `expected command link in ${dir}`);
      assert.ok(readlinkSync(link).startsWith(join(fakeHome, '.astro', 'code')));
    }

    const un = uninstallClaude();
    assert.ok(un.removed >= 3); // at least one per target
    for (const dir of [base, p1, p2]) {
      assert.ok(!existsSync(join(dir, 'commands', 'astro-status.md')));
    }
  });
});
