// Phase 50 t2 — the read-only readers `ac doctor` builds on: hookRegistrations (switch vs
// registration) and installedPluginVersion (what Claude Code recorded). Every symbol arrives
// through a dynamic import (ADR-018); real temp dirs, no `claude` anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUGIN = 'astro-mods@astro-code';
const tmp = () => mkdtempSync(join(tmpdir(), 'ac-moddoc-'));

async function world() {
  const { GUARD_HOOKS } = await import('../lib/hosts/guards.mjs');
  const claude = (await import('../lib/hosts/claude.mjs')).default;
  const home = tmp();
  const astroHome = join(home, '.astro', 'code');
  mkdirSync(join(astroHome, 'hooks'), { recursive: true });
  for (const spec of Object.values(GUARD_HOOKS)) writeFileSync(join(astroHome, 'hooks', spec.script), '// stub\n');
  const dir = join(home, '.claude');
  mkdirSync(dir, { recursive: true });
  const targets = new Map([[dir, 'base']]);
  const reg = (feature) => claude.registerGuard(dir, astroHome, GUARD_HOOKS[feature]);
  const setSwitch = async (feature, on) => (await import('../lib/mods.mjs')).setMod({ home, feature, on });
  return { home, astroHome, dir, targets, reg, setSwitch };
}
const rowsOf = async (w, cursorTargets = new Map()) => (await import('../lib/mods.mjs'))
  .hookRegistrations({ home: w.home, astroHome: w.astroHome, targets: w.targets, cursorTargets });
const find = (rows, feature) => rows.find((r) => r.feature === feature && r.host === 'claude');

test('hookRegistrations reports a switched-on guard with no entry as missing', async () => {
  const w = await world();
  await w.setSwitch('git-guard', true);
  const r = find(await rowsOf(w), 'git-guard');
  assert.equal(r.on, true);
  assert.equal(r.state, 'missing');
  assert.equal(r.dir, w.dir);
});

test('hookRegistrations reports an entry for a switched-off guard', async () => {
  const w = await world();
  w.reg('git-guard');
  const r = find(await rowsOf(w), 'git-guard');
  assert.equal(r.on, false);
  assert.equal(r.state, 'enforced');
});

test('hookRegistrations agrees when on everywhere or off everywhere', async () => {
  const w = await world();
  let rows = await rowsOf(w);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((r) => !r.on && r.state === 'missing'));
  await w.setSwitch('git-guard', true); await w.setSwitch('canon-guard', true);
  w.reg('git-guard'); w.reg('canon-guard');
  rows = await rowsOf(w);
  assert.ok(rows.every((r) => r.on === (r.state === 'enforced')));
});

test('hookRegistrations marks a Cursor dir native only when its own hooks.json carries the entry', async () => {
  const w = await world();
  const cdir = join(w.home, '.cursor'); mkdirSync(cdir);
  const rows = await rowsOf(w, new Map([[cdir, 'base']]));
  const c = rows.find((r) => r.host === 'cursor' && r.feature === 'git-guard');
  assert.equal(c.native, false);
});

function plugins(dir, data) {
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), typeof data === 'string' ? data : JSON.stringify(data));
}

test('installedPluginVersion reads the version-2 installed_plugins.json layout', async () => {
  const { installedPluginVersion } = await import('../lib/mods.mjs');
  const dir = tmp();
  plugins(dir, { version: 2, plugins: { [PLUGIN]: [{ scope: 'user', installPath: '/x/0.41.0', version: '0.41.0' }] } });
  assert.deepEqual(installedPluginVersion(dir), { version: '0.41.0', installPath: '/x/0.41.0' });
});

test('installedPluginVersion tolerates the flat shape and an object per id', async () => {
  const { installedPluginVersion } = await import('../lib/mods.mjs');
  const dir = tmp();
  plugins(dir, { [PLUGIN]: { version: '0.1.0' } });
  assert.equal(installedPluginVersion(dir).version, '0.1.0');
});

test("installedPluginVersion falls back to installPath's plugin.json", async () => {
  const { installedPluginVersion } = await import('../lib/mods.mjs');
  const dir = tmp();
  const ip = join(dir, 'cache');
  mkdirSync(join(ip, '.claude-plugin'), { recursive: true });
  writeFileSync(join(ip, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'astro-mods', version: '0.50.1' }));
  plugins(dir, { version: 2, plugins: { [PLUGIN]: [{ installPath: ip }] } });
  assert.deepEqual(installedPluginVersion(dir), { version: '0.50.1', installPath: ip });
});

test('installedPluginVersion returns null when the plugin was never installed', async () => {
  const { installedPluginVersion } = await import('../lib/mods.mjs');
  const dir = tmp();
  assert.equal(installedPluginVersion(dir), null);
  plugins(dir, { version: 2, plugins: { 'other@x': [{ version: '1' }] } });
  assert.equal(installedPluginVersion(dir), null);
});

test('installedPluginVersion marks a malformed record unreadable, never throws', async () => {
  const { installedPluginVersion } = await import('../lib/mods.mjs');
  const a = tmp(); plugins(a, '{ nope');
  assert.deepEqual(installedPluginVersion(a), { unreadable: true });
  const b = tmp(); plugins(b, { plugins: { [PLUGIN]: [{ scope: 'user' }] } });
  assert.deepEqual(installedPluginVersion(b), { unreadable: true });
  const c = tmp(); plugins(c, { plugins: { [PLUGIN]: 'junk' } });
  assert.deepEqual(installedPluginVersion(c), { unreadable: true });
});

test('neither reader spawns claude', async () => {
  const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/mods.mjs', import.meta.url), 'utf8'));
  const body = (name) => src.slice(src.indexOf(`export function ${name}`)).split('\n}\n')[0];
  for (const n of ['hookRegistrations', 'installedPluginVersion']) {
    assert.doesNotMatch(body(n), /runClaude|spawnSync|claudeVersion|pluginState/, n);
  }
});
