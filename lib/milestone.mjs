// Archive a completed milestone: move its phase directories under
// .astrocode/milestones/<n>/, snapshot the roadmap, and clear the active roadmap
// so the next milestone starts clean. The milestone number is preserved until
// `ac milestone new` bumps it.
import { mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, atomicWriteText, withLock } from './util.mjs';
import { renderRoadmapMd } from './roadmap.mjs';

export async function completeMilestone(root) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: 1, phases: [] };
    const m = rm.milestone;

    const archiveDir = join(p.dir, 'milestones', String(m));
    const phasesArchive = join(archiveDir, 'phases');
    mkdirSync(phasesArchive, { recursive: true });

    atomicWriteJSON(join(archiveDir, 'roadmap.json'), rm);
    atomicWriteText(join(archiveDir, 'ROADMAP.md'), renderRoadmapMd(rm));

    let archived = 0;
    for (const ph of rm.phases) {
      const src = join(p.phases, ph.slug);
      if (existsSync(src)) {
        renameSync(src, join(phasesArchive, ph.slug));
        archived++;
      }
    }

    const cleared = { ...rm, phases: [] };
    atomicWriteJSON(p.roadmap, cleared);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(cleared));

    // Drop blockers belonging to the phases just archived. Their roadmap entries
    // are gone, so such a blocker names something that no longer exists and
    // nothing could ever resolve it — it would follow the project into the next
    // milestone as permanent, unactionable noise.
    const archivedSlugs = new Set(rm.phases.map((ph) => ph.slug));
    const state = readJSON(p.state);
    if (state && Array.isArray(state.blockers)) {
      const kept = state.blockers.filter((b) => !(b && archivedSlugs.has(b.phase)));
      if (kept.length !== state.blockers.length) {
        atomicWriteJSON(p.state, { ...state, blockers: kept, updated_at: new Date().toISOString() });
      }
    }

    return { milestone: m, archived, archiveDir };
  });
}
