// Phase 50 t5 — lib/doctor.mjs core: runner, row shape, renderer, and the global and per-Claude-dir
// checks. A fake HOME holds a REAL installClaude(FRAMEWORK); each test then mutates that tree.
// Symbols arrive by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync,
  symlinkSync, realpathSync, utimesSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEYS = ['HOME', 'CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'PATH'];

// Install into a fake home, run `fn` with HOME pointed at it, restore the environment.
async function sandbox(fn, { link = false, configDir } = {}) {
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ac-doc-')));
  let home = join(base, 'home');
  mkdirSync(home, { recursive: true });
  if (link) { symlinkSync(home, join(base, 'link')); home = join(base, 'link'); }
  process.env.HOME = home;
  for (const k of ['CLAUDE_CONFIG_DIR', 'CURSOR_CONFIG_DIR', 'CODEX_HOME', 'XDG_CONFIG_HOME']) delete process.env[k];
  if (configDir) process.env.CLAUDE_CONFIG_DIR = configDir(home);
  process.env.PATH = `${mkdtempSync(join(tmpdir(), 'ac-nopath-'))}:${dirname(process.execPath)}`;
  try {
    const q = encodeURIComponent(`${home}-${Math.random()}`);
    const inst = await import(`../lib/install.mjs?d=${q}`);
    inst.installClaude(FRAMEWORK);
    const { runDoctor, renderDoctor } = await import(`../lib/doctor.mjs?d=${q}`);
    const astroHome = join(home, '.astro', 'code');
    const scratch = mkdtempSync(join(tmpdir(), 'ac-scratch-'));
    return await fn({
      home, astroHome, claudeDir: join(home, '.claude'), scratch, inst,
      run: (o = {}) => runDoctor({ astroHome, cwd: scratch, ...o }), render: renderDoctor,
    });
  } finally {
    for (const k of KEYS) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
  }
}
const bad = (rows) => rows.filter((r) => !r.ok);
const ofId = (rows, id) => rows.filter((r) => r.id === id);

test('a clean install reports no failing row', async () => {
  await sandbox(({ run, render }) => {
    const rows = run();
    assert.deepEqual(bad(rows), []);
    for (const r of rows) assert.deepEqual(Object.keys(r), ['id', 'host', 'dir', 'ok', 'detail', 'fix']);
    assert.equal(render(rows).length, 1);
    assert.match(render(rows)[0], /^✓ install consistent — \d+ checks across 1 config dir\(s\)$/);
    assert.equal(ofId(rows, 'plugin').length, 0, 'no plugin record, no plugin row');
  });
});

test('an installed version older than the clone is named with ac update', async () => {
  await sandbox(({ run, astroHome }) => {
    writeFileSync(join(astroHome, 'version'), '0.0.1\n');
    const rows = bad(run({ clone: FRAMEWORK }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'version');
    assert.match(rows[0].detail, /installed v0\.0\.1, clone v\d/);
    assert.equal(rows[0].fix, 'ac update');
  });
});

test('a year-old update cache is named with ac update, a missing one is not', async () => {
  await sandbox(({ run, astroHome }) => {
    assert.deepEqual(bad(run()), []);
    const file = join(astroHome, 'update-check.json');
    const year = Date.now() - 365 * 86_400_000;
    writeFileSync(file, JSON.stringify({ update_available: false, checked: Math.floor(year / 1000) }));
    utimesSync(file, new Date(year), new Date(year));
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'update-cache');
    assert.match(rows[0].detail, /last ran 36\d days ago/);
    assert.equal(rows[0].fix, 'ac update');
    rmSync(file);
    assert.deepEqual(bad(run()), []);
  });
});

test('a future-dated update cache is not stale', async () => {
  await sandbox(({ run, astroHome }) => {
    const file = join(astroHome, 'update-check.json');
    const future = Date.now() + 400 * 86_400_000;
    writeFileSync(file, JSON.stringify({ checked: Math.floor(future / 1000) }));
    utimesSync(file, new Date(future), new Date(future));
    assert.deepEqual(bad(run()), []);
  });
});

test('#15: a grant written in the unresolved form of a symlinked home is named with the resolved path', async () => {
  await sandbox(({ run, claudeDir, astroHome, home }) => {
    const resolved = realpathSync(astroHome);
    assert.notEqual(resolved, astroHome, 'the home is reached through a symlink');
    const file = join(claudeDir, 'settings.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(data.permissions.additionalDirectories, [resolved], 'install granted the resolved form');
    assert.deepEqual(bad(run()), []);
    data.permissions.additionalDirectories = [astroHome];
    writeFileSync(file, JSON.stringify(data));
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'grant');
    assert.equal(rows[0].dir, claudeDir);
    assert.ok(rows[0].fix.includes(resolved));
    void home;
  }, { link: true });
});

test('a missing grant is named per profile', async () => {
  await sandbox(({ run, claudeDir, home }) => {
    const second = join(home, 'claude2');
    process.env.CLAUDE_CONFIG_DIR = second;
    mkdirSync(second, { recursive: true });
    writeFileSync(join(second, 'settings.json'), '{}\n');
    writeFileSync(join(claudeDir, 'settings.json'), '{}\n');
    const rows = bad(run()).filter((r) => r.id === 'grant');
    assert.deepEqual(rows.map((r) => r.dir).sort(), [claudeDir, second].sort());
    assert.ok(rows.every((r) => r.host === 'claude' && /ac install/.test(r.fix)));
  });
});

function plugin(dir, version, astroHome) {
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2, plugins: { 'astro-mods@astro-code': [{ scope: 'user', installPath: join(dir, 'plugins', 'cache'), version }] },
  }));
  void astroHome;
}

test('a stale astro-mods plugin version (0.41.0) is named with both versions', async () => {
  await sandbox(({ run, claudeDir, astroHome }) => {
    const current = JSON.parse(readFileSync(join(FRAMEWORK, 'package.json'), 'utf8')).version;
    plugin(claudeDir, current, astroHome);
    assert.deepEqual(bad(run()), []);
    plugin(claudeDir, '0.41.0', astroHome);
    const rows = bad(run());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'plugin');
    assert.equal(rows[0].dir, claudeDir);
    assert.match(rows[0].detail, new RegExp(`astro-mods v0\\.41\\.0 installed, astro-code v${current.replace(/\./g, '\\.')}`));
    assert.equal(rows[0].fix, 'ac update');
  });
});

test('no installed_plugins.json means no plugin row', async () => {
  await sandbox(({ run }) => assert.equal(ofId(run(), 'plugin').length, 0));
});

test('an unreadable plugin record is skipped, not failed', async () => {
  await sandbox(({ run, claudeDir }) => {
    mkdirSync(join(claudeDir, 'plugins'), { recursive: true });
    writeFileSync(join(claudeDir, 'plugins', 'installed_plugins.json'), '{ nope');
    const rows = run();
    assert.deepEqual(bad(rows), []);
    assert.match(ofId(rows, 'plugin')[0].detail, /^skipped —/);
  });
});

test('outside a project the registry check is skipped, not failed', async () => {
  await sandbox(({ run }) => {
    const reg = ofId(run(), 'registry');
    assert.equal(reg.length, 1);
    assert.equal(reg[0].ok, true);
    assert.match(reg[0].detail, /^skipped —/);
  });
});

test('registry drift is reported exactly when canonCheck reports it', async () => {
  const { canonCheck, canonPush } = await import('../lib/canon.mjs');
  await sandbox(({ run }) => {
    const bare = join(mkdtempSync(join(tmpdir(), 'ac-origin-')), 'origin.git');
    git(['init', '--quiet', '--bare', bare]);
    const proj = mkdtempSync(join(tmpdir(), 'ac-proj-'));
    git(['init', '--quiet'], { cwd: proj });
    git(['config', 'user.email', 'a@example.com'], { cwd: proj });
    git(['config', 'user.name', 'a'], { cwd: proj });
    git(['remote', 'add', 'origin', bare], { cwd: proj });
    initPlanning(proj, { name: 'proj' });
    writeFileSync(paths(proj).conventions, '# Conventions\n\n- one.\n');
    assert.equal(canonPush(proj).ok, true);
    assert.equal(canonCheck(proj).ok, true);
    assert.deepEqual(bad(run({ cwd: proj })), []);
    writeFileSync(paths(proj).conventions, '# Conventions\n\n- two.\n');
    assert.equal(canonCheck(proj).ok, false);
    const rows = bad(run({ cwd: proj }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'registry');
    assert.match(rows[0].detail, /local canon differs from .* \(CONVENTIONS\.md\)/);
    assert.equal(rows[0].fix, 'ac canon pull');
  });
});

test('a check that throws becomes one failing row and the report continues', async () => {
  await sandbox(({ run }) => {
    const rows = run({ cwd: 42 }); // path.resolve(42) throws inside the registry check
    const failing = bad(rows);
    assert.equal(failing.length, 1);
    assert.equal(failing[0].id, 'registry');
    assert.match(failing[0].detail, /^check could not run: /);
    assert.match(failing[0].fix, /ac doctor --json/);
    assert.ok(ofId(rows, 'version').length === 1 && ofId(rows, 'grant').length === 1);
  });
});

test('renderDoctor prints one ✓ line when clean and only ⚠ lines ending with the fix otherwise', async () => {
  const { renderDoctor } = await import('../lib/doctor.mjs');
  const ok = { id: 'version', host: null, dir: null, ok: true, detail: 'fine', fix: null };
  const rows = [ok, { ...ok, id: 'grant', host: 'claude', dir: '/d', ok: false, detail: 'no grant\nacross lines', fix: 'ac install' },
    { ...ok, id: 'version', ok: false, detail: 'old', fix: 'ac update' }];
  assert.deepEqual(renderDoctor(rows), ['⚠ claude /d: no grant across lines → ac install', '⚠ old → ac update']);
  assert.deepEqual(renderDoctor([ok]), ['✓ install consistent — 1 checks across 0 config dir(s)']);
  assert.deepEqual(renderDoctor([ok], { failuresOnly: true }), []);
  assert.deepEqual(renderDoctor(rows, { failuresOnly: true }), renderDoctor(rows));
});

function snapshot(root) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) out.push(`${p} -> ${readlinkSync(p)}`);
      else if (st.isDirectory()) { out.push(`${p}/ ${st.mode}`); walk(p); }
      else out.push(`${p} ${st.mode} ${readFileSync(p, 'utf8')}`);
    }
  };
  walk(root);
  return out;
}

test('runDoctor writes nothing', async () => {
  await sandbox(({ run, home, astroHome }) => {
    writeFileSync(join(astroHome, 'version'), '0.0.1\n');
    writeFileSync(join(astroHome, 'update-check.json'), JSON.stringify({ checked: 1 }));
    const before = snapshot(home);
    run({ clone: FRAMEWORK });
    run();
    assert.deepEqual(snapshot(home), before);
  });
});

test('no astro home means one failing row naming ac install', async () => {
  const { runDoctor } = await import('../lib/doctor.mjs');
  const rows = runDoctor({ astroHome: join(mkdtempSync(join(tmpdir(), 'ac-none-')), 'nope') });
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].ok, rows[0].fix], [false, 'ac install']);
});
