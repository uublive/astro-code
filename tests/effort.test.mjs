// Unit + CLI contract tests for the per-phase effort dial (ADR-022).
//
// The dial tunes how much QUOTA the verify→remediate loop may burn per phase
// (light|standard|deep → 0|1|3 cycles; deep also escalates to opus) WITHOUT
// touching the discuss→plan→execute→verify shape. These tests lock in the two
// deliberately-different strictnesses: the WRITE path is loud on a bogus level
// (so a typo never lands on disk — C1) while the READ/resolve path normalizes an
// absent/unknown level to the `standard` budget (backward-compatible — C3). They
// also pin that `effort` is config-independent (no global knob — C8) and that the
// deep→opus escalation never mutates the caller's base tier map (C4).
//
// Per ADR-018 the modules under test are pulled in with `await import(...)` INSIDE
// each async test body (never a static top-of-file import), so a not-yet-landed
// export fails only its own case instead of crashing the whole file at module
// load. The CLI surface is driven by spawning bin/ac.mjs as a real subprocess.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON } from '../lib/util.mjs';

// Absolute path to bin/ac.mjs — same import.meta.url idiom as flow_cli.test.mjs.
const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

// Scaffold a fresh project with the named phases (number 1..N, milestone 1).
// addPhase lives in the module under test (roadmap.mjs), so it is dynamic-imported
// here too rather than statically pulled in at file top (ADR-018).
async function scaffold(names = ['alpha']) {
  const root = mkdtempSync(join(tmpdir(), 'ac-effort-'));
  initPlanning(root, { name: 'demo' });
  const { addPhase } = await import('../lib/roadmap.mjs');
  let n = 1;
  for (const name of names) await addPhase(root, { number: n++, name, milestone: 1 });
  return root;
}

// Spawn bin/ac.mjs with the given args from cwd. Returns { status, stdout, stderr }.
function ac(args, cwd) {
  return spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

// ---------------------------------------------------------------------------
// Pure resolution helpers (lib/effort.mjs)
// ---------------------------------------------------------------------------

test('effortKnobs maps light/standard/deep to 0/1/3 remediate cycles (C3)', async () => {
  const { effortKnobs } = await import('../lib/effort.mjs');
  assert.equal(effortKnobs('light').maxCycles, 0);
  assert.equal(effortKnobs('standard').maxCycles, 1);
  assert.equal(effortKnobs('deep').maxCycles, 3);
});

test('effortKnobs normalizes an absent/unknown level to the standard budget (C3)', async () => {
  const { effortKnobs } = await import('../lib/effort.mjs');
  assert.equal(effortKnobs(undefined).maxCycles, 1, 'absent → standard budget');
  assert.equal(effortKnobs('turbo').maxCycles, 1, 'unknown → standard budget');
});

test('effortKnobs returns a fresh copy each call (mutation-safe)', async () => {
  const { effortKnobs, EFFORT_KNOBS } = await import('../lib/effort.mjs');
  const a = effortKnobs('deep');
  a.maxCycles = 99;
  assert.equal(effortKnobs('deep').maxCycles, 3, 'mutating one result must not corrupt the shared table');
  assert.equal(EFFORT_KNOBS.deep.maxCycles, 3);
});

test('validateEffort throws with the valid choices on a bogus level (C1)', async () => {
  const { validateEffort } = await import('../lib/effort.mjs');
  assert.throws(() => validateEffort('turbo'), /unknown effort level "turbo".*light.*standard.*deep/s);
  // valid levels pass through and return the level for inline use
  assert.equal(validateEffort('deep'), 'deep');
});

test('resolveEffort precedence is override > stored > hardcoded standard (C5/C8)', async () => {
  const { resolveEffort, DEFAULT_EFFORT } = await import('../lib/effort.mjs');
  assert.equal(DEFAULT_EFFORT, 'standard');
  assert.equal(resolveEffort(undefined, undefined), 'standard', 'nothing set → hardcoded standard');
  assert.equal(resolveEffort('deep', undefined), 'deep', 'stored wins when no override');
  assert.equal(resolveEffort('light', 'deep'), 'deep', 'override beats stored');
  assert.equal(resolveEffort('deep', 'turbo'), 'deep', 'a bogus override is skipped, falls to stored');
  assert.equal(resolveEffort('turbo', undefined), 'standard', 'a bogus stored value normalizes to standard');
});

test('effortModels forces opus for deep only and passes base tiers through otherwise (C4)', async () => {
  const { effortModels } = await import('../lib/effort.mjs');
  const base = { planner: 'opus', researcher: 'sonnet', executor: 'sonnet', verifier: 'sonnet', discover: 'sonnet' };
  const deep = effortModels(base, 'deep');
  assert.equal(deep.executor, 'opus', 'deep escalates the executor');
  assert.equal(deep.verifier, 'opus', 'deep escalates the verifier');
  assert.equal(deep.researcher, 'sonnet', 'deep never widens the research tier');
  for (const level of ['light', 'standard']) {
    assert.deepEqual(effortModels(base, level), base, `${level} passes the base tiers through untouched`);
  }
  // Never mutate the caller's base map — the escalation is in-memory per run only.
  assert.equal(base.executor, 'sonnet', 'input map must not be mutated');
  assert.equal(base.verifier, 'sonnet', 'input map must not be mutated');
});

// ---------------------------------------------------------------------------
// Lock-guarded mutator (lib/roadmap.mjs setPhaseEffort)
// ---------------------------------------------------------------------------

test('setPhaseEffort round-trips light/standard/deep on the matched phase (C2)', async () => {
  const root = await scaffold(['alpha']);
  const { setPhaseEffort } = await import('../lib/roadmap.mjs');
  const { findPhase } = await import('../lib/roadmap.mjs');
  for (const level of ['light', 'standard', 'deep']) {
    await setPhaseEffort(root, '01-alpha', level);
    assert.equal(findPhase(root, '01-alpha').effort, level);
  }
});

test('setPhaseEffort rejects a bogus level and writes nothing (C1)', async () => {
  const root = await scaffold(['alpha']);
  const { setPhaseEffort } = await import('../lib/roadmap.mjs');
  await assert.rejects(() => setPhaseEffort(root, '01-alpha', 'turbo'), /unknown effort level/);
  const rm = readJSON(paths(root).roadmap);
  assert.equal(rm.phases[0].effort, undefined, 'a rejected level must not land on disk');
});

test('setPhaseEffort touches only the matched phase, preserving every other phase (C2)', async () => {
  const root = await scaffold(['alpha', 'beta']);
  const { setPhaseEffort } = await import('../lib/roadmap.mjs');
  await setPhaseEffort(root, '01-alpha', 'deep');
  const rm = readJSON(paths(root).roadmap);
  const beta = rm.phases.find((p) => p.slug === '02-beta');
  assert.equal(rm.phases.find((p) => p.slug === '01-alpha').effort, 'deep');
  assert.equal(beta.effort, undefined, 'the sibling phase must be left byte-for-byte intact');
  assert.equal(beta.name, 'beta');
  assert.equal(beta.status, 'pending');
});

// ---------------------------------------------------------------------------
// CLI surface (ac phase effort) — spawned subprocess
// ---------------------------------------------------------------------------

test('ac phase effort <n> <level> persists and prints the ✓ confirmation', async () => {
  const root = await scaffold(['alpha']);
  const r = ac(['phase', 'effort', '1', 'deep'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓.*deep/);
  assert.equal(readJSON(paths(root).roadmap).phases[0].effort, 'deep');
});

test('ac phase effort <n> resolves the stored level; absent reads as standard (C1)', async () => {
  const root = await scaffold(['alpha']);
  // No effort field yet → hardcoded standard default (backward-compatible read).
  const before = ac(['phase', 'effort', '1'], root);
  assert.equal(before.status, 0, before.stderr);
  assert.equal(before.stdout.trim(), 'standard');
  // After a write, the stored level is what resolves.
  ac(['phase', 'effort', '1', 'deep'], root);
  const after = ac(['phase', 'effort', '1'], root);
  assert.equal(after.stdout.trim(), 'deep');
});

test('ac phase effort <n> --effort <level> is a one-off, non-persisting override (C5)', async () => {
  const root = await scaffold(['alpha']);
  const r = ac(['phase', 'effort', '1', '--effort', 'deep'], root);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'deep', 'the override wins for this single read');
  // The override must NOT have been written back to roadmap.json.
  assert.equal(readJSON(paths(root).roadmap).phases[0].effort, undefined, 'a --effort override must never persist');
});

test('ac phase effort <n> <bogus> exits non-zero and writes nothing (C1)', async () => {
  const root = await scaffold(['alpha']);
  const r = ac(['phase', 'effort', '1', 'turbo'], root);
  assert.notEqual(r.status, 0, 'a bogus level must exit non-zero');
  assert.match(r.stderr + r.stdout, /✖|unknown effort level/i);
  assert.equal(readJSON(paths(root).roadmap).phases[0].effort, undefined, 'nothing may be written on a rejected level');
});
