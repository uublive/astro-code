// Contract guards — cheap, static cross-checks that the framework's prose (commands,
// workflows, README) stays in sync with what the code actually provides. These catch a
// whole class of silent drift: a command telling the user to run an `ac` subcommand that
// doesn't exist, a workflow naming an agent with no file, or a `/astro-X` reference to a
// command that was renamed/removed. None of this needs an LLM — it's pure text vs. reality.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS = join(ROOT, 'commands');
const WORKFLOWS = join(ROOT, 'workflows');
const AGENTS = join(ROOT, 'agents');

const mdFiles = (dir) => readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => join(dir, f));
const read = (p) => readFileSync(p, 'utf8');

// Built-in agent types the harness provides (not backed by an agents/ file).
const BUILTIN_AGENTS = new Set(['Explore', 'general-purpose', 'Plan']);
// Non-command `/astro-…` tokens: the project name itself, never a slash command.
const NON_COMMANDS = new Set(['astro-code']);

// The valid top-level `ac` subcommands ARE the switch cases in bin/ac.mjs main().
// Deriving the set from the source (not a hand-list) means this guard can't go stale.
function validAcCommands() {
  const src = read(join(ROOT, 'bin', 'ac.mjs'));
  const set = new Set();
  for (const m of src.matchAll(/case\s+'([^']+)':/g)) set.add(m[1]);
  return set;
}

// `ac X` is only a real invocation inside a code span — in prose, "puts `ac` on your
// PATH" would otherwise read as the command "on". So extract inline-code and fenced-code
// regions first, and only look for `ac <token>` there.
function codeRegions(md) {
  const out = [];
  for (const m of md.matchAll(/```[\s\S]*?```/g)) out.push(m[0]); // fenced blocks
  for (const m of md.matchAll(/`[^`\n]+`/g)) out.push(m[0]);      // inline spans
  return out.join('\n');
}

// First token after `ac ` (a lowercase command word), wherever it appears in code.
function acCommandsIn(text) {
  return [...text.matchAll(/\bac\s+(--?[a-z]+|[a-z][a-z-]*)/g)].map((m) => m[1]);
}

test('every `ac <subcommand>` referenced in a command exists in the CLI', () => {
  const valid = validAcCommands();
  const violations = [];
  for (const file of mdFiles(COMMANDS)) {
    for (const cmd of acCommandsIn(codeRegions(read(file)))) {
      if (!valid.has(cmd)) violations.push(`${file.split('/').pop()}: \`ac ${cmd}\``);
    }
  }
  assert.deepEqual(
    violations, [],
    `command(s) reference an ac subcommand the CLI does not implement:\n  ${violations.join('\n  ')}\n` +
      `(valid: ${[...valid].sort().join(', ')})`,
  );
});

test('every `ac <subcommand>` in the README exists in the CLI', () => {
  const valid = validAcCommands();
  const bad = acCommandsIn(codeRegions(read(join(ROOT, 'README.md')))).filter((c) => !valid.has(c));
  assert.deepEqual(bad, [], `README references unknown ac subcommand(s): ${bad.join(', ')}`);
});

test('every agentType in a workflow has a matching agents/ file (or is built-in)', () => {
  const violations = [];
  for (const file of readdirSync(WORKFLOWS).filter((f) => f.endsWith('.mjs'))) {
    const src = read(join(WORKFLOWS, file));
    for (const m of src.matchAll(/agentType:\s*'([^']+)'/g)) {
      const name = m[1];
      if (BUILTIN_AGENTS.has(name)) continue;
      if (!existsSync(join(AGENTS, `${name}.md`))) violations.push(`${file}: agentType '${name}'`);
    }
  }
  assert.deepEqual(violations, [], `workflow(s) name an agent with no agents/ file:\n  ${violations.join('\n  ')}`);
});

test('every /astro-<command> referenced exists as a command file', () => {
  const have = new Set(mdFiles(COMMANDS).map((f) => f.split('/').pop().replace(/\.md$/, '')));
  const violations = [];
  const sources = [...mdFiles(COMMANDS), join(ROOT, 'README.md')];
  for (const file of sources) {
    for (const m of read(file).matchAll(/\/(astro-[a-z-]+)/g)) {
      const name = m[1];
      if (NON_COMMANDS.has(name)) continue;
      if (!have.has(name)) violations.push(`${file.split('/').pop()}: /${name}`);
    }
  }
  assert.deepEqual(violations, [], `reference(s) to a non-existent /astro-command:\n  ${[...new Set(violations)].join('\n  ')}`);
});
