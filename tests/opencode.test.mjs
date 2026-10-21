// OpenCode host adapter — rendering (pure) and install/uninstall (black-box, real CLI
// against a throwaway $HOME with a clean env, like install_cursor.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getHost } from '../lib/hosts/index.mjs';
import { parseFrontmatter } from '../lib/hosts/render.mjs';
import { resolveAgentModel, resolveRoleModels, setOpencodeModel, AGENT_ROLE } from '../lib/hosts/opencode.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');
const readCommand = (n) => readFileSync(join(FRAMEWORK, 'commands', `${n}.md`), 'utf8');
const readAgent = (n) => readFileSync(join(FRAMEWORK, 'agents', `${n}.md`), 'utf8');
const sourceNames = (kind) => readdirSync(join(FRAMEWORK, kind)).filter((f) => f.endsWith('.md')).sort();

function run(T, args, env = {}) {
  return spawnSync(process.execPath, [AC, ...args], {
    env: { HOME: T, PATH: '/usr/bin:/bin', ...env },
    encoding: 'utf8',
    timeout: 60000,
  });
}

function writeUserConfig(T, cfg) {
  mkdirSync(join(T, '.astro'), { recursive: true });
  writeFileSync(join(T, '.astro', 'config.json'), JSON.stringify(cfg));
}

// --- rendering -----------------------------------------------------------------

test('an OpenCode command keeps description + $ARGUMENTS, drops Claude-only keys, carries the tool note', () => {
  const [file] = getHost('opencode').renderCommand('astro-plan', readCommand('astro-plan'));
  assert.equal(file.path, 'astro-plan.md');
  const { frontmatter, body } = parseFrontmatter(file.content);
  assert.deepEqual(Object.keys(frontmatter), ['description']);
  assert.equal(frontmatter.description, parseFrontmatter(readCommand('astro-plan')).frontmatter.description);
  assert.match(body, /^> \*\*Running on OpenCode\.\*\*/);
  assert.match(body, /`subagent`/);
  assert.match(body, /`question`/);
  assert.match(body, /always pass `model`/, 'like superpowers: the model is chosen explicitly at dispatch');
  assert.match(body, /ac opencode models --json/);
  assert.ok(body.includes('$ARGUMENTS'), '$ARGUMENTS is left for OpenCode to substitute');
  assert.ok(body.endsWith(parseFrontmatter(readCommand('astro-plan')).body), 'source body verbatim');
});

test('an OpenCode agent is a subagent with no Claude-only keys and no model by default', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-r-'));
  const prev = process.env.HOME;
  process.env.HOME = T;
  try {
    const [file] = getHost('opencode').renderAgent('astro-executor', readAgent('astro-executor'));
    const { frontmatter, body } = parseFrontmatter(file.content);
    assert.equal(file.path, 'astro-executor.md');
    assert.deepEqual(frontmatter, { description: parseFrontmatter(readAgent('astro-executor')).frontmatter.description, mode: 'subagent' });
    assert.equal(body, parseFrontmatter(readAgent('astro-executor')).body);
  } finally {
    process.env.HOME = prev;
  }
});

test('every shipped agent has a role, so none silently misses the model mapping', () => {
  for (const f of sourceNames('agents')) assert.ok(AGENT_ROLE[f.slice(0, -3)], `${f} has no AGENT_ROLE entry`);
});

test('resolveAgentModel: user tier → opencode.models id; ids verbatim; inherit / unmapped → undefined', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-m-'));
  assert.equal(resolveAgentModel('astro-planner', T), undefined, 'no config → inherit');
  writeUserConfig(T, {
    models: { planner: 'opus', researcher: 'sonnet', executor: 'haiku', verifier: 'inherit' },
    opencode: { models: { opus: 'p/opus-x', haiku: 'p/haiku-x' } },
  });
  assert.equal(resolveAgentModel('astro-planner', T), 'p/opus-x');
  assert.equal(resolveAgentModel('astro-criteria-author', T), 'p/opus-x', 'criteria-author runs at the planner tier');
  assert.equal(resolveAgentModel('astro-executor', T), 'p/haiku-x');
  assert.equal(resolveAgentModel('astro-researcher', T), undefined, 'tier with no mapping → inherit');
  assert.equal(resolveAgentModel('astro-verifier', T), undefined, 'inherit → no model');
  writeUserConfig(T, { models: { executor: 'openrouter/x/y' } });
  assert.equal(resolveAgentModel('astro-executor', T), undefined, 'a provider id in the (user-level) models tier is ignored, not used');
  assert.match(resolveRoleModels({ home: T }).sources.executor, /ignored/);
  writeUserConfig(T, { opencode: { roles: { executor: 'openrouter/x/y' } } });
  assert.equal(resolveAgentModel('astro-executor', T), 'openrouter/x/y', 'a role pin is the way to use a provider id');
});

test('read-only agents (derived from source tools:) get permission edit: deny; writers do not', () => {
  for (const n of ['astro-verifier', 'astro-researcher', 'astro-mapper']) {
    const out = getHost('opencode').renderAgent(n, readAgent(n))[0].content;
    assert.match(out, /\npermission:\n  edit: deny\n/, `${n} must be read-only`);
  }
  for (const n of ['astro-executor', 'astro-planner', 'astro-criteria-author']) {
    assert.doesNotMatch(getHost('opencode').renderAgent(n, readAgent(n))[0].content, /permission:/, `${n} writes files`);
  }
});

// --- install / uninstall -------------------------------------------------------

test('OpenCode-only home: install publishes every command and agent as plain files', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-i-'));
  mkdirSync(join(T, '.config', 'opencode'), { recursive: true });
  const res = run(T, ['install']);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /OpenCode/);
  for (const kind of ['commands', 'agents']) {
    const dir = join(T, '.config', 'opencode', kind);
    assert.deepEqual(readdirSync(dir).sort(), sourceNames(kind));
    for (const f of readdirSync(dir)) assert.ok(!lstatSync(join(dir, f)).isSymbolicLink(), `${kind}/${f} must be a regular file`);
  }
  assert.ok(!existsSync(join(T, '.claude', 'commands')), 'no Claude dir invented when OpenCode is present');
});

test('install stamps agents with the user mapping; OPENCODE_CONFIG_DIR is honoured', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-c-'));
  const cfgDir = join(T, 'oc');
  mkdirSync(cfgDir, { recursive: true });
  writeUserConfig(T, { models: { executor: 'haiku' }, opencode: { models: { haiku: 'prov/haiku-9' } } });
  const res = run(T, ['install'], { OPENCODE_CONFIG_DIR: cfgDir });
  assert.equal(res.status, 0, res.stderr);
  const exec = parseFrontmatter(readFileSync(join(cfgDir, 'agents', 'astro-executor.md'), 'utf8')).frontmatter;
  assert.equal(exec.model, 'prov/haiku-9');
  const plan = parseFrontmatter(readFileSync(join(cfgDir, 'agents', 'astro-planner.md'), 'utf8')).frontmatter;
  assert.equal(plan.model, undefined);
});

test('uninstall removes only astro-* entries and leaves the user\'s own files', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-u-'));
  const oc = join(T, '.config', 'opencode');
  mkdirSync(join(oc, 'commands'), { recursive: true });
  writeFileSync(join(oc, 'commands', 'mine.md'), 'keep me');
  assert.equal(run(T, ['install']).status, 0);
  const res = run(T, ['uninstall']);
  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(readdirSync(join(oc, 'commands')), ['mine.md']);
  assert.deepEqual(readdirSync(join(oc, 'agents')), []);
});

// --- per-role models at dispatch time ------------------------------------------

test('resolveRoleModels: a project tier beats the user tier; an opencode.roles pin beats both; --fast uses the fast preset', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-rr-'));
  const P = join(T, 'proj');
  mkdirSync(join(P, '.astrocode'), { recursive: true });
  writeFileSync(join(P, '.astrocode', 'config.json'), JSON.stringify({ models: { executor: 'sonnet' } }));
  writeUserConfig(T, {
    models: { planner: 'opus', executor: 'haiku', verifier: 'opus' },
    opencode: { models: { opus: 'p/opus', sonnet: 'p/sonnet', haiku: 'p/haiku' }, roles: { verifier: 'deepseek/v4.1-flash' } },
  });
  const user = resolveRoleModels({ home: T });
  assert.equal(user.models.executor, 'p/haiku');
  const proj = resolveRoleModels({ root: P, home: T });
  assert.equal(proj.models.executor, 'p/sonnet', 'the project tier wins over the user tier');
  assert.equal(proj.models.planner, 'p/opus');
  assert.equal(proj.models.verifier, 'deepseek/v4.1-flash', 'a pin wins whatever the tier');
  assert.equal(proj.sources.verifier, 'opencode.roles');
  assert.equal(proj.models.researcher, null, 'unset role → session model');
  const fast = resolveRoleModels({ root: P, home: T, fast: true });
  assert.equal(fast.models.planner, 'p/sonnet', 'fast puts the planner on sonnet');
});

test('setOpencodeModel keeps other keys, validates tier/role/id, and unset removes a pin', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-s-'));
  writeUserConfig(T, { agent_tools: { '*': ['x'] } });
  assert.equal(setOpencodeModel({ home: T, kind: 'roles', key: 'executor', id: 'openrouter/deepseek/deepseek-v4.1-flash' }).ok, true);
  assert.equal(setOpencodeModel({ home: T, kind: 'models', key: 'opus', id: 'p/opus' }).ok, true);
  const cfg = JSON.parse(readFileSync(join(T, '.astro', 'config.json'), 'utf8'));
  assert.deepEqual(cfg.agent_tools, { '*': ['x'] });
  assert.deepEqual(cfg.opencode, { roles: { executor: 'openrouter/deepseek/deepseek-v4.1-flash' }, models: { opus: 'p/opus' } });
  assert.equal(setOpencodeModel({ home: T, kind: 'models', key: 'gpt', id: 'a/b' }).ok, false);
  assert.equal(setOpencodeModel({ home: T, kind: 'roles', key: 'boss', id: 'a/b' }).ok, false);
  assert.equal(setOpencodeModel({ home: T, kind: 'roles', key: 'executor', id: 'no-provider' }).ok, false);
  setOpencodeModel({ home: T, kind: 'roles', key: 'executor', id: null });
  assert.deepEqual(JSON.parse(readFileSync(join(T, '.astro', 'config.json'), 'utf8')).opencode.roles, {});
});

test('`ac opencode set` pins a role and re-stamps the installed agent at once; `models --json` reports it', () => {
  const T = mkdtempSync(join(tmpdir(), 'ac-oc-cli-'));
  mkdirSync(join(T, '.config', 'opencode'), { recursive: true });
  assert.equal(run(T, ['install']).status, 0);
  const res = run(T, ['opencode', 'set', 'executor', 'openrouter/deepseek/deepseek-v4.1-flash']);
  assert.equal(res.status, 0, res.stderr);
  const fm = parseFrontmatter(readFileSync(join(T, '.config', 'opencode', 'agents', 'astro-executor.md'), 'utf8')).frontmatter;
  assert.equal(fm.model, 'openrouter/deepseek/deepseek-v4.1-flash');
  const out = run(T, ['opencode', 'models', '--json']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).executor, 'openrouter/deepseek/deepseek-v4.1-flash');
  assert.notEqual(run(T, ['opencode', 'set', 'executor', 'not-an-id']).status, 0);
});
