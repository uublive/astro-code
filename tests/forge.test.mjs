// Phase 25 t16 — the forge-read replacement guard (CONTEXT D3). Phase 15's read/write
// spec is gone: every command/agent that used to make an opportunistic
// `mcp__forge__forge_knowledge` (or `_list`) call now runs `ac principles ask`/`brief`
// instead — a personal store, local, no connect/degrade dance. This file replaces
// tests/forge.test.mjs's phase-15 guards outright (same readFileSync/scoped-slice shape,
// case-insensitive regex assertions, messages that quote the offending text) so a forge
// read cannot silently creep back into any of the five touched callers. Phase 27 (t9)
// deleted the `templates/forge-knowledge.md` stub this file used to check for — the
// pointer to "where the read went" now lives in AGENTS.md/MANUAL.md directly — and added
// the "no shipped file mentions the deleted stub" guard below. Phase 27's revision R1
// (ADR-065) removed the interim forge import (`/astro-forge-import`, the export schema,
// `ac principles import`), so there is no exemption left: no shipped file — commands/,
// agents/, templates/, hooks/, workflows/, lib/, bin/ — may name a forge MCP tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');
const SHIPPED_DIRS = ['commands', 'agents', 'templates', 'hooks', 'workflows', 'lib', 'bin'];

const FORGE_RE = /mcp__forge__|forge_knowledge|forge_capture_knowledge|FORGEMASTER/;
// The "the graph"/"ToolSearch"/entity-name restatement guard: nothing shipped may restate forge's internal shape (its node/edge vocabulary) even
// without naming an MCP tool id directly.
const RESTATEMENT_RE = /\bToolSearch\(|forge_knowledge_list|EvidencedBySignal/;

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

function offendersOf(re) {
  const offenders = [];
  for (const d of SHIPPED_DIRS) {
    const full = join(ROOT, d);
    let files;
    try { files = readdirSync(full); } catch { continue; }
    for (const f of files) {
      let text;
      try { text = readFileSync(join(full, f), 'utf8'); } catch { continue; }
      if (re.test(text)) offenders.push(`${d}/${f}`);
    }
  }
  return offenders;
}

test('no shipped file names a forge tool (ADR-065: no exemption)', () => {
  const offenders = offendersOf(FORGE_RE);
  assert.deepEqual(offenders, [], `no shipped file may name a forge tool — offenders: ${offenders.join(', ') || 'none'}`);
});

test('no shipped file restates forge internals', () => {
  const offenders = offendersOf(RESTATEMENT_RE);
  assert.deepEqual(offenders, [], `no shipped file may restate forge internals — offenders: ${offenders.join(', ') || 'none'}`);
});

test('the forge import is gone: no import command, export schema, importer module or verb (ADR-065)', () => {
  for (const rel of ['commands/astro-forge-import.md', 'templates/FORGE-EXPORT.md', 'lib/principleimport.mjs']) {
    assert.ok(!existsSync(join(ROOT, rel)), `${rel} must not exist`);
  }
  const offenders = offendersOf(/forge-import|from-forge|FORGE-EXPORT|importForgeExport|principleimport/);
  assert.deepEqual(offenders, [], `no shipped file may reference the removed import — offenders: ${offenders.join(', ') || 'none'}`);
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
