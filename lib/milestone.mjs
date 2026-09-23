// Archive a completed milestone: move its phase directories under
// .astrocode/milestones/<n>/, snapshot the roadmap, and clear the active roadmap
// so the next milestone starts clean. The milestone number is preserved until
// `ac milestone new` bumps it.
import { mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, atomicWriteText, withLock } from './util.mjs';
import { renderRoadmapMd } from './roadmap.mjs';

// The phases a close of milestone `m` owns (#29): its own, plus any with no milestone
// recorded (roadmaps predating the field) or an EARLIER one (left behind by a previous
// close). A phase scheduled for a LATER milestone is not this close's to archive — the
// loop used to take every phase on the roadmap, filing future work under `m` before it
// was started, while `markComplete` on the registry side filtered by milestone: the two
// halves of one command disagreed about what "this milestone's phases" means.
export const belongsToMilestone = (ph, m) => ph.milestone == null || ph.milestone <= m;

export async function completeMilestone(root) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: 1, phases: [] };
    const m = rm.milestone;

    const mine = rm.phases.filter((ph) => belongsToMilestone(ph, m));
    const later = rm.phases.filter((ph) => !belongsToMilestone(ph, m));

    const archiveDir = join(p.dir, 'milestones', String(m));
    const phasesArchive = join(archiveDir, 'phases');
    mkdirSync(phasesArchive, { recursive: true });

    // the snapshot records what this milestone actually held, not the next one's plans
    const snapshotRm = { ...rm, phases: mine };
    atomicWriteJSON(join(archiveDir, 'roadmap.json'), snapshotRm);
    atomicWriteText(join(archiveDir, 'ROADMAP.md'), renderRoadmapMd(snapshotRm));

    let archived = 0;
    for (const ph of mine) {
      const src = join(p.phases, ph.slug);
      if (existsSync(src)) {
        renameSync(src, join(phasesArchive, ph.slug));
        archived++;
      }
    }

    const cleared = { ...rm, phases: later }; // later-milestone phases stay scheduled
    atomicWriteJSON(p.roadmap, cleared);
    atomicWriteText(p.roadmapMd, renderRoadmapMd(cleared));

    // Drop blockers belonging to the phases just archived. Their roadmap entries
    // are gone, so such a blocker names something that no longer exists and
    // nothing could ever resolve it — it would follow the project into the next
    // milestone as permanent, unactionable noise.
    const archivedSlugs = new Set(mine.map((ph) => ph.slug));
    const state = readJSON(p.state);
    if (state && Array.isArray(state.blockers)) {
      const kept = state.blockers.filter((b) => !(b && archivedSlugs.has(b.phase)));
      if (kept.length !== state.blockers.length) {
        atomicWriteJSON(p.state, { ...state, blockers: kept, updated_at: new Date().toISOString() });
      }
    }

    return { milestone: m, archived, archiveDir, kept: later.length };
  });
}
