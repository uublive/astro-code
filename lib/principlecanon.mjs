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

/** Every non-empty bullet/paragraph line of CONVENTIONS.md, labelled by its nearest `##`. */
function conventionsItems(root) {
  const path = join(root, '.astrocode', 'CONVENTIONS.md');
  if (!existsSync(path)) return [];
  const text = readFileSync(path, 'utf8');
  const items = [];
  let heading = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^##\s+(.*)/);
    if (h) { heading = h[1].trim(); continue; }
    if (line.startsWith('#')) continue; // any other heading level
    items.push({ ref: `CONVENTIONS §${heading}`, tokens: statementTokens(line) });
  }
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

/**
 * Candidate clashes for `entry` against `items` (P6). Suppressed entirely when the
 * entry carries a promotion into THIS project. At most 2 candidates, ADRs before
 * CONVENTIONS, sorted by shared-count desc then ref.
 *
 * @param {object} entry
 * @param {{ ref: string, tokens: string[] }[]} items
 * @param {{ root: string, project: string }} opts
 * @returns {{ ref: string, shared: string[] }[]}
 */
export function clashCandidates(entry, items, { root, project } = {}) {
  const promotions = entry.promotions || [];
  const promotedHere = promotions.some((p) => p.path === root || p.project === project);
  if (promotedHere) return [];

  const entryTokens = statementTokens(entry.statement || '');
  const candidates = [];
  for (const item of items) {
    const shared = sharedTokens(entryTokens, item.tokens);
    if (shared.length >= MIN_SHARED) candidates.push({ ref: item.ref, shared });
  }

  candidates.sort((a, b) => {
    if (b.shared.length !== a.shared.length) return b.shared.length - a.shared.length;
    const aAdr = a.ref.startsWith('ADR-');
    const bAdr = b.ref.startsWith('ADR-');
    if (aAdr !== bAdr) return aAdr ? -1 : 1;
    return a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0;
  });

  return candidates.slice(0, 2);
}
