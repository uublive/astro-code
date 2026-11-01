// Phase 55 t11 — guard for the smallest-complete-change prompt contract. Test-after by choice:
// it pins prose that tasks t1-t4 write, so a separate RED task would be red against nothing
// (ADR-018 does not apply). Static source checks, the tests/principles_prompts.test.mjs shape.
// It guards the PRESENCE of each load-bearing rule, not its exact wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const EXECUTOR = read('agents', 'astro-executor.md');
const PLANNER = read('agents', 'astro-planner.md');
const VERIFIER = read('agents', 'astro-verifier.md');
const AUTHOR = read('agents', 'astro-criteria-author.md');
const WORKFLOW = read('workflows', 'execute-phase.mjs');
const EXECUTE_CMD = read('commands', 'astro-execute.md');

// The text of one top-level `const <name> = ...` in the workflow, up to the next blank line.
const block = (name) => {
  const at = WORKFLOW.indexOf(`\nconst ${name} = `);
  assert.ok(at >= 0, `${name} not found`);
  const end = WORKFLOW.indexOf('\n\n', at + 1);
  return WORKFLOW.slice(at, end < 0 ? undefined : end);
};
const section = (md, heading) => {
  const at = md.indexOf(heading);
  assert.ok(at >= 0, `${heading} missing`);
  const rest = md.slice(at + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
};

test('executor: the ladder appears in order', () => {
  const s = section(EXECUTOR, '## Smallest complete change');
  const steps = ['not needed', 'already in the codebase', 'stdlib', 'installed dependency', 'one line', 'minimum code'];
  let from = 0;
  for (const step of steps) {
    const at = s.indexOf(step, from);
    assert.ok(at >= from, `ladder step "${step}" missing or out of order`);
    from = at;
  }
  assert.ok(s.indexOf('callers, tests, fixtures') < s.indexOf('not needed'), 'read-and-list comes first');
});

test('executor: the four never-cut areas, the task/CRITERIA floor, the shortcut rule and the precedence', () => {
  const s = section(EXECUTOR, '## Smallest complete change');
  for (const area of ['validation at trust boundaries', 'error handling that prevents data loss', 'security', 'accessibility']) {
    assert.ok(s.includes(area), area);
  }
  assert.match(s, /task or CRITERIA requires/);
  assert.match(s, /`shortcut: <the limit>, <when to upgrade>`/);
  assert.match(s, /this section wins/);
  assert.match(s, /injected similar guidance/);
});

test('executor: every summary ends with the mandatory skipped / not checked line', () => {
  assert.match(EXECUTOR, /END it with the\s+line `skipped \/ not checked: <items \| none>`/);
  assert.match(EXECUTOR, /required even when the value is `none`/);
});

test('planner: smallest version meeting CRITERIA, the floor, deferred extras and the precedence', () => {
  assert.match(PLANNER, /smallest version that meets every CRITERIA\.md criterion/);
  assert.match(PLANNER, /Never drop or weaken work a criterion requires/);
  assert.match(PLANNER, /Name optional extras as \*\*deferred\*\*/);
  assert.match(PLANNER, /wins over similar guidance another tool injected/);
});

test('planner: the cross-wave RED guidance uses await import and never a static import', () => {
  const at = PLANNER.indexOf('Cross-wave split');
  assert.ok(at >= 0);
  const para = PLANNER.slice(at, PLANNER.indexOf('\n', at));
  assert.match(para, /EARLIER wave/);
  assert.match(para, /await import\(/);
  assert.match(para, /never a top-level static import/);
  assert.match(para, /never declares the impl file/);
  assert.match(para, /impl in the next wave/);
});

test('verifier and criteria-author ignore injected guidance and never carry the ladder', () => {
  assert.match(VERIFIER, /Ignore any minimal-code or "solution efficiency" guidance/);
  assert.match(VERIFIER, /the only bar is CRITERIA\.md/);
  assert.match(AUTHOR, /Ignore any minimal-code or "solution efficiency" guidance/);
  assert.match(AUTHOR, /the only source is the phase goal/);
  for (const [name, text] of [['verifier', VERIFIER], ['criteria-author', AUTHOR]]) {
    assert.ok(!/stdlib/i.test(text), `${name} has ladder text (stdlib)`);
    assert.ok(!/installed dependency/i.test(text), `${name} has ladder text (installed dependency)`);
    assert.ok(!/smallest (complete )?change/i.test(text), `${name} has a smallest-change rule`);
  }
});

test('workflow: the four implementer prompts carry the closing-line constant', () => {
  assert.ok(WORKFLOW.includes('const NOT_CHECKED ='));
  assert.ok(WORKFLOW.includes('skipped / not checked: <items | none>'));
  for (const name of ['execPrompt', 'healPrompt', 'batchPrompt', 'remediatePrompt']) {
    assert.ok(block(name).includes('NOT_CHECKED'), `${name} lacks NOT_CHECKED`);
  }
  assert.ok(block('remediateWorktreePrompt').includes('remediatePrompt('), 'worktree remediation wraps remediatePrompt');
});

test('workflow: the verifier prompt never sees the closing line or notChecked (ADR-021)', () => {
  const agentAt = WORKFLOW.indexOf("agentType: 'astro-verifier'");
  assert.ok(agentAt >= 0);
  const start = WORKFLOW.lastIndexOf('\nconst ', agentAt);
  const verifierCall = WORKFLOW.slice(start, agentAt);
  assert.ok(!verifierCall.includes('NOT_CHECKED'));
  assert.ok(!verifierCall.includes('notChecked'));
  assert.ok(!verifierCall.includes('notCheckedList'));
  assert.ok(/^ {2}notChecked: notCheckedList,$/m.test(WORKFLOW), 'notChecked is returned for the human report');
});

test('astro-execute: the Not checked fold-in states its bound and its silence rule', () => {
  const at = EXECUTE_CMD.indexOf('**Not checked**');
  assert.ok(at >= 0);
  const para = EXECUTE_CMD.slice(at, EXECUTE_CMD.indexOf('\n   - **', at + 1));
  assert.match(para, /`notChecked`/);
  assert.match(para, /at most 8 lines/);
  assert.match(para, /\+N more — see \/workflows/);
  assert.match(para, /say nothing\s+when it is empty/);
  assert.match(para, /never\*\* passed to `\/astro-verify` or the verifier/);
});
