// Phase 59 t4 — the private Go build cache and its oldest-first size cap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { goCacheDir, goCacheMaxMb, trimGoCache } from '../lib/gocache.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'gocache-'));
// 10 files of 100 bytes; file i has mtime i seconds after the epoch, so f0 is oldest.
function fill(dir) {
  mkdirSync(join(dir, 'ab'), { recursive: true });
  const names = [];
  for (let i = 0; i < 10; i += 1) {
    const p = join(dir, i % 2 ? 'ab' : '.', `f${i}`);
    writeFileSync(p, 'x'.repeat(100));
    utimesSync(p, 1000 + i, 1000 + i);
    names.push(p);
  }
  return names;
}

test('goCacheDir is a stable folder under the heavy home', () => {
  assert.equal(goCacheDir('/h'), '/h/gocache');
});

test('over the cap, exactly the oldest files are removed until it fits', () => {
  const d = tmp();
  const names = fill(d);
  const r = trimGoCache(d, 650);
  assert.equal(r.before_bytes, 1000);
  assert.equal(r.after_bytes, 600);
  assert.equal(r.evicted, 4);
  assert.equal(r.evicted_bytes, 400);
  names.forEach((p, i) => assert.equal(existsSync(p), i >= 4, `f${i}`));
});

test('a cache under the cap is untouched', () => {
  const d = tmp();
  const names = fill(d);
  const r = trimGoCache(d, 5000);
  assert.deepEqual([r.evicted, r.after_bytes], [0, 1000]);
  assert.ok(names.every((p) => existsSync(p)));
});

test('an empty or missing dir reports zeros', () => {
  const zero = { before_bytes: 0, after_bytes: 0, evicted: 0, evicted_bytes: 0 };
  assert.deepEqual(trimGoCache(tmp(), 10), zero);
  assert.deepEqual(trimGoCache(join(tmp(), 'nope'), 10), zero);
});

test('symlinks are not followed and their targets survive', () => {
  const d = tmp();
  const outside = tmp();
  writeFileSync(join(outside, 'big'), 'x'.repeat(5000));
  symlinkSync(outside, join(d, 'link'));
  writeFileSync(join(d, 'f'), 'x'.repeat(100));
  trimGoCache(d, 0);
  assert.ok(existsSync(join(outside, 'big')));
  assert.equal(existsSync(join(d, 'f')), false);
});

test('heavy.go_cache_max_mb is read, validated and defaulted to 5120', () => {
  const root = tmp();
  mkdirSync(join(root, '.astrocode'));
  const cfg = (v) => writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ heavy: { go_cache_max_mb: v } }));
  assert.equal(goCacheMaxMb(root, []), 5120);
  cfg(200);
  assert.equal(goCacheMaxMb(root, []), 200);
  cfg(-3);
  const w = [];
  assert.equal(goCacheMaxMb(root, w), 5120);
  assert.deepEqual(w, ['heavy.go_cache_max_mb "-3" is not a number > 0 — ignored']);
});
