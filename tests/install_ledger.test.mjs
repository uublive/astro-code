// Phase 50 t4 — the install ledger (published.json) and the exported sameDir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

function withEnv({ home, configDir }, fn) {
  const keys = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'PATH'];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = configDir;
  delete process.env.CURSOR_CONFIG_DIR; delete process.env.CODEX_HOME;
  process.env.PATH = mkdtempSync(join(tmpdir(), 'ac-no-host-'));
  return Promise.resolve(fn()).finally(() => {
    for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  });
}

test('installClaude records every config dir it published into in published.json', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-led-'));
  const cfg = join(home, 'c1');
  await withEnv({ home, configDir: cfg }, async () => {
    const { installClaude, readPublished } = await import(`../lib/install.mjs?led=${encodeURIComponent(home)}`);
    installClaude(FRAMEWORK);
    const ledger = JSON.parse(readFileSync(join(home, '.astro', 'code', 'published.json'), 'utf8'));
    assert.ok(ledger.claude.includes(cfg));
    assert.deepEqual(readPublished(join(home, '.astro', 'code')), ledger);
  });
});

test('a second install with a different CLAUDE_CONFIG_DIR keeps the earlier dir in the ledger', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-led-'));
  const [a, b] = [join(home, 'a'), join(home, 'b')];
  await withEnv({ home, configDir: a }, async () => {
    const m = await import(`../lib/install.mjs?led2=${encodeURIComponent(home)}`);
    m.installClaude(FRAMEWORK);
  });
  await withEnv({ home, configDir: b }, async () => {
    const m = await import(`../lib/install.mjs?led2=${encodeURIComponent(home)}`);
    m.installClaude(FRAMEWORK);
    const dirs = m.readPublished(join(home, '.astro', 'code')).claude;
    assert.ok(dirs.includes(a) && dirs.includes(b));
    assert.equal(new Set(dirs).size, dirs.length);
  });
});

test('readPublished returns an empty map for a missing or malformed ledger', async () => {
  const { readPublished } = await import('../lib/install.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ac-led-'));
  assert.deepEqual(readPublished(dir), {});
  writeFileSync(join(dir, 'published.json'), '{ nope');
  assert.deepEqual(readPublished(dir), {});
  writeFileSync(join(dir, 'published.json'), '[1]');
  assert.deepEqual(readPublished(dir), {});
});

test('sameDir is true for a symlink to the same dir and false for a missing path', async () => {
  const { sameDir } = await import('../lib/install.mjs');
  const d = mkdtempSync(join(tmpdir(), 'ac-same-'));
  mkdirSync(join(d, 'a'));
  symlinkSync(join(d, 'a'), join(d, 'link'));
  assert.equal(sameDir(join(d, 'a'), join(d, 'link')), true);
  assert.equal(sameDir(join(d, 'a'), join(d, 'nope')), false);
  assert.equal(sameDir(join(d, 'a'), d), false);
});
