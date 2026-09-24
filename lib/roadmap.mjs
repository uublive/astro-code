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

// Enrich `rm.phases` with the disk-derived `planned` flag in memory (never persisted
// to roadmap.json) and write ROADMAP.md from that. `renderRoadmapMd(rm)` alone renders
// straight off the raw in-memory object, which has no `planned` field on ANY phase — so
// calling it directly strips `· planned` off every line the command never touched, not
// just the one it wrote. Every writer below routes through this single function so the
// fix lives once, and any future caller (like `ac backlog promote`'s addPhase) gets it
// for free instead of needing its own patch.
function writeRoadmapMd(root, rm) {
  const enriched = { ...rm, phases: rm.phases.map((p) => ({ ...p, planned: isPhasePlanned(root, p.slug) })) };
  atomicWriteText(paths(root).roadmapMd, renderRoadmapMd(enriched));
}

export async function setPhaseStatus(root, slug, status, extra = {}) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: 1, phases: [] };
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`no such phase: ${slug}`);
    Object.assign(ph, extra, { status });
    atomicWriteJSON(p.roadmap, rm);
    writeRoadmapMd(root, rm);

    // A phase that has moved OFF `rejected` is no longer blocked, so its blocker
    // must go with it. Found during milestone-6 UAT: a phase rejected and then
    // accepted stayed `Blockers: 1` forever, because nothing cleared it and no
    // CLI command can remove one. Only this phase's blockers are touched.
    if (status !== 'rejected') {
      const state = readJSON(p.state);
      if (state && Array.isArray(state.blockers)) {
        const kept = state.blockers.filter((b) => b && b.phase !== slug);
        if (kept.length !== state.blockers.length) {
          atomicWriteJSON(p.state, { ...state, blockers: kept, updated_at: new Date().toISOString() });
        }
      }
    }
    return ph;
  });
}

// Reject a phase from human UAT (P2, phase 23). Sets `status: 'rejected'` and
// appends one entry to `ph.rejections`, through the same lock/write/writeRoadmapMd
// path as setPhaseStatus — this is deliberately NOT built on top of setPhaseStatus,
// because that function's blocker cleanup only fires when status moves OFF
// 'rejected'; rejecting IS that move, so there is nothing to clear here.
//
// `rejections` is never trimmed or cleared by any writer, including a later
// setPhaseStatus(..., 'complete') or 'verified': the blocker on `state.json` answers
// "is this phase blocked right now" and setPhaseStatus deliberately drops it the
// moment status leaves 'rejected', but the rejection itself is history — the
// milestone sweep (D2.3/D2.4, `ac milestone harvest`) needs to see a phase that was
// rejected and later accepted, not just the phase's current state. Cleared history
// cannot recur, and recurrence is the whole point of the sweep.
//
// `kind` ('human' | 'agent') is DECLARED via the `agent` argument, never detected —
// the same ADR-033 reasoning `phase accept --agent` already applies, now symmetric
// on the reject path: a stand-in agent runs this command on the human's behalf, and
// only the caller can say which one actually made the judgement. Default is
// 'human': every rejection to date was a genuine UAT failure, and guessing 'agent'
// would retroactively cast doubt on records that are correct.
export async function rejectPhase(root, slug, { reason, agent, now } = {}) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: 1, phases: [] };
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`no such phase: ${slug}`);
    // `agent` is DECLARED, not merely truthy: `undefined`/`null` means the caller never
    // passed `--agent` at all (kind 'human'), while `true` (a bare `--agent`, no name) and
    // `''` (`--agent ""`, an explicitly empty name) both mean "an agent signed this, name
    // unknown" — a falsy-string check collapsed that last case back into 'human' and let a
    // stand-in agent's rejection masquerade as genuine human UAT.
    const isAgent = agent !== undefined && agent !== null && agent !== false;
    const entry = { reason, kind: isAgent ? 'agent' : 'human', at: now || new Date().toISOString() };
    if (typeof agent === 'string' && agent) entry.by = agent;
    ph.rejections = [...(ph.rejections || []), entry];
    ph.status = 'rejected';
    atomicWriteJSON(p.roadmap, rm);
    writeRoadmapMd(root, rm);
    return ph;
  });
}

export async function setPhaseEffort(root, slug, level) {
  const p = paths(root);
  validateEffort(level);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap);
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`phase not found: ${slug}`);
    ph.effort = level;
    atomicWriteJSON(p.roadmap, rm);
    writeRoadmapMd(root, rm);
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
    writeRoadmapMd(root, rm);
    return ph;
  });
}

// Correct which milestone a phase belongs to. Mirrors setPhaseEffort/setPhaseNote:
// additive field, same lock, every other byte of the roadmap untouched — and in
// particular `rm.milestone` is NOT touched, for the same reason addPhase no longer
// touches it.
//
// This exists because without it a wrong assignment was permanent (issue #16): the
// number is already spent in the shared registry so the phase cannot be removed and
// re-added, no subcommand moved a phase, and `AGENTS.md` forbids hand-editing
// roadmap.json. The tool could reach a state its own rules gave the operator no way to
// leave. Whatever else changes, that must not be true.
export async function setPhaseMilestone(root, slug, milestone) {
  const p = paths(root);
  const n = Number(milestone);
  // Validate BEFORE taking the lock, so a typo exits non-zero with nothing written —
  // the same write-path strictness setPhaseEffort applies to a bogus level.
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`milestone must be a positive integer, got "${milestone}"`);
  }
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap);
    const ph = rm.phases.find((x) => x.slug === slug);
    if (!ph) throw new Error(`phase not found: ${slug}`);
    ph.milestone = n;
    atomicWriteJSON(p.roadmap, rm);
    writeRoadmapMd(root, rm);
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

// Persist the active milestone number onto the roadmap.
//
// `ac milestone new` used to mutate the object returned by `loadRoadmap()` and then call
// `renderRoadmap()` — which re-reads from disk and therefore discarded the mutation. The
// bumped number reached `state.active_milestone` and never reached `roadmap.json`, so
// `ac status` and the generated `ROADMAP.md` both kept reporting the PREVIOUS milestone.
// The first `ac phase add` repaired it as a side effect (`addPhase` persists the field),
// which is why the drift was easy to miss: it healed itself the moment real work started.
//
// `completeMilestone` also picks its archive directory from this field, so a milestone
// completed before any phase was added would archive into the previous milestone's
// directory — on top of whatever is already there.
//
// Re-renders through `renderRoadmap`, not `renderRoadmapMd`, deliberately: the former
// re-reads and re-applies the disk-derived `planned` flag, and rendering from an
// in-memory object without it strips that marker off every line.
export async function setMilestone(root, number) {
  const p = paths(root);
  await withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: number, phases: [] };
    rm.milestone = number;
    atomicWriteJSON(p.roadmap, rm);
  });
  return renderRoadmap(root);
}

// Add a phase whose number was already allocated by the registry. Throws if the
// number collides locally (should not happen once the registry granted it).
//
// The phase's milestone is recorded ON THE PHASE and the project's current-milestone
// pointer (`rm.milestone`) is left alone. It used to be written here —
// `if (milestone) rm.milestone = milestone` — which meant claiming a phase FOR a future
// milestone silently moved the whole project into that milestone (issue #16). Two
// distinct failures came out of that one line:
//
//   - `ac status`, ROADMAP.md and the statusline all reported the wrong active
//     milestone, and `ac milestone complete` would archive that wrong set.
//   - It was the only writer that moved `rm.milestone` without also moving
//     `state.active_milestone`, so the two pointers drifted apart. `ac debt pay --as
//     phase` resolves its milestone as `state.active_milestone || rm.milestone`, so a
//     drifted state pointer later filed a brand-new phase into an already-COMPLETED
//     milestone. Not a separate fallback bug — the same line, one hop downstream.
//
// The line was also vestigial by the time it was reported: it existed to repair the
// drift `ac milestone new` used to leave behind (see setMilestone above), and that has
// been fixed at the source since `milestone new` started calling setMilestone itself.
//
// Scheduling work for a future milestone is a normal backlog action. Moving the project
// is `ac milestone new`. They are different intents and no longer share a writer.
export async function addPhase(root, { number, name, milestone }) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const rm = readJSON(p.roadmap) || { version: 1, milestone: milestone || 1, phases: [] };
    if (rm.phases.some((ph) => ph.number === number)) {
      throw new Error(`phase ${number} already exists in the roadmap`);
    }
    const slug = `${pad2(number)}-${slugify(name)}`;
    const phase = { number, name, slug, status: 'pending' };
    // Absent rather than guessed when the caller had no milestone to pass: every
    // roadmap written before this change has phases with no such field, and inventing
    // one here would be indistinguishable from a real assignment.
    if (milestone) phase.milestone = Number(milestone);
    rm.phases.push(phase);
    rm.phases.sort((a, b) => a.number - b.number);
    atomicWriteJSON(p.roadmap, rm);
    writeRoadmapMd(root, rm);
    mkdirSync(join(p.phases, slug), { recursive: true });
    return phase;
  });
}
