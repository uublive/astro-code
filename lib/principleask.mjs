// Keyword ranking for `ac principles ask` (P7, phase 25 CONTEXT D7). Pure — no fs,
// no git, no network, no embeddings: statement/why/scope text against a question,
// scored, with the reason it matched carried as data.
//
// ## Why BM25-style and not raw token overlap
//
// Raw overlap over-weights long entries (more words, more chances to share a term)
// and under-weights a rare, decisive term against a common one. BM25's length
// normalization and inverse-document-frequency term give a short, precise statement
// a fair shot against a long, generic one, without any external corpus or model.
//
// ## Why the prefix rule and its 6-char floor
//
// "concurrent" and "concurrency" are the same idea typed two ways; treating them as
// unrelated tokens would miss an obvious match. A shared PREFIX of at least 6 chars
// on BOTH sides is long enough that it is very unlikely to be a coincidence (`car`
// and `carbon` share 3, and are unrelated) while short enough to catch real
// inflections without a stemmer (zero deps, ADR-001).
//
// ## Why the explanation is the ranking function's NATIVE return shape
//
// `rankPrinciples` returns `{ id, score, matched, scopeHits }` — the terms that
// matched and where are not rendered-then-thrown-away, they ARE the result. A caller
// that wants JSON (the CLI's `--json`, a future consumer) gets the same explanation
// a human reading `renderAsk`'s text does, with nothing lost in between.
import { statementTokens, STOPWORDS } from './principlematch.mjs';

/** Question words that would otherwise match almost every principle. */
export const QUESTION_STOPWORDS = new Set(
  'how what why whom whose is am i me should could would best way'.split(' '),
);

export const ASK_MAX = 10;

const K1 = 1.2;
const B = 0.75;
const PREFIX_MIN = 6;

function questionTokens(q) {
  return statementTokens(q).filter((t) => !QUESTION_STOPWORDS.has(t));
}

/** Field-weighted token bags for one entry: statement (2), why (1), scope tags (1.5). */
function entryFields(entry) {
  const scopes = entry.scopes || { stack: [], files: [], work: [] };
  const scopeText = [...scopes.stack, ...scopes.work, ...scopes.files].join(' ');
  return [
    { field: 'statement', tokens: statementTokens(entry.statement || ''), weight: 2 },
    { field: 'why', tokens: statementTokens(entry.why || ''), weight: 1 },
    { field: 'scope', tokens: statementTokens(scopeText), weight: 1.5 },
  ];
}

/** Does `qTerm` match `eTerm` — equal, or both >= PREFIX_MIN chars sharing that prefix? */
function termMatch(qTerm, eTerm) {
  if (qTerm === eTerm) return true;
  if (qTerm.length >= PREFIX_MIN && eTerm.length >= PREFIX_MIN) {
    const n = PREFIX_MIN;
    return qTerm.slice(0, n) === eTerm.slice(0, n);
  }
  return false;
}

/**
 * Rank `entries` (accepted only) against `question` (P7). Deterministic: two calls
 * with the same inputs return deep-equal arrays.
 *
 * @param {object[]} entries
 * @param {string} question
 * @param {{ stack?: string[] }} ctx
 * @returns {{ id: string, score: number, matched: { term: string, entryTerm: string, field: string }[], scopeHits: string[] }[]}
 */
export function rankPrinciples(entries, question, ctx = {}) {
  const accepted = entries.filter((e) => e.status === 'accepted');
  const qTerms = questionTokens(question);
  if (!qTerms.length) return [];

  const stackCtx = ctx.stack || [];

  // Per-field document lengths + corpus average, and per-term document frequency,
  // computed once over the whole accepted pool (BM25's idf/length-normalization).
  const fieldsByEntry = new Map(accepted.map((e) => [e.id, entryFields(e)]));
  const avgLen = { statement: 0, why: 0, scope: 0 };
  for (const [, fields] of fieldsByEntry) {
    for (const f of fields) avgLen[f.field] += f.tokens.length;
  }
  const n = accepted.length || 1;
  for (const k of Object.keys(avgLen)) avgLen[k] /= n;

  function docFreq(term) {
    let df = 0;
    for (const [, fields] of fieldsByEntry) {
      const hit = fields.some((f) => f.tokens.some((t) => termMatch(term, t)));
      if (hit) df += 1;
    }
    return df;
  }
  const idfCache = new Map();
  function idf(term) {
    if (idfCache.has(term)) return idfCache.get(term);
    const df = docFreq(term);
    const val = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    idfCache.set(term, val);
    return val;
  }

  const results = [];
  for (const entry of accepted) {
    const fields = fieldsByEntry.get(entry.id);
    let score = 0;
    const matched = [];
    for (const qTerm of qTerms) {
      let bestFieldScore = 0;
      let bestMatch = null;
      for (const f of fields) {
        const hitTerms = f.tokens.filter((t) => termMatch(qTerm, t));
        if (!hitTerms.length) continue;
        const tf = hitTerms.length;
        const len = f.tokens.length;
        const denom = tf + K1 * (1 - B + B * (len / (avgLen[f.field] || 1)));
        const fieldScore = idf(qTerm) * ((tf * (K1 + 1)) / denom) * f.weight;
        if (fieldScore > bestFieldScore) {
          bestFieldScore = fieldScore;
          bestMatch = { term: qTerm, entryTerm: hitTerms.find((t) => t !== qTerm) || qTerm, field: f.field };
        }
      }
      if (bestMatch) {
        score += bestFieldScore;
        const label = bestMatch.entryTerm !== bestMatch.term ? `${bestMatch.term}≈${bestMatch.entryTerm}` : bestMatch.term;
        matched.push({ term: label, entryTerm: bestMatch.entryTerm, field: bestMatch.field });
      }
    }
    if (score <= 0) continue;
    const scopes = entry.scopes || { stack: [], files: [], work: [] };
    const scopeHits = scopes.stack.filter((s) => stackCtx.includes(s));
    results.push({ id: entry.id, score, matched, scopeHits });
  }

  results.sort((a, b) => (b.score !== a.score ? b.score - a.score : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
  return results;
}

/**
 * Render `ask` results to text (P7). Empty results say so; results beyond
 * `ASK_MAX` fold into a `+N more` line.
 *
 * @param {object[]} results
 * @param {string} question
 * @returns {string}
 */
export function renderAsk(results, question) {
  if (!results.length) return `• no principles match "${question}"`;

  const lines = [];
  const shown = results.slice(0, ASK_MAX);
  shown.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.id}`);
    const matchedStr = r.matched.map((m) => `${m.term} (${m.field})`).join(', ');
    const scopeStr = r.scopeHits.length ? ` · scope: ${r.scopeHits.join(', ')} ✓` : '';
    lines.push(`   matched: ${matchedStr}${scopeStr}`);
  });
  if (results.length > ASK_MAX) lines.push(`• +${results.length - ASK_MAX} more — ac principles show <id>`);
  return lines.join('\n');
}
