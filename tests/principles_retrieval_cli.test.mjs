// Phase 25 t11 — CLI spec for `ac principles brief/ask/cite/list --usage` (P1, D1-D8,
// CRITERIA C1-C7/C11). Subprocess-driven exactly like tests/principles_cli.test.mjs's
// harness: real isolated HOME, ASTRO_PRINCIPLES_DIR, and a scratch project. `brief`,
// `ask`, `cite` and `list --usage` do not exist on `bin/ac.mjs` yet (t12 wires them in
// the same wave), so every invocation below currently dies "unknown command" — RED
// until t12 lands (ADR-018). Every import here is already-shipped, so no dynamic
// import is needed for this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkHome() {
  const home = mkdtempSync(join(tmpdir(), 'ac-retrieval-home-'));
  const store = mkdtempSync(join(tmpdir(), 'ac-retrieval-store-'));
  return { home, store };
}

function envFor(home, store, extra = {}) {
  return {
    ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store,
    GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com',
    ...extra,
  };
}

function run(args, cwd, home, store, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, encoding: 'utf8', env: envFor(home, store, extraEnv), windowsHide: true,
  });
}

function mkProject(home, store, { stack = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-retrieval-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (stack) {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { express: '^4' } }));
  }
  mkdirSync(join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'lib', 'x.mjs'), '// x\n');
  const init = run(['init'], dir, home, store);
  assert.strictEqual(init.status, 0, init.stderr);
  return dir;
}

function addAccepted(home, store, statement, extra = []) {
  const r = run(['principles', 'add', statement, '--kind', 'pattern', ...extra], process.cwd(), home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = r.stdout.match(/principle (\S+)/);
  return m[1];
}

test('C1: brief --work code --files lib/x.mjs vs --work review, scope matrix', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  const a = addAccepted(home, store, 'ZEBRA1 node code default', ['--stack', 'node', '--work', 'code']);
  const b = addAccepted(home, store, 'ZEBRA1 go default', ['--stack', 'go']);
  const d = addAccepted(home, store, 'ZEBRA1 review default', ['--work', 'review']);
  const rule = addAccepted(home, store, 'ZEBRA1 go rule', ['--strength', 'rule', '--stack', 'go']);

  const r1 = run(['principles', 'brief', '--work', 'code', '--files', 'lib/x.mjs'], proj, home, store);
  assert.strictEqual(r1.status, 0, r1.stderr);
  assert.ok(r1.stdout.includes(a));
  assert.ok(!r1.stdout.includes(b));
  assert.ok(r1.stdout.includes(rule));

  const r2 = run(['principles', 'brief', '--work', 'review'], proj, home, store);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.includes(d));
  assert.ok(!r2.stdout.includes(a));
});

test('C8: brief --files accepts a single value with space/semicolon-separated paths (workflow claimedFiles shape)', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  mkdirSync(join(proj, 'tests'), { recursive: true });
  writeFileSync(join(proj, 'tests', 'x.test.mjs'), '// t\n');
  const c = addAccepted(home, store, 'ZEBRAC lib scoped default', ['--files', 'lib/**']);
  const t = addAccepted(home, store, 'ZEBRAT tests scoped default', ['--files', 'tests/**']);

  const r = run(['principles', 'brief', '--stage', 'execute', '--files', 'lib/x.mjs tests/x.test.mjs', '--by', 'executor'], proj, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(c), 'a space-separated --files value must still scope in lib/**');
  assert.ok(r.stdout.includes(t), 'a space-separated --files value must still scope in tests/**');

  const r2 = run(['principles', 'brief', '--stage', 'execute', '--files', 'lib/x.mjs;tests/x.test.mjs', '--by', 'executor'], proj, home, store);
  assert.strictEqual(r2.status, 0, r2.stderr);
  assert.ok(r2.stdout.includes(c), 'a semicolon-separated --files value must still scope in lib/**');
  assert.ok(r2.stdout.includes(t), 'a semicolon-separated --files value must still scope in tests/**');
});

test('C4: stack tags line names node from package.json; go.mod-only dir without ac init', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  addAccepted(home, store, 'ZEBRA1 node-only default', ['--stack', 'node']);
  const r = run(['principles', 'brief', '--stage', 'session'], proj, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes('node'));

  const goDir = mkdtempSync(join(tmpdir(), 'ac-retrieval-go-'));
  writeFileSync(join(goDir, 'go.mod'), 'module example.com/x\n');
  const goEntry = addAccepted(home, store, 'ZEBRA1 go stack default', ['--stack', 'go']);
  const rGo = run(['principles', 'brief', '--stage', 'session'], goDir, home, store);
  assert.strictEqual(rGo.status, 0, rGo.stderr);
  assert.ok(rGo.stdout.includes('go'));
  assert.ok(rGo.stdout.includes(goEntry));

  mkdirSync(join(goDir, '.astrocode'));
  writeFileSync(join(goDir, '.astrocode', 'config.json'), JSON.stringify({ stack: ['rust'] }));
  const rustEntry = addAccepted(home, store, 'ZEBRA1 rust stack default', ['--stack', 'rust']);
  const rRust = run(['principles', 'brief', '--stage', 'session'], goDir, home, store);
  assert.ok(rRust.stdout.includes('rust'));
  assert.ok(rRust.stdout.includes(rustEntry));
  assert.ok(!rRust.stdout.includes(goEntry));
});

test('C5: ask ranks a keyword match, no network', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  const id = addAccepted(home, store, 'ZEBRA1 always wrap filesystem mutations in a lock', ['--why', 'ZEBRA2 concurrency bug']);
  const r = run(
    ['principles', 'ask', 'how should I guard concurrent filesystem writes'], proj, home, store,
    { HTTPS_PROXY: 'http://127.0.0.1:9' },
  );
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(id));
});

test('C6: brief served, cite, list --usage shows served-never-cited and never-served', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  const u1 = addAccepted(home, store, 'ZEBRA1 usage one default', ['--stack', 'node']);
  const u2 = addAccepted(home, store, 'ZEBRA1 usage two default', ['--stack', 'node']);
  addAccepted(home, store, 'ZEBRA1 usage three default', ['--stack', 'node']);

  run(['principles', 'brief', '--stage', 'session'], proj, home, store);
  run(['principles', 'brief', '--stage', 'session'], proj, home, store);
  const c = run(['principles', 'cite', u1, '--stage', 'execute', '--by', 'executor'], proj, home, store);
  assert.strictEqual(c.status, 0, c.stderr);

  const l = run(['principles', 'list', '--usage'], proj, home, store);
  assert.strictEqual(l.status, 0, l.stderr);
  assert.ok(l.stdout.includes(u2));
  assert.ok(!l.stdout.includes('ZEBRA'));
});

test('ADR-029: unknown flag/value dies naming it', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  const r1 = run(['principles', 'brief', '--bogus'], proj, home, store);
  assert.notEqual(r1.status, 0);
  assert.ok(r1.stderr.includes('bogus'));
  const r2 = run(['principles', 'ask', 'q', '--stage', 'nope'], proj, home, store);
  assert.notEqual(r2.status, 0);
});

test('ac help lists the new verbs', async () => {
  const { home, store } = mkHome();
  const r = run(['help'], process.cwd(), home, store);
  assert.ok(r.stdout.includes('principles brief'));
  assert.ok(r.stdout.includes('principles ask'));
  assert.ok(r.stdout.includes('principles cite'));
  assert.ok(r.stdout.includes('--usage'));
});

test('empty/absent store: brief exits 0 with empty stdout', async () => {
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  const r = run(['principles', 'brief', '--stage', 'session'], proj, home, store);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(r.stdout.trim(), '');
});

// Phase 25 verify, C1/C13 — `--files` scopes the same however the path is spelled:
// root-relative, absolute, relative to a subdirectory, or through a symlink to the
// project. Driven through the real CLI so the wiring in shortlist(), not just
// projectRelative(), is what this pins.
test('brief --files: absolute, subdirectory-relative and symlinked paths all serve a lib/** principle', async () => {
  const { symlinkSync } = await import('node:fs');
  const { home, store } = mkHome();
  const proj = mkProject(home, store);
  mkdirSync(join(proj, 'sub'), { recursive: true });
  addAccepted(home, store, 'ZEBRALIB applies under lib', ['--files', 'lib/**', '--work', 'code']);
  const link = join(mkdtempSync(join(tmpdir(), 'ac-retrieval-link-')), 'plink');
  symlinkSync(proj, link);

  const cases = [
    ['absolute', proj, join(proj, 'lib', 'x.mjs')],
    ['from a subdirectory', join(proj, 'sub'), '../lib/x.mjs'],
    ['from lib itself', join(proj, 'lib'), 'x.mjs'],
    ['through a symlink', proj, join(link, 'lib', 'x.mjs')],
  ];
  for (const [label, cwd, file] of cases) {
    const r = run(['principles', 'brief', '--work', 'code', '--files', file], cwd, home, store);
    assert.strictEqual(r.status, 0, `${label}: ${r.stderr}`);
    assert.match(r.stdout, /ZEBRALIB/, `${label}: the lib/** principle must be served`);
  }
  const miss = run(['principles', 'brief', '--work', 'code', '--files', 'src/x.mjs'], proj, home, store);
  assert.doesNotMatch(miss.stdout, /ZEBRALIB/, 'a path outside lib/ must not match');
});
