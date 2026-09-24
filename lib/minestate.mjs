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
// ## Why pointers and hashes, never text (C3)
//
// A held-back candidate's excerpt is re-read from its pointer (file/offset) the next time
// it is scanned — nothing here ever needs to remember what a steer SAID, only where it
// was seen and a hash of its normalised key. `writeRun`/`writeSteers` whitelist every
// field they persist for exactly this reason: a caller that accidentally attaches a text
// field (the ADR-058/D2 "the machine only proposes" trap in miniature) must not have that
// field survive onto disk just because it happened to be on the object in memory.
//
// ## Why advance is separate from read (D4/D6)
//
// `sweep()` (lib/mine.mjs) only ever READS through this module — it can run any number of
// times with no side effect. Only `advance()` commits a sweep's material into the
// watermark, and only once every downstream call (recording sightings, proposing
// candidates) has already succeeded — a failed lift must never mark its material swept,
// or the next sweep would silently never re-offer it.
//
// ## Why offsets only move forward
//
// A file offset is a byte watermark, not a fact that can un-happen: `advance` takes
// `Math.max` against whatever is already recorded, so a run scanning a STALE snapshot
// (already superseded by a later, larger recorded offset — two concurrent sweeps racing)
// can never rewind progress a later run already committed.
//
// ## Why `seen` exists, and why it is capped
//
// D5: a steer stated once in one sweep, then repeated in a LATER sweep's new session,
// must still qualify by recurrence — but the earlier sweep already advanced past that
// session's bytes, so the only place to remember "this key was seen in session X" across
// sweeps is `seen`. `SEEN_MAX` bounds it (oldest `at` dropped first) so an old, cold key
// cannot make this file grow forever.
import { existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export const SEEN_MAX = 5000;
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

/** `{ version, pending: [{ keyHash, explicit, sessions, pointers }], seen: { <keyHash>: { sessions, explicit, at } } }`. */
export function readSteers(storeDir) {
  const state = readJSON(steersPath(storeDir), null);
  if (!state || typeof state !== 'object') return { version: 1, pending: [], seen: {} };
  return {
    version: 1,
    pending: Array.isArray(state.pending) ? state.pending : [],
    seen: state.seen && typeof state.seen === 'object' ? state.seen : {},
  };
}

export function writeSteers(storeDir, state) {
  mkdirSync(mineDir(storeDir), { recursive: true });
  atomicWriteJSON(steersPath(storeDir), {
    version: 1,
    pending: (state.pending || []).map(whitelistPending),
    seen: state.seen || {},
  });
}

function whitelistPointer(p) {
  const { file, host, session, start, end, ctxStart, ctxEnd } = p || {};
  return { file, host, session, start, end, ctxStart, ctxEnd };
}

function whitelistPending(item) {
  const { keyHash, explicit, sessions, pointers } = item || {};
  return {
    keyHash,
    explicit: !!explicit,
    sessions: Array.isArray(sessions) ? [...sessions] : [],
    pointers: Array.isArray(pointers) ? pointers.map(whitelistPointer) : [],
  };
}

function whitelistSeenItem(item) {
  const { keyHash, sessions, explicit } = item || {};
  return { keyHash, sessions: Array.isArray(sessions) ? [...sessions] : [], explicit: !!explicit };
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
    emitted: (run.emitted || []).map(whitelistSeenItem),
    held: (run.held || []).map(whitelistPending),
    below: (run.below || []).map(whitelistSeenItem),
    sighted: (run.sighted || []).map(whitelistSeenItem),
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

function unionSorted(a, b) {
  return [...new Set([...(a || []), ...(b || [])])].sort();
}

/**
 * Commit a sweep's material into the watermark (P6, D4/D6). Runs under one lock so
 * concurrent sweeps on distinct ids never interleave their file-offset writes.
 */
export async function advance(storeDir, id) {
  mkdirSync(mineDir(storeDir), { recursive: true });
  return withLock(join(mineDir(storeDir), '.lock'), () => {
    const run = readRun(storeDir, id);
    if (!run) throw new Error(`unknown or already-advanced sweep "${id}"`);

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

    // Pending: drop anything the run's scope touched, replace with what it held back.
    const scanned = new Set(Object.keys(run.files || {}));
    const steers = readSteers(storeDir);
    const outOfScope = steers.pending.filter((p) => !p.pointers.some((ptr) => scanned.has(ptr.file)));
    const newPending = [...outOfScope, ...run.held];

    // Seen: union sessions per key across emitted/below/sighted, capped at SEEN_MAX.
    const seen = { ...steers.seen };
    const now = new Date().toISOString();
    for (const item of [...(run.emitted || []), ...(run.below || []), ...(run.sighted || [])]) {
      const prior = seen[item.keyHash];
      seen[item.keyHash] = {
        sessions: unionSorted(prior?.sessions, item.sessions),
        explicit: !!(prior?.explicit || item.explicit),
        at: now,
      };
    }
    const keys = Object.keys(seen);
    if (keys.length > SEEN_MAX) {
      const sorted = keys.sort((a, b) => (seen[a].at < seen[b].at ? -1 : seen[a].at > seen[b].at ? 1 : 0));
      for (const k of sorted.slice(0, keys.length - SEEN_MAX)) delete seen[k];
    }

    writeSteers(storeDir, { pending: newPending, seen });
    rmSync(runPath(storeDir, id), { force: true });
    return { ok: true };
  });
}
