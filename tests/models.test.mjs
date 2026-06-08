// Unit tests for the model-tier profiles in lib/models.mjs.
//
// These lock in the speed-switch contract: the opus→sonnet-only ladder (no haiku
// anywhere — a hard project preference), and that the `fast` profile keeps the
// verify gate on opus so "go faster" can never silently cost correctness.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileModels, MODEL_PROFILES, PROFILE_NAMES } from '../lib/models.mjs';

const ROLES = ['planner', 'researcher', 'executor', 'verifier', 'discover'];

test('every profile defines all five roles', () => {
  for (const name of PROFILE_NAMES) {
    const p = profileModels(name);
    for (const role of ROLES) {
      assert.ok(p[role], `${name}.${role} must be set`);
    }
  }
});

test('no profile uses haiku anywhere (sonnet is the floor)', () => {
  for (const name of PROFILE_NAMES) {
    const tiers = Object.values(profileModels(name));
    assert.ok(!tiers.includes('haiku'), `${name} must not use haiku`);
    for (const t of tiers) {
      assert.ok(t === 'opus' || t === 'sonnet', `${name} tier "${t}" must be opus or sonnet`);
    }
  }
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
