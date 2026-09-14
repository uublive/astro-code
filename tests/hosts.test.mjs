// Host adapters: rendering astro-code's commands and agents into each harness's
// own format, and building the headless invocation the workflow layer drives.
//
// Everything here is pure string work, so it runs with no harness installed —
// which is the point: the renderers must be verifiable on CI and on a machine
// that has only one of the three hosts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOSTS, getHost, detectHosts } from '../lib/hosts/index.mjs';
import { parseFrontmatter, toMarkdown, toYaml, mapTools } from '../lib/hosts/render.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const readCommand = (n) => readFileSync(join(FRAMEWORK, 'commands', `${n}.md`), 'utf8');
const readAgent = (n) => readFileSync(join(FRAMEWORK, 'agents', `${n}.md`), 'utf8');

// --- frontmatter ---------------------------------------------------------------

test('parseFrontmatter splits frontmatter from body, and toMarkdown round-trips', () => {
  const src = '---\ndescription: Do a thing\nargument-hint: <phase>\n---\n\nBody $ARGUMENTS\n';
  const { frontmatter, body } = parseFrontmatter(src);
  assert.equal(frontmatter.description, 'Do a thing');
  assert.equal(frontmatter['argument-hint'], '<phase>');
  assert.equal(body, '\nBody $ARGUMENTS\n');
  assert.equal(toMarkdown(frontmatter, body), src);
});

test('a file with no frontmatter is body-only, not a parse error', () => {
  const { frontmatter, body } = parseFrontmatter('just text\n');
  assert.deepEqual(frontmatter, {});
  assert.equal(body, 'just text\n');
});

// --- Claude: the authoring format, so rendering is the identity ------------------

test('the Claude adapter renders commands and agents byte-identically', () => {
  const claude = getHost('claude');
  const src = readCommand('astro-plan');
  const [file] = claude.renderCommand('astro-plan', src);
  assert.equal(file.path, 'astro-plan.md');
  assert.equal(file.content, src, 'Claude IS the source format — nothing may change');

  const asrc = readAgent('astro-executor');
  const [afile] = claude.renderAgent('astro-executor', asrc);
  assert.equal(afile.content, asrc);
});

// --- Codex: commands ------------------------------------------------------------

test('a Codex command renders as a SKILL, not a prompts/ file', () => {
  // ~/.codex/prompts/*.md is documented but not read by 0.154.0: Codex had
  // never created that dir, the binary's only `prompts` strings are MCP
  // protocol, and 22 files installed there produced "no matches" in the TUI.
  // Skills are what actually works, so commands go there like agents do.
  const codex = getHost('codex');
  const files = codex.renderCommand('astro-plan', readCommand('astro-plan'));
  // SKILL.md ONLY — matching lean-ctx, the plain skill that demonstrably works.
  // An openai.yaml here would carry allow_implicit_invocation: false, which is
  // right for a subagent and fatal for a command: it tells Codex never to
  // invoke it, and Codex has no custom slash commands as a fallback path.
  assert.deepEqual(files.map((f) => f.path), ['astro-plan/SKILL.md']);

  const skill = files.find((f) => f.path.endsWith('SKILL.md'));
  const { frontmatter, body } = parseFrontmatter(skill.content);
  assert.ok(frontmatter.description, 'description drives discovery');
  assert.ok(!('allowed-tools' in frontmatter),
    'allowed-tools is Claude-only; Codex gates tools via its sandbox');
  assert.equal(body, parseFrontmatter(readCommand('astro-plan')).body,
    'the prompt body must not be rewritten');

  assert.ok(!files.some((f) => f.path.endsWith('openai.yaml')),
    'a command must not carry the sidecar that suppresses its own discovery');
});

test('an AGENT does keep the sidecar — it is delegated to, not discovered', () => {
  const files = getHost('codex').renderAgent('astro-executor', readAgent('astro-executor'));
  const yaml = files.find((f) => f.path.endsWith('openai.yaml'));
  assert.ok(yaml, 'subagents mirror the shipped review-agent shape');
  assert.match(yaml.content, /allow_implicit_invocation: false/,
    'an executor runs as a deliberate step in a wave, never opportunistically');
});

// --- Codex: agents are a skill DIRECTORY, not a file ----------------------------

test('a Codex agent renders as SKILL.md + agents/openai.yaml', () => {
  // This shape was read off the agents Codex itself ships in
  // ~/.codex/skills/.system (review-agent, skill-creator, ...) on a real
  // 0.154.0 install. Prose docs claimed ~/.codex/agents/*.toml, which does not
  // match what is on disk — and an invented schema yields agents Codex silently
  // ignores, so the shipped shape is what this pins.
  const codex = getHost('codex');
  const files = codex.renderAgent('astro-executor', readAgent('astro-executor'));
  assert.equal(files.length, 2);

  const skill = files.find((f) => f.path.endsWith('SKILL.md'));
  const sidecar = files.find((f) => f.path.endsWith('openai.yaml'));
  assert.equal(skill.path, 'astro-executor/SKILL.md');
  assert.equal(sidecar.path, 'astro-executor/agents/openai.yaml');

  const { frontmatter, body } = parseFrontmatter(skill.content);
  assert.equal(frontmatter.name, 'astro-executor');
  assert.ok(frontmatter.description);
  assert.ok(!('tools' in frontmatter), 'tools is not part of the shipped SKILL.md shape');
  assert.ok(!('color' in frontmatter), 'colour is Claude-only cosmetics');
  assert.match(body, /You implement exactly ONE task/, 'the prompt body carries over');

  assert.match(sidecar.content, /interface:/);
  assert.match(sidecar.content, /display_name: "astro-executor"/);
  assert.match(sidecar.content, /allow_implicit_invocation: false/,
    'astro agents are dispatched by the loop, never picked up opportunistically');
});

// --- the headless invocation ----------------------------------------------------

test('codex exec argv carries isolation and structured output natively', () => {
  const codex = getHost('codex');
  const { command, args } = codex.execCommand({
    prompt: 'do the task', model: 'gpt-5-codex', cwd: '/tmp/wt',
    worktree: true, schemaFile: '/tmp/s.json', outFile: '/tmp/o.txt',
  });
  assert.equal(command, 'codex');
  assert.equal(args[0], 'exec');
  // These two are why Codex fits astro-code's execution model: they are the
  // Workflow tool's `isolation: 'worktree'` and `schema:` as plain CLI flags.
  assert.ok(args.includes('--worktree'));
  assert.deepEqual(args.slice(args.indexOf('--output-schema'), args.indexOf('--output-schema') + 2),
    ['--output-schema', '/tmp/s.json']);
  assert.deepEqual(args.slice(args.indexOf('--cd'), args.indexOf('--cd') + 2), ['--cd', '/tmp/wt']);
  assert.equal(args[args.length - 1], 'do the task', 'the prompt is the trailing positional');
});

test('codex exec omits flags that were not asked for', () => {
  const { args } = getHost('codex').execCommand({ prompt: 'x' });
  for (const flag of ['--worktree', '--output-schema', '--model', '--sandbox', '--json']) {
    assert.ok(!args.includes(flag), `${flag} must not appear unrequested`);
  }
});

// --- tool mapping ---------------------------------------------------------------

test('tool names map per host, and unknown names pass through rather than vanish', () => {
  assert.deepEqual(mapTools('Read, Write, Glob', 'pi'), ['read', 'write', 'find']);
  // An MCP id means the same thing everywhere — dropping it would quietly
  // remove a capability the agent was written to rely on.
  assert.deepEqual(mapTools('mcp__forge__forge_knowledge', 'pi'), ['mcp__forge__forge_knowledge']);
  // No equivalent → deliberately dropped, never mapped to something approximate.
  assert.deepEqual(mapTools('WebSearch', 'pi'), []);
  // A host with no table gets the names verbatim.
  assert.deepEqual(mapTools('Read, Bash', 'claude'), ['Read', 'Bash']);
});

// --- YAML emitter ---------------------------------------------------------------

test('toYaml nests one level and quotes strings', () => {
  const out = toYaml({ interface: { display_name: 'x: y' }, policy: { allow_implicit_invocation: false } });
  assert.match(out, /^interface:\n {2}display_name: "x: y"\n/);
  assert.match(out, /policy:\n {2}allow_implicit_invocation: false/);
});

// --- every real command and agent renders on every host -------------------------

test('all shipped commands and agents render on every host without throwing', () => {
  const commands = readdirSync(join(FRAMEWORK, 'commands')).filter((f) => f.endsWith('.md'));
  const agents = readdirSync(join(FRAMEWORK, 'agents')).filter((f) => f.endsWith('.md'));
  assert.ok(commands.length >= 20 && agents.length >= 6, 'sanity: the corpus is present');

  for (const host of HOSTS) {
    for (const f of commands) {
      const name = f.replace(/\.md$/, '');
      const files = host.renderCommand(name, readCommand(name));
      assert.ok(Array.isArray(files) && files.length >= 1, `${host.id}: ${name} produced no file`);
      for (const out of files) {
        assert.ok(out.path && out.content, `${host.id}: ${name} produced an empty file`);
      }
      // A command with no description is undiscoverable on every host.
      const primary = files.find((f) => /\.md$/.test(f.path));
      assert.ok(parseFrontmatter(primary.content).frontmatter.description,
        `${host.id}: ${name} lost its description`);
    }
    for (const f of agents) {
      const name = f.replace(/\.md$/, '');
      const files = host.renderAgent(name, readAgent(name));
      assert.ok(files.length >= 1, `${host.id}: agent ${name} produced no file`);
      for (const out of files) assert.ok(out.path && out.content);
    }
  }
});

// --- the registry ---------------------------------------------------------------

test('the host registry exposes claude and codex, and detect never throws', () => {
  assert.deepEqual(HOSTS.map((h) => h.id), ['claude', 'codex']);
  assert.equal(getHost('nope'), null);
  assert.ok(Array.isArray(detectHosts()), 'detectHosts must swallow adapter errors');
  for (const h of HOSTS) {
    for (const fn of ['detect', 'configTargets', 'renderCommand', 'renderAgent']) {
      assert.equal(typeof h[fn], 'function', `${h.id} must implement ${fn}`);
    }
  }
});
