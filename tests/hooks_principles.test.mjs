// Phase 25 t13 — spec for principles delivery via the SessionStart / PreCompact
// hooks (P10, D1, CRITERIA C10). Spawns hooks/astro-update.mjs and
// hooks/astro-precompact.mjs as real subprocesses against an isolated HOME and a
// seeded ASTRO_PRINCIPLES_DIR store — nothing here touches a developer's real
// `~/.astro/principles`. The hooks do not read principles yet (t14 wires that in),
// so these assertions currently fail RED (ADR-018 applies to hook subprocess specs
// too, per this phase's plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const UPDATE_HOOK = join(FRAMEWORK, 'hooks', 'astro-update.mjs');
const PRECOMPACT_HOOK = join(FRAMEWORK, 'hooks', 'astro-precompact.mjs');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function seededStore(home) {
  const store = mkdtempSync(join(tmpdir(), 'ac-hooks-store-'));
  const env = { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store };
  for (let i = 0; i < 150; i++) {
    spawnSync(process.execPath, [AC, 'principles', 'add', `default statement number ${i}`, '--kind', 'pattern'], { encoding: 'utf8', env });
  }
  for (const [n, why] of [['1', 'WHYRULE1'], ['2', 'WHYRULE2'], ['3', 'WHYRULE3']]) {
    spawnSync(process.execPath, [AC, 'principles', 'add', `rule statement ${n}`, '--kind', 'pattern', '--strength', 'rule', '--why', why], { encoding: 'utf8', env });
  }
  spawnSync(process.execPath, [AC, 'principles', 'add', 'a default with a special why', '--kind', 'pattern', '--why', 'WHYDEFAULT'], { encoding: 'utf8', env });
  return store;
}

function mkProject(home, store) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-hooks-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  const env = { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store };
  spawnSync(process.execPath, [AC, 'init'], { cwd: dir, encoding: 'utf8', env });
  return dir;
}

function runHook(hook, input, home, store) {
  return spawnSync(process.execPath, [hook], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store },
    windowsHide: true,
  });
}

test('SessionStart startup: additionalContext carries all 3 rules + whys + index, never WHYDEFAULT', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-hooks-home-'));
  const store = seededStore(home);
  const proj = mkProject(home, store);
  const r = runHook(UPDATE_HOOK, { cwd: proj, source: 'startup' }, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout || '{}');
  const ctx = out?.hookSpecificOutput?.additionalContext || '';
  assert.ok(ctx.includes('WHYRULE1'));
  assert.ok(ctx.includes('WHYRULE2'));
  assert.ok(ctx.includes('WHYRULE3'));
  assert.ok(!ctx.includes('WHYDEFAULT'));
});

test('SessionStart is present on clear/compact too (banner-skip rule is visual only)', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-hooks-home-'));
  const store = seededStore(home);
  const proj = mkProject(home, store);
  const r = runHook(UPDATE_HOOK, { cwd: proj, source: 'clear' }, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout || '{}');
  assert.ok(out?.hookSpecificOutput?.additionalContext);
});

test('PreCompact systemMessage carries the same principles section', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-hooks-home-'));
  const store = seededStore(home);
  const proj = mkProject(home, store);
  const r = runHook(PRECOMPACT_HOOK, { cwd: proj }, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout || '{}');
  assert.ok(out.systemMessage.includes('WHYRULE1'));
});

test('outside an astro project: no section, no error, exit 0', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-hooks-home-'));
  const store = seededStore(home);
  const bare = mkdtempSync(join(tmpdir(), 'ac-hooks-bare-'));
  const r = runHook(UPDATE_HOOK, { cwd: bare, source: 'startup' }, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
});
