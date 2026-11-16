// Fix 2026-11-16-astro-mods-hooks-run-bare-ac-which (reported by Andrea): the astro-mods hooks ran `ac` by
// its bare name. Claude Code can start them with a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin), where
// macOS resolves `ac` to /usr/sbin/ac, the login-accounting command, which prints "total 0.00": every
// read failed as "ac printed output that is not JSON" and the mods switched off. The hooks now take the
// command from hooks/lib/ac.js, which `ac install` rewrites in the installed copy with absolute paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = join(FRAMEWORK, 'mods', 'astro-mods', 'hooks');
const MINIMAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

const sources = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  if (statSync(p).isDirectory()) return sources(p);
  return /\.(js|tsx?)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

test('no astro-mods hook spells a bare `ac` argv: every call goes through hooks/lib/ac.js', () => {
  const bare = sources(HOOKS).filter((f) => /\[\s*['"]ac['"]\s*,/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bare.map((f) => f.slice(HOOKS.length + 1)), []);
});

test('the repo copy of hooks/lib/ac.js is the plain `ac` (tests and a dev checkout are unchanged)', async () => {
  const { AC } = await import(pathToFileURL(join(HOOKS, 'lib', 'ac.js')).href);
  assert.deepEqual(AC, ['ac']);
});

test('ac install pins the installed hooks/lib/ac.js to absolute node + bin/ac.mjs, which answer under the minimal PATH', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-home-'));
  const prev = { HOME: process.env.HOME, CFG: process.env.CLAUDE_CONFIG_DIR, CURSOR: process.env.CURSOR_CONFIG_DIR, PATH: process.env.PATH };
  process.env.HOME = home;
  delete process.env.CLAUDE_CONFIG_DIR;
  delete process.env.CURSOR_CONFIG_DIR;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'ac-no-cursor-'));
  try {
    const { installClaude } = await import(`../lib/install.mjs?bare=${encodeURIComponent(home)}`);
    installClaude(FRAMEWORK);
    const file = join(home, '.astro', 'code', 'mods', 'astro-mods', 'hooks', 'lib', 'ac.js');
    assert.ok(existsSync(file), 'the installed copy has hooks/lib/ac.js');
    const { AC } = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
    assert.equal(AC.length, 2);
    assert.ok(AC.every((p) => isAbsolute(p) && existsSync(p)), JSON.stringify(AC));
    assert.equal(AC[0], process.execPath);
    assert.ok(AC[1].endsWith(join('bin', 'ac.mjs')));
    const r = spawnSync(AC[0], [...AC.slice(1), '--version'], { encoding: 'utf8', env: { PATH: MINIMAL_PATH, HOME: home } });
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /total\s+\d/, 'not the macOS login-accounting ac');
  } finally {
    for (const [k, v] of [['HOME', prev.HOME], ['CLAUDE_CONFIG_DIR', prev.CFG], ['CURSOR_CONFIG_DIR', prev.CURSOR], ['PATH', prev.PATH]]) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
