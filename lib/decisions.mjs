// The one decision-identity engine: parsing, normalization, sameness and
// duplicate detection for DECISIONS.md entries. Pure — no filesystem, no git,
// no consumers yet (lib/canon.mjs wires it in a later task).
//
// This module exists because `lib/canon.mjs` used to carry its own private
// `norm()` and it was wrong in two independent ways at once (ADR-053):
//
//   1. It stripped the heading separator with `—?` — an EM-DASH-ONLY class.
//      A heading written with a plain hyphen (`## ADR-142 - Title`) kept the
//      `- Title` text in its normalized form while an em-dash heading for the
//      identical decision dropped it, so the two normalized to different
//      strings and were treated as two decisions.
//   2. It never excluded the `_YYYY-MM-DD_` date stamp `buildDecision` writes
//      into every entry, so the SAME decision recorded on two machines on two
//      different days differed "by construction" — the exact case that must
//      converge, not collide.
//
// Two normalizers is how the second one drifts back out of sync with the
// first; there must only ever be this one, and every caller (canon.mjs,
// tests) reaches identity through it rather than re-deriving a regex.
//
// Sameness here is STRICT normalized-string equality — no edit distance, no
// similarity score, no model judgement. ADR-053 rejected fuzzy merging on
// precedent: an automatic similarity-driven merge was deliberately removed
// elsewhere in this codebase because a wrong merge is destructive and no
// convenience is worth reintroducing that risk. Do not "improve" this into a
// fuzzy match.

// Matches the end of one `## ADR-NNN` entry: either the start of the next
// heading, or true end-of-input. Lifted verbatim from lib/canon.mjs's
// `unionLocalOnly` (ADR-037 fixed the EOF edge case there — a naive `$`
// alone stops one character short when the file doesn't end in a newline).
const EOI = '(?=\\n##\\s+ADR-|$(?![\\s\\S]))';

// Any dash character a human or an editor's autocorrect might use as the
// heading separator, not just the em-dash the original regex assumed.
const DASH_CLASS = '[-‐‑‒–—―]';

/**
 * Parse a DECISIONS.md-shaped text into EVERY entry, in document order.
 *
 * Sliced by heading position rather than by a per-id regex. The regex form
 * (`src.match(/^##\s+<id>\b.../)`) always resolves to the FIRST occurrence of
 * an id, so a file holding two entries under the same id yielded the first
 * one twice and the second was invisible to every caller — and `mergeDecisions`
 * then wrote a merged text that silently DESTROYED it. Duplicate ids are not
 * hypothetical: `canonPull`'s own ADR-034 note records agents writing ADRs
 * straight into the file, and a project that already has a duplicated pair is
 * exactly the input that triggered the loss.
 *
 * @param {string} text
 * @returns {{ id: string, text: string }[]} every entry, in document order
 */
export function parseDecisionEntries(text) {
  const src = String(text || '');
  const heads = [...src.matchAll(/^##\s+(ADR-\d+)/gm)];
  return heads.map((m, i) => ({
    id: m[1],
    text: src.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : src.length).trim(),
  }));
}

/**
 * Parse a DECISIONS.md-shaped text into its entries, keyed by id.
 *
 * First-wins on a repeated id, which is lossy BY CONSTRUCTION — a Map cannot
 * hold two entries under one key. Callers that must not lose an entry use
 * `parseDecisionEntries` instead; this stays for the id-keyed lookups
 * (`remote.get(id)`) where collapsing really is what is wanted.
 *
 * @param {string} text
 * @returns {Map<string, string>} id ('ADR-NNN') -> the entry's full text,
 *   heading through body, trimmed.
 */
export function parseDecisions(text) {
  const out = new Map();
  for (const { id, text: entry } of parseDecisionEntries(text)) {
    if (!out.has(id)) out.set(id, entry);
  }
  return out;
}

/**
 * Reduce a decision entry to its content identity: the string two entries
 * must match on to be considered the SAME decision. In order:
 *   1. strip the heading id and any dash-variant separator (or none at all);
 *   2. strip the `_YYYY-MM-DD_` date-stamp line, as its own anchored step —
 *      NOT folded into the heading strip, so a body that happens to contain
 *      an underscored, date-shaped line elsewhere (e.g. inside `**Why:**`)
 *      is not silently eaten by a looser combined pattern;
 *   3. collapse whitespace and trim, so formatting differences (line wraps,
 *      trailing spaces) never cause a false mismatch.
 *
 * @param {string} entry a single entry's text (heading through body)
 * @returns {string} the normalized identity string
 */
export function normalizeDecision(entry) {
  return String(entry || '')
    .replace(new RegExp(`^##\\s+ADR-\\d+\\s*(?:${DASH_CLASS}\\s*)?`), '')
    .replace(/^_\d{4}-\d{2}-\d{2}(?: · at [0-9a-f]{4,40})?_\s*$/m, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Is `a` the same decision as `b`? Strict normalized-content equality only —
 * see the module header for why fuzzy matching is deliberately absent.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameDecision(a, b) {
  return normalizeDecision(a) === normalizeDecision(b);
}

/**
 * Find groups of entries within a single DECISIONS.md text that are exact
 * normalized matches of each other — detection only, never mutates the text.
 *
 * @param {string} text
 * @returns {{ ids: string[], title: string }[]}
 */
export function findDuplicates(text) {
  // Every entry, not one per id: two entries sharing an id AND their content are
  // still a duplicate pair, and the id-keyed view cannot see the second one.
  const entries = parseDecisionEntries(text);
  const groups = new Map(); // normalized identity -> ids[]
  for (const { id, text: entry } of entries) {
    const key = normalizeDecision(entry);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(id);
  }
  const out = [];
  for (const [key, ids] of groups) {
    if (ids.length < 2) continue;
    out.push({ ids, title: key.split('\n')[0] });
  }
  return out;
}

/**
 * Collapse exact-normalized-match duplicate groups down to one entry each,
 * keeping the LOWEST-numbered id in every group and removing the rest.
 * Touches nothing else in the text — not formatting, not entry order, not
 * near-duplicates (those are left for a human, per ADR-053's strict-equality
 * rule).
 *
 * @param {string} text
 * @returns {{ text: string, removed: { id: string, keptId: string, title: string }[] }}
 */
export function collapseDuplicates(text, { date = new Date().toISOString().slice(0, 10) } = {}) {
  const src = String(text || '');
  const dupes = findDuplicates(src);
  if (dupes.length === 0) return { text: src, removed: [] };

  const byNum = (id) => Number(id.slice(4));
  const removed = [];
  const removeIds = new Set();
  for (const { ids, title } of dupes) {
    const sorted = [...ids].sort((a, b) => byNum(a) - byNum(b));
    const [keptId, ...rest] = sorted;
    for (const id of rest) {
      removeIds.add(id);
      removed.push({ id, keptId, title });
    }
  }

  // #45/#36 — a collapsed duplicate leaves a STUB, never a gap: the next ADR number is the
  // highest heading + 1, so deleting the newest entry handed its number out again and a
  // citation of it silently pointed at a different decision. The stub keeps the heading
  // (and so the number) and says where the decision lives.
  let next = src;
  for (const rem of removed) {
    const entryText = parseDecisionEntries(next).find((e) => e.id === rem.id)?.text;
    if (entryText == null) continue;
    const stub = `## ${rem.id} — ${decisionTitle(entryText)}\n${statusLine({ kind: 'duplicate', by: rem.keptId, date })}`;
    next = replaceEntry(next, rem.id, stub);
  }
  return { text: next.trim() ? next : src.trim(), removed };
}

// ── Revisions: status and amendment (#35, #36) ─────────────────────────────────
//
// A decision leaves the log, or has its prose corrected, by APPENDING a marker line —
// never by editing or deleting the entry in place:
//
//   **Status:** superseded by ADR-072 (2026-09-23) — <reason>
//   **Status:** retired (2026-09-23) — <reason>
//   **Status:** duplicate of ADR-001 (2026-09-23)
//   _Amended 2026-09-23: <reason>_
//
// The markers are what let two copies of one decision be ordered: a copy whose markers
// are a strict prefix of another's is an OLDER REVISION of it, not a conflicting edit.
// Without that, a teammate's `supersede` made every other copy "same id, different text"
// — the collision `mergeDecisions` refuses — and blocked their next pull or add. A hand
// edit adds no marker, so it still collides exactly as before.

const isMarker = (line) => /^\*\*Status:\*\*\s/.test(line) || /^_Amended \d{4}-\d{2}-\d{2}: .*_$/.test(line);

/** Every revision marker in an entry, in order. */
export function revisionMarkers(entry) {
  return String(entry || '').split('\n').map((l) => l.trim()).filter(isMarker);
}

/** Is `older` an earlier revision of `newer` — its markers a strict prefix of newer's? */
export function isOlderRevision(older, newer) {
  const a = revisionMarkers(older);
  const b = revisionMarkers(newer);
  return b.length > a.length && a.every((m, i) => m === b[i]);
}

/** The heading title of an entry, dash-variant tolerant. */
export function decisionTitle(entry) {
  const first = String(entry || '').split('\n')[0];
  return first.replace(new RegExp(`^##\\s+ADR-\\d+\\s*(?:${DASH_CLASS}\\s*)?`), '').trim();
}

/** The marker line for a status. */
export function statusLine({ kind, by, date, reason = '' }) {
  const why = reason ? ` — ${reason}` : '';
  if (kind === 'superseded') return `**Status:** superseded by ${by} (${date})${why}`;
  if (kind === 'duplicate') return `**Status:** duplicate of ${by} (${date})`;
  if (kind === 'retired') return `**Status:** retired (${date})${why}`;
  throw new Error(`unknown decision status: ${kind}`);
}

/**
 * The status an entry is in, from its LAST status marker. A status line this module
 * did not write is read as live: a decision is never hidden from agents on a guess.
 * @returns {{ state: 'live'|'superseded'|'retired'|'duplicate', by?: string, date?: string, reason?: string }}
 */
export function decisionStatus(entry) {
  const lines = revisionMarkers(entry).filter((l) => l.startsWith('**Status:**'));
  if (!lines.length) return { state: 'live' };
  const last = lines[lines.length - 1].replace(/^\*\*Status:\*\*\s*/, '');
  let m;
  if ((m = last.match(/^superseded by (ADR-\d+) \((\d{4}-\d{2}-\d{2})\)(?: — (.*))?$/))) return { state: 'superseded', by: m[1], date: m[2], reason: m[3] || '' };
  if ((m = last.match(/^duplicate of (ADR-\d+) \((\d{4}-\d{2}-\d{2})\)$/))) return { state: 'duplicate', by: m[1], date: m[2], reason: '' };
  if ((m = last.match(/^retired \((\d{4}-\d{2}-\d{2})\)(?: — (.*))?$/))) return { state: 'retired', date: m[1], reason: m[2] || '' };
  return { state: 'live' };
}

/** One line standing in for a decision that is no longer in force — id, title, what replaced it, when. */
export function decisionStub(id, entry) {
  const st = decisionStatus(entry);
  const tail =
    st.state === 'superseded' ? `superseded by ${st.by} (${st.date})`
      : st.state === 'duplicate' ? `duplicate of ${st.by} (${st.date})`
        : `retired (${st.date})${st.reason ? `: ${st.reason}` : ''}`;
  return `- ${id} — ${decisionTitle(entry)} · ${tail}`;
}

/** Replace one entry (by id, first occurrence) with new text; everything else untouched. */
export function replaceEntry(text, id, newEntry) {
  const src = String(text || '');
  const m = src.match(new RegExp(`^##\\s+${id}\\b[\\s\\S]*?` + EOI, 'm'));
  if (!m) return src;
  const rest = src.slice(m.index + m[0].length);
  return src.slice(0, m.index) + newEntry.trim() + '\n' + (rest.trim() ? rest.replace(/^\n*/, '\n') : '');
}

/**
 * What agents read (#36): every LIVE decision in full, then one stub line per decision
 * no longer in force — so a citation of it still resolves to "this was superseded by
 * ADR-072", but its body no longer arrives at full weight in every prompt.
 */
export function inForceText(text) {
  const src = String(text || '');
  const firstHead = src.search(/^##\s+ADR-\d+/m);
  const preamble = (firstHead === -1 ? src : src.slice(0, firstHead)).trim();
  const entries = parseDecisionEntries(src);
  const live = entries.filter((e) => decisionStatus(e.text).state === 'live').map((e) => e.text);
  const gone = entries.filter((e) => decisionStatus(e.text).state !== 'live').map((e) => decisionStub(e.id, e.text));
  const parts = [preamble, ...live];
  if (gone.length) {
    parts.push(
      '## Not in force\n\nThese decisions no longer apply — follow the decision each one names. They are ' +
        'listed so a citation still resolves; the full text is in DECISIONS.md.\n\n' + gone.join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n') + '\n';
}
