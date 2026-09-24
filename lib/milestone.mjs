// Archive a completed milestone: move its phase directories under
// .astrocode/milestones/<n>/, snapshot the roadmap, and clear the active roadmap
// so the next milestone starts clean. The milestone number is preserved until
// `ac milestone new` bumps it.
import { mkdirSync, existsSync, renameSync, readFileSync } from 'node:fs';
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

// The highest ADR number recorded in DECISIONS.md at the moment a milestone closes —
// stamped onto its snapshot alongside `closed_at` so `lib/harvest.mjs` has an anchor
// finer than a calendar day. `closed_at` alone cannot separate "ADR-001 landed just
// before this close" from "ADR-002 landed just after it" when both happen on the same
// date (DECISIONS.md only ever records a day, never a time) — the exact leak that let
// one milestone's ADR bleed into its neighbor's harvest. The watermark is a plain
// ordinal, immune to that ambiguity: an ADR belongs to this milestone's window iff its
// number is above the previous close's watermark and at or below this one's.
function currentAdrWatermark(root) {
  const file = paths(root).decisions;
  // No DECISIONS.md, or one with no ADRs, is a KNOWN count of zero — stamp 0, never null.
  // null means "not checked" and sends the harvest back to day-granular dates, which let
  // the next milestone's same-day ADR leak into this one's window (phase 23 verify, C9).
  if (!existsSync(file)) return 0;
  const ids = [...readFileSync(file, 'utf8').matchAll(/^##\s+ADR-(\d+)/gm)].map((m) => Number(m[1]));
  return ids.length ? Math.max(...ids) : 0;
}

export async function completeMilestone(root) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: 1, phases: [] };
    const m = rm.milestone;

    const mine = rm.phases.filter((ph) => belongsToMilestone(ph, m));
    const later = rm.phases.filter((ph) => !belongsToMilestone(ph, m));

    const archiveDir = join(p.dir, 'milestones', String(m));
    const phasesArchive = join(archiveDir, 'phases');
    const snapshotFile = join(archiveDir, 'roadmap.json');
    // #64 — a second close of an already-closed milestone (a retried command, a re-run
    // script) rewrote this snapshot from the now-empty roadmap: the only record of what
    // the milestone held became `phases: []` while its archived directories stayed put.
    // Nothing of this milestone left to archive + a snapshot already on disk = refuse.
    const previous = existsSync(snapshotFile) ? readJSON(snapshotFile) : null;
    if (previous && mine.length === 0) {
      throw new Error(
        `milestone ${m} is already complete — archived at ${archiveDir}. Nothing was changed; ` +
          'start the next cycle with `ac milestone new`',
      );
    }
    mkdirSync(phasesArchive, { recursive: true });

    // the snapshot records what this milestone actually held, not the next one's plans; a
    // phase added to an already-closed milestone later is appended, never a replacement
    const kept = previous && Array.isArray(previous.phases)
      ? previous.phases.filter((ph) => !mine.some((x) => x.slug === ph.slug))
      : [];
    // `closed_at` is the future anchor `lib/harvest.mjs` reads as the ADR window's
    // lower bound for the NEXT milestone's sweep — without it, an archive predating
    // this stamp has no honest "since" and the sweep must say so (ADR-043/054) rather
    // than guess. Stamped once, here, never touched by a later re-close.
    const snapshotRm = {
      ...rm,
      phases: [...kept, ...mine],
      closed_at: new Date().toISOString(),
      adr_watermark: currentAdrWatermark(root),
    };
    atomicWriteJSON(snapshotFile, snapshotRm);
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
