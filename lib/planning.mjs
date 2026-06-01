// Scaffold the .planning/ directory for a new project.
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.mjs';
import { atomicWriteJSON } from './util.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');

export function initPlanning(root, { name, vision = '' } = {}) {
  const p = paths(root);
  name = name || basename(root);

  if (existsSync(p.state)) {
    return { created: false, message: `.planning already initialized for "${name}"` };
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

  return { created: true, message: `Initialized .planning for "${name}"` };
}
