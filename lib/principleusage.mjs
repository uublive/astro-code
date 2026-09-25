// The usage log (P8, phase 25 CONTEXT D4): who served/cited which principle, when.
//
// ## Why `.local/` — per-machine, never synced, and deliberately deferred
// `.local/` is already in the store's `.gitignore` (phase 22), so the log stays
// per-machine by construction — an append-only file is NOT merge-safe under git
// without phase-24-style reconciliation (sightings), and that reconciliation is
// deferred on purpose rather than built twice.
//
// ## Why ids only, never a statement (ADR-057/C11)
// The log exists to answer "was this served/cited", not to carry a second copy of
// personal principle text into a file with looser handling than the entries
// themselves — an id is enough to look the entry up.
//
// ## Why served AND cited
// Served-often-never-cited is the actionable signal: a principle kept showing up in
// shortlists but an agent never said it applied one — either it's noise (too broad
// a scope) or agents are ignoring it. Served-once, cited-once looks identical to
// unused if only citations were counted.
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLock } from './util.mjs';

export const IGNORED_MIN_SERVES = 2;

/** `<dir>/.local/usage.jsonl` — the one place this module builds that path. */
export function usageFile(dir) {
  return join(dir, '.local', 'usage.jsonl');
}

/**
 * Append usage events (P8). A failed append is the caller's problem to report (never
 * thrown here as fatal to the command it rides on — see lib/retrieval.mjs); an empty
 * `events` array against an absent `dir` creates nothing.
 *
 * @param {string} dir the principle store dir
 * @param {{ event: 'served'|'cited', id: string, by: string, stage: string, project: string }[]} events
 * @param {{ now?: Date }} [opts]
 */
export async function recordUsage(dir, events, { now = new Date() } = {}) {
  if (!events || !events.length) return;
  const local = join(dir, '.local');
  mkdirSync(local, { recursive: true });
  const file = usageFile(dir);
  const lines = events.map((e) => JSON.stringify({
    at: now.toISOString(), event: e.event, id: e.id, by: e.by, stage: e.stage, project: e.project,
  })).join('\n') + '\n';
  return withLock(join(local, '.lock'), () => {
    appendFileSync(file, lines);
  });
}

/**
 * Read the log, skipping malformed lines (counted, never thrown).
 *
 * @param {string} dir
 * @returns {{ events: object[], ignored: number }}
 */
export function readUsage(dir) {
  const file = usageFile(dir);
  if (!existsSync(file)) return { events: [], ignored: 0 };
  const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const events = [];
  let ignored = 0;
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj || typeof obj !== 'object' || !obj.id || !obj.event) { ignored += 1; continue; }
      events.push(obj);
    } catch {
      ignored += 1;
    }
  }
  return { events, ignored };
}

/**
 * The review surface (P8): `ignored` = served >= IGNORED_MIN_SERVES and never cited;
 * `unused` = never served. Scoped to `accepted` entries the caller passes in.
 *
 * @param {{ id: string }[]} accepted
 * @param {object[]} events
 * @returns {{ ignored: { id: string, served: number, lastServed: string }[], unused: { id: string }[] }}
 */
export function usageReport(accepted, events) {
  const served = new Map();
  const cited = new Set();
  for (const e of events) {
    if (e.event === 'served') {
      const cur = served.get(e.id) || { count: 0, last: null };
      cur.count += 1;
      if (!cur.last || e.at > cur.last) cur.last = e.at;
      served.set(e.id, cur);
    } else if (e.event === 'cited') {
      cited.add(e.id);
    }
  }

  const ignored = [];
  const unused = [];
  for (const { id } of accepted) {
    const s = served.get(id);
    if (!s) { unused.push({ id }); continue; }
    if (s.count >= IGNORED_MIN_SERVES && !cited.has(id)) {
      ignored.push({ id, served: s.count, lastServed: s.last });
    }
  }
  return { ignored, unused };
}
