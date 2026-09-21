// Locate the project root (the directory containing the state dir) and resolve
// the canonical paths astro-code reads and writes.
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

// In-project state directory. Intentionally NOT `.planning` (too generic — other tools
// claim it) and NOT `.astro` (collides with the Astro web framework's cache, which is
// often gitignored, so the state would silently never be committed).
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
    // ADR-053 follow-up — the last CONVENTIONS.md content this working copy is KNOWN
    // to have matched the registry on, set after every successful pull/push. Distinct
    // from `conventions` itself: without it, `canonPull`/`decision add` cannot tell a
    // real local EDIT (must refuse/publish) from mere STALENESS (safe to fast-forward
    // in silence) — both look identical as "local differs from the registry right now".
    conventionsSynced: join(dir, '.conventions-synced'),
    roadmapMd: join(dir, 'ROADMAP.md'),
    phases: join(dir, 'phases'),
    // Fixes are peers of phases, deliberately NOT inside roadmap.json: that file
    // is archived wholesale per milestone, and a fix belongs to no milestone.
    fixes: join(dir, 'fixes.json'),
    fixes_dir: join(dir, 'fixes'),
    // The debt register. One file, no per-item directory: a debt item has no
    // artifacts until it is paid, and the fix/phase that pays it owns the
    // directory from that point on (see lib/debt.mjs).
    debt: join(dir, 'debt.json'),
    // The backlog register (ADR-056). Same shape as debt: one flat file, no
    // per-item directory — an idea has no artifacts until it is promoted, and
    // from that point the phase it became owns them.
    backlog: join(dir, 'backlog.json'),
    lock: join(dir, '.lock'),
  };
}
