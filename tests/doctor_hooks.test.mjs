// Phase 50 t6 — the hook checks: settings, hook-interpreter, hook-registration, hook-script.
// Each test mutates a REAL install with two Claude profiles (the base dir plus a jean-claude
// profile). Symbols arrive by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'PATH'];

async function sandbox(fn, { cursor = false } = {}) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'ac-dochook-')));
  process.env.HOME = home;
  for (const k of ['CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];
  process.env.PATH = `${mkdtempSync(join(tmpdir(), 'ac-nopath-'))}:${dirname(process.execPath)}`;
  const base = join(home, '.claude');
  const profile = join(home, 'profile-b');
  mkdirSync(join(base, '.jean-claude'), { recursive: true });
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(base, '.jean-claude', 'profiles.json'), JSON.stringify({ profiles: { b: { configDir: profile } } }));
  if (cursor) { process.env.CURSOR_CONFIG_DIR = join(home, '.cursor'); mkdirSync(process.env.CURSOR_CONFIG_DIR); }
  try {
    const q = encodeURIComponent(`${home}-${Math.random()}`);
    const inst = await import(`../lib/install.mjs?d=${q}`);
    inst.installClaude(FRAMEWORK);
    const { runDoctor } = await import(`../lib/doctor.mjs?d=${q}`);
    const astroHome = join(home, '.astro', 'code');
    const scratch = mkdtempSync(join(tmpdir(), 'ac-scratch-'));
    return await fn({ home, astroHome, base, profile, inst, run: () => runDoctor({ astroHome, cwd: scratch }) });
  } finally {
    for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const bad = (rows) => rows.filter((r) => !r.ok);
const settingsOf = (dir) => join(dir, 'settings.json');
const edit = (dir, fn) => {
  const data = JSON.parse(readFileSync(settingsOf(dir), 'utf8'));
  fn(data);
  writeFileSync(settingsOf(dir), JSON.stringify(data, null, 2));
};
// Re-point the interpreter of every command in a settings.json.
const setInterp = (dir, interp) => writeFileSync(settingsOf(dir),
  readFileSync(settingsOf(dir), 'utf8').replace(/"command": "\\"[^"\\]+\\" /g, `"command": "\\"${interp}\\" `));

test('a clean two-profile install has no failing hook row', async () => {
  await sandbox(({ run }) => {
    const rows = run();
    assert.deepEqual(bad(rows), []);
    assert.equal(new Set(rows.filter((r) => r.id === 'hook-script').map((r) => r.dir)).size, 2);
  });
});

test('#126: a dead node interpreter is named for its config dir only', async () => {
  await sandbox(({ run, profile, base }) => {
    const dead = '/opt/homebrew/Cellar/node/0.0.0/bin/node';
    setInterp(profile, dead);
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'hook-interpreter');
    assert.equal(rows[0].dir, profile);
    assert.notEqual(rows[0].dir, base);
    assert.match(rows[0].detail, new RegExp(`${dead.replace(/\//g, '\\/')} missing`));
    assert.equal(rows[0].fix, 'ac install');
  });
});

test('an existing interpreter that does not run is named', async () => {
  await sandbox(({ run, profile, home }) => {
    const sh = join(home, 'fake-runtime');
    writeFileSync(sh, '#!/bin/sh\nexit 1\n'); chmodSync(sh, 0o755);
    setInterp(profile, sh);
    let rows = bad(run());
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /fake-runtime does not run/);
    assert.match(rows[0].fix, /^replace ".*fake-runtime" with ".*" in .*settings\.json$/);
    const plain = join(home, 'not-executable');
    writeFileSync(plain, '#!/bin/sh\nexit 0\n'); chmodSync(plain, 0o644);
    setInterp(profile, plain);
    rows = bad(run());
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /not-executable does not run/);
    assert.equal(rows[0].dir, profile);
  });
});

test('a registered hook script missing from the home copy is named with its path and dir', async () => {
  await sandbox(({ run, astroHome, base, profile }) => {
    const script = join(astroHome, 'hooks', 'astro-precompact.mjs');
    rmSync(script);
    const rows = bad(run());
    assert.deepEqual(rows.map((r) => r.id), ['hook-script', 'hook-script']);
    assert.deepEqual(rows.map((r) => r.dir).sort(), [base, profile].sort());
    assert.ok(rows.every((r) => r.detail.includes(script) && r.fix === 'ac install'));
  });
});

test('principles parts 2..N pointing at one missing script give one row', async () => {
  await sandbox(({ run, astroHome, base, profile }) => {
    const script = join(astroHome, 'hooks', 'astro-principles.mjs');
    rmSync(script);
    const rows = bad(run());
    assert.equal(rows.length, 2, 'one row per dir, not one per part');
    assert.deepEqual(rows.map((r) => r.dir).sort(), [base, profile].sort());
  });
});

test('a guard switched on but not registered is named with ac mods enable', async () => {
  await sandbox(async ({ run, home, base, profile }) => {
    const { setMod } = await import('../lib/mods.mjs');
    setMod({ home, feature: 'git-guard', on: true });
    const rows = bad(run());
    assert.deepEqual(rows.map((r) => r.id), ['hook-registration', 'hook-registration']);
    assert.deepEqual(rows.map((r) => r.dir).sort(), [base, profile].sort());
    assert.ok(rows.every((r) => r.detail === 'git-guard on but not registered' && r.fix === 'ac mods enable git-guard'));
  });
});

test('a guard registered while switched off is named with ac mods disable', async () => {
  await sandbox(async ({ run, astroHome, profile, base }) => {
    const claude = (await import('../lib/hosts/claude.mjs')).default;
    const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
    claude.registerGuard(profile, astroHome, GUARD_HOOKS['canon-guard']);
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dir, profile);
    assert.notEqual(rows[0].dir, base);
    assert.equal(rows[0].detail, 'canon-guard registered while off');
    assert.equal(rows[0].fix, 'ac mods disable canon-guard');
  });
});

test('consistent switches and registrations give no hook-registration failure', async () => {
  await sandbox(async ({ run, home, astroHome, inst }) => {
    const { setMod, syncHookFeatures } = await import('../lib/mods.mjs');
    setMod({ home, feature: 'git-guard', on: true });
    syncHookFeatures({ home, astroHome, targets: inst.configTargets(), cursorTargets: new Map() });
    assert.deepEqual(bad(run()), []);
  });
});

test("a user's own non-astro hook with a dead interpreter is not judged", async () => {
  await sandbox(({ run, profile }) => {
    edit(profile, (d) => {
      d.hooks.Stop.push({ hooks: [{ type: 'command', command: '/no/such/python /home/me/my-hook.py' }] });
      d.hooks.PreToolUse = [{ matcher: 'Bash', hooks: [{ type: 'command', command: '"/no/such/node" "/home/me/mine.mjs"' }] }];
    });
    assert.deepEqual(bad(run()), []);
  });
});

test('an unparseable settings.json is named, not thrown', async () => {
  await sandbox(({ run, profile }) => {
    writeFileSync(settingsOf(profile), '{ nope');
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'settings');
    assert.equal(rows[0].dir, profile);
    assert.match(rows[0].detail, /not valid JSON, so hooks were not checked/);
    assert.equal(rows[0].fix, `edit ${settingsOf(profile)} by hand (not valid JSON)`);
  });
});

test("a Cursor dir riding Claude's import is not a problem", async () => {
  await sandbox(async ({ run, home, astroHome, inst }) => {
    const { setMod, syncHookFeatures } = await import('../lib/mods.mjs');
    const cursorHost = (await import('../lib/hosts/cursor.mjs')).default;
    let rows = run();
    assert.deepEqual(bad(rows), []);
    assert.ok(rows.some((r) => r.host === 'cursor'), 'cursor is detected and examined');
    setMod({ home, feature: 'git-guard', on: true });
    syncHookFeatures({ home, astroHome, targets: inst.configTargets(), cursorTargets: cursorHost.configTargets() });
    rows = run();
    assert.deepEqual(bad(rows), []);
  }, { cursor: true });
});
