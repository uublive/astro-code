// #186 — which task ids of a phase already carry a `(phase NN <id>)` stamp on this branch.
//
// Execute's Discover marks a task done when any commit carries its stamp, so a re-plan that numbers
// its new tasks t1..tN again would be skipped as already landed. The planner reads `stampedTaskIds`
// to number new tasks from the next free id, and `/astro-plan` runs `planIdCollisions` on the plan it
// just wrote, so a reused id is a stated choice (the same, already-landed task), never a silent skip.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';

/** Task ids stamped for phase `num` on HEAD (remediation stamps excluded), and the next free `tN`. */
export function stampedTaskIds(root, num) {
  const n = String(parseInt(num, 10));
  const spellings = [...new Set([n, n.padStart(2, '0')])];
  const ids = new Set();
  for (const v of spellings) {
    const r = git(['log', '--format=%s', '--fixed-strings', '--grep', `(phase ${v} `], { cwd: root });
    if (r.status !== 0) continue;
    for (const m of r.stdout.matchAll(new RegExp(`\\(phase ${v} ([^)\\s]+)\\)`, 'g'))) {
      if (!m[1].startsWith('remediate-')) ids.add(m[1]);
    }
  }
  const numeric = (id) => Number(/^t(\d+)$/.exec(id)?.[1] ?? NaN);
  const stamped = [...ids].sort((a, b) => (numeric(a) - numeric(b)) || a.localeCompare(b));
  const max = Math.max(0, ...stamped.map(numeric).filter(Number.isFinite));
  return { stamped, next: `t${max + 1}` };
}

/** The task ids a PLAN.md declares (`- **id:** t1`, or a `### t1 — …` heading). */
export function planTaskIds(planFile) {
  if (!existsSync(planFile)) return [];
  const text = readFileSync(planFile, 'utf8');
  const ids = new Set();
  for (const m of text.matchAll(/^\s*-\s*\*\*id:\*\*\s*`?([\w.-]+)`?/gm)) ids.add(m[1]);
  for (const m of text.matchAll(/^#{2,4}\s+`?([A-Za-z]*\d[\w.-]*)`?\s+[—–-]\s/gm)) ids.add(m[1]);
  return [...ids];
}

/** The ids of the phase's PLAN.md that collide with stamps already on the branch. */
export function planIdCollisions(root, num, slug) {
  const { stamped, next } = stampedTaskIds(root, num);
  const taken = new Set(stamped);
  const collisions = planTaskIds(join(root, '.astrocode', 'phases', slug, 'PLAN.md')).filter((id) => taken.has(id));
  return { collisions, stamped, next };
}
