// Phase 51 t4 — lib/verifyrun.mjs: the headless verifier trial. The contract is single-sourced from
// commands/astro-verify.md, the prompt names no leak word, the verdict is parsed in code (C4, C5, C9).
// Modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEAK = /calibrat|plant|mutant|mutat|defect|mutmut|stryker/i; // declared here: no dependency on lib/plant.mjs
const fence = (obj) => `Verdict follows.\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\n`;
const env = (result, extra = {}) => JSON.stringify({ type: 'result', is_error: false, result, total_cost_usd: 1.25, ...extra });

test('verifierContract returns exactly the marked sentence of astro-verify.md and throws when the markers are missing', async () => {
  const { verifierContract } = await import('../lib/verifyrun.mjs');
  const text = readFileSync(join(ROOT, 'commands', 'astro-verify.md'), 'utf8');
  const marked = text.slice(text.indexOf('<!-- verifier-contract -->') + 26, text.indexOf('<!-- /verifier-contract -->'));
  assert.equal(verifierContract(), marked.replace(/\s+/g, ' ').trim());
  const dir = mkdtempSync(join(tmpdir(), 'ac-vr-'));
  try {
    writeFileSync(join(dir, 'v.md'), 'no markers here');
    assert.throws(() => verifierContract({ file: join(dir, 'v.md') }), /markers/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the marked contract still says plan-blind, assume FAIL, full suite and every criterion', async () => {
  const { verifierContract } = await import('../lib/verifyrun.mjs');
  const c = verifierContract();
  for (const re of [/do NOT read PLAN\.md\/SPEC\.md/, /assume FAIL/, /full suite/, /\*\*every\*\* criterion/, /CRITERIA\.md/]) assert.match(c, re);
});

test('trialPrompt carries the goal, the CRITERIA.md path and the contract, asks for a full run and the fenced verdict, and its frame matches no LEAK word', async () => {
  const { trialPrompt, verifierContract } = await import('../lib/verifyrun.mjs');
  const { prompt, frame } = trialPrompt({ number: 7, slug: '07-thing', goal: 'Ship the thing', criteriaPath: '/tmp/ac-v-x/repo/.astrocode/phases/07-thing/CRITERIA.md' });
  assert.ok(prompt.includes('Ship the thing') && prompt.includes('/CRITERIA.md') && prompt.includes(verifierContract()));
  assert.match(prompt, /full verify, not narrowed/);
  assert.match(prompt, /```json/);
  assert.match(prompt, /"mode":"full"/);
  assert.doesNotMatch(frame, LEAK);
  assert.doesNotMatch(prompt, LEAK);
  assert.ok(!frame.includes('Ship the thing'));
});

test('execCommand adds --agent and --max-budget-usd only when given, and its existing argv is unchanged', async () => {
  const { execCommand } = await import('../lib/hosts/claude.mjs');
  const base = { prompt: 'p', json: true, model: 'opus', tools: ['Read', 'Bash'], permissionMode: 'plan' };
  const before = execCommand(base).args;
  assert.deepEqual(before, ['--print', '--output-format', 'json', '--model', 'opus', '--allowedTools', 'Read', 'Bash', '--permission-mode', 'plan', 'p']);
  assert.deepEqual(execCommand({ ...base, agent: 'a', maxBudgetUsd: 2.5 }).args, ['--print', '--output-format', 'json', '--model', 'opus', '--allowedTools', 'Read', 'Bash', '--permission-mode', 'plan', '--agent', 'a', '--max-budget-usd', '2.5', 'p']);
  assert.equal(execCommand({ ...base, maxBudgetUsd: 0 }).args.includes('--max-budget-usd'), true);
});

test('trialArgv uses the agent\'s frontmatter tools and omits --model for inherit', async () => {
  const { trialArgv } = await import('../lib/verifyrun.mjs');
  const a = trialArgv({ prompt: 'P', model: 'inherit', maxBudgetUsd: 3 });
  assert.deepEqual(a, ['claude', '--print', '--output-format', 'json', '--allowedTools', 'Read', 'Bash', 'Grep', 'Glob', '--agent', 'astro-verifier', '--max-budget-usd', '3', 'P']);
  const b = trialArgv({ prompt: 'P', model: 'opus' });
  assert.deepEqual(b.slice(0, 5), ['claude', '--print', '--output-format', 'json', '--model']);
  assert.equal(b.includes('--max-budget-usd'), false);
  assert.equal(b[b.length - 1], 'P');
});

test('parseTrialVerdict: all ids passed is pass; a missing or false id is fail; no fenced block, bad JSON, is_error or an empty criteria list is invalid; total_cost_usd is read and its absence is null', async () => {
  const { parseTrialVerdict } = await import('../lib/verifyrun.mjs');
  const ids = ['C1', 'C2'];
  const ok = parseTrialVerdict(env(fence({ criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] })), ids);
  assert.deepEqual([ok.outcome, ok.cost], ['pass', 1.25]);
  const falseId = parseTrialVerdict(env(fence({ criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: false }] })), ids);
  assert.deepEqual([falseId.outcome, falseId.failed_ids], ['fail', ['C2']]);
  const missing = parseTrialVerdict(env(fence({ criteria: [{ id: 'C1', passed: true }] })), ids);
  assert.deepEqual([missing.outcome, missing.failed_ids], ['fail', ['C2']]);
  // the LAST fenced block wins
  const two = parseTrialVerdict(env(`${fence({ criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] })}${fence({ criteria: [{ id: 'C1', passed: false }] })}`), ids);
  assert.equal(two.outcome, 'fail');
  for (const bad of [env('I think it is fine'), env('```json\n{nope\n```'), env(fence({ criteria: [] })), env(fence({ criteria: [{ id: 'C1', passed: true }] }), { is_error: true })]) {
    assert.equal(parseTrialVerdict(bad, ids).outcome, 'invalid', bad);
  }
  const nocost = JSON.stringify({ result: fence({ criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] }) });
  assert.equal(parseTrialVerdict(nocost, ids).cost, null);
  assert.equal(parseTrialVerdict(fence({ criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] }), ids).outcome, 'pass', 'plain stdout works too');
});

test('runTrial with an injected runner maps exit≠0, capped and ENOENT to invalid / no-verifier', async () => {
  const { runTrial } = await import('../lib/verifyrun.mjs');
  const good = env(fence({ criteria: [{ id: 'C1', passed: true }] }));
  const t = (r) => runTrial({ cwd: '/x', argv: ['claude'], env: {}, criteriaIds: ['C1'], run: async () => r });
  assert.equal((await t({ status: 0, stdout: good })).outcome, 'pass');
  assert.deepEqual(Object.values(await t({ status: 2, stdout: '' })).slice(0, 2), ['invalid', 'exit 2']);
  assert.equal((await t({ status: null, capped: true, stdout: '' })).reason, 'capped');
  const none = await t({ status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }) });
  assert.deepEqual([none.outcome, none.no_verifier], ['invalid', true]);
  let seen;
  await runTrial({ cwd: '/work', argv: ['claude', 'a'], env: { A: '1' }, criteriaIds: ['C1'], run: async (argv, o) => { seen = { argv, o }; return { status: 0, stdout: good }; } });
  assert.deepEqual([seen.argv, seen.o.cwd, seen.o.env, seen.o.capMs], [['claude', 'a'], '/work', { A: '1' }, 45 * 60 * 1000]);
});

test('promptFingerprint changes when the package agent, the installed agent (CLAUDE_CONFIG_DIR) or the contract changes', async () => {
  const { promptFingerprint } = await import('../lib/verifyrun.mjs');
  const cfg = mkdtempSync(join(tmpdir(), 'ac-vr-cfg-'));
  try {
    const none = promptFingerprint({ env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.equal(none.installed_agent_sha, null);
    assert.match(none.prompt_hash, /^[0-9a-f]{16}$/);
    mkdirSync(join(cfg, 'agents'));
    writeFileSync(join(cfg, 'agents', 'astro-verifier.md'), 'agent v1');
    const v1 = promptFingerprint({ env: { CLAUDE_CONFIG_DIR: cfg } });
    writeFileSync(join(cfg, 'agents', 'astro-verifier.md'), 'agent v2');
    const v2 = promptFingerprint({ env: { CLAUDE_CONFIG_DIR: cfg } });
    assert.notEqual(v1.prompt_hash, none.prompt_hash);
    assert.notEqual(v2.prompt_hash, v1.prompt_hash);
    assert.equal(v2.prompt_hash, promptFingerprint({ env: { CLAUDE_CONFIG_DIR: cfg } }).prompt_hash, 'stable for the same inputs');
    assert.equal(v2.agent_sha, v1.agent_sha);
    assert.notEqual(v2.installed_agent_sha, v1.installed_agent_sha);
    assert.equal(typeof v2.contract_sha, 'string');
    assert.equal(v2.version, JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  } finally { rmSync(cfg, { recursive: true, force: true }); }
});
