// Survivor triage support (phase 49, ADR-085): a stable identity for a mutant, text-only
// detection, grouping, and the committed per-phase judgements file.
//
// Why the key is not the line number (D3): a judgement must follow its MUTANT. Insert five lines
// above a function and every mutant below it moves; matching by line would re-open every
// judgement and the verifier would re-judge a whole phase after each edit. The key is built from
// what the mutant IS — the file, the enclosing function, the mutation kind, the mutated source
// line (trimmed, so re-indenting keeps it), the replacement text and the column relative to the
// first non-blank character. Edit the mutated line and `line_text` changes, which re-opens the
// judgement: the code that was judged is gone. Stryker's `id` and Gremlins' index are run-local
// counters and mutmut's `__mutmut_N` suffix is too, so none of them can be part of an identity.
//
// Why nothing here is ever marked equivalent (333f, 1a0d): grouping, text-only detection and key
// matching are mechanical text comparison. Whether a survivor is equivalent is a judgement for a
// human or the verifier. A group note is expanded at write time into one explicit entry per
// CURRENT member, so a survivor that appears later is never covered by an older note.
//
// The judgements live in `.astrocode/phases/<slug>/SURVIVORS.json`, beside VERDICT.json: committed,
// not under the gitignored `.local/`, so a teammate's clone and a reviewer see every justification.
// The evidence contract, the gate and the kept run stay in lib/verdict.mjs (9173); this module
// imports `TRIAGES`, `oneLine` and `readMutateRun` from it, and verdict loads this module only
// through `await import`, so there is no static cycle.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './paths.mjs';
import { withLock, atomicWriteJSON, assertSafeSlug } from './util.mjs';
import { TRIAGES, oneLine, readMutateRun } from './verdict.mjs';
import { enclosingFunction } from './funcscan.mjs';

export const SURVIVORS_FILE = 'SURVIVORS.json';
export const TEXT_ONLY_GROUP = 'g:text-only';

const sha12 = (...parts) => createHash('sha1').update(parts.join('\0')).digest('hex').slice(0, 12);

/** `<repo>/.astrocode/phases/<slug>/SURVIVORS.json`. */
export function survivorsFile(root, slug) {
  assertSafeSlug(slug);
  return join(paths(root).phases, slug, SURVIVORS_FILE);
}

// ---- Text-only changes (D6) ----

// A line split into its code skeleton (each string literal's CONTENT replaced by a marker) and the
// literal contents. Python/JS/Go quotes; a backslash escapes the next character. Total, no throw.
function splitLiterals(line) {
  let code = '';
  const lits = [];
  let i = 0;
  const s = String(line ?? '');
  while (i < s.length) {
    const ch = s[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < s.length && s[j] !== ch) j += s[j] === '\\' ? 2 : 1;
      lits.push(s.slice(i + 1, Math.min(j, s.length)));
      code += `${ch}\0${ch}`;
      i = j + 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return { code: code.trim(), lits };
}

/**
 * Do these two lines differ only inside string-literal content, with the code outside the literals
 * identical? `return "bad"` -> `return "XXbadXX"` is; `ValueError("x")` -> `ValueError(None)` and
 * `x > "a"` -> `x >= "a"` are not. Message content is never matched (research risk 8).
 */
export function literalOnlyChange(orig, repl) {
  const a = splitLiterals(orig);
  const b = splitLiterals(repl);
  return a.code === b.code && a.lits.length === b.lits.length && a.lits.some((l, i) => l !== b.lits[i]);
}

/**
 * Is this mutant a text-only change? True when its mutator is one the tool row names as
 * string-literal (`textKinds`, Stryker `StringLiteral`), or when the tool gave the mutated line
 * (`replacement_line`, mutmut 3) and only literal content changed. Gremlins has no string mutator.
 */
export function isTextOnly(m, textKinds = []) {
  if (textKinds.includes(m.mutator)) return true;
  const orig = m.line_text;
  return typeof m.replacement_line === 'string' && typeof orig === 'string' && literalOnlyChange(orig, m.replacement_line);
}

// ---- Kind ----

const TOKEN = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[\p{L}\p{N}_]+|[-+*/%<>=!&|^~@]+|\S/gu;

/**
 * The minimal differing token pair between a source line and its mutated line, written
 * `` `>` → `>=` ``. `unknown` when the lines are the same or one is missing. mutmut 3's own
 * mutant-name suffix is a run-local counter and never a kind.
 */
export function diffKind(orig, repl) {
  if (typeof orig !== 'string' || typeof repl !== 'string') return 'unknown';
  const a = orig.match(TOKEN) ?? [];
  const b = repl.match(TOKEN) ?? [];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q += 1;
  const x = a.slice(p, a.length - q).join(' ');
  const y = b.slice(p, b.length - q).join(' ');
  if (!x && !y) return 'unknown';
  return `\`${x || '∅'}\` → \`${y || '∅'}\``;
}

// ---- Identity ----

const groupId = (file, fn, kind) => `g:${sha12(file, fn ?? '', kind)}`;

// The three inputs of the key that are not the file or the function (one place, 9173).
function identityOf(m, lineText, tool) {
  const text = typeof lineText === 'string' ? lineText : (typeof m.line_text === 'string' ? m.line_text : '');
  const kind = tool === 'mutmut'
    ? (typeof m.replacement_line === 'string' && text ? diffKind(text, m.replacement_line) : 'unknown')
    : (m.mutator || 'unknown');
  const replacement = m.replacement ?? (typeof m.replacement_line === 'string' ? m.replacement_line.trim() : null);
  return { text, kind, replacement };
}

/**
 * `{ key, fn, kind, text_only, line_text, group }` for one mutant. `lineText` is the mutated source
 * line at HEAD, `fn` its enclosing function (or null), `tool` the tool id. `ordinal` is the
 * mutant's index among ALL parsed mutants sharing its file, function, kind, line and replacement —
 * used only when the tool gave neither a column nor a replacement (mutmut 2, or a mutmut 3 whose
 * `show` was capped), and counted over every mutant so a sibling's kill cannot shift it.
 * The line NUMBER is in no part of the key.
 */
export function describeMutant(m, { lineText, fn = null, tool = null, textKinds = [], ordinal = 0 } = {}) {
  const { text, kind, replacement } = identityOf(m, lineText, tool);
  const indent = text.length - text.trimStart().length;
  const col = Number.isInteger(m.col) && text ? String(m.col - 1 - indent) : '';
  const lacking = col === '' && replacement === null;
  const key = `s:${sha12(m.file, fn ?? '', kind, text.trim(), replacement ?? '', col, lacking ? `#${ordinal}` : '')}`;
  const text_only = isTextOnly({ ...m, line_text: text }, textKinds);
  return { key, fn, kind, text_only, line_text: text.trim(), group: text_only ? TEXT_ONLY_GROUP : groupId(m.file, fn, kind) };
}

/**
 * Describe a whole parse result's mutants (survivors and killed alike) so the fallback ordinal sees
 * every sibling. `sources` is `{ file: text at HEAD }`; returns descriptions parallel to `mutants`.
 */
export function describeAll(mutants, { tool = null, sources = {}, textKinds = [] } = {}) {
  const seen = new Map();
  return mutants.map((m) => {
    const src = sources[m.file];
    const known = typeof src === 'string' && Number.isInteger(m.line) && m.line > 0;
    const lineText = known ? (src.replace(/\r\n?/g, '\n').split('\n')[m.line - 1] ?? '') : undefined;
    const fn = m.func != null ? m.func : (known ? enclosingFunction(m.file, src, m.line) : null);
    const { text, kind, replacement } = identityOf(m, lineText, tool);
    const sig = [m.file, fn ?? '', kind, text.trim(), replacement ?? ''].join('\0');
    const ordinal = seen.get(sig) ?? 0;
    seen.set(sig, ordinal + 1);
    return describeMutant(m, { lineText, fn, tool, textKinds, ordinal });
  });
}

// ---- Groups ----

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isEquivalent = (s) => s.triage === 'equivalent' && oneLine(s.justification);

/**
 * Every survivor in exactly one group: logic survivors by `(file, fn, kind)`, every text-only
 * survivor in ONE `g:text-only` group whatever its function (one note can cover it). Ordered by
 * file, fn, kind, with the text-only group last; the counts sum to `survivors.length`.
 */
export function groupSurvivors(survivors) {
  const byId = new Map();
  for (const s of survivors) {
    const id = s.text_only ? TEXT_ONLY_GROUP : (s.group ?? groupId(s.file, s.fn, s.kind));
    let g = byId.get(id);
    if (!g) {
      g = s.text_only
        ? { id, file: null, fn: null, kind: 'text-only', text_only: true, count: 0, open: 0, equivalent: 0, test_gap: 0, keys: [] }
        : { id, file: s.file, fn: s.fn ?? null, kind: s.kind ?? 'unknown', text_only: false, count: 0, open: 0, equivalent: 0, test_gap: 0, keys: [] };
      byId.set(id, g);
    }
    g.count += 1;
    if (isEquivalent(s)) g.equivalent += 1;
    else { g.open += 1; if (s.triage === 'test-gap') g.test_gap += 1; }
    g.keys.push(s.key);
  }
  return [...byId.values()].sort((a, b) => Number(a.text_only) - Number(b.text_only)
    || cmp(a.file ?? '', b.file ?? '') || cmp(a.fn ?? '', b.fn ?? '') || cmp(a.kind, b.kind));
}

// ---- The judgements file ----

const validEntry = (e) => {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'not an object';
  if (typeof e.key !== 'string' || !e.key.startsWith('s:')) return 'no mutant key';
  if (!TRIAGES.includes(e.triage)) return `unknown triage "${e.triage}"`;
  if (e.triage === 'equivalent' && !oneLine(e.justification)) return 'equivalent without a one-line justification';
  if (e.justification !== undefined && e.justification !== null && e.justification !== '' && !oneLine(e.justification)) return 'justification is not one line';
  return null;
};

/**
 * Total: never throws. `{ judgements, invalid, reason }` — `invalid` lists hand-edited entries that
 * are never applied (an unknown triage, an equivalent without a justification); an unreadable file
 * gives no judgements and a `reason` (6105), a missing one just none.
 */
export function readJudgements(file) {
  if (!existsSync(file)) return { judgements: [], invalid: [], reason: null };
  let v;
  try { v = JSON.parse(readFileSync(file, 'utf8')); } catch { return { judgements: [], invalid: [], reason: 'SURVIVORS.json is unreadable' }; }
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.version !== 1 || !Array.isArray(v.judgements)) {
    return { judgements: [], invalid: [], reason: 'SURVIVORS.json has an unknown shape' };
  }
  const judgements = [];
  const invalid = [];
  for (const e of v.judgements) {
    const why = validEntry(e);
    if (why) invalid.push({ key: typeof e?.key === 'string' ? e.key : null, why });
    else judgements.push(e);
  }
  return { judgements, invalid, reason: null };
}

/**
 * Write judgements for survivors of the LAST FULL kept run. `ids` are survivor keys (`s:…`) or
 * group ids (`g:…`); a group expands to one explicit entry per CURRENT member. An unknown id, an
 * `equivalent` without a one-line justification, or no usable kept run is refused (throws) before
 * anything is written. The file is written, not committed: `ac verdict record` commits it.
 */
export async function recordJudgements(root, slug, { ids, triage, justification = null, now = new Date() }) {
  assertSafeSlug(slug);
  if (!TRIAGES.includes(triage)) throw new Error(`triage must be one of ${TRIAGES.join(', ')}`);
  if (triage === 'equivalent' && !oneLine(justification)) throw new Error('an equivalent judgement needs a one-line justification');
  if (justification !== null && justification !== undefined && justification !== '' && !oneLine(justification)) throw new Error('the justification must be one line');
  if (!Array.isArray(ids) || !ids.length) throw new Error('name at least one survivor key (s:…) or group id (g:…)');
  const run = readMutateRun(root, slug);
  const kept = (run?.survivors ?? []).filter((s) => typeof s.key === 'string');
  if (!run || !kept.length) {
    throw new Error(run && !(run.survivors ?? []).length
      ? 'the last `ac mutate` run has no survivors to judge'
      : 'no `ac mutate` run with survivor keys on record for this phase — run `ac mutate <n>` first');
  }
  const picked = new Map();
  for (const id of ids) {
    if (id.startsWith('g:')) {
      const members = kept.filter((s) => s.group === id);
      if (!members.length) throw new Error(`unknown group ${id} — it is not in the last \`ac mutate\` run`);
      for (const s of members) picked.set(s.key, { s, group: id });
    } else {
      const s = kept.find((x) => x.key === id);
      if (!s) throw new Error(`unknown survivor ${id} — it is not in the last \`ac mutate\` run`);
      picked.set(s.key, { s, group: null });
    }
  }
  const at = now.toISOString();
  const file = survivorsFile(root, slug);
  return withLock(paths(root).lock, () => {
    const { judgements } = readJudgements(file);
    const byKey = new Map(judgements.map((e) => [e.key, e]));
    for (const [key, { s, group }] of picked) {
      byKey.set(key, {
        key, file: s.file, fn: s.fn ?? null, kind: s.kind ?? null, line_text: s.line_text ?? '', triage,
        ...(oneLine(justification) ? { justification } : {}), ...(group ? { group } : {}), at,
      });
    }
    const out = [...byKey.values()].sort((a, b) => cmp(a.key, b.key));
    atomicWriteJSON(file, { version: 1, judgements: out });
    return { file, written: picked.size, total: out.length, keys: [...picked.keys()].sort() };
  });
}

/**
 * Overlay the judgements on a survivor list: a survivor whose key has an entry gets `triage`,
 * `justification` and `judged: true`. `stale` counts entries matching no survivor — the file is
 * never pruned automatically, so a capped run cannot drop a judgement (7fdd).
 */
export function applyJudgements(survivors, judgements) {
  const byKey = new Map(judgements.map((e) => [e.key, e]));
  const used = new Set();
  const out = survivors.map((s) => {
    const e = s.key ? byKey.get(s.key) : null;
    if (!e) return s;
    used.add(e.key);
    return { ...s, triage: e.triage, ...(e.justification ? { justification: e.justification } : {}), judged: true };
  });
  return { survivors: out, stale: judgements.filter((e) => !used.has(e.key)).length };
}
