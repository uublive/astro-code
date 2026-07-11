// Contract guards for ADR-021's verification half: the astro-verifier agent and the
// execute-phase Verify spawn must be plan-blind (never read PLAN.md), adversarial
// (assume FAIL, gather independent per-criterion evidence), check against CRITERIA.md,
// and self-derive with a provenance line when CRITERIA.md is absent. Static guards only —
// the prompt text is the enforcement, so we pin the load-bearing language.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const verifier = readFileSync(join(ROOT, 'agents', 'astro-verifier.md'), 'utf8');
const execPhase = readFileSync(join(ROOT, 'workflows', 'execute-phase.mjs'), 'utf8');

test('astro-verifier is plan-blind, adversarial, per-criterion, and self-derives with provenance', () => {
  assert.match(verifier, /CRITERIA\.md/, 'verifier checks against CRITERIA.md');
  assert.match(verifier, /do NOT read[^.\n]*PLAN\.md/i, 'must not read PLAN.md');
  assert.match(verifier, /assume[^.\n]*FAIL/i, 'adversarial: assume FAIL until proven');
  assert.match(verifier, /every criterion/i, 'PASS requires every criterion to independently pass');
  assert.match(verifier, /self-derive/i, 'self-derives criteria when CRITERIA.md is absent');
  assert.match(verifier, /provenance/i, 'announces criteria provenance in the verdict');
  // read-only: the frontmatter grants no Write tool
  assert.match(verifier, /tools:\s*Read,\s*Bash,\s*Grep,\s*Glob/);
  const frontmatter = verifier.split('---')[1] || '';
  assert.doesNotMatch(frontmatter, /Write/, 'verifier frontmatter must not grant Write');
});

test('the execute-phase Verify spawn is CRITERIA.md-based, plan-blind, adversarial, self-deriving', () => {
  const vi = execPhase.indexOf("phase('Verify')");
  assert.ok(vi !== -1, "phase('Verify') not found");
  // Window spans the Verify section (both the integrationFailed branch and the else spawn).
  const window = execPhase.slice(vi, vi + 4000);
  assert.match(window, /CRITERIA\.md/, 'spawn prompt must reference CRITERIA.md');
  assert.match(window, /do NOT read[^.\n]*PLAN\.md/i, 'spawn prompt must forbid reading PLAN.md');
  assert.match(window, /assume[^.\n]*FAIL/i, 'spawn prompt must be adversarial (assume FAIL)');
  assert.match(window, /self-derive/i, 'spawn prompt must carry the self-derive fallback');
  assert.match(window, /agentType:\s*'astro-verifier'/, 'still spawns the astro-verifier agent');
});
