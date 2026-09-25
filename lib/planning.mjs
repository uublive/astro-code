// Scaffold the .astrocode/ directory for a new project.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.mjs';
import { atomicWriteJSON } from './util.mjs';
import { writeAgentsMd } from './agentsmd.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');

// Provenance marker stamped at the top of CONTEXT.md by /astro-discuss when it
// CAPTURES a real discussion. It's an HTML comment, so it's invisible in any
// rendered/markdown view but trivially machine-detectable. The whole point: a
// CONTEXT.md that someone (or the planning side) hand-seeds as a stub will NOT
// carry this marker, so the plan gate can tell "actually discussed" from "a file
// merely exists" — the gap that let /astro-plan satisfy its own discuss gate.
export const CONTEXT_MARKER = '<!-- astro-discuss: captured -->';
// Tolerant of incidental whitespace variations so a reflow/format can't defeat it.
// Accepts BOTH the human form `<!-- astro-discuss: captured -->` and ADR-035's agent form
// `<!-- astro-discuss: captured by agent: <name> -->`. The original required `captured` to be
// followed immediately by `-->`, so /astro-discuss instructed agents to write a marker this
// gate then REJECTED: an agent-discussed phase read as `stub`, /astro-plan treated it as
// undiscussed, and ADR-032's pipeline gate could never be satisfied by an agent-authored
// discussion. The feature was inert in exactly the configuration it was added for, with a
// fully green suite — no test covered the agent form.
const CONTEXT_MARKER_RE = /<!--\s*astro-discuss:\s*captured\b[^>]*-->/i;

// The ONE provenance classifier for a CONTEXT.md's text — `ac phase context --author`
// (via `contextAuthor`) and `lib/harvest.mjs` both read it, so the discuss gate and the
// milestone sweep can never disagree about who captured a discussion again (phase 23
// verify: two classifiers, each fixed in turn, kept disagreeing on the other's edge).
//
//   'human' — the FIRST non-blank line is the human marker (whitespace-tolerant), or the
//             file carries only human-form markers. A human brief that quotes the agent
//             form in its prose (to document ADR-037's two forms) stays human, because the
//             marker /astro-discuss stamps on line 1 is what declares provenance.
//   'agent' — otherwise, ANY non-human `captured …` marker anywhere: `captured by agent:
//             <name>`, the colon-less `captured by agent`, `captured by fleet-bot`. A
//             marker pushed below a heading or front matter still declares agent
//             provenance — anchoring it to byte 0 read those as human (ADR-037 trap).
//   'stub'  — no marker at all.
//
// `author` is the declared agent name ('' when none is given); null unless 'agent'.
const HUMAN_MARKER_RE = /^<!--\s*astro-discuss:\s*captured\s*-->$/i;
const ANY_MARKER_RE = /<!--\s*astro-discuss:\s*captured\b([^>]*)-->/gi;

export function classifyContext(text) {
  const src = String(text);
  const first = (src.split(/\r?\n/).find((l) => l.trim() !== '') || '').trim();
  if (HUMAN_MARKER_RE.test(first)) return { kind: 'human', author: null };
  let sawHuman = false;
  for (const m of src.matchAll(ANY_MARKER_RE)) {
    const rest = m[1].trim();
    if (!rest) { sawHuman = true; continue; }
    const named = rest.match(/^by\s+agent\s*:?\s*(.*)$/i);
    return { kind: 'agent', author: named ? named[1].trim() : rest.replace(/^by\s+/i, '').trim() };
  }
  return sawHuman ? { kind: 'human', author: null } : { kind: 'stub', author: null };
}

// The declared author of an agent-written brief, or null when it is not agent-captured.
// A thin view over `classifyContext` — kept because `ac phase context --author` prints it.
export function contextAuthor(text) {
  const c = classifyContext(text);
  return c.kind === 'agent' ? c.author : null;
}

/**
 * Classify a phase's discussion brief WITHOUT trusting mere file presence.
 *
 *   'missing' — no CONTEXT.md on disk.
 *   'stub'    — a CONTEXT.md exists but lacks the /astro-discuss provenance
 *               marker (a hand-seeded placeholder, or one written by an older
 *               astro-discuss before markers existed). Treat as "not really
 *               discussed" so the soft gate still nudges toward /astro-discuss.
 *   'ready'   — CONTEXT.md exists AND carries the marker: a genuine capture.
 *
 * Pure over the filesystem so it's unit-testable; the CLI (`ac phase context`)
 * and the /astro-plan gate both read this single source of truth.
 *
 * @param {string} root  project root (the dir containing .astrocode/)
 * @param {string} slug  phase slug, e.g. "04-oracle"
 * @returns {'missing' | 'stub' | 'ready'}
 */
export function phaseContextStatus(root, slug) {
  const file = join(paths(root).phases, slug, 'CONTEXT.md');
  if (!existsSync(file)) return 'missing';
  return CONTEXT_MARKER_RE.test(readFileSync(file, 'utf8')) ? 'ready' : 'stub';
}

export function initPlanning(root, { name, vision = '' } = {}) {
  const p = paths(root);
  name = name || basename(root);

  if (existsSync(p.state)) {
    return { created: false, message: `.astrocode already initialized for "${name}"` };
  }
  mkdirSync(p.phases, { recursive: true });

  atomicWriteJSON(p.state, {
    version: 1,
    project: name,
    active_milestone: 1,
    active_phase: null,
    status: 'planning',
    decisions: [],
    blockers: [],
    updated_at: new Date().toISOString(),
  });
  atomicWriteJSON(p.roadmap, { version: 1, milestone: 1, phases: [] });

  writeFileSync(p.config, readFileSync(join(TEMPLATES, 'config.json'), 'utf8'));

  const project = readFileSync(join(TEMPLATES, 'PROJECT.md'), 'utf8')
    .replaceAll('{{NAME}}', name)
    .replaceAll('{{VISION}}', vision || '_(to be filled in)_');
  writeFileSync(p.project, project);

  for (const file of ['CONVENTIONS.md', 'DECISIONS.md']) {
    const target = file === 'CONVENTIONS.md' ? p.conventions : p.decisions;
    writeFileSync(target, readFileSync(join(TEMPLATES, file), 'utf8').replaceAll('{{NAME}}', name));
  }

  // Explain astro-code to whatever agent opens this project next. On Claude
  // Code the hooks and status line carry this continuously; on every other host
  // this file is the only thing that does.
  const agentsMd = writeAgentsMd(root);

  return {
    created: true,
    agentsMd,
    message: `Initialized .astrocode for "${name}"`,
  };
}
