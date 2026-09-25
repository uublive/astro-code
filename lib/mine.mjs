// The transcript miner engine (P5/P6/P8, D2/D4/D6, phase 26 revision R1, ADR-064): hands
// the `/astro-mine` agent a bounded batch of the turns the human actually typed, and
// routes exact store matches to sightings — the same "the machine only proposes"
// (ADR-058) contract phase 24's `proposePrinciple` already keeps.
//
// ## R1: this module judges no MEANING (ADR-064)
//
// Two verify rounds showed that every word-list grouping breaks on the next phrasing
// ("don't"/"dont", "X not Y" vs "prefer X over Y") and on the next language (an Italian
// cue list says nothing about German). The reasoning agent already in the loop handles
// meaning in any language, so everything semantic moved there: which turn is a steer,
// which turns state the same instruction, which are opposites, what is an explicit rule,
// how many distinct sessions a group spans, whether it qualifies, and which 10 are
// strongest. What stays here is only what is deterministic and testable without a
// model — and nothing in this file drops or merges a turn because of the words in it:
//
//   - which turns the human typed (`lib/transcripts.mjs`, D2 — structure, not words);
//   - redaction (`lib/redact.mjs`, fixed credential shapes);
//   - an EXACT-normalised collapse (`collapseKey`: NFKC, lowercase, whitespace runs
//     folded, trimmed — symbols and punctuation KEPT): identical-after-normalising turns
//     become one item carrying the union of their sessions, because handing the agent the
//     same "No." forty times is noise, not evidence — the session list keeps the evidence;
//   - exact store matches → `sightings[]` (ADR-058/061, unchanged);
//   - pointer-only carry-over and a per-sweep batch budget (below).
//
// ## D3 split: `ac` extracts, the agent lifts
//
// This module never writes a principle. It reads transcripts, and writes only a
// pointer-only run record (`lib/minestate.mjs`). `/astro-mine` is the one that groups,
// qualifies and runs `ac principles add … --propose`, following
// `templates/principle-capture.md` — the boundary phase 23 drew for every capture moment.
//
// ## Why an exact store match becomes a sighting and never an item (ADR-058, C8)
//
// `lib/principlematch.mjs`'s `findCandidates` already answers "does the store already say
// this" with the exact-equality test `proposePrinciple` uses for its own dedupe. A turn
// that exactly restates a REJECTED entry must never be re-offered as if it were new — the
// literal case ADR-058/D2 exists to prevent — so a hit goes straight to `sight` material.
// That is equality, not meaning, so it stays deterministic here.
//
// ## Why carry-over is by pointer, and why the agent names what to keep (R1, C3/C4/C7)
//
// Recurrence ACROSS sweeps still has to be judgeable: a one-off steer in sweep 1 that
// recurs in sweep 2 must be seen twice. Only the agent knows which turns were steers, so
// `advance(…, { keep })` takes the item ids it names, and those items' POINTERS (file +
// byte offsets, never text — C3) are re-read and handed over again with `earlier: true`.
// Turns beyond the batch budget are carried the same way without the agent asking, so
// nothing handed over or held back is ever lost (C7).
//
// ## Why a batch budget
//
// A first sweep over months of sessions can hold thousands of human turns; dumping them
// all into one agent turn blows its context. `MINE_BATCH` items and `MINE_BATCH_CHARS`
// characters bound one sweep; the overflow is recorded as held pointers and `remaining`
// tells the agent (and the user, via "N more turns — run again") how much is left.
//
// ## Why `MINE_CAP` is still exported (D6, single source)
//
// `templates/principle-capture.md` states "at most 10 per sweep" for the agent to apply;
// the engine no longer ranks, but `tests/mine.test.mjs` still pins this constant to the
// spec's number so the one place a caller could read the cap from cannot drift from it.
import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { sessionFiles, scanSession, readLines, classifyClaudeLine, classifyCodexLine } from './transcripts.mjs';
import { readFilesState, readSteers, writeRun, advance as advanceMinestate } from './minestate.mjs';
import { findCandidates, pickExactTarget } from './principlematch.mjs';
import { redactSecrets } from './redact.mjs';
import { loadPrinciples } from './principles.mjs';
import { transcriptSlug } from '../hooks/_astro-ctx.mjs';

/** The spec's proposals-per-sweep cap (applied by the agent; pinned to the spec by a test). */
export const MINE_CAP = 10;
/** Most items one sweep hands the agent. */
export const MINE_BATCH = 150;
/** Most characters (item text + context) one sweep hands the agent. */
export const MINE_BATCH_CHARS = 60000;
/** Most sightings one sweep hands the agent; the rest are held like budget overflow. */
export const MINE_SIGHTINGS = 20;

const TEXT_MAX = 500;
const CONTEXT_MAX = 300;
// Sessions (and pointers, one per session) kept per item: enough for the agent to count
// distinct-session recurrence well past the ≥2 threshold, bounded so a "No." typed in
// every session of a year cannot bloat the run record.
const SESSIONS_MAX = 20;

function cap(s, n, { tail = false } = {}) {
  const str = String(s ?? '');
  if (str.length <= n) return str;
  return tail ? str.slice(str.length - n) : str.slice(0, n);
}

function slugForFile(info) {
  if (info.host === 'claude') {
    // <projectsDir>/<slug>/<session>.jsonl — the directory name IS the slug.
    return basename(dirname(info.file));
  }
  return info.cwd ? transcriptSlug(info.cwd) : 'default';
}

function readOneLine(file, start) {
  for (const line of readLines(file, { start })) {
    if (line.oversized || line.start !== start) return null;
    try { return JSON.parse(line.text); } catch { return null; }
  }
  return null;
}

/** Re-read one carried pointer's line and re-classify it, or `null` if it no longer reads as a human turn. */
function reReadPointer(ptr) {
  const obj = readOneLine(ptr.file, ptr.start);
  if (!obj) return null;
  const r = ptr.host === 'codex' ? classifyCodexLine(obj) : classifyClaudeLine(obj);
  if (r.kind !== 'human') return null;
  return r.text;
}

/** Re-read the assistant turn a carried pointer recorded as its context, or `''`. */
function reReadContext(ptr) {
  if (ptr.ctxStart == null || ptr.ctxStart >= ptr.start) return '';
  const obj = readOneLine(ptr.file, ptr.ctxStart);
  if (!obj) return '';
  const r = ptr.host === 'codex' ? classifyCodexLine(obj) : classifyClaudeLine(obj);
  return r.kind === 'assistant' ? r.text : '';
}

function mkSweepId() {
  return `mine-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function pointerOf(info, turn) {
  return { file: info.file, host: info.host, session: info.session, start: turn.start, end: turn.end, ctxStart: turn.ctxStart, ctxEnd: turn.ctxEnd };
}

/**
 * The miner's own collapse key: NFKC, lowercase, whitespace runs folded to one space,
 * trimmed — and nothing else. Symbols and punctuation are KEPT on purpose.
 *
 * Phase 24's `normaliseStatement` strips every non-letter/non-digit, which is right for
 * store dedupe (a principle's wording, not its punctuation, is its identity) but wrong
 * here: it folded "always use === not ==" and "always use == not ===" into the same key,
 * so two OPPOSITE instructions from two sessions reached the agent as one item carrying
 * both sessions — a merge on words, exactly what ADR-064 forbids this module (C4,
 * remediate-r2). `normaliseStatement` itself stays untouched; store sightings still go
 * through `findCandidates`.
 */
export function collapseKey(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** `collapseKey` minus sentence-ending punctuation at the very END — never meaning. */
export function storeKey(s) {
  return collapseKey(s).replace(/[\s.!?…]+$/u, '');
}

/**
 * Collapse occurrences whose redacted text is identical after `collapseKey` —
 * equality only, never similarity (ADR-053/061) — keeping first-seen order, the union of
 * sessions and one pointer per session.
 */
function collapse(occurrences) {
  const map = new Map();
  for (const occ of occurrences) {
    const key = collapseKey(occ.text);
    let item = map.get(key);
    if (!item) {
      item = { key, occurrences: [], sessions: new Set(), pointers: [], earlier: false, at: null };
      map.set(key, item);
    }
    item.occurrences.push(occ);
    item.earlier = item.earlier || !!occ.earlier;
    if (occ.at && (!item.at || occ.at < item.at)) item.at = occ.at;
    if (occ.session && !item.sessions.has(occ.session) && item.sessions.size < SESSIONS_MAX) {
      item.sessions.add(occ.session);
      item.pointers.push(occ.pointer);
    }
  }
  return [...map.values()];
}

/**
 * Read-only towards the watermark (P1/P6): scans in-scope session files from their
 * recorded offset, re-reads carried pointers, collapses exact-identical turns, routes
 * exact store matches to sightings, bounds the batch, and writes only a pointer-only run
 * record. Never mutates `files/<slug>.json` or `steers.json` — only `advanceSweep` commits.
 */
export async function sweep({ scope = { mode: 'project', roots: [] }, rescan = false, storeDir, env = process.env } = {}) {
  const files = sessionFiles({ roots: scope.roots || [], all: scope.mode === 'all', env });

  const skipped = { malformed: 0, unrecognised: 0, oversized: 0, stalePending: 0 };
  const filesOut = {};
  const fresh = [];
  const infoByFile = new Map();
  let sessionsHeadless = 0;
  let hadNewBytes = rescan && files.length > 0;

  for (const info of files) {
    infoByFile.set(info.file, info);
    const slug = slugForFile(info);
    const state = readFilesState(storeDir, slug);
    const prior = state.files[info.file] || { offset: 0, ctxOffset: 0 };
    const startOffset = rescan ? 0 : (prior.offset || 0);
    const ctxStart = rescan ? 0 : (prior.ctxOffset || 0);

    const result = scanSession({ file: info.file, host: info.host, start: startOffset, ctxStart });
    skipped.malformed += result.skipped.malformed;
    skipped.unrecognised += result.skipped.unrecognised;
    skipped.oversized += result.skipped.oversized;

    let end = result.end;
    if (result.headless) {
      try { end = statSync(info.file).size; } catch { /* keep result.end */ }
    }
    if (end > startOffset) hadNewBytes = true;
    filesOut[info.file] = { offset: end, ctxOffset: result.ctxOffset, headless: result.headless, host: info.host, session: info.session, slug };
    if (result.headless) sessionsHeadless++;

    for (const turn of result.turns) {
      const text = redactSecrets(turn.text);
      // Empty/whitespace-only turns carry nothing to judge — the only drop this module
      // makes on content, and it is not a word test.
      if (!text.trim()) continue;
      fresh.push({
        text, context: redactSecrets(turn.context || ''), session: info.session, host: info.host,
        project: info.cwd ? basename(info.cwd) : undefined,
        pointer: pointerOf(info, turn), earlier: false,
      });
    }
  }

  // Carried turns: only those whose file this sweep's scope covers (C1 — a `--rescan` in
  // one project must never re-offer another project's kept turns).
  const { pending } = readSteers(storeDir);
  const inScope = pending.filter((p) => p.pointers.some((ptr) => infoByFile.has(ptr.file)));
  const carried = [];
  let heldCarried = 0;
  for (const p of inScope) {
    if (p.reason === 'held') heldCarried++;
    let any = false;
    for (const ptr of p.pointers) {
      if (!infoByFile.has(ptr.file)) continue;
      const raw = reReadPointer(ptr);
      if (raw == null) continue;
      const text = redactSecrets(raw);
      if (!text.trim()) continue;
      any = true;
      const info = infoByFile.get(ptr.file);
      carried.push({
        text, context: redactSecrets(reReadContext(ptr)), session: ptr.session, host: ptr.host,
        project: info?.cwd ? basename(info.cwd) : undefined,
        pointer: ptr, earlier: true, at: p.at,
      });
    }
    if (!any) skipped.stalePending++;
  }

  // A kept turn cannot gain a recurrence without new material, so kept-only carry-over
  // with no new bytes is still "nothing new" (C6); budget-held turns are unfinished
  // work and always make a sweep worth running.
  if (!hadNewBytes && heldCarried === 0) {
    return {
      sweep: null, scope, nothingNew: true,
      sessions: { scanned: files.length, headless: sessionsHeadless },
      items: [], sightings: [], remaining: 0, skipped,
    };
  }

  // Carried first, so the oldest held-back turns are never starved by a busy new week.
  const collapsed = collapse([...carried, ...fresh]);

  const { entries } = loadPrinciples(storeDir);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const sightings = [];
  const sightingById = new Map();
  const heldPending = [];
  const nowIso = new Date().toISOString();
  const open = [];
  for (const item of collapsed) {
    const latest = item.occurrences[item.occurrences.length - 1];
    // Only a turn that IS a stored statement — identical after folding case, Unicode
    // form and whitespace (`collapseKey`, symbols and punctuation kept) — is sighted
    // here. Phase 24's looser equality folds symbols, so "Prefer C++ over C" or
    // "use . not ?." would be sighted against their own opposite (even a REJECTED entry)
    // and never reach the agent (phase 26 verify, C4). Everything else goes to the agent,
    // which judges meaning and can check `ac principles match` (ADR-064).
    const exact = findCandidates(entries, latest.text).exact
      .filter((m) => storeKey(byId.get(m.id)?.statement) === storeKey(latest.text));
    if (!exact.length) { open.push(item); continue; }
    const target = pickExactTarget(exact);
    // Two items that differ only in punctuation ("… lockfiles." / "… lockfiles") stay
    // apart as ITEMS (collapseKey keeps symbols) yet can hit the SAME store entry under
    // phase 24's looser equality. That is one entry, so one sighting with the union of
    // sessions — keyed on the entry id, which is identity, not meaning.
    const already = sightingById.get(target.id);
    if (already) {
      already.sessions = [...new Set([...already.sessions, ...item.sessions])].sort();
      continue;
    }
    if (sightings.length >= MINE_SIGHTINGS) {
      heldPending.push({ reason: 'held', at: item.at || nowIso, pointers: item.pointers });
      continue;
    }
    const sighting = {
      id: target.id, status: target.status, ...(target.reason !== undefined ? { reason: target.reason } : {}),
      fromSession: latest.session, fromRef: `transcript ${latest.host}:${latest.session}`,
      excerpt: cap(latest.text, TEXT_MAX),
      sessions: [...item.sessions].sort(),
    };
    sightings.push(sighting);
    sightingById.set(target.id, sighting);
  }

  const items = [];
  const runItems = {};
  let chars = 0;
  for (const item of open) {
    const latest = item.occurrences[item.occurrences.length - 1];
    const text = cap(latest.text, TEXT_MAX);
    const context = cap(latest.context || '', CONTEXT_MAX, { tail: true });
    const size = text.length + context.length;
    const fits = items.length < MINE_BATCH && (items.length === 0 || chars + size <= MINE_BATCH_CHARS);
    if (!fits) {
      heldPending.push({ reason: 'held', at: item.at || nowIso, pointers: item.pointers });
      continue;
    }
    chars += size;
    const id = `t${items.length + 1}`;
    items.push({
      id, text, context,
      sessions: [...item.sessions].sort(),
      host: latest.host,
      project: latest.project,
      fromSession: latest.session,
      fromRef: `transcript ${latest.host}:${latest.session}`,
      earlier: item.earlier,
    });
    runItems[id] = { at: item.at || nowIso, pointers: item.pointers };
  }

  const id = mkSweepId();
  writeRun(storeDir, { id, files: filesOut, items: runItems, held: heldPending });

  return {
    sweep: id,
    scope,
    nothingNew: false,
    sessions: { scanned: files.length, headless: sessionsHeadless },
    items,
    sightings,
    remaining: heldPending.length,
    skipped,
  };
}

/** Commit a sweep's material into the watermark, carrying the `keep` item ids forward (P6, D4, R1). */
export async function advanceSweep({ storeDir, id, keep = [] }) {
  return advanceMinestate(storeDir, id, { keep });
}
