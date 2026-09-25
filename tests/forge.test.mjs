// Phase 25 t16 — the forge-read replacement guard (CONTEXT D3). Phase 15's read/write
// spec is gone: every command/agent that used to make an opportunistic
// `mcp__forge__forge_knowledge` (or `_list`) call now runs `ac principles ask`/`brief`
// instead — a personal store, local, no connect/degrade dance. This file replaces
// tests/forge.test.mjs's phase-15 guards outright (same readFileSync/scoped-slice shape,
// case-insensitive regex assertions, messages that quote the offending text) so a forge
// read cannot silently creep back into any of the five touched callers. Phase 27 (t9)
// deleted the `templates/forge-knowledge.md` stub this file used to check for — the
// pointer to "where the read went" now lives in AGENTS.md/MANUAL.md directly — and added
// the "no shipped file mentions the deleted stub" guard below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');

const FORGE_RE = /mcp__forge__|forge_knowledge|forge_capture_knowledge|FORGEMASTER/;

const TOUCHED_FILES = [
  join(COMMANDS_DIR, 'astro-discuss.md'),
  join(COMMANDS_DIR, 'astro-plan.md'),
  join(COMMANDS_DIR, 'astro-new-project.md'),
  join(AGENTS_DIR, 'astro-researcher.md'),
  join(AGENTS_DIR, 'astro-planner.md'),
];

const allCommandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
const allAgentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));

test('no shipped file (commands/, agents/, templates/, hooks/, workflows/, lib/, bin/) mentions forge-knowledge.md', () => {
  const dirs = ['commands', 'agents', 'templates', 'hooks', 'workflows', 'lib', 'bin'];
  const offenders = [];
  for (const d of dirs) {
    const full = join(ROOT, d);
    let files;
    try { files = readdirSync(full); } catch { continue; }
    for (const f of files) {
      const path = join(full, f);
      let text;
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      if (text.includes('forge-knowledge.md')) offenders.push(`${d}/${f}`);
    }
  }
  assert.deepEqual(offenders, [], `no shipped file may mention the deleted stub — offenders: ${offenders.join(', ') || 'none'}`);
});

test('no commands/ or agents/ file grants or mentions a forge tool any more', () => {
  const offenders = [];
  for (const f of allCommandFiles) {
    const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
    if (FORGE_RE.test(src)) offenders.push(`commands/${f}`);
  }
  for (const f of allAgentFiles) {
    const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
    if (FORGE_RE.test(src)) offenders.push(`agents/${f}`);
  }
  assert.deepEqual(offenders, [], `no commands/ or agents/ file may name a forge tool — offenders: ${offenders.join(', ') || 'none'}`);
});

for (const path of TOUCHED_FILES) {
  const name = path.split('/').slice(-2).join('/');

  test(`${name} calls \`ac principles ask\` or \`ac principles brief\` (D3 replacement)`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      src.includes('ac principles ask') || src.includes('ac principles brief'),
      `${name} must call \`ac principles ask\` or \`ac principles brief\` — found neither`,
    );
  });

  test(`${name} says "one call" / "don't relitigate" (D3's framing survives the replacement)`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      /\bONE\b.*call|one call/i.test(src),
      `${name} must still say the call is bounded to ONE — found no such phrase`,
    );
  });
}

test('astro-executor.md and astro-verifier.md never mention a forge tool', () => {
  for (const f of ['astro-executor.md', 'astro-verifier.md']) {
    const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
    assert.ok(!FORGE_RE.test(src), `agents/${f} must not mention a forge tool`);
  }
});
