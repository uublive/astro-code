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
// same slowness signal, counted as detected. mutmut 3.x names carry no line, so line is 0.
import { MUTANT_STATUSES } from './verdict.mjs';

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

/** Bucket, scope-filter and sort a flat `[{file,line,mutator,status,id?}]` list. */
export function normalize(list, scope = null) {
  const sc = scope ? scope.map(norm) : null;
  const out = { mutants: [], not_run: [], ignored: [] };
  const keyed = [];
  for (const raw of list) {
    const file = inScope(norm(raw.file), sc);
    if (file === null) continue;
    keyed.push({ file, line: raw.line, mutator: raw.mutator, status: raw.status, id: String(raw.id ?? '') });
  }
  const num = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  keyed.sort((a, b) => num(a.file, b.file) || num(a.line, b.line) || num(a.mutator, b.mutator)
    || num(a.id.padStart(12, '0'), b.id.padStart(12, '0')) || num(a.status, b.status));
  for (const { id, ...m } of keyed) {
    if (m.status === NOT_RUN) out.not_run.push({ ...m, status: NOT_RUN });
    else if (m.status === IGNORED) out.ignored.push({ ...m, status: IGNORED });
    else out.mutants.push(m);
  }
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

export function parseStryker(text, { scope = null } = {}) {
  const r = parseJson(text);
  if (!r || !r.files || typeof r.files !== 'object') return { error: 'not a Stryker mutation report (no files{})' };
  const list = [];
  for (const [file, f] of Object.entries(r.files)) {
    for (const m of Array.isArray(f?.mutants) ? f.mutants : []) {
      list.push({
        file, line: m.location?.start?.line ?? 0, mutator: m.mutatorName || 'unknown',
        status: mapOr(STRYKER, m.status), id: m.id,
      });
    }
  }
  return normalize(list, scope);
}

export function parseGremlins(text, { scope = null } = {}) {
  const r = parseJson(text);
  if (!r || !Array.isArray(r.files)) return { error: 'not a Gremlins report (no files[])' };
  const list = [];
  for (const f of r.files) {
    for (const [i, m] of (Array.isArray(f?.mutations) ? f.mutations : []).entries()) {
      list.push({
        file: f.file_name, line: m.line ?? 0, mutator: m.type || 'unknown',
        status: mapOr(GREMLINS, m.status), id: `${m.column ?? 0}.${i}`,
      });
    }
  }
  return normalize(list, scope);
}

const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];

export function parseMutmutJunit(text, { scope = null } = {}) {
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
    const msg = (/\b(?:message|type)="([^"]*)"/.exec(body)?.[1] ?? '').toLowerCase();
    let status = 'killed';
    if (body.trim()) {
      if (/survived/.test(msg)) status = 'survived';
      else if (/timeout|suspicious/.test(msg)) status = 'timeout';
      else if (/untested|not checked|not_checked/.test(msg)) status = NOT_RUN;
      else if (/<skipped\b/.test(body)) status = IGNORED;
      else status = 'error';
    }
    list.push({ file, line: Number(attr(head, 'line')) || 0, mutator: name, status, id: name.replace(/\D+/g, '') });
  }
  return normalize(list, scope);
}

const MUTMUT3 = {
  killed: 'killed', survived: 'survived', timeout: 'timeout', 'no tests': 'no-coverage',
  suspicious: 'timeout', segfault: 'error', 'not checked': NOT_RUN, skipped: IGNORED,
  'check was interrupted by user': NOT_RUN,
};

export function parseMutmutResults(text, { scope = null } = {}) {
  const list = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^\s*([\w.]+__mutmut_(\d+)):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const name = m[1];
    const dot = name.lastIndexOf('.');
    if (dot < 1) continue;
    list.push({
      file: name.slice(0, dot).replace(/\./g, '/') + '.py', line: 0, mutator: name.slice(dot + 1),
      status: mapOr(MUTMUT3, m[3].toLowerCase()), id: m[2],
    });
  }
  if (!list.length) return { error: 'no mutmut results lines found' };
  return normalize(list, scope);
}
