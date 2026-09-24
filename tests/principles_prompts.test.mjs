// Phase 25 t15 — the prose guard for delivery into workflow prompts (P10, D1/D2).
// Test-after by design (written in the same task as the prose it guards, per this
// phase's PLAN.md test strategy): it asserts on text that only exists once
// workflows/execute-phase.mjs and workflows/plan-phase.mjs carry the principles
// block, so a separate RED task would be RED against nothing (ADR-018 does not
// apply here). Static source checks, the tests/workflows.test.mjs shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXEC_SRC = readFileSync(join(ROOT, 'workflows', 'execute-phase.mjs'), 'utf8');
const PLAN_SRC = readFileSync(join(ROOT, 'workflows', 'plan-phase.mjs'), 'utf8');
const EXECUTOR_MD = readFileSync(join(ROOT, 'agents', 'astro-executor.md'), 'utf8');
const VERIFIER_MD = readFileSync(join(ROOT, 'agents', 'astro-verifier.md'), 'utf8');

test('execute-phase.mjs carries a sentinel-delimited principles block', () => {
  assert.ok(EXEC_SRC.includes('// principles-block:start'));
  assert.ok(EXEC_SRC.includes('// principles-block:end'));
  const start = EXEC_SRC.indexOf('// principles-block:start');
  const end = EXEC_SRC.indexOf('// principles-block:end');
  assert.ok(end > start);
});

test('plan-phase.mjs carries a sentinel-delimited principles block', () => {
  assert.ok(PLAN_SRC.includes('// principles-block:start'));
  assert.ok(PLAN_SRC.includes('// principles-block:end'));
});

test('execPrompt, healPrompt, batchPrompt and remediatePrompt call principlesFor + CITE', () => {
  for (const name of ['const execPrompt', 'const healPrompt', 'const batchPrompt', 'const remediatePrompt']) {
    const idx = EXEC_SRC.indexOf(name);
    assert.ok(idx !== -1, `${name} not found`);
    const nextConst = EXEC_SRC.indexOf('\nconst ', idx + name.length);
    const body = EXEC_SRC.slice(idx, nextConst === -1 ? idx + 4000 : nextConst);
    assert.ok(body.includes('principlesFor('), `${name} must call principlesFor(...)`);
    assert.ok(body.includes('CITE'), `${name} must append CITE`);
  }
});

test('runVerify carries VERIFY_RULES (hard rules only, non-blocking)', () => {
  const idx = EXEC_SRC.indexOf('const runVerify');
  assert.ok(idx !== -1);
  const body = EXEC_SRC.slice(idx, idx + 6000);
  assert.ok(body.includes('VERIFY_RULES'));
});

test('VERIFY_RULES text says findings only, never a criterion failure', () => {
  const idx = EXEC_SRC.indexOf('const VERIFY_RULES');
  const body = EXEC_SRC.slice(idx, idx + 800);
  assert.ok(body.includes('rules-only'));
  assert.ok(body.includes('outsideCriteria'));
  assert.ok(/never.*passed\s*=\s*false|NEVER grounds to set/.test(body));
});

test('Criteria stage in plan-phase.mjs is never given a principles instruction (D2: plan-blind AND principle-blind)', () => {
  // Actual stage calls sit alone on their own line — the module-header comment ABOVE
  // them uses the same `phase('Research')` text as a prose example, so match line-start.
  const criteriaIdx = PLAN_SRC.search(/^phase\('Criteria'\)$/m);
  const researchIdx = PLAN_SRC.search(/^phase\('Research'\)$/m);
  assert.ok(criteriaIdx !== -1 && researchIdx !== -1 && researchIdx > criteriaIdx);
  const criteriaBody = PLAN_SRC.slice(criteriaIdx, researchIdx);
  assert.ok(!criteriaBody.includes('PRINCIPLES_RESEARCH'));
  assert.ok(!criteriaBody.includes('PRINCIPLES_PLAN'));
  assert.ok(!/ac principles/.test(criteriaBody));
});

test('Research and Synthesize stages each call the principles instruction', () => {
  assert.ok(PLAN_SRC.includes('PRINCIPLES_RESEARCH'));
  assert.ok(PLAN_SRC.includes('PRINCIPLES_PLAN'));
});

test('astro-executor.md tells the agent to brief and cite', () => {
  assert.ok(EXECUTOR_MD.includes('ac principles brief'));
  assert.ok(EXECUTOR_MD.includes('ac principles cite'));
});

test('astro-verifier.md: rules-only, non-blocking', () => {
  assert.ok(VERIFIER_MD.includes('--rules-only'));
  assert.ok(VERIFIER_MD.includes('outsideCriteria'));
  assert.ok(VERIFIER_MD.toLowerCase().includes('never'));
});

test('no workflow result schema gains a field for principles (byte-identical additionalProperties:false shapes)', () => {
  for (const name of ['TASK_SCHEMA', 'EXEC_SCHEMA', 'VERIFY_SCHEMA', 'REMEDIATE_SCHEMA']) {
    const idx = EXEC_SRC.indexOf(`const ${name} =`);
    if (idx === -1) continue;
    const end = EXEC_SRC.indexOf('\n}\n', idx);
    const body = EXEC_SRC.slice(idx, end === -1 ? idx + 2000 : end + 3);
    assert.ok(!/principle/i.test(body), `${name} must not gain a principles field`);
  }
});
