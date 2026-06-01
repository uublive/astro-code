// Roadmap model: canonical roadmap.json + a rendered, human/hook-readable
// ROADMAP.md. The Markdown format is deliberately greppable ("**Milestone N**",
// "Phase N") so external numbering hooks can parse it too.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, atomicWriteText, withLock } from './util.mjs';

const pad2 = (n) => String(n).padStart(2, '0');
export const slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export function loadRoadmap(root) {
  return readJSON(paths(root).roadmap) || { version: 1, milestone: 1, phases: [] };
}

export function renderRoadmapMd(rm) {
  const lines = ['# Roadmap', '', `**Milestone ${rm.milestone}**`, ''];
  if (!rm.phases.length) {
    lines.push('_No phases yet. Add one with `ac phase add <name>`._');
  } else {
    for (const ph of rm.phases) {
      const box = ph.status === 'complete' ? 'x' : ' ';
      lines.push(`- [${box}] Phase ${ph.number} — ${ph.name} (${ph.plans} plans) \`${ph.status}\``);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function renderRoadmap(root) {
  const rm = loadRoadmap(root);
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
    const phase = { number, name, slug, status: 'pending', plans: 0 };
    rm.phases.push(phase);
    rm.phases.sort((a, b) => a.number - b.number);
    atomicWriteJSON(p.roadmap, rm);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(rm));
    mkdirSync(join(p.phases, slug), { recursive: true });
    return phase;
  });
}
