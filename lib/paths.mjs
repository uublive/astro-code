// Locate the project root (the directory containing the state dir) and resolve
// the canonical paths astro-code reads and writes.
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// In-project state directory. Intentionally NOT `.planning` (a GSD convention) and
// NOT `.astro` (collides with the Astro web framework's cache, often gitignored).
export const STATE_DIR = '.astrocode';

export function findRoot(start = process.cwd()) {
  let cur = resolve(start);
  for (;;) {
    if (existsSync(join(cur, STATE_DIR))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

export function paths(root) {
  const dir = join(root, STATE_DIR);
  return {
    root,
    dir,
    state: join(dir, 'state.json'),
    roadmap: join(dir, 'roadmap.json'),
    config: join(dir, 'config.json'),
    project: join(dir, 'PROJECT.md'),
    conventions: join(dir, 'CONVENTIONS.md'),
    decisions: join(dir, 'DECISIONS.md'),
    roadmapMd: join(dir, 'ROADMAP.md'),
    phases: join(dir, 'phases'),
    lock: join(dir, '.lock'),
  };
}
