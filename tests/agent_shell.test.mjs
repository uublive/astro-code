// An agent that runs Bash may be running unattended, inside a workflow nobody watches. A command
// Claude Code judges risky (an unguarded variable in an `rm` path) stops for a human and the whole
// run waits. Every Bash agent carries the same shell section; this keeps the copies identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');
const HEADING = '## Shell commands — never stall on a permission prompt';

const agents = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'))
  .map((f) => ({ name: f, text: readFileSync(join(AGENTS_DIR, f), 'utf8') }));
const usesBash = ({ text }) => /^tools:.*\bBash\b/m.test(text);
const section = (text) => {
  const at = text.indexOf(HEADING);
  if (at < 0) return null;
  const next = text.indexOf('\n## ', at + HEADING.length);
  return text.slice(at, next < 0 ? undefined : next).trimEnd();
};

test('every agent that runs Bash carries the shell section, identical in each', () => {
  const bash = agents.filter(usesBash);
  assert.ok(bash.length >= 5, 'expected the executor, mapper, planner, researcher and verifier');
  const first = section(bash[0].text);
  for (const a of bash) {
    assert.ok(section(a.text), `${a.name} runs Bash but has no "${HEADING}" section`);
    assert.equal(section(a.text), first, `${a.name}'s shell section differs from ${bash[0].name}'s`);
  }
  assert.match(first, /"\$\{d:\?\}"/, 'the section shows the guarded form');
});

test('an agent without Bash does not carry the shell section', () => {
  for (const a of agents.filter((x) => !usesBash(x))) assert.equal(section(a.text), null, a.name);
});
