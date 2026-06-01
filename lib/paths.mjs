// Locate the project root (the directory containing .planning/) and resolve
// the canonical paths astro-code reads and writes.
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export function findRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, '.planning'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function paths(root) {
  const planning = join(root, '.planning');
  return {
    root,
    planning,
    state: join(planning, 'state.json'),
    roadmap: join(planning, 'roadmap.json'),
    config: join(planning, 'config.json'),
    project: join(planning, 'PROJECT.md'),
    roadmapMd: join(planning, 'ROADMAP.md'),
    phases: join(planning, 'phases'),
    lock: join(planning, '.lock'),
  };
}
