// Phase 50 t3 — the additionalDirectories grant (#15, PLAN P1). registerHooks writes the RESOLVED
// astro home, unregisterHooks removes only that string, grantState reads it without writing.
// Dynamic imports (ADR-018); real temp dirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const claude = () => import('../lib/hosts/claude.mjs');
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'ac-grant-')));
const read = (dir) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
const write = (dir, data) => writeFileSync(join(dir, 'settings.json'), typeof data === 'string' ? data : JSON.stringify(data));

test('registerHooks grants the resolved astro home in additionalDirectories', async () => {
  const { registerHooks } = await claude();
  const dir = tmp(); const home = tmp();
  registerHooks(dir, home);
  assert.deepEqual(read(dir).permissions.additionalDirectories, [home]);
});

test("registerHooks keeps the user's own additionalDirectories entries and adds ours once", async () => {
  const { registerHooks } = await claude();
  const dir = tmp(); const home = tmp();
  write(dir, { permissions: { allow: ['Bash(ls)'], additionalDirectories: ['/mine'] } });
  registerHooks(dir, home); registerHooks(dir, home);
  const p = read(dir).permissions;
  assert.deepEqual(p.additionalDirectories, ['/mine', home]);
  assert.deepEqual(p.allow, ['Bash(ls)']);
});

test('with a symlinked home the grant is the resolved path, not the unresolved one (#15)', async () => {
  const { registerHooks, grantPath } = await claude();
  const real = tmp(); const link = join(tmp(), 'link');
  symlinkSync(real, link);
  mkdirSync(join(real, '.astro', 'code'), { recursive: true });
  const dir = tmp();
  registerHooks(dir, join(link, '.astro', 'code'));
  assert.deepEqual(read(dir).permissions.additionalDirectories, [join(real, '.astro', 'code')]);
  assert.equal(grantPath(join(link, '.astro', 'code')), join(real, '.astro', 'code'));
});

test('unregisterHooks removes only our grant and drops an array it emptied', async () => {
  const { registerHooks, unregisterHooks } = await claude();
  const dir = tmp(); const home = tmp();
  registerHooks(dir, home);
  unregisterHooks(dir, home);
  assert.equal(read(dir).permissions, undefined);
  write(dir, { permissions: { additionalDirectories: ['/mine'] } });
  registerHooks(dir, home); unregisterHooks(dir, home);
  assert.deepEqual(read(dir).permissions.additionalDirectories, ['/mine']);
});

test('grantState is granted for the resolved path or a resolved ancestor', async () => {
  const { grantState } = await claude();
  const dir = tmp(); const home = tmp();
  write(dir, { permissions: { additionalDirectories: [home] } });
  assert.equal(grantState(dir, home), 'granted');
  write(dir, { permissions: { additionalDirectories: [`${home}/`] } });
  assert.equal(grantState(dir, home), 'granted');
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  write(dir, { permissions: { additionalDirectories: [home] } });
  assert.equal(grantState(dir, join(home, '.astro', 'code')), 'granted');
});

test('grantState is missing for no grant and for the unresolved form of a symlinked home', async () => {
  const { grantState } = await claude();
  const dir = tmp();
  const real = tmp(); const link = join(tmp(), 'link');
  symlinkSync(real, link);
  assert.equal(grantState(dir, real), 'missing');
  write(dir, { permissions: { additionalDirectories: ['/elsewhere'] } });
  assert.equal(grantState(dir, real), 'missing');
  write(dir, { permissions: { additionalDirectories: [link] } });
  assert.equal(grantState(dir, link), 'missing');
  assert.equal(grantState(join(dir, 'nope'), real), 'no-dir');
});

test('grantState is unreadable for invalid JSON and never writes', async () => {
  const { grantState } = await claude();
  const dir = tmp(); const home = tmp();
  write(dir, '{ not json');
  assert.equal(grantState(dir, home), 'unreadable');
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8'), '{ not json');
});
