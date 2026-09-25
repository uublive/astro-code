// The transcript miner's watermark + run-record store (P6, D4/D6, phase 26).
//
// ## Why under the store's `.local/` (no new ADR-057 exception)
//
// `lib/principlesync.mjs` already gitignores `.local/` (phase 22, `GITIGNORE`) and uses it
// as the per-machine, never-synced home for the usage log (phase 25). This module reuses
// that same directory rather than carving out a new home-dir exception: the watermark and
// run records are exactly the kind of machine-local bookkeeping `.local/` already exists
// for, and a second gitignored root would just be the same promise stated twice.
//
// ## Why pointers, never text (C3)
//
// A carried turn (budget-held, or kept by the agent — R1) is re-read from its pointer
// (file/offset) the next time it is swept — nothing here ever needs to remember what a
// turn SAID, only where it was typed. `writeRun`/`writeSteers` whitelist every field they
// persist for exactly this reason: a caller that accidentally attaches a text field (the
// ADR-058/D2 "the machine only proposes" trap in miniature) must not have that field
// survive onto disk just because it happened to be on the object in memory.
//
// ## Why advance is separate from read (D4/D6)
//
// `sweep()` (lib/mine.mjs) only ever READS through this module — it can run any number of
// times with no side effect. Only `advance()` commits a sweep's material into the
// watermark, and only once every downstream call (recording sightings, proposing) has
// already succeeded — a failed lift must never mark its material swept, or the next sweep
// would silently never re-offer it.
//
// ## Why offsets only move forward
//
// A file offset is a byte watermark, not a fact that can un-happen: `advance` takes
// `Math.max` against whatever is already recorded, so a run scanning a STALE snapshot
// (already superseded by a later, larger recorded offset — two concurrent sweeps racing)
// can never rewind progress a later run already committed.
//
// ## Why pending is replaced per scope, bounded, and names only what the agent kept (R1)
//
// Every in-scope pending entry was re-read and handed over (or held again) by the run
// being advanced, so the run's own record is the complete new truth for that scope:
// `held` (budget overflow, carried without asking) plus the item ids the agent passed in
// `keep` (steers that may recur later, qualifying groups beyond the cap). Anything else
// the run handed over was proposed, sighted or judged not a steer, and must not resurface
// (C7). An unknown keep id REFUSES before anything is written — a typo must never advance
// the watermark past a turn the agent meant to keep. `PENDING_MAX` bounds the file,
// oldest first, so a cold one-off cannot make it grow forever.
//
// ## Why `seen` is gone
//
// Before R1, `seen` remembered word-list group keys across sweeps. Grouping is now the
// agent's (ADR-064) and cross-sweep recurrence rides on kept pointers, so the map is no
// longer written; an old file that still has it reads fine and loses it on next advance.
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export const PENDING_MAX = 500;
export const RUNS_KEEP = 5;

export function mineDir(storeDir) {
  return join(storeDir, '.local', 'mine');
}

function filesPath(storeDir, slug) {
  return join(mineDir(storeDir), 'files', `${slug || 'default'}.json`);
}

function steersPath(storeDir) {
  return join(mineDir(storeDir), 'steers.json');
}

function runsDir(storeDir) {
  return join(mineDir(storeDir), 'runs');
}

function runPath(storeDir, id) {
  return join(runsDir(storeDir), `${id}.json`);
}

/** `{ version, files: { <abs path>: { offset, ctxOffset, headless, host, session } } }`. */
export function readFilesState(storeDir, slug) {
  const state = readJSON(filesPath(storeDir, slug), null);
  if (!state || typeof state !== 'object' || !state.files) return { version: 1, files: {} };
  return state;
}

function writeFilesState(storeDir, slug, state) {
  atomicWriteJSON(filesPath(storeDir, slug), state);
}

/** `{ version, pending: [{ reason: 'held'|'kept', at, pointers }] }` — a pre-R1 file's `seen` is ignored. */
export function readSteers(storeDir) {
  const state = readJSON(steersPath(storeDir), null);
  if (!state || typeof state !== 'object') return { version: 2, pending: [] };
  const pending = Array.isArray(state.pending) ? state.pending : [];
  return {
    version: 2,
    pending: pending
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({ ...p, pointers: Array.isArray(p.pointers) ? p.pointers : [] })),
  };
}

export function writeSteers(storeDir, state) {
  mkdirSync(mineDir(storeDir), { recursive: true });
  atomicWriteJSON(steersPath(storeDir), {
    version: 2,
    pending: (state.pending || []).map(whitelistPending),
  });
}

function whitelistPointer(p) {
  const { file, host, session, start, end, ctxStart, ctxEnd } = p || {};
  return { file, host, session, start, end, ctxStart, ctxEnd };
}

// A pre-R1 pending entry has no `reason`; it was a held-back ranked group, but the ranking
// that held it is gone, so it is carried as `kept` (re-offered with new material, never
// by itself forcing a sweep).
function whitelistPending(item) {
  const { reason, at, pointers } = item || {};
  return {
    reason: reason === 'held' ? 'held' : 'kept',
    at: typeof at === 'string' ? at : undefined,
    pointers: Array.isArray(pointers) ? pointers.map(whitelistPointer) : [],
  };
}

function whitelistItem(item) {
  const { at, pointers } = item || {};
  return {
    at: typeof at === 'string' ? at : undefined,
    pointers: Array.isArray(pointers) ? pointers.map(whitelistPointer) : [],
  };
}

function whitelistFileEntry(entry) {
  const { offset, ctxOffset, headless, host, session, slug } = entry || {};
  return {
    offset: offset || 0, ctxOffset: ctxOffset || 0, headless: !!headless, host, session, slug,
  };
}

/** Persist a sweep's run record (only whitelisted fields ever reach disk — C3). */
export function writeRun(storeDir, run) {
  mkdirSync(runsDir(storeDir), { recursive: true });
  const record = {
    id: run.id,
    files: Object.fromEntries(Object.entries(run.files || {}).map(([p, e]) => [p, whitelistFileEntry(e)])),
    items: Object.fromEntries(Object.entries(run.items || {}).map(([k, v]) => [k, whitelistItem(v)])),
    held: (run.held || []).map((h) => whitelistPending({ ...h, reason: 'held' })),
  };
  atomicWriteJSON(runPath(storeDir, run.id), record);
  pruneRuns(storeDir);
}

function pruneRuns(storeDir) {
  const dir = runsDir(storeDir);
  let names;
  try { names = readdirSync(dir); } catch { return; }
  const withMtime = names
    .filter((n) => n.endsWith('.json'))
    .map((n) => ({ n, mtime: statSync(join(dir, n)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime);
  const excess = withMtime.length - RUNS_KEEP;
  for (let i = 0; i < excess; i++) rmSync(join(dir, withMtime[i].n), { force: true });
}

/** Read a run record by id, or `null` if absent/already advanced. */
export function readRun(storeDir, id) {
  return readJSON(runPath(storeDir, id), null);
}

/** Keep the newest `max` pending entries (by `at`; entries with no `at` count as oldest). */
function boundPending(pending, max = PENDING_MAX) {
  if (pending.length <= max) return pending;
  const order = pending.map((p, i) => ({ p, i })).sort((x, y) => {
    const ax = x.p.at || '';
    const ay = y.p.at || '';
    if (ax !== ay) return ax < ay ? -1 : 1;
    return x.i - y.i;
  });
  const drop = new Set(order.slice(0, pending.length - max).map((o) => o.i));
  return pending.filter((_, i) => !drop.has(i));
}

/**
 * Commit a sweep's material into the watermark (P6, D4, R1), carrying the items named in
 * `keep` forward as pointers. Runs under one lock so concurrent sweeps on distinct ids
 * never interleave their writes. An unknown keep id throws before anything is written.
 */
export async function advance(storeDir, id, { keep = [] } = {}) {
  mkdirSync(mineDir(storeDir), { recursive: true });
  return withLock(join(mineDir(storeDir), '.lock'), () => {
    const run = readRun(storeDir, id);
    if (!run) throw new Error(`unknown or already-advanced sweep "${id}"`);

    const items = run.items && typeof run.items === 'object' ? run.items : {};
    const keepIds = [...new Set((keep || []).map((k) => String(k).trim()).filter(Boolean))];
    const unknown = keepIds.filter((k) => !Object.prototype.hasOwnProperty.call(items, k));
    if (unknown.length) {
      throw new Error(`unknown item id${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')} in sweep "${id}" — nothing was advanced`);
    }

    // Offsets only move forward, bucketed per project slug (default bucket when the
    // caller didn't scope by project).
    const bySlug = new Map();
    for (const [file, entry] of Object.entries(run.files || {})) {
      const slug = entry.slug || 'default';
      if (!bySlug.has(slug)) bySlug.set(slug, readFilesState(storeDir, slug));
      const state = bySlug.get(slug);
      const prior = state.files[file] || { offset: 0, ctxOffset: 0 };
      state.files[file] = {
        offset: Math.max(prior.offset || 0, entry.offset || 0),
        ctxOffset: Math.max(prior.ctxOffset || 0, entry.ctxOffset || 0),
        headless: entry.headless,
        host: entry.host,
        session: entry.session,
      };
    }
    for (const [slug, state] of bySlug) writeFilesState(storeDir, slug, { version: 1, files: state.files });

    // Pending: this scope's entries are replaced by what the run held back plus what the
    // agent kept; other scopes' entries are untouched.
    const scanned = new Set(Object.keys(run.files || {}));
    const { pending } = readSteers(storeDir);
    const outOfScope = pending.filter((p) => !p.pointers.some((ptr) => scanned.has(ptr.file)));
    const kept = keepIds.map((k) => ({ reason: 'kept', at: items[k].at, pointers: items[k].pointers }));
    const newPending = boundPending([...outOfScope, ...(run.held || []), ...kept]);

    writeSteers(storeDir, { pending: newPending });
    rmSync(runPath(storeDir, id), { force: true });
    return { ok: true, kept: keepIds.length, pending: newPending.length };
  });
}
