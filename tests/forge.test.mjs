// Phase 25 t16 — the forge-read replacement guard (CONTEXT D3). Phase 15's read/write
// spec is gone: every command/agent that used to make an opportunistic
// `mcp__forge__forge_knowledge` (or `_list`) call now runs `ac principles ask`/`brief`
// instead — a personal store, local, no connect/degrade dance. This file replaces
// tests/forge.test.mjs's phase-15 guards outright (same readFileSync/scoped-slice shape,
// case-insensitive regex assertions, messages that quote the offending text) so a forge
// read cannot silently creep back into any of the five touched callers. Phase 27 (t9)
// deleted the `templates/forge-knowledge.md` stub this file used to check for — the
// pointer to "where the read went" now lives in AGENTS.md/MANUAL.md directly — and added
// the "no shipped file mentions the deleted stub" guard below. Phase 27 (t10) then
// deliberately reopened ONE narrow hole in the "no forge tool anywhere" guard:
// `commands/astro-forge-import.md` is now the sole file in the whole tree allowed to name
// a forge MCP tool (ADR-030) — every other shipped file, INCLUDING templates/, hooks/ and
// workflows/ now (widened from just commands/+agents/), still must not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORGE_EXPORT_FORMAT, FORGE_EXPORT_VERSION,
} from '../lib/principleimport.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');
const IMPORT_CMD_PATH = join(COMMANDS_DIR, 'astro-forge-import.md');
const EXEMPT = new Set([IMPORT_CMD_PATH]);

const FORGE_RE = /mcp__forge__|forge_knowledge|forge_capture_knowledge|FORGEMASTER/;
// The "the graph"/"ToolSearch"/entity-name restatement guard: nothing outside the one
// exempt command may restate forge's internal shape (its node/edge vocabulary) even
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

test('no shipped file names a forge tool, except the one exempt import command', () => {
  const dirs = ['commands', 'agents', 'templates', 'hooks', 'workflows'];
  const offenders = [];
  for (const d of dirs) {
    const full = join(ROOT, d);
    let files;
    try { files = readdirSync(full); } catch { continue; }
    for (const f of files) {
      const path = join(full, f);
      if (EXEMPT.has(path)) continue;
      let text;
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      if (FORGE_RE.test(text)) offenders.push(`${d}/${f}`);
    }
  }
  assert.deepEqual(offenders, [], `only commands/astro-forge-import.md may name a forge tool — offenders: ${offenders.join(', ') || 'none'}`);
});

test('no shipped file restates forge internals, except the one exempt import command', () => {
  const dirs = ['commands', 'agents', 'templates', 'hooks', 'workflows'];
  const offenders = [];
  for (const d of dirs) {
    const full = join(ROOT, d);
    let files;
    try { files = readdirSync(full); } catch { continue; }
    for (const f of files) {
      const path = join(full, f);
      if (EXEMPT.has(path)) continue;
      let text;
      try { text = readFileSync(path, 'utf8'); } catch { continue; }
      if (RESTATEMENT_RE.test(text)) offenders.push(`${d}/${f}`);
    }
  }
  assert.deepEqual(offenders, [], `only commands/astro-forge-import.md may restate forge internals — offenders: ${offenders.join(', ') || 'none'}`);
});

// --- the one exempt command itself: what it MUST and MUST NOT do -----------------------

test('astro-forge-import.md grants no forge write/capture tool in its frontmatter, and stops in one line when tools are absent', () => {
  const src = readFileSync(IMPORT_CMD_PATH, 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'astro-forge-import.md must have frontmatter');
  const allowedToolsLine = fm[1].split('\n').find((l) => l.startsWith('allowed-tools:')) || '';
  assert.ok(!/forge_capture_knowledge|forge_write|forge_create/.test(allowedToolsLine), 'allowed-tools must grant no forge write/capture tool');
  assert.match(src, /forge tools are not\s+connected/i);
});

test('astro-forge-import.md runs the importer, points at FORGE-EXPORT.md, and writes under a mktemp -d path', () => {
  const src = readFileSync(IMPORT_CMD_PATH, 'utf8');
  assert.match(src, /ac principles import --from-forge/);
  assert.match(src, /FORGE-EXPORT\.md/);
  assert.match(src, /mktemp -d/);
});

test('astro-forge-import.md never names ~/.astro/principles except to forbid writing it', () => {
  const src = readFileSync(IMPORT_CMD_PATH, 'utf8');
  const mentions = [...src.matchAll(/~\/\.astro\/principles/g)];
  assert.ok(mentions.length > 0, 'must at least name the store to forbid writing it');
  for (const m of mentions) {
    const around = src.slice(Math.max(0, m.index - 120), m.index + 120);
    assert.match(
      around, /never|NEVER|only (?:ever )?writ|only writer/i,
      `every ~/.astro/principles mention must read as a prohibition on writing it: "${around}"`,
    );
  }
});

test('astro-forge-import.md asks before the real import and before marking anything accepted', () => {
  const src = readFileSync(IMPORT_CMD_PATH, 'utf8');
  const askCount = (src.match(/AskUserQuestion/g) || []).length;
  assert.ok(askCount >= 2, 'must ask at least twice — once for accepted-vs-proposed, once before the real import');
  assert.match(src, /import now/i);
  assert.match(src, /accepted/i);
});

test('astro-forge-import.md names the same format/version the importer accepts', () => {
  const src = readFileSync(IMPORT_CMD_PATH, 'utf8');
  assert.match(src, /FORGE-EXPORT\.md/);
  // The command deliberately never restates the schema (single source) — this just
  // confirms the constants it would have to match still exist and have not drifted.
  assert.equal(FORGE_EXPORT_FORMAT, 'astro-forge-export');
  assert.equal(FORGE_EXPORT_VERSION, 1);
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
