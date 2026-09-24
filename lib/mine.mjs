// The transcript miner engine (P5/P6/P8, D2/D5/D6, phase 26): turns steer sentences an
// agent kept hearing into ranked, redacted candidates, and dedupes against the store's
// own exact matches — the same "the machine only proposes" (ADR-058) contract phase 24's
// `proposePrinciple` already keeps.
//
// ## D3 split: `ac` extracts, the agent lifts
//
// This module never writes a principle. It reads transcripts (`lib/transcripts.mjs`),
// groups and ranks what recurs, and writes only a pointer-only run record
// (`lib/minestate.mjs`). `/astro-mine` is the one that runs `ac principles add …
// --propose` per candidate, following `templates/principle-capture.md`'s lift rule —
// exactly the boundary phase 23 already drew for every other capture moment.
//
// ## Why the group key is one function over token sets + polarity, never a similarity
// score (ADR-053)
//
// `lib/principlematch.mjs` already settled "strict equality or a shared-token list,
// never a float" for the store's own dedupe, for the reason its header gives: a score
// nobody can act on, and a threshold that silently merges two different principles.
// `steerKey` reuses that module's `statementTokens` for the same reason — one already-
// proven, already-tested tokenizer — and adds only what a plain shared-token match would
// get wrong here: `statementTokens` treats `always`/`never`/`not`/`no` as stopwords (they
// generically open a rule), which is correct for matching a NEW statement against the
// store but wrong for grouping steers, where "always run the linter" and "never run the
// linter" are opposite instructions that must never collapse into one group. Polarity is
// therefore tracked separately and appended to the key.
//
// ## Why recurrence counts distinct SESSIONS, not occurrences
//
// A steer repeated three times in the same rambling session is one data point about that
// session, not three independent confirmations — D2's whole premise is that a principle
// worth keeping is one a developer restated ACROSS separate moments of work.
//
// ## Why an exact store match becomes a sighting and never a candidate (ADR-058, C8)
//
// `lib/principlematch.mjs`'s `findCandidates` (phase 24) already answers "does the store
// already say this" with the same exact-equality test `proposePrinciple` uses for its own
// dedupe. A steer that exactly restates a REJECTED entry must never be re-offered as if
// it were new — that is the literal case ADR-058/D2 exists to prevent — so this module
// runs the same exact check and routes a hit straight to `ac principles sight` material,
// never to `candidates[]`.
//
// ## Why `MINE_CAP` is guarded against the spec's own row (D6, single source)
//
// `templates/principle-capture.md` states "at most 10 per sweep" in prose for the agent
// to read; this constant is what the engine actually enforces. `tests/mine.test.mjs`
// pins them together so a future reword of one number can never silently drift from the
// other.
import { statSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { sessionFiles, scanSession, readLines, classifyClaudeLine, classifyCodexLine } from './transcripts.mjs';
import { readFilesState, readSteers, writeRun, advance as advanceMinestate } from './minestate.mjs';
import { normaliseStatement, statementTokens, findCandidates, pickExactTarget } from './principlematch.mjs';
import { redactSecrets } from './redact.mjs';
import { loadPrinciples } from './principles.mjs';
import { transcriptSlug } from '../hooks/_astro-ctx.mjs';

export const MINE_CAP = 10;

export const RULE_CUES = Object.freeze([
  'always', 'never', 'from now on', 'going forward', 'from here on', 'every time',
  'in future', 'in the future', 'as a rule',
  'sempre', 'mai', 'd ora in poi', 'da ora in poi', 'd ora in avanti', 'da adesso',
  'ogni volta', 'in futuro',
]);

export const STEER_CUES = Object.freeze([
  'no', 'don t', 'do not', 'dont', 'stop', 'instead', 'rather', 'i prefer', 'i d prefer',
  'prefer', 'not like that', 'wrong', 'shouldn t', 'should not', 'avoid',
  'non', 'invece', 'preferisco', 'preferirei', 'evita', 'smettila', 'sbagliato',
]);

export const MINE_FILLER = Object.freeze(['please', 'ok', 'okay', 'just', 'also', 'again', 'really', 'actually', 'hey', 'per', 'favore', 'dai']);

const POLARITY_WORDS = ['not', 'no', 'never', 'don', 'dont', 'nor', 'non', 'mai', 'always', 'sempre'];

function normForCue(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function hasPhrase(norm, phrases) {
  const padded = ` ${norm} `;
  return phrases.some((p) => padded.includes(` ${p} `));
}

/** Split (already-redacted) text into steer sentences: `{ sentence, explicit }[]`. */
export function steerSentences(text) {
  const redacted = redactSecrets(text);
  const raw = redacted.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const sentence of raw) {
    const norm = normForCue(sentence);
    if (!norm) continue;
    const explicit = hasPhrase(norm, RULE_CUES);
    if (explicit || hasPhrase(norm, STEER_CUES)) out.push({ sentence, explicit });
  }
  return out;
}

/** The one group-key function (ADR-053): token set (minus filler) + polarity, hashed. */
export function steerKey(sentence) {
  const norm = normForCue(sentence);
  const pol = [...new Set(POLARITY_WORDS.filter((w) => hasPhrase(norm, [w])))].sort();
  const toks = statementTokens(sentence).filter((t) => !MINE_FILLER.includes(t));
  const key = toks.length >= 3 ? `${toks.join(' ')}|${pol.join(' ')}` : normaliseStatement(sentence);
  const keyHash = createHash('sha256').update(key).digest('hex').slice(0, 16);
  return { key, keyHash };
}

/** Group steer occurrences (`{ sentence, explicit, session, ... }`) by `steerKey`. */
export function groupSteers(occurrences) {
  const map = new Map();
  let seq = 0;
  for (const occ of occurrences) {
    const { keyHash } = steerKey(occ.sentence);
    if (!map.has(keyHash)) map.set(keyHash, { keyHash, explicit: false, sessions: new Set(), occurrences: [], lastSeq: -1 });
    const g = map.get(keyHash);
    g.explicit = g.explicit || !!occ.explicit;
    if (occ.session) g.sessions.add(occ.session);
    g.occurrences.push(occ);
    g.lastSeq = seq++;
  }
  return [...map.values()].map((g) => ({ ...g, sessions: g.sessions, recurrence: g.sessions.size }));
}

/** Rank: recurrence desc, explicit desc, latest occurrence desc, keyHash asc (deterministic). */
export function rankGroups(groups) {
  return [...groups].sort((a, b) => {
    if (b.recurrence !== a.recurrence) return b.recurrence - a.recurrence;
    const ea = a.explicit ? 1 : 0;
    const eb = b.explicit ? 1 : 0;
    if (eb !== ea) return eb - ea;
    if ((b.lastSeq ?? 0) !== (a.lastSeq ?? 0)) return (b.lastSeq ?? 0) - (a.lastSeq ?? 0);
    return a.keyHash < b.keyHash ? -1 : a.keyHash > b.keyHash ? 1 : 0;
  });
}

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

/** Re-read one pending pointer's line and re-classify it, or `null` if it no longer reads as a human turn. */
function reReadPointer(ptr) {
  let first;
  for (const line of readLines(ptr.file, { start: ptr.start })) { first = line; break; }
  if (!first || first.oversized || first.start !== ptr.start) return null;
  let obj;
  try { obj = JSON.parse(first.text); } catch { return null; }
  const r = ptr.host === 'codex' ? classifyCodexLine(obj) : classifyClaudeLine(obj);
  if (r.kind !== 'human') return null;
  return r.text;
}

function mkSweepId() {
  return `mine-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

/**
 * Read-only towards the watermark (P1/P6): scans in-scope session files from their
 * recorded offset, groups qualifying steers, matches them against the store, ranks and
 * caps at `MINE_CAP`, and writes only a pointer-only run record. Never mutates
 * `files/<slug>.json` or `steers.json` — only `advanceSweep` commits.
 */
export async function sweep({ scope = { mode: 'project', roots: [] }, rescan = false, storeDir, env = process.env, now = new Date() } = {}) {
  const files = sessionFiles({ roots: scope.roots || [], all: scope.mode === 'all', env });

  const skipped = { malformed: 0, unrecognised: 0, oversized: 0, stalePending: 0 };
  const filesOut = {};
  const occurrences = [];
  let sessionsHeadless = 0;
  let hadNewBytes = rescan && files.length > 0;

  for (const info of files) {
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
      const excerpt = redactSecrets(turn.text);
      const context = redactSecrets(turn.context || '');
      for (const s of steerSentences(turn.text)) {
        occurrences.push({
          sentence: s.sentence, explicit: s.explicit, session: info.session, host: info.host,
          project: info.cwd ? basename(info.cwd) : undefined,
          excerpt, context,
          pointer: { file: info.file, host: info.host, session: info.session, start: turn.start, end: turn.end, ctxStart: turn.ctxStart, ctxEnd: turn.ctxEnd },
        });
      }
    }
  }

  const scannedFileSet = new Set(files.map((f) => f.file));
  const steers = readSteers(storeDir);
  const inScopePending = steers.pending.filter((p) => rescan || p.pointers.some((ptr) => scannedFileSet.has(ptr.file)));
  if (inScopePending.length) hadNewBytes = true;

  for (const p of inScopePending) {
    let text = null;
    let firstPtr = null;
    for (const ptr of p.pointers) {
      const re = reReadPointer(ptr);
      if (re != null) { text = re; firstPtr = ptr; break; }
    }
    if (text == null) { skipped.stalePending++; continue; }
    occurrences.push({
      sentence: text, explicit: p.explicit, session: firstPtr.session, host: firstPtr.host,
      project: undefined, excerpt: redactSecrets(text), context: '',
      pointer: firstPtr, priorSessions: p.sessions,
    });
  }

  if (!hadNewBytes) {
    return {
      sweep: null, scope, nothingNew: true,
      sessions: { scanned: files.length, headless: sessionsHeadless },
      candidates: [], sightings: [], remaining: 0, belowThreshold: 0, skipped,
    };
  }

  const groups = groupSteers(occurrences);
  // Merge in prior sessions carried by any reconstructed pending occurrence, and `seen`.
  for (const g of groups) {
    for (const occ of g.occurrences) {
      if (occ.priorSessions) for (const s of occ.priorSessions) g.sessions.add(s);
    }
    const seenEntry = steers.seen[g.keyHash];
    if (seenEntry) {
      for (const s of seenEntry.sessions || []) g.sessions.add(s);
      g.explicit = g.explicit || !!seenEntry.explicit;
    }
    g.recurrence = g.sessions.size;
  }

  const qualifying = [];
  const below = [];
  for (const g of groups) (g.recurrence >= 2 || g.explicit ? qualifying : below).push(g);

  const { entries } = loadPrinciples(storeDir);
  const sightings = [];
  const sightedGroups = [];
  const candidateGroups = [];
  for (const g of qualifying) {
    const latest = g.occurrences[g.occurrences.length - 1];
    const { exact } = findCandidates(entries, redactSecrets(latest.sentence));
    if (exact.length) {
      const target = pickExactTarget(exact);
      sightings.push({
        id: target.id, status: target.status, ...(target.reason !== undefined ? { reason: target.reason } : {}),
        fromSession: latest.session, fromRef: `transcript ${latest.host}:${latest.session}`,
        sessions: [...g.sessions].sort().slice(0, 10),
      });
      sightedGroups.push(g);
    } else {
      const { overlap } = findCandidates(entries, redactSecrets(latest.sentence));
      candidateGroups.push({ group: g, latest, matches: overlap });
    }
  }
  const sightingsCapped = sightings.slice(0, 20);

  const ranked = rankGroups(candidateGroups.map((c) => ({ ...c.group, _c: c })));
  const emitted = ranked.slice(0, MINE_CAP);
  const heldRanked = ranked.slice(MINE_CAP);

  const candidates = emitted.map((g, idx) => {
    const c = g._c;
    const text = cap(redactSecrets(c.latest.sentence), 300);
    return {
      id: `c${idx + 1}`,
      text,
      excerpt: cap(c.latest.excerpt || text, 500),
      context: cap(c.latest.context || '', 300, { tail: true }),
      explicit: g.explicit,
      recurrence: g.recurrence,
      sessions: [...g.sessions].sort().slice(0, 10),
      host: c.latest.host,
      project: c.latest.project,
      fromSession: c.latest.session,
      fromRef: `transcript ${c.latest.host}:${c.latest.session}`,
      matches: c.matches,
    };
  });

  const heldPending = heldRanked.map((g) => ({
    keyHash: g.keyHash, explicit: g.explicit, sessions: [...g.sessions],
    pointers: g.occurrences.map((o) => o.pointer).filter(Boolean),
  }));

  const id = mkSweepId();
  writeRun(storeDir, {
    id,
    files: filesOut,
    emitted: emitted.map((g) => ({ keyHash: g.keyHash, sessions: [...g.sessions], explicit: g.explicit })),
    held: heldPending,
    below: below.map((g) => ({ keyHash: g.keyHash, sessions: [...g.sessions], explicit: g.explicit })),
    sighted: sightedGroups.map((g) => ({ keyHash: g.keyHash, sessions: [...g.sessions], explicit: g.explicit })),
  });

  return {
    sweep: id,
    scope,
    nothingNew: false,
    sessions: { scanned: files.length, headless: sessionsHeadless },
    candidates,
    sightings: sightingsCapped,
    remaining: heldRanked.length,
    belowThreshold: below.length,
    skipped,
  };
}

/** Commit a sweep's material into the watermark (P6, D4/D6). */
export async function advanceSweep({ storeDir, id }) {
  return advanceMinestate(storeDir, id);
}
