// Phase 50 t11 — `ac doctor`, `ac --version` and the `ac update` tail, end to end through the real
// CLI against a real `ac install` in a scratch HOME (test-after: it drives the whole stack).
// PATH holds shims for every package manager that append to a marker file; the doctor must
// never reach one. Only HOME and PATH are passed, so nothing of the real machine leaks in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, existsSync,
  realpathSync, rmSync, cpSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';
const PKG = JSON.parse(readFileSync(join(FRAMEWORK, 'package.json'), 'utf8'));

function world({ codex = false, opencode = false } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ac-doccli-')));
  const home = join(root, 'home');
  const shims = join(root, 'shims');
  const marker = join(root, 'marker');
  const scratch = join(root, 'scratch');
  for (const d of [home, shims, scratch]) mkdirSync(d, { recursive: true });
  mkdirSync(join(home, '.claude'), { recursive: true });
  if (codex) mkdirSync(join(home, '.codex'), { recursive: true });
  if (opencode) mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  for (const pm of ['npm', 'npx', 'pnpm', 'yarn', 'bun', 'brew']) {
    writeFileSync(join(shims, pm), `#!/bin/sh\necho ${pm} >> "${marker}"\nexit 0\n`, { mode: 0o755 });
  }
  const env = { HOME: home, PATH: [shims, dirname(process.execPath), '/usr/bin', '/bin'].join(':') };
  const ac = (args, { cwd = scratch, extra = {}, bin = join(FRAMEWORK, 'bin', 'ac.mjs') } = {}) => spawnSync(
    process.execPath, [bin, ...args], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  const inst = ac(['install']);
  assert.equal(inst.status, 0, inst.stderr);
  rmSync(marker, { force: true });
  return { root, home, marker, scratch, env, ac, claude: join(home, '.claude'), astroHome: join(home, '.astro', 'code') };
}

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

// Two hosts drifted at once: a stale opencode entry, and a dead interpreter in Claude's settings.
function seed(w) {
  writeFileSync(join(w.home, '.config', 'opencode', 'commands', 'astro-gone.md'), 'stale');
  const file = join(w.claude, 'settings.json');
  writeFileSync(file, readFileSync(file, 'utf8').replace(/"command": "\\"[^"\\]+\\" /g, '"command": "\\"/opt/homebrew/Cellar/node/0.0.0/bin/node\\" '));
}
const lines = (s) => s.split('\n').filter(Boolean);

test('ac doctor on a fresh install exits 0 with one ✓ line and all-ok JSON', { skip: WIN }, () => {
  for (const hosts of [{}, { codex: true, opencode: true }]) {
    const w = world(hosts);
    const r = w.ac(['doctor']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(lines(r.stdout).length, 1, r.stdout);
    assert.match(r.stdout, /^✓ install consistent — \d+ checks across \d config dir\(s\)\n$/);
    const j = w.ac(['doctor', '--json']);
    assert.equal(j.status, 0);
    const rows = JSON.parse(j.stdout);
    assert.ok(rows.length > 0 && rows.every((x) => x.ok === true && x.fix === null));
    const seen = new Set(rows.map((x) => x.host).filter(Boolean));
    assert.deepEqual([...seen].sort(), hosts.codex ? ['claude', 'codex', 'opencode'] : ['claude']);
  }
});

test('ac doctor --json and the human output name the same failures and exit with the same code', { skip: WIN }, () => {
  const w = world({ opencode: true });
  seed(w);
  const human = w.ac(['doctor']);
  const js = w.ac(['doctor', '--json']);
  assert.equal(human.status, 1);
  assert.equal(js.status, 1);
  const failing = JSON.parse(js.stdout).filter((r) => !r.ok);
  assert.ok(failing.some((r) => r.host === 'claude') && failing.some((r) => r.host === 'opencode'));
  const warn = lines(human.stdout);
  assert.equal(warn.length, failing.length);
  for (const r of failing) {
    const line = warn.find((l) => l.endsWith(` → ${r.fix}`) && l.includes(r.detail));
    assert.ok(line, `no ⚠ line for ${r.id}: ${r.detail}`);
    assert.ok(line.startsWith(`⚠ ${r.host} ${r.dir}: `));
  }
});

test('every failing JSON row has a fix and every ⚠ line ends with it', { skip: WIN }, () => {
  const w = world({ opencode: true });
  seed(w);
  const rows = JSON.parse(w.ac(['doctor', '--json']).stdout);
  for (const r of rows) {
    for (const k of ['id', 'host', 'dir', 'ok', 'detail', 'fix']) assert.ok(k in r, k);
    if (!r.ok) assert.ok(typeof r.fix === 'string' && r.fix.length > 0);
  }
  for (const l of lines(w.ac(['doctor']).stdout)) {
    assert.match(l, /^⚠ /);
    assert.ok(rows.some((r) => !r.ok && l.endsWith(` → ${r.fix}`)));
  }
});

test('ac doctor writes nothing and spawns no package manager', { skip: WIN }, () => {
  for (const seeded of [false, true]) {
    const w = world({ opencode: true });
    if (seeded) seed(w);
    const before = snapshot(w.home);
    w.ac(['doctor']);
    w.ac(['doctor', '--json']);
    assert.deepEqual(snapshot(w.home), before, seeded ? 'seeded state changed' : 'clean state changed');
    assert.equal(existsSync(w.marker), false, 'a package manager shim ran');
  }
});

test("ac --version prints package.json's version and exits 0", { skip: WIN }, () => {
  const w = world();
  const before = snapshot(w.home);
  const r = w.ac(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `astro-code ${PKG.version}\n`);
  assert.equal(r.stderr, '');
  assert.deepEqual(snapshot(w.home), before);
});

test('ac help lists doctor --json and --version', { skip: WIN }, () => {
  const w = world();
  const out = w.ac(['help']).stdout;
  assert.match(out, /ac doctor \[--json\]/);
  assert.match(out, /ac --version/);
});

test('ac doctor --nope is refused', { skip: WIN }, () => {
  const w = world();
  const r = w.ac(['doctor', '--nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown flag for `ac doctor`: --nope/);
});

test('ac update prints no doctor line when clean, and exactly ac doctor\'s ⚠ lines when a drift survives', { skip: WIN }, () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ac-docupd-')));
  const home = join(root, 'home');
  mkdirSync(home);
  // a clone of THIS working tree with a bare upstream, so the pull needs no network
  const remote = join(root, 'remote.git');
  const clone = join(root, 'clone');
  const gitOpts = { cwd: clone, encoding: 'utf8' };
  const git = (args, o = gitOpts) => spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=T', ...args], o);
  spawnSync('git', ['init', '--bare', '-b', 'main', remote], { encoding: 'utf8' });
  mkdirSync(clone);
  for (const entry of ['bin', 'lib', 'hooks', 'commands', 'agents', 'workflows', 'templates', 'mods', 'package.json']) {
    if (existsSync(join(FRAMEWORK, entry))) cpSync(join(FRAMEWORK, entry), join(clone, entry), { recursive: true });
  }
  symlinkSync(join(FRAMEWORK, 'node_modules'), join(clone, 'node_modules'));
  writeFileSync(join(clone, '.gitignore'), 'node_modules\n');
  git(['init', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-m', 'v']);
  git(['remote', 'add', 'origin', remote]);
  assert.equal(git(['push', '-u', 'origin', 'main']).status, 0);

  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { HOME: home, PATH: [bin, dirname(process.execPath), '/usr/bin', '/bin'].join(':') };
  const ac = (args, extra = {}) => spawnSync(process.execPath, [join(clone, 'bin', 'ac.mjs'), ...args],
    { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });

  assert.equal(ac(['install']).status, 0);
  // (a) clean: the update's output carries no doctor line at all
  const clean = ac(['update']);
  assert.equal(clean.status, 0, clean.stderr);
  assert.doesNotMatch(clean.stdout, /install consistent/);
  assert.doesNotMatch(clean.stdout, /^⚠ /m);
  assert.match(clean.stdout, /now at v/);

  // (b) a drift the update does not repair: a stale link in a dir install no longer targets
  const d2 = join(home, 'claude2');
  mkdirSync(d2);
  assert.equal(ac(['install'], { CLAUDE_CONFIG_DIR: d2 }).status, 0);
  writeFileSync(join(d2, 'commands', 'astro-gone.md'), 'stale');
  const drift = ac(['update']);
  assert.equal(drift.status, 0, 'the update succeeded, so its exit code is its own');
  const doctor = ac(['doctor']);
  assert.equal(doctor.status, 1);
  const want = lines(doctor.stdout);
  assert.ok(want.length >= 1 && want.every((l) => l.startsWith('⚠ ')));
  assert.deepEqual(lines(drift.stdout).slice(-want.length), want);
  assert.doesNotMatch(drift.stdout, /install consistent/);
});
