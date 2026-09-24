// Canon-clash candidates (P6, phase 25 CONTEXT D5). Deterministic keyword-overlap
// candidates between a personal principle and a project's canon — CONVENTIONS.md
// bullets/paragraphs and live DECISIONS.md entries — never a resolution.
//
// ## Why candidates only, canon always wins, nothing is resolved automatically
//
// A principle is personal; canon is the team's recorded agreement. An automatic
// merge or suppression here would let one developer's private preference silently
// override — or silently look overridden by — what the team actually decided. The
// most this module ever does is flag "these two texts share words", leaving the
// judgement to the agent applying the principle and, ultimately, to a human.
//
// ## Why promotion into THIS project suppresses the flag
//
// `recordPromotion` (lib/principles.mjs) is how a principle becomes canon on
// purpose — once promoted here, this project's copy of the idea IS the principle;
// any remaining "clash" would be canon disagreeing with itself, not with the
// principle, and is out of this module's scope.
//
// ## Why ADR TITLES only, never bodies
//
// A body compared against a statement's tokens overlaps almost everything (common
// words like "code", "test", "should" recur across every decision) — the title is
// the one line an ADR commits to being ABOUT, so it is the only fair unit to compare.
//
// Imports `statementTokens`/`MIN_SHARED` from phase 24's lib/principlematch.mjs — the
// one shared-token matcher family (CONTEXT precondition: never fork a second one).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { statementTokens, MIN_SHARED } from './principlematch.mjs';
import { parseDecisionEntries, decisionStatus, decisionTitle } from './decisions.mjs';

// A bullet that is only a label — `- Error handling:`, `- Why this stack (one line):` — is
// an unfilled template placeholder, not a rule. Counted as canon, its two or three label
// words flagged nearly every ordinary principle in a freshly `ac init`-ed project
// (phase 25 verify, C7).
const LABEL_ONLY = /^[-*+]\s+[^:]*:\s*$/;
const BULLET = /^[-*+]\s+/;

/**
 * CONVENTIONS.md as items labelled by their nearest `##`: each filled bullet is one item,
 * and each run of wrapped prose lines is ONE paragraph item. Line-by-line, a wrapped
 * paragraph splintered into fragments of a few words each, and two generic words landing
 * in a four-word fragment passed the ratio test below by pure coincidence.
 */
function conventionsItems(root) {
  const path = join(root, '.astrocode', 'CONVENTIONS.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const items = [];
  let heading = '';
  let para = [];
  const flush = () => {
    if (para.length && heading) items.push({ ref: `CONVENTIONS §${heading}`, tokens: statementTokens(para.join(' ')) });
    para = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const h = line.match(/^##\s+(.*)/);
    if (h) { flush(); heading = h[1].trim(); continue; }
    if (line.startsWith('#')) { flush(); continue; } // any other heading level
    // The document preamble (title/blockquote before the first `##`) belongs to no
    // section — flagging it would name "CONVENTIONS §" with nothing after the §.
    if (!heading) continue;
    if (BULLET.test(line)) {
      flush();
      if (LABEL_ONLY.test(line)) continue;
      items.push({ ref: `CONVENTIONS §${heading}`, tokens: statementTokens(line) });
      continue;
    }
    para.push(line);
  }
  flush();
  return items;
}

/** Every LIVE decision in DECISIONS.md, labelled by its ADR id, compared on its title. */
function decisionItems(root) {
  const path = join(root, '.astrocode', 'DECISIONS.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const entries = parseDecisionEntries(text);
  const items = [];
  for (const { id, text: entryText } of entries) {
    if (decisionStatus(entryText).state !== 'live') continue;
    items.push({ ref: id, tokens: statementTokens(decisionTitle(entryText)) });
  }
  return items;
}

/**
 * Every canon item at `root` — CONVENTIONS.md bullets and live DECISIONS.md titles —
 * as `{ ref, tokens }`. Read-only; no `.astrocode/` yields `[]`.
 *
 * @param {string} root
 * @returns {{ ref: string, tokens: string[] }[]}
 */
export function canonItems(root) {
  if (!existsSync(join(root, '.astrocode'))) return [];
  return [...decisionItems(root), ...conventionsItems(root)];
}

function sharedTokens(a, b) {
  const setB = new Set(b);
  return a.filter((t) => setB.has(t)).sort();
}

// A canon item (an ADR title, a long CONVENTIONS paragraph) can run to dozens of
// tokens; two or three of those landing in a short principle statement by pure
// coincidence (generic words like "pull", "one", "keep") happens often enough to be
// noise, not signal — and the coincidence rate only grows with the item's own
// length, not the statement's. So a candidate also has to cover a real SLICE OF THE
// ITEM itself: a two-word overlap against a four-word CONVENTIONS bullet or a
// three-word ADR title is a real match; the same two or three words lost inside a
// thirty-word ADR title usually is not.
const MIN_SHARED_RATIO = 0.25;

// Words that say how a rule is phrased, not what it is about. Two of them in common
// ("keep … short", "first … second") are not a clash, so they never count toward
// MIN_SHARED here. Canon-only: the phase-24 dedupe matcher keeps its own token rules.
const GENERIC = new Set(
  ('keep short long one two three first second last line lines make new good small large '
    + 'simple clear instead thing things way need get set also more less same like much many '
    + 'follow follows here there sure well').split(' '),
);

/**
 * Candidate clashes for `entry` against `items` (P6). Suppressed entirely when the
 * entry carries a promotion into THIS project (matched by path). At most 2 candidates, ADRs before
 * CONVENTIONS, sorted by shared-count desc then ref.
 *
 * @param {object} entry
 * @param {{ ref: string, tokens: string[] }[]} items
 * @param {{ root: string }} opts
 * @returns {{ ref: string, shared: string[] }[]}
 */
export function clashCandidates(entry, items, { root } = {}) {
  // Promotion is matched on the project's PATH only. Matching the project NAME too hid a
  // real clash in any other project that happened to share a directory basename
  // (phase 25 verify, C7) — names are not identities.
  const promotions = entry.promotions || [];
  const promotedHere = promotions.some((p) => p.path && p.path === root);
  if (promotedHere) return [];

  const entryTokens = statementTokens(entry.statement || '').filter((t) => !GENERIC.has(t));
  // One candidate per ref — several bullets in one § used to list that § twice.
  const best = new Map();
  for (const item of items) {
    const shared = sharedTokens(entryTokens, item.tokens);
    if (shared.length < MIN_SHARED) continue;
    if (shared.length / (item.tokens.length || 1) < MIN_SHARED_RATIO) continue;
    const prev = best.get(item.ref);
    if (!prev || shared.length > prev.shared.length) best.set(item.ref, { ref: item.ref, shared });
  }
  const candidates = [...best.values()];

  candidates.sort((a, b) => {
    if (b.shared.length !== a.shared.length) return b.shared.length - a.shared.length;
    const aAdr = a.ref.startsWith('ADR-');
    const bAdr = b.ref.startsWith('ADR-');
    if (aAdr !== bAdr) return aAdr ? -1 : 1;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });

  return candidates.slice(0, 2);
}
