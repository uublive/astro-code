// Phase 25 verify, C13 — behaviour guards. A mutation sweep broke each of these
// behaviours with the whole suite still green; every test here fails against the
// matching mutant (lifecycle-gated hard rules, rules printed in full, ask's reasons,
// the canon-clash note in brief and list, verify forced to rules-only, the planner's
// principles instruction, and the SessionStart banner surviving a principles section).
// Driven through the real CLI and hooks against an isolated HOME and store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { git } from '../lib/git.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const UPDATE_HOOK = join(FRAMEWORK, 'hooks', 'astro-update.mjs');

function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'ac-guards-home-'));
  const store = mkdtempSync(join(tmpdir(), 'ac-guards-store-'));
  const env = { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store };
  delete env.CLAUDE_CONFIG_DIR;
  const proj = mkdtempSync(join(tmpdir(), 'ac-guards-proj-'));
  git(['init', '--quiet'], { cwd: proj });
  const ac = (args, cwd = proj) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env, windowsHide: true });
  assert.strictEqual(ac(['init']).status, 0);
  const add = (statement, extra = []) => {
    const r = ac(['principles', 'add', statement, '--kind', 'principle', ...extra]);
    assert.strictEqual(r.status, 0, r.stderr);
    return r.stdout.match(/principle (\S+)/)[1];
  };
  return { home, store, env, proj, ac, add };
}

test('a proposed or rejected hard rule is never served; an accepted one is', () => {
  const { ac, add } = sandbox();
  add('ACCEPTEDRULE always pin versions', ['--strength', 'rule', '--why', 'reproducible builds']);
  add('PROPOSEDRULE never commit on friday', ['--strength', 'rule', '--why', 'weekend', '--propose']);
  const rej = add('REJECTEDRULE tabs everywhere', ['--strength', 'rule', '--why', 'taste', '--propose']);
  assert.strictEqual(ac(['principles', 'reject', rej, '--reason', 'not mine']).status, 0);

  const r = ac(['principles', 'brief', '--work', 'code']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /ACCEPTEDRULE/);
  assert.doesNotMatch(r.stdout, /PROPOSEDRULE/);
  assert.doesNotMatch(r.stdout, /REJECTEDRULE/);
});

test('a long, multi-sentence hard rule is printed in full by brief', () => {
  const { ac, add } = sandbox();
  const long = 'LONGRULE Every write to shared state goes through the lock helper, never a bare fs call. '
    + 'The helper retries on contention and records the holder, so a stuck lock names its owner ENDOFRULE';
  add(long, ['--strength', 'rule', '--why', 'concurrent writers corrupted state']);
  const r = ac(['principles', 'brief', '--work', 'code']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(long), `the rule must appear verbatim:\n${r.stdout}`);
});

test('ask prints why each result matched', () => {
  const { ac, add } = sandbox();
  add('Wrap filesystem mutations in a lock', ['--why', 'concurrency bugs']);
  const r = ac(['principles', 'ask', 'concurrent filesystem writes']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /matched: .*filesystem/);
});

test('a canon clash is flagged in brief and in principles list', () => {
  const { proj, ac, add } = sandbox();
  writeFileSync(join(proj, '.astrocode', 'CONVENTIONS.md'),
    '# Conventions\n\n## Naming\n\n- Named function exports only, no default exports\n');
  add('Use default exports for modules', ['--work', 'code']);

  const b = ac(['principles', 'brief', '--work', 'code']);
  assert.strictEqual(b.status, 0, b.stderr);
  assert.match(b.stdout, /⚠ canon may override: CONVENTIONS §Naming/);

  const l = ac(['principles', 'list']);
  assert.strictEqual(l.status, 0, l.stderr);
  assert.match(l.stdout, /canon may override: CONVENTIONS §Naming/);
});

test('--stage verify serves hard rules only, even without --rules-only', () => {
  const { ac, add } = sandbox();
  add('VERIFYRULE keep migrations reversible', ['--strength', 'rule', '--why', 'rollbacks']);
  add('VERIFYDEFAULT prefer small commits', ['--work', 'review']);
  const r = ac(['principles', 'brief', '--stage', 'verify', '--by', 'verifier']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /VERIFYRULE/);
  assert.doesNotMatch(r.stdout, /VERIFYDEFAULT/);
});

test('the planner (Synthesize) prompt ends with the principles instruction', () => {
  const src = readFileSync(join(FRAMEWORK, 'workflows', 'plan-phase.mjs'), 'utf8');
  const end = src.indexOf("phase: 'Synthesize'");
  assert.ok(end > 0, 'Synthesize stage not found');
  const start = src.lastIndexOf('agent(', end);
  assert.match(src.slice(start, end), /\bPRINCIPLES_PLAN\b/, 'the planner prompt must include PRINCIPLES_PLAN');
});

test('SessionStart keeps the banner when a principles section is also emitted', () => {
  const { home, store, proj, add } = sandbox();
  add('BANNERRULE keep the mark', ['--strength', 'rule', '--why', 'orientation']);
  const r = spawnSync(process.execPath, [UPDATE_HOOK], {
    input: JSON.stringify({ cwd: proj, source: 'startup' }), encoding: 'utf8',
    env: { ...process.env, HOME: home, ASTRO_PRINCIPLES_DIR: store }, windowsHide: true,
  });
  assert.strictEqual(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout || '{}');
  assert.match(out.hookSpecificOutput?.additionalContext || '', /BANNERRULE/);
  assert.match(out.systemMessage || '', /4str0\|ize/, 'the banner must still be shown');
});
