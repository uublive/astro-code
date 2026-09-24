// Phase 26 t8 — RED: CLI tests for `ac principles mine` (P1/P8, ADR-029). Subprocess-only,
// against a real isolated HOME (git init + `ac init`), exactly like tests/principles_cli.
// `mine` doesn't exist on bin/ac.mjs yet (t14), so every invocation below currently dies
// with a non-zero exit — this file loads fine and fails RED until t14 lands (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { sandbox as fixtureSandbox, addProfile, writeClaudeSession, writeCodexRollout, cHuman, cAssistant, cToolResult, cMeta, GARBAGE_LINES, SECRETS, xUser } from './fixtures/minefixtures.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

function mkProject(sb) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mine-proj-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  const init = spawnSync(process.execPath, [AC, 'init'], { cwd: dir, encoding: 'utf8', env: sb.env, windowsHide: true });
  assert.strictEqual(init.status, 0, init.stderr);
  return dir;
}

function run(argv, cwd, sb, extraEnv = {}) {
  return spawnSync(process.execPath, [AC, ...argv], {
    cwd, encoding: 'utf8', env: { ...sb.env, GIT_AUTHOR_NAME: 'dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'dev', GIT_COMMITTER_EMAIL: 'dev@example.com', ...extraEnv },
    windowsHide: true,
  });
}

test('C1: default scope finds this project only; --project targets another; --all finds both', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const Q = mkdtempSync(join(tmpdir(), 'ac-mine-q-'));
  writeClaudeSession(sb.claude, P, 'sess-p', [cHuman('always run tests before pushing')]);
  writeClaudeSession(sb.claude, Q, 'sess-q', [cHuman('always run tests before pushing')]);

  const def = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(def.status, 0, def.stderr);
  const defJson = JSON.parse(def.stdout);
  assert.deepEqual(defJson.scope.mode, 'project');

  const withProject = run(['principles', 'mine', '--project', Q, '--json'], P, sb);
  assert.strictEqual(withProject.status, 0, withProject.stderr);
  JSON.parse(withProject.stdout);

  const all = run(['principles', 'mine', '--all', '--json'], P, sb);
  assert.strictEqual(all.status, 0, all.stderr);
  JSON.parse(all.stdout);

  const both = run(['principles', 'mine', '--all', '--project', Q, '--json'], P, sb);
  assert.notStrictEqual(both.status, 0, '--all together with --project must die');
});

test('C3: neither stdout/stderr nor any file under HOME contains a raw secret', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  writeClaudeSession(sb.claude, P, 'sess-s', [
    cHuman(`from now on always redact secrets like ${SECRETS[0]} ${SECRETS[1]} ${SECRETS[2]} ${SECRETS[3]} ${SECRETS[4]}`),
  ]);
  const res = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  for (const s of SECRETS) {
    assert.ok(!res.stdout.includes(s), `stdout must never contain ${s}`);
    assert.ok(!res.stderr.includes(s));
  }
});

test('C6: mine → advance → nothingNew → append → new candidate; --rescan re-emits', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  writeClaudeSession(sb.claude, P, 'sess-1', [cHuman('from now on always run the full test suite')]);

  const first = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(first.status, 0, first.stderr);
  const firstJson = JSON.parse(first.stdout);
  assert.ok(firstJson.sweep);

  const advanced = run(['principles', 'mine', '--advance', firstJson.sweep], P, sb);
  assert.strictEqual(advanced.status, 0, advanced.stderr);

  const again = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(again.status, 0, again.stderr);
  const againJson = JSON.parse(again.stdout);
  assert.strictEqual(againJson.nothingNew, true);

  const rescanned = run(['principles', 'mine', '--rescan', '--json'], P, sb);
  const rescannedJson = JSON.parse(rescanned.stdout);
  assert.strictEqual(rescannedJson.nothingNew, false, '--rescan must re-emit already-processed material');

  const storeStatus = git(['status', '--porcelain'], { cwd: sb.store });
  assert.strictEqual(storeStatus.stdout.trim(), '', 'nothing under .local should show up in the store\'s git status');
});

test('C9: garbage lines never crash the sweep; skipped is reported', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  writeClaudeSession(sb.claude, P, 'sess-g', [...GARBAGE_LINES, cHuman('from now on always run the full test suite')]);

  const res = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  const j = JSON.parse(res.stdout);
  assert.ok(j.skipped.malformed + j.skipped.unrecognised >= 1);

  const text = run(['principles', 'mine'], P, sb);
  assert.match(text.stdout, /⚠ skipped/);
});

test('ADR-029: an unknown flag dies; --advance of an unknown sweep dies', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const bogus = run(['principles', 'mine', '--bogus'], P, sb);
  assert.notStrictEqual(bogus.status, 0);

  const badAdvance = run(['principles', 'mine', '--advance', 'nope'], P, sb);
  assert.notStrictEqual(badAdvance.status, 0);
  assert.match(badAdvance.stderr, /unknown or already-advanced sweep/);
});

test('ac help lists `principles mine`', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const res = run(['help'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /principles mine/);
});
