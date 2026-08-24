// Doc guards for phase 15 (opportunistic forge knowledge-graph read/write).
//
// Follows tests/commands.test.mjs exactly: readFileSync, scoped slices where useful,
// case-insensitive regex assertions, and messages that quote the missing/offending
// text. The guards are keyed on tokens a copy-edit cannot silently reword — the two
// literal tool ids and the literal path `templates/forge-knowledge.md` (C8) — so that
// deleting the integration, or hollowing out the shared spec, reliably goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMMANDS_DIR = join(ROOT, 'commands');
const AGENTS_DIR = join(ROOT, 'agents');
const SPEC_PATH = join(ROOT, 'templates', 'forge-knowledge.md');

const READ_TOOL = 'mcp__forge__forge_knowledge';
const WRITE_TOOL = 'mcp__forge__forge_capture_knowledge';
const LIST_TOOL = 'mcp__forge__forge_knowledge_list';
const POINTER = 'templates/forge-knowledge.md';
// Every touched caller points at the spec via `` `$(ac path templates)/forge-knowledge.md` ``
// (resolved at run time, never hardcoded) rather than the literal joined path — match either
// form so the guard survives that indirection without losing the "resolves to the real file"
// intent (C5).
const POINTER_RE = /\$\(ac path templates\)\/forge-knowledge\.md|templates\/forge-knowledge\.md/;

const specSrc = readFileSync(SPEC_PATH, 'utf8');

// ── 1. The spec is complete (C4) ─────────────────────────────────────────────────────
//
// A reader must be able to answer the full read/write/degrade contract from this file
// alone. Each assertion below pins one load-bearing token; if the file is truncated to
// empty (the C8 mutation check), every one of these goes red.

test('templates/forge-knowledge.md names both exact tool ids', () => {
  assert.ok(
    specSrc.includes(READ_TOOL),
    `templates/forge-knowledge.md must literally contain "${READ_TOOL}" — found no such text.`,
  );
  assert.ok(
    specSrc.includes(WRITE_TOOL),
    `templates/forge-knowledge.md must literally contain "${WRITE_TOOL}" — found no such text.`,
  );
});

test('templates/forge-knowledge.md documents the ToolSearch detection probe', () => {
  assert.ok(
    specSrc.includes('ToolSearch('),
    `templates/forge-knowledge.md must document the "ToolSearch(" detection probe — found no such text.`,
  );
});

// The probe must name EVERY tool astro-code can call. A tool left out of the probe stays
// deferred and uncallable even when forge is connected — the exact silent failure the
// probe exists to prevent, just narrowed to one tool. This caught forge_knowledge_list,
// which the spec did not know about until connected-mode UAT surfaced it.
test('the ToolSearch probe names every tool the spec grants', () => {
  const probe = specSrc.match(/ToolSearch\("select:[^"]*"\)/);
  assert.ok(probe, 'templates/forge-knowledge.md must contain a concrete ToolSearch("select:…") probe');
  for (const tool of [READ_TOOL, LIST_TOOL, WRITE_TOOL]) {
    assert.ok(
      probe[0].includes(tool),
      `the ToolSearch probe must name ${tool}, or that tool stays deferred and uncallable. Probe: ${probe[0]}`,
    );
  }
});

test('templates/forge-knowledge.md names the browse tool and separates it from search', () => {
  assert.ok(
    specSrc.includes(LIST_TOOL),
    `templates/forge-knowledge.md must literally contain "${LIST_TOOL}" — found no such text.`,
  );
  // Naming it is not enough: a caller has to know WHICH read tool to reach for, or the
  // distinction collapses and the browse tool never gets used on purpose.
  assert.ok(
    /browse/i.test(specSrc) && /search/i.test(specSrc),
    'templates/forge-knowledge.md must distinguish the browse tool from the search tool, not merely list both.',
  );
});

// Deliberately reads the FRONTMATTER GRANT LINE, not the whole file. A caller that names
// a tool in its prose while lacking the grant is precisely the "names a tool it lacks"
// defect — a whole-file `includes()` would pass on the prose mention alone and prove
// nothing about whether the tool can actually be called.
const grantLine = (dir, f) => (readFileSync(join(dir, f), 'utf8').match(/^(?:allowed-tools|tools):.*$/m) || [''])[0];

test('the browse tool is granted only where the spec says it is used', () => {
  const granted = readdirSync(COMMANDS_DIR)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => grantLine(COMMANDS_DIR, f).includes(LIST_TOOL));
  assert.deepStrictEqual(
    granted.sort(),
    ['astro-new-project.md'],
    `${LIST_TOOL} is a browse-by-category tool with exactly one documented caller ` +
      `(/astro-new-project, which has no phase goal to search against). Granting it more ` +
      `widely invites a search-then-browse pair per caller, which the READ protocol forbids.`,
  );
  // And no agent holds it — agents always have a concrete goal to search against.
  const agentHits = readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => grantLine(AGENTS_DIR, f).includes(LIST_TOOL));
  assert.deepStrictEqual(agentHits, [], 'no agent should hold the browse tool');
});

test('astro-new-project names the browse tool in prose AND holds the grant for it', () => {
  const src = readFileSync(join(COMMANDS_DIR, 'astro-new-project.md'), 'utf8');
  assert.ok(src.includes(LIST_TOOL), 'astro-new-project.md must mention the browse tool in its prose');
  assert.ok(
    grantLine(COMMANDS_DIR, 'astro-new-project.md').includes(LIST_TOOL),
    `astro-new-project.md names ${LIST_TOOL} in prose but does not grant it — the call would ` +
      `silently never happen, which is indistinguishable from correct degradation.`,
  );
});

test('templates/forge-knowledge.md enumerates all four node_type values', () => {
  const nodeTypes = ['Principle', 'Pattern', 'AntiPattern', 'Preference'];
  const missing = nodeTypes.filter((t) => !specSrc.includes(t));
  assert.deepEqual(
    missing,
    [],
    `templates/forge-knowledge.md must enumerate all four node_type values — missing: ${missing.join(', ') || 'none'}.`,
  );
});

test('templates/forge-knowledge.md documents an …EvidencedBySignal edge type', () => {
  assert.ok(
    /EvidencedBySignal/.test(specSrc),
    `templates/forge-knowledge.md must name an "…EvidencedBySignal" edge type — found no such text.`,
  );
});

test('templates/forge-knowledge.md documents the full capture-contract field set', () => {
  const fields = [
    'node_body',
    'signal_body',
    'node_slug',
    'signal_slug',
    'source',
    'third_party_content',
  ];
  const missing = fields.filter((f) => !specSrc.includes(f));
  assert.deepEqual(
    missing,
    [],
    `templates/forge-knowledge.md must document every capture-contract field — missing: ${missing.join(', ') || 'none'}.`,
  );
});

test('templates/forge-knowledge.md requires kebab-case slugs', () => {
  assert.ok(
    /kebab-case/i.test(specSrc),
    `templates/forge-knowledge.md must require "kebab-case" slugs — found no such text.`,
  );
});

test('templates/forge-knowledge.md states both degradation paths distinctly', () => {
  // Absent → no output at all, silently.
  const hasAbsentSilent =
    /absent/i.test(specSrc) && /(no output|silent(?:ly)?)/i.test(specSrc);
  // Present-but-broken → one line that the brain was unreachable.
  const hasUnreachableLine =
    /unreachable/i.test(specSrc) && /one (?:short )?line/i.test(specSrc);
  assert.ok(
    hasAbsentSilent,
    `templates/forge-knowledge.md must state the "tools absent → no output, silently" path — found no such text.`,
  );
  assert.ok(
    hasUnreachableLine,
    `templates/forge-knowledge.md must state the distinct "tools present but call fails → one line, unreachable" path — found no such text.`,
  );
});

// ── 2. Every touched file points at the spec and states the skip rule (C5) ──────────
//
// Table-driven over the six touched commands + two touched agents: each must name
// `templates/forge-knowledge.md`, mention its relevant tool id in prose, and carry a
// skip-on-absence phrase. Deleting the pointer from any one file must go red.

const TOUCHED_FILES = [
  { path: join(COMMANDS_DIR, 'astro-decision.md'), tool: WRITE_TOOL },
  { path: join(COMMANDS_DIR, 'astro-discuss.md'), tool: READ_TOOL },
  { path: join(COMMANDS_DIR, 'astro-plan.md'), tool: READ_TOOL },
  { path: join(COMMANDS_DIR, 'astro-new-project.md'), tool: READ_TOOL },
  { path: join(COMMANDS_DIR, 'astro-execute.md'), tool: WRITE_TOOL },
  { path: join(COMMANDS_DIR, 'astro-verify.md'), tool: WRITE_TOOL },
  { path: join(AGENTS_DIR, 'astro-researcher.md'), tool: READ_TOOL },
  { path: join(AGENTS_DIR, 'astro-planner.md'), tool: READ_TOOL },
];

// The ToolSearch grant is LOAD-BEARING, not incidental. The spec's detection order is
// "toolset check, then exactly one ToolSearch probe" — and that probe is the ONLY way to
// tell "forge is not installed" apart from "forge is connected but its tools are
// DEFERRED" (present as a name in a system-reminder, schema unloaded until ToolSearch
// fetches it). A file that prescribes the probe without being granted ToolSearch silently
// degrades to a bare toolset check: the integration never fires even when forge IS
// connected, and that looks EXACTLY like correct standalone degradation. It would never
// surface as an error. Caught in phase-15 UAT, guarded here so it cannot regress.
const GRANT_RE = /^(?:allowed-tools|tools):.*$/m;

for (const { path, tool } of TOUCHED_FILES) {
  const name = path.split('/').slice(-2).join('/');

  test(`${name} grants ToolSearch so the deferred-tool probe can actually run`, () => {
    const src = readFileSync(path, 'utf8');
    const grant = src.match(GRANT_RE);
    assert.ok(grant, `${name} must declare an allowed-tools/tools frontmatter line`);
    assert.ok(
      /\bToolSearch\b/.test(grant[0]),
      `${name} prescribes the ToolSearch detection probe but does not grant ToolSearch — ` +
        `detection would silently fall back to a bare toolset check and skip forge even when connected. Got: ${grant[0]}`,
    );
    // The grant is only meaningful alongside the forge tool it is probing for.
    assert.ok(
      grant[0].includes(tool),
      `${name} must still grant ${tool} on the same frontmatter line`,
    );
  });

  test(`${name} points at ${POINTER} and names ${tool}`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      POINTER_RE.test(src),
      `${name} must point at "${POINTER}" (directly or via "$(ac path templates)/forge-knowledge.md") — found no such reference.`,
    );
    assert.ok(
      src.includes(tool),
      `${name} must name "${tool}" in prose — found no such reference.`,
    );
  });

  test(`${name} states a skip-on-absence rule`, () => {
    const src = readFileSync(path, 'utf8');
    const hasSkipPhrase =
      /skip\s*(?:the\s+step\s+)?silently/i.test(src) ||
      /(?:tools?\s+)?absent\s*(?:→|->)\s*skip/i.test(src) ||
      /capture(?:s)?\s+nothing/i.test(src) ||
      /skip\s+silently,?\s+no\s+output/i.test(src);
    assert.ok(
      hasSkipPhrase,
      `${name} must carry a skip-on-absence phrase (e.g. "skip silently" / "captures nothing") — found none.`,
    );
  });
}

// ── 3. Grant split (C6) ──────────────────────────────────────────────────────────────
//
// Parse the `allowed-tools:` / `tools:` frontmatter line of every file in commands/ and
// agents/. The read/write split must match the intended roles exactly.

function frontmatterToolsLine(src, key) {
  const re = new RegExp(`^${key}:\\s*(.*)$`, 'm');
  const match = re.exec(src);
  return match ? match[1] : '';
}

const allCommandFiles = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
const allAgentFiles = readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md'));

const WRITE_ALLOWED_COMMANDS = new Set(['astro-decision.md', 'astro-execute.md', 'astro-verify.md']);
const READ_ALLOWED_COMMANDS = new Set(['astro-discuss.md', 'astro-plan.md', 'astro-new-project.md']);
const READ_ALLOWED_AGENTS = new Set(['astro-researcher.md', 'astro-planner.md']);

test('no agents/ file is granted mcp__forge__forge_capture_knowledge', () => {
  const offenders = allAgentFiles.filter((f) => {
    const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
    return frontmatterToolsLine(src, 'tools').includes(WRITE_TOOL);
  });
  assert.deepEqual(
    offenders,
    [],
    `no agents/ file may grant "${WRITE_TOOL}" — offenders: ${offenders.join(', ') || 'none'}.`,
  );
});

test('mcp__forge__forge_knowledge appears in agents/ tools: only for astro-researcher.md and astro-planner.md', () => {
  const granted = allAgentFiles.filter((f) => {
    const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
    return frontmatterToolsLine(src, 'tools').includes(READ_TOOL);
  });
  assert.deepEqual(
    granted.sort(),
    [...READ_ALLOWED_AGENTS].sort(),
    `only astro-researcher.md and astro-planner.md may grant "${READ_TOOL}" in agents/ — found: ${granted.join(', ') || 'none'}.`,
  );
});

test('agents/astro-executor.md grants neither forge tool', () => {
  const src = readFileSync(join(AGENTS_DIR, 'astro-executor.md'), 'utf8');
  const toolsLine = frontmatterToolsLine(src, 'tools');
  assert.ok(
    !toolsLine.includes(READ_TOOL) && !toolsLine.includes(WRITE_TOOL),
    `agents/astro-executor.md must grant neither forge tool (decision 8) — tools: line was "${toolsLine}".`,
  );
});

test('mcp__forge__forge_capture_knowledge in commands/ appears only in astro-decision.md, astro-execute.md, astro-verify.md', () => {
  const granted = allCommandFiles.filter((f) => {
    const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
    return frontmatterToolsLine(src, 'allowed-tools').includes(WRITE_TOOL);
  });
  assert.deepEqual(
    granted.sort(),
    [...WRITE_ALLOWED_COMMANDS].sort(),
    `"${WRITE_TOOL}" must be granted only to astro-decision.md, astro-execute.md, astro-verify.md — found: ${granted.join(', ') || 'none'}.`,
  );
});

test('mcp__forge__forge_knowledge in commands/ appears only in astro-discuss.md, astro-plan.md, astro-new-project.md', () => {
  const granted = allCommandFiles.filter((f) => {
    const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
    return frontmatterToolsLine(src, 'allowed-tools').includes(READ_TOOL);
  });
  assert.deepEqual(
    granted.sort(),
    [...READ_ALLOWED_COMMANDS].sort(),
    `"${READ_TOOL}" must be granted only to astro-discuss.md, astro-plan.md, astro-new-project.md — found: ${granted.join(', ') || 'none'}.`,
  );
});

// ── 4. DRY / single source (C5) ──────────────────────────────────────────────────────
//
// Outside templates/forge-knowledge.md, no file under commands/ or agents/ may restate
// the node_type enum, the edge-type naming, or the ToolSearch detection procedure — a
// second copy of the rules is drift bait: the two copies will diverge and one will be
// wrong.

test('no commands/ or agents/ file restates the AntiPattern/EvidencedBySignal/ToolSearch( rules inline', () => {
  const restatementRe = /AntiPattern|EvidencedBySignal|ToolSearch\(/;
  const offenders = [];
  for (const f of allCommandFiles) {
    const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
    if (restatementRe.test(src)) offenders.push(`commands/${f}`);
  }
  for (const f of allAgentFiles) {
    const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
    if (restatementRe.test(src)) offenders.push(`agents/${f}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `only templates/forge-knowledge.md may match AntiPattern|EvidencedBySignal|ToolSearch( — a second copy is drift bait. Offenders: ${offenders.join(', ') || 'none'}.`,
  );
});

// ── 5. Capture is conditional (C7) ───────────────────────────────────────────────────
//
// Each of the three write callers must contain an explicit negative branch near its
// capture step (e.g. "capture(s) nothing"), a non-blocking phrasing ("never fails" /
// "non-blocking"), and the capture step must appear strictly after the caller's primary
// effect marker in the file.

const CAPTURE_CALLERS = [
  { name: 'astro-decision.md', path: join(COMMANDS_DIR, 'astro-decision.md'), primaryMarker: 'ac decision add' },
  { name: 'astro-execute.md', path: join(COMMANDS_DIR, 'astro-execute.md'), primaryMarker: 'verdict' },
  { name: 'astro-verify.md', path: join(COMMANDS_DIR, 'astro-verify.md'), primaryMarker: 'ac phase verify' },
];

for (const { name, path, primaryMarker } of CAPTURE_CALLERS) {
  test(`${name} states an explicit "capture nothing" negative branch`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      /capture(?:s)?\s+nothing/i.test(src),
      `${name} must contain an explicit negative branch (e.g. "capture nothing") — found none.`,
    );
  });

  test(`${name} describes a failed capture as non-blocking`, () => {
    const src = readFileSync(path, 'utf8');
    assert.ok(
      /never (?:fails|block|changes)|non-blocking/i.test(src),
      `${name} must describe a failed capture as non-blocking (e.g. "never fails this command") — found none.`,
    );
  });

  test(`${name} places the capture step after its primary effect marker "${primaryMarker}"`, () => {
    const src = readFileSync(path, 'utf8');
    const primaryIdx = src.indexOf(primaryMarker);
    assert.ok(
      primaryIdx !== -1,
      `${name}: expected to find the primary effect marker "${primaryMarker}" — it may have been renamed or removed.`,
    );
    // lastIndexOf, not indexOf: the frontmatter `allowed-tools:` line grants the tool
    // near the top of the file, before any primary effect — the actual invocation (what
    // this assertion cares about) is the LAST mention, in the capture step's prose.
    const captureIdx = src.lastIndexOf(WRITE_TOOL);
    assert.ok(
      captureIdx !== -1,
      `${name}: expected to find "${WRITE_TOOL}" — the capture step may have been removed.`,
    );
    assert.ok(
      captureIdx > primaryIdx,
      `${name}: the capture step (mentioning "${WRITE_TOOL}" at index ${captureIdx}) must appear ` +
        `after the primary effect marker "${primaryMarker}" (at index ${primaryIdx}) — capture must ` +
        `never precede or gate the caller's primary effect.`,
    );
  });
}
