// Roadmap model: canonical roadmap.json + a rendered, human/hook-readable
// ROADMAP.md. The Markdown format is deliberately greppable ("**Milestone N**",
// "Phase N") so external numbering hooks can parse it too.
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, atomicWriteText, withLock } from './util.mjs';
import { validateEffort } from './effort.mjs';

const pad2 = (n) => String(n).padStart(2, '0');
export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function loadRoadmap(root) {
  return readJSON(paths(root).roadmap) || { version: 1, milestone: 1, phases: [] };
}

// Phase lifecycle: pending → executing → verified (AI) → complete (human-accepted).
// `rejected` is set when UAT fails.
export const PHASE_STATUSES = ['pending', 'executing', 'verified', 'complete', 'rejected'];

// Resolve a phase by slug, number ("3" / "03"), or name.
export function findPhase(root, ref) {
  const r = String(ref);
  return (
    loadRoadmap(root).phases.find(
      (p) => p.slug === r || p.name === r || String(p.number) === r || String(p.number) === r.replace(/^0+/, ''),
    ) || null
  );
}

export async function setPhaseStatus(root, slug, status, extra = {}) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap);
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`phase not found: ${slug}`);
    ph.status = status;
    Object.assign(ph, extra);
    atomicWriteJSON(p.roadmap, rm);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(rm));
    return ph;
  });
}

// Set the per-phase effort dial (ADR-022). `effort` is an ADDITIVE roadmap-phase
// field — we only ever touch `ph.effort`, leaving every other phase/field/milestone
// byte-for-byte intact (no migration, no schema change). validateEffort throws BEFORE
// any write so a bogus level never lands on disk; the shared lock gives the same
// concurrent-write safety as setPhaseStatus (whose shape this deliberately mirrors).
export async function setPhaseEffort(root, slug, level) {
  const p = paths(root);
  validateEffort(level);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap);
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`phase not found: ${slug}`);
    ph.effort = level;
    atomicWriteJSON(p.roadmap, rm);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(rm));
    return ph;
  });
}

// Derived from disk (not a stored counter): does the phase have a PLAN.md yet?
export function isPhasePlanned(root, slug) {
  return existsSync(join(paths(root).phases, slug, 'PLAN.md'));
}

// ROADMAP.md is GENERATED — every render rebuilds it from roadmap.json, so anything
// typed straight into the Markdown is gone at the next `ac phase add`/`verify`/`accept`/
// `effort`/`roadmap render`. ADR-044 gives that intent somewhere durable to live: a
// per-phase `note`, set with `ac phase note <phase> "<text>"`, which the renderer emits
// so hand-written status like "(parked: awaiting specs)" survives instead of vanishing.
export function renderRoadmapMd(rm) {
  const lines = ['# Roadmap', '', `**Milestone ${rm.milestone}**`, ''];
  if (!rm.phases.length) {
    lines.push('_No phases yet. Add one with `ac phase add <name>`._');
  } else {
    for (const ph of rm.phases) {
      const box = ph.status === 'complete' ? 'x' : ' ';
      const extra = ph.planned ? ' · planned' : '';
      const note = ph.note ? ` — _${ph.note}_` : '';
      lines.push(`- [${box}] Phase ${ph.number} — ${ph.name} \`${ph.status}\`${extra}${note}`);
    }
  }
  lines.push('');
  lines.push('<!-- generated from roadmap.json — edits here are overwritten; use `ac phase note <phase> "<text>"` -->');
  lines.push('');
  return lines.join('\n');
}

// Set (or clear, with an empty string) a phase's durable note. Mirrors setPhaseEffort:
// additive field, same lock, every other byte of the roadmap untouched.
export async function setPhaseNote(root, slug, note) {
  const p = paths(root);
  const text = String(note ?? '').trim();
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap);
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`phase not found: ${slug}`);
    if (text) ph.note = text;
    else delete ph.note;
    atomicWriteJSON(p.roadmap, rm);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(rm));
    return ph;
  });
}

export function renderRoadmap(root) {
  const rm = loadRoadmap(root);
  // enrich (in memory only) with the disk-derived planned flag before rendering
  rm.phases = rm.phases.map((p) => ({ ...p, planned: isPhasePlanned(root, p.slug) }));
  atomicWriteText(paths(root).roadmapMd, renderRoadmapMd(rm));
  return rm;
}

// Add a phase whose number was already allocated by the registry. Throws if the
// number collides locally (should not happen once the registry granted it).
export async function addPhase(root, { number, name, milestone }) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: milestone || 1, phases: [] };
    if (milestone) rm.milestone = milestone;
    if (rm.phases.some((ph) => ph.number === number)) {
      throw new Error(`phase ${number} already exists in the roadmap`);
    }
    const slug = `${pad2(number)}-${slugify(name)}`;
    const phase = { number, name, slug, status: 'pending' };
    rm.phases.push(phase);
    rm.phases.sort((a, b) => a.number - b.number);
    atomicWriteJSON(p.roadmap, rm);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(rm));
    mkdirSync(join(p.phases, slug), { recursive: true });
    return phase;
  });
}
