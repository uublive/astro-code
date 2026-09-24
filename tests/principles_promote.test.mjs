// CLI tests for `ac principles promote <id> [--as decision|convention]` (P13, D8,
// ADR-057/058; phase 22 t14). `promote` does not exist on `bin/ac.mjs` yet — it lands in
// t13, paired by the shared `depends_on: t6, t11` — so every promote call below currently
// dies with "unknown: ac principles promote", a non-zero exit from the `principles` case's
// own `default:` die(), never a crash. So this file loads fine and simply fails RED until
// t13 lands (ADR-018). Every import here is already-shipped (`lib/git.mjs`), so no dynamic
// import is needed for THIS file — same posture as tests/principles_cli.test.mjs (t12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkHome() {
  return mkdtempSync(join(tmpdir(), 'ac-principles-promote-home-'));
}

// Same isolation contract as t12: a real HOME, no `ASTRO_PRINCIPLES_DIR` override, its own
// git identity via env so no global git config is relied on.
function envFor(home, extra = {}) {
  const env = { ...process.env, HOME: home };
  delete env.ASTRO_PRINCIPLES_DIR;
  env.GIT_AUTHOR_NAME = 'dev';
  env.GIT_AUTHOR_EMAIL = 'dev@example.com';
  env.GIT_COMMITTER_NAME = 'dev';
  env.GIT_COMMITTER_EMAIL = 'dev@example.com';
  Object.assign(env, extra);
  return env;
}

function run(args, cwd, home, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    cwd, encoding: 'utf8', env: envFor(home, extraEnv),
  });
}

function storeDir(home) {
  return join(home, '.astro', 'principles');
}

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-promote-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

const registryTip = (bare) =>
  git(['rev-parse', 'refs/heads/astro-registry'], { cwd: bare }).stdout.trim();

// A scratch project on a local bare remote, with the registry initialised — the harness
// from tests/flags.test.mjs (`mkBareRemote` + `mkWorkdir` + `ac registry init`), driven
// entirely via the CLI (not the lib) so the home-store wiring gets exercised too.
function mkProject(home, bare, name) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-promote-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  git(['remote', 'add', 'origin', bare], { cwd: dir });
  const init = run(['init', '--name', name], dir, home);
  assert.strictEqual(init.status, 0, init.stderr);
  const reg = run(['registry', 'init'], dir, home);
  assert.strictEqual(reg.status, 0, reg.stderr);
  return dir;
}

function decisionsPath(dir) {
  return join(dir, '.astrocode', 'DECISIONS.md');
}

function conventionsPath(dir) {
  return join(dir, '.astrocode', 'CONVENTIONS.md');
}

function extractPrincipleId(text) {
  const m = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z0-9-]+)\b/);
  return m && m[1];
}

function extractAdrId(text) {
  const m = text.match(/\bADR-\d+\b/);
  return m && m[0];
}

function addAcceptedPrinciple(home, dir, statement, extra = []) {
  const res = run(['principles', 'add', statement, '--kind', 'antipattern', ...extra], dir, home);
  assert.strictEqual(res.status, 0, res.stderr);
  const id = extractPrincipleId(res.stdout);
  assert.ok(id, `expected a principle id in: ${res.stdout}`);
  return id;
}

function showJSON(id, home, dir) {
  const r = run(['principles', 'show', id, '--json'], dir, home);
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// ── C13 — default promote records a shared ADR, entry stays personal ────────────────

test('C13: `ac principles promote <id>` records an ADR locally and on the registry remote, entry stays accepted and personal', () => {
  const home = mkHome();
  const bare = mkBareRemote();
  const dir = mkProject(home, bare, 'proj-c13');

  // Seed an existing decision first, so we can prove promote never disturbs it.
  const seeded = run(['decision', 'add', 'Existing pre-promotion decision', '--why', 'because'], dir, home);
  assert.strictEqual(seeded.status, 0, seeded.stderr);
  const seededDecisions = readFileSync(decisionsPath(dir), 'utf8');
  const seededAdrId = extractAdrId(seeded.stdout);
  assert.ok(seededAdrId, `expected an ADR id in: ${seeded.stdout}`);

  const id = addAcceptedPrinciple(home, dir, 'Never mock the database in tests');

  const promote = run(['principles', 'promote', id], dir, home);
  assert.strictEqual(promote.status, 0, promote.stderr);
  assert.match(promote.stdout, /promoted/i);
  const adrId = extractAdrId(promote.stdout);
  assert.ok(adrId, `expected the new ADR id in: ${promote.stdout}`);
  assert.notStrictEqual(adrId, seededAdrId, 'the promotion must mint a NEW ADR, not reuse the seeded one');

  // Local DECISIONS.md: the new ADR carries the statement, and the seeded one is untouched.
  const decisions = readFileSync(decisionsPath(dir), 'utf8');
  assert.match(decisions, new RegExp(`## ${adrId}[^\\n]*`));
  assert.match(decisions, /Never mock the database in tests/);
  assert.match(decisions, new RegExp(`## ${seededAdrId}[^\\n]*`), 'the pre-existing ADR heading must still be present');
  assert.match(decisions, /Existing pre-promotion decision/, 'the pre-existing ADR body must still be present');
  assert.ok(decisions.startsWith(seededDecisions), 'the seeded ADR must stay an untouched prefix, promote appends after it');

  // Same ADR on the bare remote's registry branch.
  const remoteDecisions = git(['show', 'astro-registry:DECISIONS.md'], { cwd: bare }).stdout;
  assert.match(remoteDecisions, new RegExp(`## ${adrId}[^\\n]*`));
  assert.match(remoteDecisions, /Never mock the database in tests/);
  assert.match(remoteDecisions, new RegExp(`## ${seededAdrId}[^\\n]*`), 'the shared ADR must still be present on the registry');

  // The personal entry stays accepted, personal, and now lists the promotion.
  const entry = showJSON(id, home, dir);
  assert.strictEqual(entry.status, 'accepted');
  assert.strictEqual(entry.promotions.length, 1);
  assert.strictEqual(entry.promotions[0].project, 'proj-c13');
  assert.strictEqual(entry.promotions[0].as, 'decision');
  assert.strictEqual(entry.promotions[0].ref, adrId);
  assert.ok(existsSync(join(storeDir(home), `${id}.md`)), 'the store file must stay under $HOME');
});

// ── C14 — promote-as-convention appends locally, publishes nothing ──────────────────

test('C14: `ac principles promote <id> --as convention` appends to CONVENTIONS.md, never publishes, and names `ac canon push`', () => {
  const home = mkHome();
  const bare = mkBareRemote();
  const dirA = mkProject(home, bare, 'proj-c14-a');

  // A pre-existing local edit — proves the append never overwrites or reorders it.
  const before = readFileSync(conventionsPath(dirA), 'utf8');
  writeFileSync(conventionsPath(dirA), before + '\n- an existing, unrelated convention line\n');
  const seededConventions = readFileSync(conventionsPath(dirA), 'utf8');

  const id2 = addAcceptedPrinciple(home, dirA, 'Prefer explicit over implicit config');

  const tipBefore = registryTip(bare);
  const promote = run(['principles', 'promote', id2, '--as', 'convention'], dirA, home);
  assert.strictEqual(promote.status, 0, promote.stderr);
  assert.match(promote.stdout, /ac canon push/);

  const conventions = readFileSync(conventionsPath(dirA), 'utf8');
  assert.ok(conventions.startsWith(seededConventions), 'the pre-existing bytes must stay an untouched prefix');
  assert.match(conventions, /Prefer explicit over implicit config/);
  assert.strictEqual(registryTip(bare), tipBefore, 'the registry branch tip must NOT move on a convention promotion');

  let entry = showJSON(id2, home, dirA);
  assert.strictEqual(entry.promotions.length, 1);
  assert.strictEqual(entry.promotions[0].project, 'proj-c14-a');
  assert.strictEqual(entry.promotions[0].as, 'convention');
  assert.strictEqual(entry.promotions[0].ref, 'convention');

  // Promoting the SAME entry into a second project adds a second promotion record.
  const dirB = mkProject(home, bare, 'proj-c14-b');
  const promote2 = run(['principles', 'promote', id2, '--as', 'convention'], dirB, home);
  assert.strictEqual(promote2.status, 0, promote2.stderr);
  entry = showJSON(id2, home, dirB);
  assert.strictEqual(entry.promotions.length, 2, 'a second project promotion must be a SECOND record, not a replacement');
  assert.strictEqual(entry.promotions[1].project, 'proj-c14-b');
});

// ── Refusals: no side effects, no promotion recorded ─────────────────────────────────

test('promoting a PROPOSED entry exits non-zero and changes nothing', () => {
  const home = mkHome();
  const bare = mkBareRemote();
  const dir = mkProject(home, bare, 'proj-refuse-proposed');

  const add = run(['principles', 'add', 'A proposed antipattern', '--kind', 'antipattern', '--propose'], dir, home);
  assert.strictEqual(add.status, 0, add.stderr);
  const id = extractPrincipleId(add.stdout);
  assert.ok(id);

  const decisionsBefore = readFileSync(decisionsPath(dir), 'utf8');
  const conventionsBefore = readFileSync(conventionsPath(dir), 'utf8');

  const promote = run(['principles', 'promote', id], dir, home);
  assert.notStrictEqual(promote.status, 0, 'a proposed entry must refuse to promote');

  assert.strictEqual(readFileSync(decisionsPath(dir), 'utf8'), decisionsBefore, 'DECISIONS.md must be unchanged');
  assert.strictEqual(readFileSync(conventionsPath(dir), 'utf8'), conventionsBefore, 'CONVENTIONS.md must be unchanged');

  const entry = showJSON(id, home, dir);
  assert.strictEqual(entry.status, 'proposed');
  assert.strictEqual(entry.promotions.length, 0, 'no promotion may be recorded');
});

test('`--as foo` (an invalid target) exits non-zero and changes nothing', () => {
  const home = mkHome();
  const bare = mkBareRemote();
  const dir = mkProject(home, bare, 'proj-refuse-badas');

  const id = addAcceptedPrinciple(home, dir, 'A valid accepted principle');

  const decisionsBefore = readFileSync(decisionsPath(dir), 'utf8');
  const conventionsBefore = readFileSync(conventionsPath(dir), 'utf8');

  const promote = run(['principles', 'promote', id, '--as', 'foo'], dir, home);
  assert.notStrictEqual(promote.status, 0, 'an unrecognised --as target must refuse');

  assert.strictEqual(readFileSync(decisionsPath(dir), 'utf8'), decisionsBefore, 'DECISIONS.md must be unchanged');
  assert.strictEqual(readFileSync(conventionsPath(dir), 'utf8'), conventionsBefore, 'CONVENTIONS.md must be unchanged');

  const entry = showJSON(id, home, dir);
  assert.strictEqual(entry.promotions.length, 0, 'no promotion may be recorded');
});
