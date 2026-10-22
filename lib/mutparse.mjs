// Mutation-report parsers and status maps (phase 47, P6; ADR-083).
//
// Why this exists: `ac mutate` must turn three tools' reports into ONE fixed list so the
// verifier only judges survivors. Every mutant lands in exactly one bucket:
//   mutants  — one of MUTANT_STATUSES (the contract lives in lib/verdict.mjs, 9173);
//   not_run  — the tool never got to it (Stryker Pending, Gremlins RUNNABLE, mutmut "not
//              checked"/untested), so a capped run can say what it did not cover;
//   ignored  — the tool skipped it on purpose (Stryker Ignored, Gremlins SKIPPED, mutmut skipped).
// Timeouts stay `timeout` here; classification counts them as killed (D4).
//
// Pure and total: garbage input returns `{ error }`, never throws. Output is sorted (file,
// line, mutator, then the tool's own id) so two parses of one report are byte-identical (C1).
// Zero deps: the mutmut junit XML is flat, so it is read with plain string matching.
//
// Format notes (no network was available when these were written — verify against the tools'
// current docs): Stryker `mutation-testing-report-schema` `files{path:{mutants[]}}`; Gremlins
// `--output` JSON `files[].mutations[]`; mutmut 2.x `junitxml`; mutmut 3.x `results` lines.
// mutmut "suspicious" (test run far slower than the baseline) is mapped to `timeout`: the
// same slowness signal, counted as detected. mutmut 3.x names carry no line: a caller that mapped
// them (`mutmutShowLine` / `mutantsFileOffsets`, below) passes `lines`; an unmapped mutant has
// `line: null` — never 0, which would read as a real line (phase 48, P9).
//
// Phase 49: Stryker's `id` and Gremlins' index are run-local, so neither can identify a mutant
// across runs — that identity is built in `lib/survivors.mjs`. The parsers only carry what it
// needs (replacement, location, column, killedBy) and add nothing when the tool gave none.
//
// Phase 48 adds the narrowing filter. `normalize` takes `{ ranges, funcs }`: a mutant in a scoped
// file but outside the phase's changed line ranges (or changed mutmut functions) is not dropped
// silently — it lands in `outside`, with the files the scope excluded, so the counts reconcile to
// the report's total and the full list on disk can show it. A filter handed to a tool is never
// trusted (phase 47 P4), which is why the parser applies it again.
import { MUTANT_STATUSES } from './verdict.mjs';
import { pythonFunctions, parseMutantName } from './pyscan.mjs';

const NOT_RUN = 'not_run';
const IGNORED = 'ignored';

const norm = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

// A report path may be relative to a sub-root (mutmut 3.x module paths, Gremlins module-relative
// paths): accept an exact match, else the one scope entry that ends with it. Null = out of scope.
function inScope(file, scope) {
  if (!scope) return file;
  if (scope.includes(file)) return file;
  const hits = scope.filter((s) => s.endsWith('/' + file));
  return hits.length === 1 ? hits[0] : null;
}

// A mutant is outside the phase's narrowing when its file has changed-function names and its
// function is not one of them (mutmut 3), or the file has line ranges and its known line misses
// them all (Stryker, Gremlins, mutmut 2). An unknown line (null / 0) is kept: it cannot be judged.
function outsideNarrowing(m, ranges, funcs) {
  const fl = funcs?.[m.file];
  if (fl) return !(m.func != null && fl.includes(m.func));
  const r = ranges?.[m.file];
  if (r && Number.isInteger(m.line) && m.line > 0) return !r.some(([a, b]) => m.line >= a && m.line <= b);
  return false;
}

/**
 * Bucket, scope-filter and sort a flat `[{file,line,mutator,status,id?,func?}]` list.
 * `{ mutants, not_run, ignored, outside }`: `outside` holds every mutant not in the scope (a file
 * the scope excludes, or outside `ranges` / `funcs`) with its mapped status, so totals reconcile.
 */
export function normalize(list, scope = null, { ranges = null, funcs = null } = {}) {
  const sc = scope ? scope.map(norm) : null;
  const out = { mutants: [], not_run: [], ignored: [], outside: [] };
  const keyed = [];
  const num = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // A null line sorts last within its file.
  const lineKey = (l) => (Number.isInteger(l) ? l : Number.MAX_SAFE_INTEGER);
  const mapped = (raw, file) => ({
    file, line: raw.line, mutator: raw.mutator, status: raw.status, id: String(raw.id ?? ''),
    ...(raw.func !== undefined ? { func: raw.func } : {}),
    ...(raw.name !== undefined ? { name: raw.name } : {}),
    // Phase 49: what the survivor-identity key and the `--survivors` narrowing need, carried only
    // when the tool gave it (Stryker: replacement, loc, col, killedBy; Gremlins: col).
    ...(raw.replacement !== undefined ? { replacement: raw.replacement } : {}),
    ...(raw.loc !== undefined ? { loc: raw.loc } : {}),
    ...(raw.col !== undefined ? { col: raw.col } : {}),
    ...(raw.killedBy !== undefined ? { killedBy: raw.killedBy } : {}),
  });
  for (const raw of list) {
    const file = inScope(norm(raw.file), sc);
    if (file === null) { out.outside.push(mapped(raw, norm(raw.file))); continue; }
    const m = mapped(raw, file);
    if (outsideNarrowing(m, ranges, funcs)) out.outside.push(m);
    else keyed.push(m);
  }
  keyed.sort((a, b) => num(a.file, b.file) || num(lineKey(a.line), lineKey(b.line)) || num(a.mutator, b.mutator)
    || num(a.id.padStart(12, '0'), b.id.padStart(12, '0')) || num(a.status, b.status));
  // `id` is the tool's own mutant id (Stryker id, mutmut number, Gremlins column.index): two
  // mutants can share file, line and mutator, so the id is what tells survivors apart (C9).
  for (const m of keyed) {
    if (m.status === NOT_RUN) out.not_run.push({ ...m, status: NOT_RUN });
    else if (m.status === IGNORED) out.ignored.push({ ...m, status: IGNORED });
    else out.mutants.push(m);
  }
  return out;
}

/**
 * Zero-filled per-file counts over a parse result: the five mutant statuses plus `not_run` and
 * `ignored`. Their grand total equals `mutants + not_run + ignored` (`outside` is counted apart).
 */
export function perFileCounts(parsed) {
  const out = {};
  const row = (f) => (out[f] ??= { ...Object.fromEntries(MUTANT_STATUSES.map((s) => [s, 0])), not_run: 0, ignored: 0 });
  for (const m of parsed.mutants ?? []) row(m.file)[m.status]++;
  for (const m of parsed.not_run ?? []) row(m.file).not_run++;
  for (const m of parsed.ignored ?? []) row(m.file).ignored++;
  return out;
}

/** Counts for all five statuses (zero-filled), over a `mutants` list. */
export function countStatuses(mutants) {
  const c = Object.fromEntries(MUTANT_STATUSES.map((s) => [s, 0]));
  for (const m of mutants) if (m.status in c) c[m.status]++;
  return c;
}

const STRYKER = {
  Killed: 'killed', Survived: 'survived', Timeout: 'timeout', NoCoverage: 'no-coverage',
  RuntimeError: 'error', CompileError: 'error', Ignored: IGNORED, Pending: NOT_RUN,
};
const GREMLINS = {
  KILLED: 'killed', LIVED: 'survived', 'TIMED OUT': 'timeout', 'NOT COVERED': 'no-coverage',
  'NOT VIABLE': 'error', SKIPPED: IGNORED, RUNNABLE: NOT_RUN,
};
// An unknown tool status is an `error` mutant, never silently dropped or counted as killed.
const mapOr = (table, s) => table[s] ?? 'error';

function parseJson(text) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : null;
  } catch { return null; }
}

export function parseStryker(text, { scope = null, ranges = null } = {}) {
  const r = parseJson(text);
  if (!r || !r.files || typeof r.files !== 'object') return { error: 'not a Stryker mutation report (no files{})' };
  const list = [];
  // `killedBy` holds run-local test ids; the report's `testFiles[].tests[]` turns them into names.
  const testName = {};
  for (const tf of Object.values(r.testFiles && typeof r.testFiles === 'object' ? r.testFiles : {})) {
    for (const t of Array.isArray(tf?.tests) ? tf.tests : []) if (t?.id !== undefined) testName[t.id] = t.name ?? String(t.id);
  }
  const pos = (p) => (Number.isInteger(p?.line) && Number.isInteger(p?.column) ? { line: p.line, column: p.column } : null);
  for (const [file, f] of Object.entries(r.files)) {
    for (const m of Array.isArray(f?.mutants) ? f.mutants : []) {
      const start = pos(m.location?.start);
      const end = pos(m.location?.end);
      list.push({
        file, line: m.location?.start?.line ?? 0, mutator: m.mutatorName || 'unknown',
        status: mapOr(STRYKER, m.status), id: m.id,
        ...(typeof m.replacement === 'string' ? { replacement: m.replacement } : {}),
        ...(start && end ? { loc: { start, end }, col: start.column } : {}),
        ...(Array.isArray(m.killedBy) ? { killedBy: m.killedBy.map((t) => testName[t] ?? String(t)) } : {}),
      });
    }
  }
  return normalize(list, scope, { ranges });
}

export function parseGremlins(text, { scope = null, ranges = null } = {}) {
  const r = parseJson(text);
  if (!r || !Array.isArray(r.files)) return { error: 'not a Gremlins report (no files[])' };
  const list = [];
  for (const f of r.files) {
    for (const [i, m] of (Array.isArray(f?.mutations) ? f.mutations : []).entries()) {
      list.push({
        file: f.file_name, line: m.line ?? 0, mutator: m.type || 'unknown',
        status: mapOr(GREMLINS, m.status), id: `${m.column ?? 0}.${i}`,
        ...(Number.isInteger(m.column) ? { col: m.column } : {}),
      });
    }
  }
  return normalize(list, scope, { ranges });
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

export function parseMutmutJunit(text, { scope = null, skippedIds = [], ranges = null } = {}) {
  const skipped = new Set(skippedIds.map(String));
  const src = String(text ?? '');
  if (!/<testsuite\b/.test(src)) return { error: 'not a mutmut junitxml report (no <testsuite>)' };
  const list = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  for (const m of src.matchAll(re)) {
    const head = m[1];
    const body = m[3] ?? '';
    const name = attr(head, 'name') ?? '';
    const file = attr(head, 'file') ?? attr(head, 'classname');
    if (!file || !name) continue;
    // Real junit_xml writes `<failure type="failure" message="bad_survived">`: the message is the
    // status, `type` only a fallback.
    const res = /<(?:failure|error|skipped)\b([^>]*)>/.exec(body)?.[1] ?? '';
    const msg = (attr(res, 'message') ?? attr(res, 'type') ?? '').toLowerCase();
    // mutmut 2.x gives every testcase a <system-out> (the mutated line), killed ones included:
    // only a failure/error/skipped tag carries a status, any other body is still killed.
    let status = 'killed';
    if (/<(?:failure|error|skipped)\b/.test(body)) {
      if (/survived/.test(msg)) status = 'survived';
      else if (/timeout|suspicious/.test(msg)) status = 'timeout';
      else if (/untested|not checked|not_checked/.test(msg)) status = NOT_RUN;
      else if (/<skipped\b/.test(body)) status = IGNORED;
      else status = 'error';
    }
    const id = name.replace(/\D+/g, '');
    if (status === 'killed' && skipped.has(id)) status = IGNORED;
    list.push({ file, line: Number(attr(head, 'line')) || 0, mutator: name, status, id });
  }
  return normalize(list, scope, { ranges });
}

const MUTMUT3 = {
  killed: 'killed', survived: 'survived', timeout: 'timeout', 'no tests': 'no-coverage',
  suspicious: 'timeout', segfault: 'error', 'not checked': NOT_RUN, skipped: IGNORED,
  'check was interrupted by user': NOT_RUN,
};

/**
 * `lines` maps a full mutant name (`pkg.mod.x_b__mutmut_3`) to its real source line; a mutant not
 * in it has `line: null`. `funcs` / `ranges` narrow as in `normalize`. Every entry carries `func`.
 */
export function parseMutmutResults(text, { scope = null, lines = null, funcs = null, ranges = null } = {}) {
  const list = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*([^\s:]+__mutmut_(\d+)):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const dot = name.lastIndexOf('.');
    if (dot < 1) continue;
    // mutmut 3 names a package's `__init__.py` mutants after the package (`pkg.x_f__mutmut_1`):
    // the module is `pkg.py` or `pkg/__init__.py`, and the scope says which one exists.
    const mod = name.slice(0, dot).replace(/\./g, '/');
    const sc = scope ? scope.map(norm) : null;
    const file = sc && inScope(`${mod}.py`, sc) === null && inScope(`${mod}/__init__.py`, sc) !== null
      ? `${mod}/__init__.py` : `${mod}.py`;
    const at = lines?.[name];
    list.push({
      file, line: Number.isInteger(at) && at > 0 ? at : null, mutator: name.slice(dot + 1),
      status: mapOr(MUTMUT3, m[3].toLowerCase()), id: m[2], func: parseMutantName(name)?.qual ?? null, name,
    });
  }
  if (!list.length) return { error: 'no mutmut results lines found' };
  return normalize(list, scope, { funcs, ranges });
}

// ---- mutmut 3 line mapping (phase 48, P9) ----
// mutmut 3 names a mutant `pkg.mod.x_b__mutmut_3` and gives no line. Two text-only routes find it
// (333f: no interpretation, no process per mutant):
//  - a survivor: `mutmut show <name>` prints a unified diff whose hunk is relative to the FUNCTION
//    (its `def` is line 1), so the guess is def + the removed line's offset; the removed text is
//    checked against the real source, and searched for inside the function when the guess misses
//    (a decorator or a mutated signature shifts it);
//  - every mutant: the generated `mutants/<file>` holds `x_<f>__mutmut_orig` and one body per
//    mutant, so the first line that differs from orig gives the offset with no process at all.

/**
 * The 1-based source line a `mutmut show` diff mutated. `fn` is the function record from
 * `pythonFunctions(srcText)`. `null` when it cannot be placed inside the function.
 */
export function mutmutShowLine(diff, srcText, fn) {
  if (!fn) return null;
  const rows = String(diff ?? '').replace(/\r\n?/g, '\n').split('\n');
  const h = rows.findIndex((r) => /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.test(r));
  if (h < 0) return null;
  const oldStart = Number(/^@@ -(\d+)/.exec(rows[h])[1]);
  let old = oldStart;
  let removed = null;
  let at = null;
  for (const r of rows.slice(h + 1)) {
    if (r.startsWith('-')) { removed = r.slice(1); at = old; break; }
    if (r.startsWith('+')) { at = old; break; } // a pure addition: placed by position only
    if (r.startsWith(' ') || r === '') old += 1;
  }
  if (at === null) return null;
  const guess = fn.def + at - 1;
  const src = String(srcText ?? '').replace(/\r\n?/g, '\n').split('\n');
  const same = (n) => removed !== null && (src[n - 1] ?? '').trim() === removed.trim();
  if (removed === null) return guess >= fn.start && guess <= fn.end ? guess : null;
  if (guess >= fn.start && guess <= fn.end && same(guess)) return guess;
  let best = null;
  for (let n = fn.start; n <= fn.end; n += 1) {
    if (same(n) && (best === null || Math.abs(n - guess) < Math.abs(best - guess))) best = n;
  }
  return best;
}

/**
 * `{ 'x_b__mutmut_3': offset }` from a generated `mutants/<file>`: the 0-based offset from the
 * mutant function's `def` line of the first line that differs from its `__mutmut_orig` body.
 * Add it to the SOURCE function's `def` line for the real line. Mutants identical to orig map to 0.
 */
export function mutantsFileOffsets(generated) {
  const text = String(generated ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const funcs = pythonFunctions(text);
  const body = (f) => lines.slice(f.def - 1, f.end).map((l) => l.trim());
  const orig = new Map();
  for (const f of funcs) {
    const m = /^(.*)__mutmut_orig$/.exec(f.name);
    if (m) orig.set(`${f.cls ?? ''}\0${m[1]}`, body(f));
  }
  const out = {};
  for (const f of funcs) {
    const m = /^(.*)__mutmut_\d+$/.exec(f.name);
    const base = m && orig.get(`${f.cls ?? ''}\0${m[1]}`);
    if (!base) continue;
    const mine = body(f);
    const bare = (l) => l.replace(/__mutmut_(?:orig|\d+)/, '');
    // The def line differs by name alone unless the signature itself was mutated (offset 0).
    if (bare(base[0]) !== bare(mine[0])) { out[f.name] = 0; continue; }
    let i = 1;
    for (; i < Math.min(base.length, mine.length); i += 1) if (base[i] !== mine[i]) break;
    out[f.name] = i < Math.min(base.length, mine.length) || base.length !== mine.length ? i : 0;
  }
  return out;
}
