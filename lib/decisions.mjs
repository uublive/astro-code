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
 * Parse a DECISIONS.md-shaped text into its entries, keyed by id.
 *
 * @param {string} text
 * @returns {Map<string, string>} id ('ADR-NNN') -> the entry's full text,
 *   heading through body, trimmed.
 */
export function parseDecisions(text) {
  const out = new Map();
  const src = String(text || '');
  for (const m of src.matchAll(/^##\s+(ADR-\d+)/gm)) {
    const e = src.match(new RegExp(`^##\\s+${m[1]}\\b[\\s\\S]*?` + EOI, 'm'));
    if (e) out.set(m[1], e[0].trim());
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
    .replace(/^_\d{4}-\d{2}-\d{2}_\s*$/m, '')
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
  const entries = parseDecisions(text);
  const groups = new Map(); // normalized identity -> ids[]
  for (const [id, entry] of entries) {
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
export function collapseDuplicates(text) {
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

  let next = src;
  for (const id of removeIds) {
    const m = next.match(new RegExp(`^##\\s+${id}\\b[\\s\\S]*?` + EOI, 'm'));
    if (m) next = (next.slice(0, m.index) + next.slice(m.index + m[0].length)).replace(/\n{3,}/g, '\n\n');
  }
  return { text: next.trim() ? next : src.trim(), removed };
}
