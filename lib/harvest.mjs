// Milestone harvest (D2.4, P5): the retrospective sweep material for the milestone-close
// principle sweep. Read-only, by design — the moments that PROPOSE are the per-phase ones
// (D2.1-3); this module only gathers what they might have missed, for a human-attended
// `ac milestone complete` to sweep once, at the end.
//
// Why the archive is the source of truth once a milestone has closed: `completeMilestone`
// clears `state.blockers` for every phase it archives, and archives the phase directories
// out from under `.astrocode/phases/`. Reading the LIVE roadmap/state for a milestone that
// has already closed would see neither the phases nor their blockers — the very data this
// sweep exists to read. The snapshot under `.astrocode/milestones/<n>/` is what survived.
//
// Why agent-authored material is filtered HERE, once, instead of trusted to the prose in
// `astro-complete-milestone.md`: D6/ADR-058 — an agent's answers, rejections or discussion
// are not the human's stated preferences, and "the command should remember to exclude
// them" is exactly the bet ADR-036 says eventually loses. `skipped` reports the count
// rather than silently dropping it, so an attended sweep can tell "nothing recurred" from
// "most of this milestone's record was agent-run".
//
// Why an unknown ADR window refuses rather than guesses (ADR-043/054: unknown is not
// empty): the lower bound comes from the PREVIOUS milestone's close, and if that snapshot
// predates `closed_at` (issue #64-era archives) and every one of its phases predates
// `accepted_at` too, there is no honest anchor — reporting `adrs: []` there would read as
// "nothing decided last milestone", which may simply be false. `adrWindow: null` says "not
// checked" instead of asserting a possibly-wrong empty.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON } from './util.mjs';
import { loadRoadmap } from './roadmap.mjs';
import { belongsToMilestone } from './milestone.mjs';
import { CONTEXT_MARKER, contextAuthor } from './planning.mjs';
import { SURPRISES_FILE, readSurprises } from './surprises.mjs';
import { parseDecisionEntries, decisionStatus, decisionTitle } from './decisions.mjs';

// A CONTEXT.md's status for the sweep — deliberately narrower than
// `phaseContextStatus` (which resolves a LIVE phase's path via `paths(root)`): an
// archived phase's CONTEXT.md lives under `milestones/<n>/phases/<slug>/` instead, so
// this reads whatever absolute file it is handed rather than re-deriving the path.
// Reuses the same two provenance primitives `phaseContextStatus` is built on
// (`CONTEXT_MARKER`, `contextAuthor`) so "what counts as captured/agent-authored"
// stays defined in exactly one place (lib/planning.mjs).
function contextProvenance(file) {
  if (!existsSync(file)) return 'missing';
  const text = readFileSync(file, 'utf8');
  const author = contextAuthor(text);
  if (author !== null) return 'agent';
  return text.includes(CONTEXT_MARKER) ? 'human' : 'stub';
}

// Extract an ADR entry's `_YYYY-MM-DD_` date line — the same stamp
// `lib/decisions.mjs` `normalizeDecision` strips for identity, read here instead of
// discarded.
function decisionDate(entry) {
  const m = String(entry).match(/^_(\d{4}-\d{2}-\d{2})(?:\s*·.*)?_\s*$/m);
  return m ? m[1] : null;
}

function decisionWhy(entry) {
  const m = String(entry).match(/\*\*Why:\*\*\s*(.+)/);
  return m ? m[1].trim() : '';
}

// The highest archived milestone snapshot strictly numbered below `n`, or null when
// none exists (the first milestone IS the history — nothing came before it).
function priorArchive(root, n) {
  const dir = join(paths(root).dir, 'milestones');
  if (!existsSync(dir)) return null;
  const nums = readdirSync(dir)
    .map((name) => Number(name))
    .filter((num) => Number.isInteger(num) && num < n);
  if (nums.length === 0) return null;
  const prev = Math.max(...nums);
  const snapshot = readJSON(join(dir, String(prev), 'roadmap.json'));
  return snapshot ? { number: prev, snapshot } : null;
}

// The lower-bound anchor for the ADR window: the previous milestone's `closed_at`
// stamp, falling back to the latest `accepted_at` among its phases when the snapshot
// predates the stamp (issue #64-era archives). `since: null` distinguishes "checked,
// no earlier milestone" from the anchor being genuinely unknown (caller's job).
function resolveSince(root, n) {
  const prior = priorArchive(root, n);
  if (!prior) return { since: null };
  if (prior.snapshot.closed_at) return { since: prior.snapshot.closed_at };
  const accepted = (prior.snapshot.phases || [])
    .map((ph) => ph.accepted_at)
    .filter(Boolean)
    .sort();
  if (accepted.length) return { since: accepted[accepted.length - 1] };
  return { since: undefined }; // neither timestamp — the "unknown" case
}

/**
 * Gather the sweep material `ac milestone complete` (and `ac milestone harvest`) reads
 * for milestone `n` (default: the live roadmap's current milestone). Pure read — never
 * mutates roadmap, state, or the principle store.
 *
 * @param {string} root
 * @param {number} [n]
 * @returns {{ milestone: number, source: 'live'|'archive',
 *   adrWindow: { since: string|null } | null, adrs: { id, title, date, why }[],
 *   contexts: { phase, file }[], rejections: { phase, reason, at }[],
 *   surprises: { phase, at, signals, note }[],
 *   skipped: { agentContexts, agentRejections, damagedSurprises } }}
 */
export function milestoneHarvest(root, n) {
  const p = paths(root);
  const live = loadRoadmap(root);
  const milestone = n == null ? live.milestone : Number(n);

  const archiveDir = join(p.dir, 'milestones', String(milestone));
  const archiveRoadmap = join(archiveDir, 'roadmap.json');

  let source, phases, phaseDir, ownClosedAt;
  if (existsSync(archiveRoadmap)) {
    const snapshot = readJSON(archiveRoadmap);
    source = 'archive';
    phases = snapshot.phases || [];
    phaseDir = (slug) => join(archiveDir, 'phases', slug);
    ownClosedAt = snapshot.closed_at || null;
  } else if (milestone === live.milestone) {
    source = 'live';
    phases = live.phases.filter((ph) => belongsToMilestone(ph, milestone));
    phaseDir = (slug) => join(p.phases, slug);
    ownClosedAt = null;
  } else {
    throw new Error(`milestone ${milestone} is neither current nor archived`);
  }

  const contexts = [];
  const rejections = [];
  const surprises = [];
  const skipped = { agentContexts: 0, agentRejections: 0, damagedSurprises: 0 };

  for (const ph of phases) {
    const dir = phaseDir(ph.slug);

    const status = contextProvenance(join(dir, 'CONTEXT.md'));
    if (status === 'human') contexts.push({ phase: ph.slug, file: join(dir, 'CONTEXT.md') });
    else if (status === 'agent') skipped.agentContexts++;

    for (const r of ph.rejections || []) {
      if (r.kind === 'agent') skipped.agentRejections++;
      else rejections.push({ phase: ph.slug, reason: r.reason, at: r.at });
    }

    const { entries, damaged } = readSurprises(join(dir, SURPRISES_FILE));
    skipped.damagedSurprises += damaged;
    for (const s of entries) {
      surprises.push({ phase: ph.slug, at: s.at, signals: s.signals, note: s.note });
    }
  }

  // ADR window: honest "not checked" (ADR-043/054) beats a guessed empty — see the
  // module header for why the "neither timestamp" case below is not simply `[]`.
  const { since } = resolveSince(root, milestone);
  let adrWindow, adrs;
  if (since === undefined) {
    adrWindow = null;
    adrs = [];
  } else {
    adrWindow = { since };
    const sinceDay = since ? since.slice(0, 10) : null;
    const untilDay = ownClosedAt ? ownClosedAt.slice(0, 10) : null;
    const decisionsText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
    adrs = parseDecisionEntries(decisionsText)
      .filter((e) => decisionStatus(e.text).state === 'live')
      .map((e) => ({ id: e.id, title: decisionTitle(e.text), date: decisionDate(e.text), why: decisionWhy(e.text) }))
      .filter((e) => e.date != null)
      .filter((e) => (sinceDay ? e.date >= sinceDay : true))
      .filter((e) => (untilDay ? e.date <= untilDay : true));
  }

  return { milestone, source, adrWindow, adrs, contexts, rejections, surprises, skipped };
}
