// Scaffold the .astrocode/ directory for a new project.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.mjs';
import { atomicWriteJSON } from './util.mjs';

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
const CONTEXT_MARKER_RE = /<!--\s*astro-discuss:\s*captured\s*-->/i;

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

  return { created: true, message: `Initialized .astrocode for "${name}"` };
}
