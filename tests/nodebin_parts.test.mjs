// hookCommandParts / isAstroScript: the one parser of an astro hook command (phase 50 t1).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('hookCommandParts splits a quoted command', async () => {
  const { hookCommandParts } = await import('../lib/nodebin.mjs');
  assert.deepEqual(hookCommandParts('"/usr/bin/node" "/h/_astro-ctx.mjs" principles'),
    { interp: '/usr/bin/node', script: '/h/_astro-ctx.mjs', rest: ' principles' });
});

test('hookCommandParts splits an unquoted command', async () => {
  const { hookCommandParts } = await import('../lib/nodebin.mjs');
  assert.deepEqual(hookCommandParts('node /h/astro-update.mjs'),
    { interp: 'node', script: '/h/astro-update.mjs', rest: '' });
});

test('hookCommandParts keeps a quoted path with spaces whole', async () => {
  const { hookCommandParts } = await import('../lib/nodebin.mjs');
  const p = hookCommandParts('"/my dir/node" "/my home/astro-x.mjs" a b');
  assert.equal(p.interp, '/my dir/node');
  assert.equal(p.script, '/my home/astro-x.mjs');
  assert.equal(p.rest, ' a b');
});

test('hookCommandParts tolerates leading whitespace', async () => {
  const { hookCommandParts } = await import('../lib/nodebin.mjs');
  const p = hookCommandParts('   node /h/astro-x.mjs');
  assert.equal(p.interp, 'node');
  assert.equal(p.script, '/h/astro-x.mjs');
});

test('hookCommandParts returns null for a non-string or one-token command', async () => {
  const { hookCommandParts } = await import('../lib/nodebin.mjs');
  assert.equal(hookCommandParts(undefined), null);
  assert.equal(hookCommandParts(42), null);
  assert.equal(hookCommandParts('node'), null);
});

test('isAstroScript is true for astro hook files only', async () => {
  const { isAstroScript } = await import('../lib/nodebin.mjs');
  assert.equal(isAstroScript('/x/_astro-ctx.mjs'), true);
  assert.equal(isAstroScript('/x/astro-update.mjs'), true);
  assert.equal(isAstroScript('/x/mine.mjs'), false);
});
