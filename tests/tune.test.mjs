// `ac tune` — the astro-recommended Claude settings profile. The contract under
// test is ADDITIVE + REVERSIBLE: user-authored settings always survive a tune and
// an undo removes exactly what tune added, nothing else. HOME is redirected per
// test so the manifest (~/.astro/code/tune.json) never touches the real user.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

function withEnv(home, fn) {
  const prev = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve(fn()).finally(() => { process.env.HOME = prev; });
}
const readSettings = (f) => JSON.parse(readFileSync(f, 'utf8'));

test('tune is additive: creates settings.json, adds allow entries + absent keys only', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-tune-'));
  await withEnv(home, async () => {
    const { applyTune, TUNE_ALLOW, TUNE_DEFAULTS } = await import(`../lib/tune.mjs?a=${encodeURIComponent(home)}`);
    const file = join(home, 'proj', '.claude', 'settings.json');
    mkdirSync(dirname(file), { recursive: true });

    const res = applyTune(file);
    const s = readSettings(file);
    for (const e of TUNE_ALLOW) assert.ok(s.permissions.allow.includes(e), `allow has ${e}`);
    for (const [k, v] of Object.entries(TUNE_DEFAULTS)) assert.equal(s[k], v, `${k} set`);
    assert.equal(res.added.allow.length, TUNE_ALLOW.length);

    // idempotent: a second tune adds nothing and duplicates nothing
    const again = applyTune(file);
    assert.equal(again.added.allow.length, 0, 'second tune adds no allow entries');
    assert.equal(readSettings(file).permissions.allow.filter((e) => e === TUNE_ALLOW[0]).length, 1, 'no duplicates');
  });
});

test('tune never overrides a user-chosen value; undo removes exactly what tune added', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-tune-'));
  await withEnv(home, async () => {
    const { applyTune, undoTune } = await import(`../lib/tune.mjs?b=${encodeURIComponent(home)}`);
    const file = join(home, 'proj', '.claude', 'settings.json');
    mkdirSync(dirname(file), { recursive: true });
    // the user already chose fastMode:true and has their own allow entry + hook
    writeFileSync(file, JSON.stringify({
      fastMode: true,
      permissions: { allow: ['Bash(npm run *)'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] },
    }));

    applyTune(file);
    let s = readSettings(file);
    assert.equal(s.fastMode, true, 'user fastMode:true NOT overridden');
    assert.equal(s.alwaysThinkingEnabled, true, 'absent key set');
    assert.ok(s.permissions.allow.includes('Bash(npm run *)'), 'user allow entry preserved');

    const res = undoTune(file);
    assert.ok(res.undone);
    s = readSettings(file);
    assert.equal(s.fastMode, true, 'user key survives undo');
    assert.ok(!('alwaysThinkingEnabled' in s), 'tune-set key removed');
    assert.deepEqual(s.permissions.allow, ['Bash(npm run *)'], 'only tune allow entries removed');
    assert.ok(s.hooks.Stop, 'unrelated settings untouched');

    assert.equal(undoTune(file).undone, false, 'second undo is a no-op');
  });
});

test('the ac tune CLI verb tunes the project .claude/settings.json and undoes it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-tune-'));
  const proj = join(home, 'proj');
  mkdirSync(join(proj, '.astrocode'), { recursive: true });
  writeFileSync(join(proj, '.astrocode', 'state.json'), '{}');
  writeFileSync(join(proj, '.astrocode', 'roadmap.json'), '{"version":1,"milestone":1,"phases":[]}');
  const ac = (args) => spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args],
    { cwd: proj, encoding: 'utf8', env: { ...process.env, HOME: home } });

  const r = ac(['tune']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ tuned .*settings\.json\s+\[project\]/);
  assert.match(r.stdout, /not touchable/, 'names the internal-only settings it will not write');
  const s = readSettings(join(proj, '.claude', 'settings.json'));
  assert.ok(s.permissions.allow.some((e) => e.startsWith('Bash(ac ')), 'ac allowlisted');

  const u = ac(['tune', '--undo']);
  assert.equal(u.status, 0, u.stderr);
  assert.match(u.stdout, /✓ tune undone/);
  // tune created the file; a full undo must remove it, not leave an empty `{}`
  const { existsSync } = await import('node:fs');
  assert.ok(!existsSync(join(proj, '.claude', 'settings.json')), 'tune-created file removed on full undo');
});
