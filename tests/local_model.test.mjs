// A session running on a LOCAL model (Claude Code pointed at an OpenAI/Anthropic-compatible
// endpoint serving e.g. Qwen) cannot serve the `opus`/`sonnet` tiers astro-code passes to its
// subagents: every agent failed with a model-name error. The rule, for now: on a local model,
// EVERY subagent runs on the session's model — no per-role model, no reasoning effort.
// `ac` detects it from the session env it inherits; the workflows honour the `inherit` tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { localModelSession, sessionModels, SESSION_MODEL } from '../lib/models.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(ROOT, 'bin', 'ac.mjs');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// ── detection ────────────────────────────────────────────────────────────────

test('a base URL that is not Anthropic is a local-model session', () => {
  const s = localModelSession({ ANTHROPIC_BASE_URL: 'http://100.108.56.96:8000' });
  assert.equal(s.local, true);
  assert.match(s.why, /ANTHROPIC_BASE_URL=100\.108\.56\.96:8000/);
});

test('a non-Claude ANTHROPIC_MODEL is a local-model session', () => {
  assert.equal(localModelSession({ ANTHROPIC_MODEL: 'Qwen3.8-27B-FP8' }).local, true);
});

test('Anthropic itself, Claude model ids and the tier aliases are not local', () => {
  for (const env of [
    {},
    { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
    { ANTHROPIC_BASE_URL: 'https://api.anthropic.com/v1/' },
    { ANTHROPIC_MODEL: 'claude-opus-5-5' },
    { ANTHROPIC_MODEL: 'opus' },
    { ANTHROPIC_MODEL: 'sonnet[1m]' },
    { ANTHROPIC_MODEL: 'opusplan' },
  ]) assert.equal(localModelSession(env).local, false, JSON.stringify(env));
});

test('ASTRO_LOCAL_MODEL forces the answer either way (a proxy in front of real Claude, or a missed signal)', () => {
  assert.equal(localModelSession({ ANTHROPIC_BASE_URL: 'http://litellm:4000', ASTRO_LOCAL_MODEL: '0' }).local, false);
  assert.equal(localModelSession({ ASTRO_LOCAL_MODEL: '1' }).local, true);
  assert.match(localModelSession({ ASTRO_LOCAL_MODEL: 'true' }).why, /ASTRO_LOCAL_MODEL/);
});

test('sessionModels puts every role on the session model', () => {
  const m = sessionModels();
  assert.deepEqual(Object.keys(m).sort(), ['discover', 'executor', 'integrator', 'planner', 'researcher', 'verifier']);
  assert.ok(Object.values(m).every((v) => v === SESSION_MODEL));
});

// ── the CLI hands the session model to every command ────────────────────────

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-local-'));
  const init = spawnSync(process.execPath, [AC, 'init', '--name', 'Local'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(init.status, 0, init.stderr);
  const models = spawnSync(process.execPath, [AC, 'models', 'balanced'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
  assert.equal(models.status, 0, models.stderr);
  return dir;
}
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_MODEL', 'ASTRO_LOCAL_MODEL']) delete env[k];
  return { ...env, ...extra };
}
const ac = (args, cwd, extra) => spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env: cleanEnv(extra) });
const LOCAL = { ANTHROPIC_BASE_URL: 'http://100.108.56.96:8000', ANTHROPIC_MODEL: 'Qwen3.8-27B-FP8' };

test('on a local model, `ac config get models` is the session model for every role, and reasoning is empty', () => {
  const dir = project();
  const models = JSON.parse(ac(['config', 'get', 'models'], dir, LOCAL).stdout);
  assert.ok(Object.values(models).length === 6 && Object.values(models).every((v) => v === 'inherit'), JSON.stringify(models));
  assert.deepEqual(JSON.parse(ac(['config', 'get', 'reasoning'], dir, LOCAL).stdout), {});
  assert.equal(JSON.parse(ac(['config', 'get', 'models.planner'], dir, LOCAL).stdout), 'inherit');
  assert.match(ac(['config', 'get', 'models'], dir, LOCAL).stderr, /local model/, 'says why, on stderr so the JSON stays clean');
  // the one-off preset the commands use for --fast is overridden the same way
  const preview = JSON.parse(ac(['models', 'fast', '--preview'], dir, LOCAL).stdout);
  assert.ok(Object.values(preview.models || preview).every((v) => v === 'inherit'), JSON.stringify(preview));
});

test('on a local model the stored config is untouched, and a normal session still gets it', () => {
  const dir = project();
  ac(['config', 'get', 'models'], dir, LOCAL);
  const cfg = JSON.parse(readFileSync(join(dir, '.astrocode', 'config.json'), 'utf8'));
  assert.equal(cfg.models.planner, 'opus', 'nothing was persisted');
  assert.equal(JSON.parse(ac(['config', 'get', 'models'], dir).stdout).planner, 'opus');
  assert.equal(ac(['config', 'get', 'models'], dir).stderr, '');
});

test('`ac status` says agents run on the session model, and why', () => {
  const dir = project();
  assert.match(ac(['status'], dir, LOCAL).stdout, /Models: {4}session model on every role — local model \(ANTHROPIC_BASE_URL=100\.108\.56\.96:8000\)/);
  assert.doesNotMatch(ac(['status'], dir).stdout, /session model on every role/);
});

// ── the workflows pass no model and no effort ───────────────────────────────

function loadWorkflow(name) {
  const src = readFileSync(join(ROOT, 'workflows', name), 'utf8').replace(/^export const meta/m, 'const meta');
  return new AsyncFunction('phase', 'agent', 'parallel', 'log', 'args', src);
}
const INHERIT = { planner: 'inherit', researcher: 'inherit', executor: 'inherit', verifier: 'inherit', discover: 'inherit', integrator: 'inherit' };

test('plan-phase: every agent runs on the session model with no effort', async () => {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push(opts);
    return { criteria: [{ id: 'C1', text: 'x' }], written: true, path: 'CRITERIA.md', summary: 'ok' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  try {
    await loadWorkflow('plan-phase.mjs')(() => {}, agent, parallel, () => {}, { root: '/tmp/p', phase: '01-x', models: INHERIT, reasoning: {} });
  } catch { /* the stubs are thin; only the calls made matter */ }
  assert.ok(calls.length >= 2, `expected the criteria and research agents to be called, got ${calls.length}`);
  for (const o of calls) {
    assert.equal(o.model, undefined, `${o.label || o.phase}: no model on a local session`);
    assert.equal(o.effort, undefined, `${o.label || o.phase}: no effort on a local session`);
  }
});

test('execute-phase: no model or effort anywhere — deep escalation and the integrator floor included', async () => {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push(opts);
    const props = (opts.schema && opts.schema.properties) || {};
    if ('tasks' in props) return { tasks: [1, 2, 3].map((i) => ({ id: `t${i}`, title: `T${i}`, file: `f${i}.mjs`, depends_on: [], done: false })) };
    if ('integrated' in props) return { integrated: false, branches: ['worktree-t1', 'worktree-t3'], conflicts: [{ branch: 'worktree-t2', taskId: 't2' }], tornDown: ['worktree-t1', 'worktree-t3'] };
    if ('missing' in props) return { missing: [] };
    if ('removed' in props) return { removed: ['worktree-t2'], leftover: [] };
    if ('branch' in props && 'commit' in props) return { summary: 'done', branch: null, commit: null };
    if ('criteriaFound' in props) return { passed: true, criteriaFound: true, summary: 'ok', criteria: [] };
    if ('ranSuite' in props) return { ranSuite: true, passed: true, testsRun: 5 };
    return { summary: 'done' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  await loadWorkflow('execute-phase.mjs')(() => {}, agent, parallel, () => {},
    { root: '/tmp/p', phase: '03-x', strategy: 'parallel', effort: 'deep', models: INHERIT, reasoning: {} });
  const labels = calls.map((o) => o.label || o.phase);
  assert.ok(labels.some((l) => String(l).startsWith('integrate:')), `the integrator must run in this fixture: ${labels}`);
  for (const o of calls) {
    assert.equal(o.model, undefined, `${o.label || o.phase}: no model on a local session`);
    assert.equal(o.effort, undefined, `${o.label || o.phase}: no effort on a local session`);
  }
});

test('execute-phase: a normal session still gets its tiers, deep escalation and the integrator floor', async () => {
  const calls = [];
  const agent = async (prompt, opts = {}) => {
    calls.push(opts);
    const props = (opts.schema && opts.schema.properties) || {};
    if ('tasks' in props) return { tasks: [1, 2].map((i) => ({ id: `t${i}`, title: `T${i}`, file: `f${i}.mjs`, depends_on: [], done: false })) };
    if ('integrated' in props) return { integrated: true, branches: [] };
    if ('missing' in props) return { missing: [] };
    if ('branch' in props && 'commit' in props) return { summary: 'done', branch: null, commit: null };
    if ('criteriaFound' in props) return { passed: true, criteriaFound: true, summary: 'ok', criteria: [] };
    if ('ranSuite' in props) return { ranSuite: true, passed: true, testsRun: 5 };
    return { summary: 'done' };
  };
  const parallel = async (thunks) => Promise.all(thunks.map((f) => f()));
  await loadWorkflow('execute-phase.mjs')(() => {}, agent, parallel, () => {},
    { root: '/tmp/p', phase: '03-x', strategy: 'parallel', effort: 'deep', models: { executor: 'sonnet', verifier: 'sonnet' }, reasoning: {} });
  const integ = calls.find((o) => String(o.label || '').startsWith('integrate:'));
  assert.equal(integ.model, 'sonnet', 'the integrator floor still applies off a local model');
  assert.ok(calls.some((o) => o.model === 'opus'), 'deep still escalates to opus off a local model');
});

test('the command texts that name a tier carry the local-model exception', () => {
  const fast = readFileSync(join(ROOT, 'commands', 'astro-fast.md'), 'utf8');
  assert.match(fast, /returns `inherit`[\s\S]{0,200}pass that map through \*\*unchanged\*\*/, '/astro-fast must not default the executor to opus on a local model');
  const exec = readFileSync(join(ROOT, 'commands', 'astro-execute.md'), 'utf8');
  assert.match(exec, /returns `inherit` \(a local-model session\)[\s\S]{0,120}no model at all/, "/astro-execute's fallback tier must not escalate to opus on a local model");
});

// A built-in Claude Code agent type (e.g. `Explore`) carries its OWN default model: passing
// no model made it run Opus, not the session's model, so on Qwen all three researchers
// failed while the criteria author (one of ours, no model pinned) ran fine. On a local
// session every agent must be one of astro-code's own, which pin nothing.
const OWN_AGENTS = new Set(readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)));

test('plan-phase on a local model uses only astro-code agents — no built-in type with its own model', async () => {
  const calls = [];
  const agent = async (prompt, opts = {}) => { calls.push(opts); return { criteria: [{ id: 'C1', text: 'x' }], written: true, summary: 'ok' }; };
  try {
    await loadWorkflow('plan-phase.mjs')(() => {}, agent, async (t) => Promise.all(t.map((f) => f())), () => {},
      { root: '/tmp/p', phase: '01-x', models: INHERIT, reasoning: {} });
  } catch { /* thin stubs */ }
  const research = calls.filter((o) => String(o.label || '').startsWith('research:'));
  assert.equal(research.length, 3, 'the three researchers ran');
  for (const o of calls) assert.ok(OWN_AGENTS.has(o.agentType), `${o.label || o.phase}: ${o.agentType} is not an astro-code agent`);
});

test('plan-phase off a local model keeps its researchers as they were', async () => {
  const calls = [];
  const agent = async (prompt, opts = {}) => { calls.push(opts); return { criteria: [{ id: 'C1', text: 'x' }], written: true, summary: 'ok' }; };
  try {
    await loadWorkflow('plan-phase.mjs')(() => {}, agent, async (t) => Promise.all(t.map((f) => f())), () => {},
      { root: '/tmp/p', phase: '01-x', models: { researcher: 'sonnet' }, reasoning: {} });
  } catch { /* thin stubs */ }
  const research = calls.filter((o) => String(o.label || '').startsWith('research:'));
  assert.ok(research.length && research.every((o) => o.agentType === 'Explore' && o.model === 'sonnet'));
});

test('execute-phase uses only astro-code agents (none of its agents is a built-in type)', () => {
  const src = readFileSync(join(ROOT, 'workflows', 'execute-phase.mjs'), 'utf8');
  for (const [, t] of src.matchAll(/agentType: *'([^']+)'/g)) assert.ok(OWN_AGENTS.has(t), `execute-phase uses ${t}`);
});
