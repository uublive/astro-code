// Unit tests for the model-tier profiles in lib/models.mjs.
//
// These lock in the speed-switch contract: the opus→sonnet-only ladder for every
// JUDGEMENT role (no haiku among them — a hard project preference), the sole
// documented exception being `integrator` (ADR-027 — mechanical git bookkeeping,
// not judgement), and that the `fast` profile keeps the verify gate on opus so
// "go faster" can never silently cost correctness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileModels, MODEL_PROFILES, PROFILE_NAMES } from '../lib/models.mjs';

// Judgement roles only — `integrator` is deliberately excluded (ADR-027) or
// "max is every role on opus" below would wrongly demand integrator === 'opus'.
const ROLES = ['planner', 'researcher', 'executor', 'verifier', 'discover'];

test('every profile defines all five judgement roles plus integrator', () => {
  for (const name of PROFILE_NAMES) {
    const p = profileModels(name);
    for (const role of ROLES) {
      assert.ok(p[role], `${name}.${role} must be set`);
    }
    assert.ok(p.integrator, `${name}.integrator must be set`);
  }
});

test('every profile defines the IDENTICAL key set (a profile switch can never leave a role unset)', () => {
  const [first, ...rest] = PROFILE_NAMES.map((name) => Object.keys(profileModels(name)).sort());
  for (const keys of rest) {
    assert.deepEqual(keys, first, 'profiles must all carry the same roles');
  }
});

test('no profile uses haiku for a judgement role (sonnet is the floor)', () => {
  for (const name of PROFILE_NAMES) {
    const p = profileModels(name);
    const tiers = ROLES.map((role) => p[role]);
    assert.ok(!tiers.includes('haiku'), `${name} must not use haiku for a judgement role`);
    for (const t of tiers) {
      assert.ok(t === 'opus' || t === 'sonnet', `${name} judgement tier "${t}" must be opus or sonnet`);
    }
  }
});

test('integrator is the sole haiku-tier role: max sonnet, balanced/fast haiku (ADR-027)', () => {
  assert.equal(profileModels('max').integrator, 'sonnet');
  assert.equal(profileModels('balanced').integrator, 'haiku');
  assert.equal(profileModels('fast').integrator, 'haiku');
});

test('max is every role on opus', () => {
  const p = profileModels('max');
  for (const role of ROLES) assert.equal(p[role], 'opus', `max.${role}`);
});

test('balanced keeps opus only for planner and verifier', () => {
  const p = profileModels('balanced');
  assert.equal(p.planner, 'opus');
  assert.equal(p.verifier, 'opus');
  assert.equal(p.researcher, 'sonnet');
  assert.equal(p.executor, 'sonnet');
  assert.equal(p.discover, 'sonnet');
});

test('fast keeps opus ONLY for the verify gate; everything else sonnet', () => {
  const p = profileModels('fast');
  assert.equal(p.verifier, 'opus', 'the verify gate must stay opus so speed cannot cost correctness');
  for (const role of ['planner', 'researcher', 'executor', 'discover']) {
    assert.equal(p[role], 'sonnet', `fast.${role} must be sonnet`);
  }
});

test('profileModels returns a fresh copy each call (mutation-safe)', () => {
  const a = profileModels('fast');
  a.executor = 'opus';
  const b = profileModels('fast');
  assert.equal(b.executor, 'sonnet', 'mutating one result must not corrupt the shared constant');
  assert.notEqual(MODEL_PROFILES.fast.executor, 'opus');
});

test('an unknown profile throws with the valid choices listed', () => {
  assert.throws(() => profileModels('turbo'), /unknown model profile "turbo".*max.*balanced.*fast/s);
});
