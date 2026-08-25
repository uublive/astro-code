// Guards for two related CLI safety gaps found while testing 0.8.1 against a real
// project (ADR-029):
//
//   1. `parseArgs` collected ANY `--x` into `flags` and no verb validated them, so an
//      unknown flag was silently discarded and the command ran with DEFAULT behavior.
//   2. `ac canon push` had no `--dry-run` at all, yet `--dry-run` is the flag a cautious
//      operator reaches for before publishing to a branch the whole team reads.
//
// Together those made `ac canon push --dry-run` perform a REAL publish — the
// safest-sounding invocation was the most dangerous one. This file pins both halves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { initRegistry } from '../lib/registry.mjs';
import { canonPush, canonPull } from '../lib/canon.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

const run = (args, cwd) =>
  spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-flags-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: 'flagproj' });
  return dir;
}

const registryTip = (bare) =>
  git(['rev-parse', 'refs/heads/astro-registry'], { cwd: bare }).stdout.trim();

// ── 1. unknown flags are rejected on the shared/destructive verbs ─────────────

test('ADR-029: `ac canon push --dryrun` (typo) exits non-zero instead of publishing', () => {
  const dir = mkWorkdir(null);
  const res = run(['canon', 'push', '--dryrun'], dir);
  assert.notStrictEqual(res.status, 0, 'a typo\'d flag must not exit 0');
  assert.match(res.stderr, /unknown flag/i);
  assert.match(res.stderr, /--dryrun/, 'the error must name the offending flag');
  assert.match(res.stderr, /--dry-run/, 'the error must name what IS accepted');
});

test('ADR-029: the flag check runs BEFORE the command does any work', () => {
  // This repo has no coordinated remote, so canon push would normally die with
  // "no coordinated remote". The unknown-flag error must win — proving the guard
  // is reached before the side-effecting path, not after it.
  const dir = mkWorkdir(null);
  const res = run(['canon', 'push', '--nope'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  assert.doesNotMatch(res.stderr, /no coordinated remote/i);
});

test('ADR-029: a typo\'d `ac decision add` flag rejects and writes NO decision', () => {
  const dir = mkWorkdir(null);
  const res = run(['decision', 'add', 'Some choice', '--wy', 'because'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  // The real damage from a silent flag drop is the side effect landing anyway.
  const decisions = existsSync(paths(dir).decisions) ? readFileSync(paths(dir).decisions, 'utf8') : '';
  assert.doesNotMatch(decisions, /Some choice/, 'the decision must NOT have been appended');
});

test('ADR-029: a typo\'d `ac phase accept --forse` rejects and leaves the phase unaccepted', async () => {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  await setPhaseStatus(dir, ph.slug, 'verified');

  const res = run(['phase', 'accept', '1', '--forse'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  assert.strictEqual(
    findPhase(dir, '1').status, 'verified',
    'the phase must not have been closed by a command whose flag was a typo',
  );
});

test('ADR-029: documented flags still work — the guard is an allowlist, not a ban', async () => {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  await setPhaseStatus(dir, ph.slug, 'verified');

  const res = run(['phase', 'accept', '1', '--by', 'alice'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(findPhase(dir, '1').status, 'complete');
});

test('ADR-029: read-only verbs are deliberately NOT guarded (no blanket enforcement)', () => {
  const dir = mkWorkdir(null);
  const res = run(['status', '--verbose'], dir);
  assert.strictEqual(res.status, 0, 'a stray flag on a read-only verb stays harmless');
});

// ── 2. canon push --dry-run reads, never writes ───────────────────────────────

test('ADR-029: canonPush dryRun reports a pending change and leaves the registry untouched', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  writeFileSync(paths(dir).conventions, '# Conventions\n\nfirst version\n');
  assert.strictEqual(canonPush(dir).ok, true, 'seed a published copy');
  const tip = registryTip(bare);

  // Now diverge locally and ask what a push WOULD do.
  writeFileSync(paths(dir).conventions, '# Conventions\n\nsecond version\n');
  const dry = canonPush(dir, { dryRun: true });

  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.dryRun, true);
  assert.strictEqual(dry.wouldChange, true, 'a diverged local copy must report wouldChange');
  assert.strictEqual(dry.remoteExists, true);
  assert.deepStrictEqual(dry.pushed, [], 'a dry run must report nothing as pushed');
  assert.strictEqual(registryTip(bare), tip, 'the registry branch must NOT have moved');

  // And the published copy is still the OLD one.
  canonPull(dir);
  assert.match(readFileSync(paths(dir).conventions, 'utf8'), /first version/);
});

test('ADR-029: canonPush dryRun distinguishes identical from changed', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  writeFileSync(paths(dir).conventions, '# Conventions\n\nsame\n');
  assert.strictEqual(canonPush(dir).ok, true);

  const dry = canonPush(dir, { dryRun: true });
  assert.strictEqual(dry.wouldChange, false, 'a byte-identical local copy is a no-op push');
  assert.strictEqual(dry.remoteExists, true);
});

test('ADR-029: a real canonPush still publishes (the dry-run guard is opt-in)', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  const tip = registryTip(bare);

  writeFileSync(paths(dir).conventions, '# Conventions\n\npublished\n');
  const res = canonPush(dir);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.pushed, ['CONVENTIONS.md']);
  assert.notStrictEqual(registryTip(bare), tip, 'a real push must move the registry branch');
});

// ── ADR-033: acceptance provenance — who signed, and of what kind ─────────────
//
// REQ-006 is the two-gate guarantee: the AI verifier reaches `verified`, only a human
// `/astro-accept` reaches `complete`. `accepted_by` used to default to the repo's git
// identity, so an autonomous agent accepting on the operator's behalf was recorded AS the
// operator — a machine sign-off and a human one had the identical shape, making the
// guarantee unauditable from the record. Found during an unattended benchmark run.

async function verifiedPhase() {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  await setPhaseStatus(dir, findPhase(dir, '1').slug, 'verified');
  return dir;
}

test('ADR-033: a plain accept records accepted_kind "human"', async () => {
  const dir = await verifiedPhase();
  const res = run(['phase', 'accept', '1'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  const ph = findPhase(dir, '1');
  assert.strictEqual(ph.status, 'complete');
  assert.strictEqual(ph.accepted_kind, 'human', 'an undeclared accept asserts a human made the judgement');
});

test('ADR-033: --agent records accepted_kind "agent" and the agent as signer', async () => {
  const dir = await verifiedPhase();
  const res = run(['phase', 'accept', '1', '--agent', 'FORGEMASTER'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  const ph = findPhase(dir, '1');
  assert.strictEqual(ph.accepted_kind, 'agent');
  assert.strictEqual(ph.accepted_by, 'FORGEMASTER', 'the agent must be the recorded signer, not the git identity');
  // The distinction is worthless if a human reading the terminal cannot see it.
  assert.match(res.stdout, /AGENT/, 'a machine sign-off must be visible in the output, not just in the file');
});

test('ADR-033: the two signer kinds are distinguishable in the record', async () => {
  const human = await verifiedPhase();
  run(['phase', 'accept', '1'], human);
  const agent = await verifiedPhase();
  run(['phase', 'accept', '1', '--agent', 'bot'], agent);
  assert.notStrictEqual(
    findPhase(human, '1').accepted_kind,
    findPhase(agent, '1').accepted_kind,
    'a machine sign-off and a human sign-off must not be the same shape — that is the defect ADR-033 fixes',
  );
});

test('ADR-033: --agent is allowlisted, and a typo of it is still rejected', async () => {
  const dir = await verifiedPhase();
  const bad = run(['phase', 'accept', '1', '--agnet', 'bot'], dir);
  assert.notStrictEqual(bad.status, 0, 'a typo must not silently fall back to a human sign-off');
  assert.match(bad.stderr, /unknown flag/i);
  assert.strictEqual(findPhase(dir, '1').status, 'verified', 'the rejected accept must not have closed the phase');
});
