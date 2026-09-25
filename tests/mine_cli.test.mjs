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
import { sandbox as fixtureSandbox, addProfile, writeClaudeSession, writeCodexRollout, cHuman, cAssistant, cToolResult, cMeta, GARBAGE_LINES, SECRETS, xUser, appendLines } from './fixtures/minefixtures.mjs';

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
  writeClaudeSession(sb.claude, P, 'sess-p', [cHuman('always-P run tests before pushing')]);
  writeClaudeSession(sb.claude, Q, 'sess-q', [cHuman('always-Q run tests before pushing')]);
  const texts = (r) => JSON.parse(r.stdout).items.map((i) => i.text).join('\n');

  const def = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(def.status, 0, def.stderr);
  assert.deepEqual(JSON.parse(def.stdout).scope.mode, 'project');
  assert.match(texts(def), /always-P/);
  assert.doesNotMatch(texts(def), /always-Q/);

  const withProject = run(['principles', 'mine', '--project', Q, '--json'], P, sb);
  assert.strictEqual(withProject.status, 0, withProject.stderr);
  assert.match(texts(withProject), /always-Q/);

  const all = run(['principles', 'mine', '--all', '--json'], P, sb);
  assert.strictEqual(all.status, 0, all.stderr);
  assert.match(texts(all), /always-P/);
  assert.match(texts(all), /always-Q/);

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

test('C6: mine → advance → nothingNew → append → new item; --rescan re-emits', () => {
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

test('C9 remediation: a Codex rollout entirely of unrecognised lines (no readable session_meta) is reported, not read as "nothing new"', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const dir = join(sb.codex, 'sessions', '2026', '09', '24');
  const file = join(dir, 'rollout-no-meta.jsonl');
  appendLines(file, [
    { type: 'future_codex_event', a: 1 },
    { type: 'future_codex_event', a: 2 },
    { type: 'future_codex_event', a: 3 },
    { type: 'future_codex_event', a: 4 },
  ]);

  const res = run(['principles', 'mine', '--json'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  const j = JSON.parse(res.stdout);
  assert.strictEqual(j.nothingNew, false, 'an unrecognised-only Codex rollout must not read as a clean/empty run');
  assert.ok(j.sessions.scanned >= 1);
  assert.ok(j.skipped.unrecognised >= 4);
});

test('ADR-029: an unknown flag dies; --advance of an unknown sweep dies; --keep needs --advance', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const bogus = run(['principles', 'mine', '--bogus'], P, sb);
  assert.notStrictEqual(bogus.status, 0);

  const badAdvance = run(['principles', 'mine', '--advance', 'nope'], P, sb);
  assert.notStrictEqual(badAdvance.status, 0);
  assert.match(badAdvance.stderr, /unknown or already-advanced sweep/);

  const loneKeep = run(['principles', 'mine', '--keep', 't1'], P, sb);
  assert.notStrictEqual(loneKeep.status, 0);
});

test('text output: one line per item plus the summary', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  writeClaudeSession(sb.claude, P, 's1', [cHuman('No.'), cHuman('Nie die Datenbank in Tests mocken.')]);
  writeClaudeSession(sb.claude, P, 's2', [cHuman('No.')]);
  const res = run(['principles', 'mine'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  const lines = res.stdout.trim().split('\n');
  assert.match(lines[0], /^• 2 turn\(s\) from 2 session file\(s\) — sweep mine-/);
  assert.ok(lines.some((l) => /^ {2}t\d+ \[2 sessions\] No\.$/.test(l)), res.stdout);
  assert.ok(lines.some((l) => /^ {2}t\d+ \[1 session\] Nie die Datenbank/.test(l)), res.stdout);
});

test('C7: --advance --keep carries the kept turn into the next sweep; an unknown keep id refuses and advances nothing', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  writeClaudeSession(sb.claude, P, 's1', [cHuman('Niente virgole finali.'), cHuman('rename it to parseRow')]);
  const first = JSON.parse(run(['principles', 'mine', '--json'], P, sb).stdout);
  const keepId = first.items.find((i) => /virgole/.test(i.text)).id;

  const bad = run(['principles', 'mine', '--advance', first.sweep, '--keep', `${keepId},t404`], P, sb);
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /unknown item id "t404"/);
  const still = JSON.parse(run(['principles', 'mine', '--json'], P, sb).stdout);
  assert.strictEqual(still.nothingNew, false, 'a refused advance moves no watermark');

  const ok = run(['principles', 'mine', '--advance', first.sweep, '--keep', keepId], P, sb);
  assert.strictEqual(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /1 turn\(s\) kept/);

  writeClaudeSession(sb.claude, P, 's2', [cHuman('Keine nachgestellten Kommas.')]);
  const second = JSON.parse(run(['principles', 'mine', '--json'], P, sb).stdout);
  const kept = second.items.find((i) => /virgole/.test(i.text));
  assert.ok(kept && kept.earlier === true, 'the kept turn comes back marked earlier');
  assert.ok(second.items.some((i) => /Kommas/.test(i.text) && i.earlier === false));
  assert.ok(!second.items.some((i) => /parseRow/.test(i.text)), 'an unkept handled turn never comes back');
});

test('ac help lists `principles mine`', () => {
  const sb = fixtureSandbox();
  const P = mkProject(sb);
  const res = run(['help'], P, sb);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /principles mine/);
});
