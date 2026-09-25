// A pure candidate-matcher for personal principles (P1, phase 24 — ADR-053 precedent,
// CONTEXT D1). No fs, no git, no redaction: every caller passes already-redacted text
// (`lib/principles.mjs` redacts before it ever reaches here).
//
// ## Why exact is plain `===`, on its own code path
//
// ADR-053 already settled "strict-equality-never-similarity" for a different module;
// CONTEXT D1 restates the reason here — a similarity-driven auto-merge destroyed data
// before (two distinct principles silently folded into one). `sameStatement` is the
// ONLY test on the suppress path (a repeat mints no new entry, an overlap always does):
// normalise both sides and compare strings. No score, no threshold, no edit distance.
//
// ## Why overlap is a shared-token LIST, not a float score
//
// A caller (the review command, a capturing agent) has to be able to say WHY two
// statements look related. A Jaccard-style score answers "how related" with a number
// nobody can act on; a list of the words that actually matched is the explanation
// itself, and it needs no threshold-tuning, no embeddings, and no dependency (zero
// deps — CONVENTIONS).
//
// ## Why `lib/registry.mjs`'s `classifyMatch` was not reused
//
// Its Jaccard ≥ 0.5 over raw words is a whole-statement ratio: "Commit the pnpm
// lockfile on every dependency change" vs "Use pnpm for every lockfile in JS repos"
// shares only 2 of 8 content words and would never clear 0.5, even though both are
// unmistakably about the same thing (CRITERIA C4). It also cannot say which words
// matched — no explanation, which D1 requires before anything is surfaced to a human.

/**
 * Every non-letter/digit run collapses to one space; case and Unicode forms fold. This is
 * phase 24's store-dedupe equality (`sameStatement`) and the tokenising form. It folds
 * symbols, so two statements differing ONLY by a symbol are one statement here — the
 * miner therefore never relies on it to decide that a transcript turn "is" a stored
 * entry (lib/mine.mjs `collapseKey`, phase 26 C4).
 */
export function normaliseStatement(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Generic glue words, and the words almost every principle statement starts with. */
export const STOPWORDS = new Set(
  ('a an the and or but nor for of to in on at by with from as is are was be been it its '
    + 'this that these those every each all any some use uses using used prefer always '
    + 'never not no do does don t s over than then when where which who into onto your you '
    + 'we our us i my me so only just should must can will would via per').split(' '),
);

/** The number of shared non-stopword tokens that makes two statements an overlap candidate. */
export const MIN_SHARED = 2;

/**
 * The ONLY exact test: normalised string equality, never on a blank statement.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameStatement(a, b) {
  const na = normaliseStatement(a);
  const nb = normaliseStatement(b);
  return na !== '' && na === nb;
}

/** Fold a trailing `s` on a token longer than 3 chars, unless it ends in a double `s`. */
function foldPlural(token) {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Normalise, split, drop stopwords and tokens shorter than 2 chars, fold plurals, and
 * return the unique tokens sorted.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function statementTokens(s) {
  const words = normaliseStatement(s).split(' ').filter(Boolean);
  const tokens = new Set();
  for (const w of words) {
    if (w.length < 2) continue;
    if (STOPWORDS.has(w)) continue;
    tokens.add(foldPlural(w));
  }
  return [...tokens].sort();
}

/** The tokens shared between two token arrays, sorted. */
function sharedTokens(a, b) {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).sort();
}

/**
 * Find every candidate an existing entry pool offers for a new statement. Fully
 * deterministic — no timestamps, no randomness — so two runs are byte-identical.
 *
 * @param {object[]} entries — entry-shaped objects (id, status, statement, reason?,
 *   mergedInto?)
 * @param {string} statement — already-redacted
 * @returns {{ exact: object[], overlap: object[] }}
 */
export function findCandidates(entries, statement) {
  const tokens = statementTokens(statement);
  const exact = [];
  const overlap = [];

  for (const e of entries) {
    if (sameStatement(e.statement, statement)) {
      const m = { id: e.id, status: e.status };
      if (e.reason !== undefined) m.reason = e.reason;
      if (e.mergedInto !== undefined) m.mergedInto = e.mergedInto;
      exact.push(m);
      continue;
    }
    const eTokens = statementTokens(e.statement);
    const shared = sharedTokens(tokens, eTokens);
    if (shared.length >= MIN_SHARED) {
      const m = { id: e.id, status: e.status, shared };
      if (e.reason !== undefined) m.reason = e.reason;
      overlap.push(m);
    }
  }

  exact.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  overlap.sort((a, b) => {
    if (b.shared.length !== a.shared.length) return b.shared.length - a.shared.length;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { exact, overlap };
}

// Priority an exact hit resolves to when several statuses match the same statement.
const TARGET_PRIORITY = ['accepted', 'proposed', 'rejected', 'retired', 'superseded', 'merged'];

/**
 * The one entry a sighting lands on, by status priority, ties to the smaller id.
 *
 * @param {object[]} exactEntries
 * @returns {object}
 */
export function pickExactTarget(exactEntries) {
  const sorted = [...exactEntries].sort((a, b) => {
    const pa = TARGET_PRIORITY.indexOf(a.status);
    const pb = TARGET_PRIORITY.indexOf(b.status);
    if (pa !== pb) return pa - pb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return sorted[0];
}

/** True when two entries are close enough to be the same duplicate group. */
function isDuplicateOf(a, b) {
  if (sameStatement(a.statement, b.statement)) return true;
  const shared = sharedTokens(statementTokens(a.statement), statementTokens(b.statement));
  return shared.length >= MIN_SHARED;
}

/**
 * Connected components (size ≥ 2) of proposed entries under `sameStatement || overlap`.
 * Each group's ids are sorted; groups are ordered by their first id.
 *
 * @param {object[]} proposedEntries
 * @returns {string[][]}
 */
export function groupDuplicates(proposedEntries) {
  const ids = proposedEntries.map((e) => e.id);
  const parent = new Map(ids.map((id) => [id, id]));
  function find(id) {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  for (let i = 0; i < proposedEntries.length; i++) {
    for (let j = i + 1; j < proposedEntries.length; j++) {
      if (isDuplicateOf(proposedEntries[i], proposedEntries[j])) {
        union(proposedEntries[i].id, proposedEntries[j].id);
      }
    }
  }
  const groups = new Map(); // root -> ids[]
  for (const id of ids) {
    const root = find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(id);
  }
  return [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((g) => [...g].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The proposed-review queue: every proposed entry, sorted by id, enriched with
 * `sightingCount`, `matches` against every non-proposed, non-merged entry, and
 * `groupWith` — the ids of other proposed entries in the same duplicate group.
 *
 * @param {object[]} entries
 * @returns {object[]}
 */
export function buildReviewQueue(entries) {
  const proposed = entries.filter((e) => e.status === 'proposed').sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pool = entries.filter((e) => e.status !== 'proposed' && e.status !== 'merged');
  const groups = groupDuplicates(proposed);
  const groupOf = new Map();
  for (const g of groups) {
    for (const id of g) groupOf.set(id, g.filter((x) => x !== id));
  }

  return proposed.map((e) => {
    const sightings = e.sightings ?? [];
    const { exact, overlap } = findCandidates(pool, e.statement);
    const matches = [
      ...exact.map(({ id, status, reason }) => {
        const m = { id, status, match: 'exact' };
        if (reason !== undefined) m.reason = reason;
        return m;
      }),
      ...overlap.map(({ id, status, reason, shared }) => {
        const m = { id, status, match: 'overlap', shared };
        if (reason !== undefined) m.reason = reason;
        return m;
      }),
    ];
    return {
      ...e,
      sightings,
      sightingCount: sightings.length,
      matches,
      groupWith: groupOf.get(e.id) ?? [],
    };
  });
}
