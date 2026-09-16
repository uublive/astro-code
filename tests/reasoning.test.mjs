// The per-role reasoning dial: how hard each agent thinks, independent of which
// model runs it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REASONING_LEVELS, DEFAULT_REASONING, REASONING_PROFILES,
  validateReasoning, resolveReasoning, profileReasoning, hostReasoning,
} from '../lib/reasoning.mjs';
import { EFFORT_LEVELS } from '../lib/effort.mjs';
import { PROFILE_NAMES, profileModels } from '../lib/models.mjs';
import { getHost } from '../lib/hosts/index.mjs';
import { buildInvocation } from '../lib/hosts/runner.mjs';

test('reasoning and effort are DIFFERENT dials with different vocabularies', () => {
  // astro-code already had an `effort` dial (ADR-022) budgeting verify→remediate
  // cycles. Reasoning is an agent's thinking depth. Two things both called
  // "effort" in one config would be a permanent source of confusion — this
  // pins that they never share a vocabulary and so can never be silently swapped.
  assert.deepEqual(EFFORT_LEVELS, ['light', 'standard', 'deep']);
  assert.deepEqual(REASONING_LEVELS, ['low', 'medium', 'high', 'xhigh', 'max']);
  for (const l of EFFORT_LEVELS) assert.ok(!REASONING_LEVELS.includes(l));
});

test('the WRITE path is strict and the READ path is lenient', () => {
  // Same discipline as effort.mjs: a typo must fail loud before it lands in
  // config, but an old config with no/unknown level must keep working.
  assert.equal(validateReasoning('xhigh'), 'xhigh');
  assert.throws(() => validateReasoning('very-high'), /unknown reasoning level/);
  assert.equal(resolveReasoning(undefined), DEFAULT_REASONING);
  assert.equal(resolveReasoning('stale-value'), DEFAULT_REASONING);
  assert.equal(resolveReasoning('high'), 'high');
});

test('every model profile has a matching reasoning profile, role for role', () => {
  for (const name of PROFILE_NAMES) {
    const models = profileModels(name);
    const reasoning = profileReasoning(name);
    assert.deepEqual(Object.keys(reasoning).sort(), Object.keys(models).sort(),
      `${name}: a role with a tier but no reasoning would silently run at the host default`);
    for (const [role, level] of Object.entries(reasoning)) {
      assert.ok(REASONING_LEVELS.includes(level), `${name}.${role} = ${level}`);
    }
  }
});

test('fast keeps the verify gate deep — speed must not cost correctness', () => {
  // Mirrors the model profile, where `fast` keeps the verifier on opus.
  assert.equal(REASONING_PROFILES.fast.verifier, 'high');
  assert.equal(REASONING_PROFILES.fast.executor, 'low');
  // and the mechanical roles never pay for thinking they cannot use
  for (const name of PROFILE_NAMES) {
    assert.equal(profileReasoning(name).integrator, 'low', `${name}: integrator`);
    assert.equal(profileReasoning(name).discover, 'low', `${name}: discover`);
  }
});

test('levels clamp to each host ceiling rather than silently dropping', () => {
  // Asking for maximum thinking and quietly getting the default is the worst
  // outcome, because it is invisible. Clamping is visible in the argv.
  assert.equal(hostReasoning('max', 'claude'), 'max');
  assert.equal(hostReasoning('max', 'codex'), 'xhigh', "codex's ceiling is xhigh");
  assert.equal(hostReasoning('xhigh', 'pi'), 'max', "pi has no xhigh; its ceiling is max");
  assert.equal(hostReasoning('medium', 'codex'), 'medium');
  // an unregistered host passes the canonical value through, so a new adapter
  // fails visibly at the CLI instead of running at the host default
  assert.equal(hostReasoning('high', 'brand-new-host'), 'high');
});

test('Codex carries reasoning into the argv; Claude reports it cannot', () => {
  const codex = buildInvocation(getHost('codex'), { prompt: 'p', reasoning: 'high' });
  const i = codex.args.indexOf('-c');
  assert.ok(i !== -1, 'codex takes it through the generic config override');
  assert.equal(codex.args[i + 1], 'model_reasoning_effort="high"');
  assert.equal(codex.reasoning, 'high');
  assert.equal(codex.reasoningApplied, true);

  // Claude Code takes depth via the Workflow tool's agent({effort}), not the
  // CLI — so a headless run must say it was requested, not imply it applied.
  const claude = buildInvocation(getHost('claude'), { prompt: 'p', reasoning: 'high' });
  assert.ok(!claude.args.includes('-c'));
  assert.equal(claude.reasoningApplied, false);
});

test('a task with no reasoning adds no flag at all', () => {
  const inv = buildInvocation(getHost('codex'), { prompt: 'p' });
  assert.ok(!inv.args.includes('-c'), 'nothing unrequested reaches the wire');
  assert.equal(inv.reasoning, null);
  assert.equal(inv.reasoningApplied, null);
});
