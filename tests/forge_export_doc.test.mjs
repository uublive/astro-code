// Guard for templates/FORGE-EXPORT.md (phase 27 t7): the field tables must name exactly
// the keys `lib/principleimport.mjs` actually accepts, and the shipped example must be a
// real, importable document. Static import is fine here — t2 (`lib/principleimport.mjs`)
// has already landed by the time this task runs (depends_on: [t2]).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseForgeExport, planForgeImport, FORGE_TYPES, FORGE_STATUSES,
  FORGE_ENVELOPE_KEYS, FORGE_NODE_KEYS, FORGE_SIGNAL_KEYS,
} from '../lib/principleimport.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC_PATH = join(ROOT, 'templates', 'FORGE-EXPORT.md');
const doc = readFileSync(DOC_PATH, 'utf8');

/** Every `| \`key\` | ...` first-column key in the markdown table under `## heading`. */
function tableKeys(heading) {
  const start = doc.indexOf(`## ${heading}`);
  assert.ok(start !== -1, `templates/FORGE-EXPORT.md must have a "## ${heading}" section`);
  const rest = doc.slice(start + heading.length);
  const nextHeading = rest.indexOf('\n## ');
  const section = nextHeading === -1 ? rest : rest.slice(0, nextHeading);
  const keys = [];
  for (const line of section.split('\n')) {
    const m = line.match(/^\|\s*`([^`]+)`\s*\|/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** Every fenced ```json block in the document. */
function jsonFences() {
  const out = [];
  const re = /```json\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(doc))) out.push(m[1]);
  return out;
}

test('templates/FORGE-EXPORT.md is non-empty and states Version: 1', () => {
  assert.ok(doc.trim().length > 0);
  assert.match(doc, /Version:\s*1\b/);
});

test('the envelope table names exactly FORGE_ENVELOPE_KEYS', () => {
  assert.deepEqual(new Set(tableKeys('Envelope')), new Set(FORGE_ENVELOPE_KEYS));
});

test('the node table names exactly FORGE_NODE_KEYS', () => {
  assert.deepEqual(new Set(tableKeys('Node')), new Set(FORGE_NODE_KEYS));
});

test('the signal table names exactly FORGE_SIGNAL_KEYS', () => {
  assert.deepEqual(new Set(tableKeys('Signal')), new Set(FORGE_SIGNAL_KEYS));
});

test('every forge type and status named in the doc matches FORGE_TYPES/FORGE_STATUSES', () => {
  for (const type of Object.keys(FORGE_TYPES)) {
    assert.ok(doc.includes(type), `doc must mention type "${type}"`);
  }
  for (const status of FORGE_STATUSES) {
    assert.ok(doc.includes(status), `doc must mention status "${status}"`);
  }
});

test('the example fence parses with parseForgeExport', () => {
  const fences = jsonFences();
  assert.ok(fences.length >= 1, 'doc must ship at least one ```json example fence');
  const parsed = parseForgeExport(fences[fences.length - 1]);
  assert.ok(parsed.nodes.length >= 6, 'the example should cover every type/status combination');
});

test('planForgeImport([], example) yields every entry status of the mapping table', () => {
  const fences = jsonFences();
  const parsed = parseForgeExport(fences[fences.length - 1]);
  let n = 0;
  const plan = planForgeImport([], parsed, { now: new Date('2026-09-25T00:00:00.000Z'), idFor: () => `doc-${(n += 1)}` });
  const statuses = new Set(plan.created.map((c) => c.status));
  assert.ok(statuses.has('accepted'), 'example must yield an accepted entry');
  assert.ok(statuses.has('proposed'), 'example must yield a proposed entry');
  assert.ok(statuses.has('rejected'), 'example must yield a rejected entry');
  assert.ok(statuses.has('superseded') || statuses.has('retired'), 'example must yield a superseded/retired entry');
});

test('the doc never names an MCP tool id', () => {
  assert.ok(!/mcp__forge__|forge_knowledge|forge_capture_knowledge/.test(doc));
});
