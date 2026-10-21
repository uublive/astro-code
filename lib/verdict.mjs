// Saved verify verdicts and the narrowing decision (ADR-079, amends ADR-031).
//
// Why this exists: a re-verify after a FAIL used to re-run the whole verifier even when one
// or two criteria were still unmet (#129: 33% of measured verifier cost). Nothing persisted
// between runs, so there was nothing to narrow FROM. `VERDICT.json` is that memory: one file
// per phase, beside CRITERIA.md, the latest verdict only, written solely by `ac verdict record`.
//
// The guarantee ADR-031 gave is kept, not traded: narrowing only makes a still-failing
// re-verify cheap. A PASS needs a FULL run — every criterion independently checked — and
// `verifiedGate` enforces that in code, so no carried or narrowed verdict can mark a phase
// verified however the prose around it reads (ce7b).
//
// Rules live here and only here (9173): the thresholds, the fingerprint, the mode decision
// and the gate. The workflow and `/astro-verify` both ask `ac verdict plan`; neither restates
// a number.
//
// The commit-ordering trap (D6): the verdict file records the commit it GRADED, so HEAD is
// read BEFORE the write; the verdict is then committed on its own (path-limited), which
// moves HEAD one commit past the graded one. The gate therefore cannot demand
// `commit === HEAD`; it demands that the graded commit is an ancestor of HEAD and that
// nothing outside `.astrocode/` changed since. A failed commit (no repo, a hook) leaves the
// file written and reports `committed: false` — fail soft (b940).
//
// Phase 47 (ADR-083) adds optional mutation evidence per criterion. The rules for it live
// here too and nowhere else (9173): the `[mutation]` heading marker (`testStrengthIds`), the
// evidence contract (`MUTANT_STATUSES`, `TRIAGES`, `validateMutation`) and the pass bar
// (`mutationGate`). The bar is a code gate, not prose (ce7b): a test-gap survivor, an
// unjustified equivalent, a capped or incomplete run can never be recorded as a passing
// criterion however the verifier words it. Structural junk is refused outright; a breach of
// the bar is SAVED as `failed` with a `refused` reason, so the remediation loop sees why.
// `version` stays 1: the field is additive.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './paths.mjs';
import { git, gitOk } from './git.mjs';
import { withLock, atomicWriteJSON, assertSafeSlug } from './util.mjs';

export const VERDICT_FILE = 'VERDICT.json';

// Narrowing is allowed only while few criteria are unmet: at most MAX_NARROW_UNMET, and at
// most a third of all criteria. Past either, the failing set is no longer "a small local
// miss" and a narrowed pass saves little while a broad regression hides. Integer maths only:
// `unmet * NARROW_DENOMINATOR <= total`.
export const MAX_NARROW_UNMET = 3;
export const NARROW_DENOMINATOR = 3;

const STATUSES = new Set(['passed', 'failed', 'carried']);
const MODES = new Set(['full', 'narrowed']);

// ---- Mutation evidence contract (phase 47, ADR-083) ----
// Statuses every mutant lands in. Timeouts count as killed (the tool saw the change);
// `survived` and `no-coverage` are the survivors a verifier must triage.
export const MUTANT_STATUSES = ['killed', 'survived', 'timeout', 'no-coverage', 'error'];
export const SURVIVOR_STATUSES = ['survived', 'no-coverage'];
export const MUTATION_OUTCOMES = ['clean', 'survivors', 'incomplete', 'no-scope', 'tool-missing', 'no-tool', 'error'];
// Outcomes where "no tool evidence" is legitimate and the AI-mutant fallback may stand.
export const FALLBACK_OUTCOMES = ['tool-missing', 'no-tool', 'no-scope'];
export const TRIAGES = ['test-gap', 'equivalent'];

/**
 * Criterion ids whose heading carries the `[mutation]` test-strength tag
 * (`### C4 [mutation] — claim`), unique, in file order. Heading line only, case-insensitive:
 * a mention in a body line never opts a criterion in. The one matcher for the marker.
 */
export function testStrengthIds(text) {
  const ids = [];
  for (const m of String(text ?? '').matchAll(/^#{1,6}\s*(C\d+)\b([^\n]*)$/gm)) {
    if (/\[mutation\]/i.test(m[2]) && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const oneLine = (x) => typeof x === 'string' && x.trim() !== '' && !/[\r\n]/.test(x);

/** Structural check only (throws). The semantic bar is `mutationGate`. */
export function validateMutation(m, id = '?') {
  const bad = (why) => { throw new Error(`criterion ${id}: mutation evidence ${why}`); };
  if (!isObj(m)) bad('must be an object');
  if (!isObj(m.counts)) bad('needs counts{}');
  for (const k of MUTANT_STATUSES) {
    if (!Number.isInteger(m.counts[k]) || m.counts[k] < 0) bad(`counts.${k} must be a non-negative integer`);
  }
  if (!Array.isArray(m.survivors)) bad('needs survivors[]');
  for (const s of m.survivors) {
    if (!isObj(s)) bad('survivors must be objects');
    if (s.triage !== undefined && !TRIAGES.includes(s.triage)) bad(`has an unknown triage "${s.triage}"`);
  }
  if (m.outcome !== undefined && !MUTATION_OUTCOMES.includes(m.outcome)) bad(`has an unknown outcome "${m.outcome}"`);
  if (m.fallback != null && !isObj(m.fallback)) bad('fallback must be an object or null');
}

/**
 * Pure pass bar. `{ ok: true }` or `{ ok: false, reason }`. Applies to a criterion that is
 * `[mutation]`-marked or carries evidence AND is reported passed; callers skip the rest.
 */
export function mutationGate({ marked, mutation }) {
  const no = (reason) => ({ ok: false, reason });
  const m = mutation;
  if (!m) return marked ? no('marked [mutation] but no mutation evidence was recorded') : { ok: true };
  if (m.fallback) {
    if (!FALLBACK_OUTCOMES.includes(m.outcome)) {
      return no(`fallback is only allowed for ${FALLBACK_OUTCOMES.join('/')}, not outcome "${m.outcome}"`);
    }
    if (!oneLine(m.fallback.reason)) return no('fallback needs a one-line reason');
    // A fallback means the tool produced NO evidence; real run counts or survivors beside it are a contradiction.
    if (m.survivors.length || MUTANT_STATUSES.some((k) => m.counts[k] > 0)) {
      return no('fallback evidence must carry no tool mutants — counts and survivors come from a real run');
    }
    return { ok: true };
  }
  if (m.capped) return no(`run was capped at ${m.cap_seconds ?? '?'}s — a capped run is never all killed`);
  if (m.complete !== true) return no('run is not complete — not every mutant ran');
  if (m.outcome !== 'clean' && m.outcome !== 'survivors') return no(`outcome is "${m.outcome}", not clean or survivors`);
  const total = MUTANT_STATUSES.reduce((n, k) => n + m.counts[k], 0);
  if (total === 0) return no('zero mutants ran — nothing was tested');
  const expected = SURVIVOR_STATUSES.reduce((n, k) => n + m.counts[k], 0);
  if (m.survivors.length !== expected) {
    return no(`${m.survivors.length} survivors listed but counts say ${expected} — every survivor must be triaged`);
  }
  for (const s of m.survivors) {
    const at = `${s.file}:${s.line} ${s.mutator}`;
    if (s.triage === 'test-gap') return no(`survivor ${at} is a test-gap`);
    if (s.triage !== 'equivalent') return no(`survivor ${at} is untriaged`);
    if (!oneLine(s.justification)) return no(`survivor ${at} is equivalent without a one-line justification`);
  }
  return { ok: true };
}

/** Criterion ids from CRITERIA.md headings (`### C3 — …`), unique, in file order. */
export function parseCriteriaIds(text) {
  const ids = [];
  for (const m of String(text ?? '').matchAll(/^#{1,6}\s*(C\d+)\b/gm)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

/** Fingerprint of the exact CRITERIA.md bytes: any edit, even one character, changes it. */
export function criteriaHash(text) {
  return 'sha256:' + createHash('sha256').update(text).digest('hex');
}

const criteriaFile = (root, slug) => join(paths(root).phases, slug, 'CRITERIA.md');
const verdictFile = (root, slug) => join(paths(root).phases, slug, VERDICT_FILE);

/** Total: never throws. `{ verdict, reason }` — verdict is null with a reason when unusable. */
export function readVerdict(file) {
  if (!existsSync(file)) return { verdict: null, reason: 'no saved verdict' };
  let v;
  try {
    v = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { verdict: null, reason: 'saved verdict is unreadable' };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.version !== 1) {
    return { verdict: null, reason: 'saved verdict has an unknown version' };
  }
  if (!MODES.has(v.mode) || !Number.isInteger(v.run) || !Array.isArray(v.criteria)
      || !v.criteria.every((c) => c && typeof c.id === 'string' && STATUSES.has(c.status))) {
    return { verdict: null, reason: 'saved verdict is malformed' };
  }
  return { verdict: v, reason: null };
}

const failingOf = (v) => v.criteria
  .filter((c) => c.status === 'failed' || (c.status === 'carried' && c.last === 'failed'))
  .map((c) => c.id);

const isAncestor = (root, sha) =>
  typeof sha === 'string' && /^[0-9a-f]{4,64}$/i.test(sha)
  && gitOk(['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: root });

/**
 * Pure mode decision. Rules run cheapest first; the first that fires decides.
 * `ancestor` is a boolean the caller computed from git.
 */
export function chooseMode({ full, ids, verdict, verdictReason, hash, ancestor }) {
  const fullBecause = (reason) => ({ mode: 'full', reason, first: [] });
  if (full) return fullBecause('--full passed');
  if (!ids || ids.length === 0) return fullBecause('no criterion ids in CRITERIA.md');
  if (!verdict) return fullBecause(verdictReason || 'no saved verdict');
  if (verdict.criteria_sha !== hash) return fullBecause('CRITERIA.md changed since the saved verdict');
  const failing = failingOf(verdict);
  if (failing.length === 0) return fullBecause('the saved verdict has no unmet criterion');
  if (failing.some((id) => !ids.includes(id))) {
    return fullBecause('an unmet criterion is no longer in CRITERIA.md');
  }
  if (!ancestor) return fullBecause('the saved verdict commit is not an ancestor of HEAD');
  const unmet = failing.length;
  if (unmet > MAX_NARROW_UNMET || unmet * NARROW_DENOMINATOR > ids.length) {
    return fullBecause(`too many unmet criteria (${unmet} of ${ids.length})`);
  }
  return { mode: 'narrowed', reason: `${unmet} of ${ids.length} unmet`, first: ids.filter((id) => failing.includes(id)) };
}

/** Gather the inputs, decide. Never throws on a bad/absent verdict. */
export function planReverify(root, slug, { full = false } = {}) {
  assertSafeSlug(slug);
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const ids = parseCriteriaIds(text);
  const { verdict, reason } = readVerdict(verdictFile(root, slug));
  const ancestor = verdict ? isAncestor(root, verdict.commit) : false;
  const d = chooseMode({
    full, ids, verdict, verdictReason: reason, hash: text ? criteriaHash(text) : null, ancestor,
  });
  return {
    mode: d.mode,
    reason: d.reason,
    first: d.first,
    ids,
    total: ids.length,
    saved: verdict ? { run: verdict.run, commit: verdict.commit, mode: verdict.mode } : null,
    range: verdict ? `${verdict.commit}..HEAD` : null,
  };
}

function validateResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('verdict result must be a JSON object');
  if (!MODES.has(r.mode)) throw new Error('verdict result needs mode "full" or "narrowed"');
  if (!Array.isArray(r.criteria)
      || !r.criteria.every((c) => c && typeof c.id === 'string' && typeof c.passed === 'boolean')) {
    throw new Error('verdict result needs criteria: [{ id, passed }]');
  }
}

/**
 * Derive and save the verdict. `passed` is computed here and never trusted from the caller:
 * a narrowed run can never be a pass (the C4 code guard).
 */
export async function recordVerdict(root, slug, result) {
  assertSafeSlug(slug);
  validateResult(result);
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const ids = parseCriteriaIds(text);
  if (ids.length === 0) {
    throw new Error(`phase ${slug} has no CRITERIA.md with C<n> ids — nothing to record a verdict against`);
  }
  const reported = new Map();
  let ignored = 0;
  for (const c of result.criteria) {
    if (!ids.includes(c.id)) { ignored++; continue; }
    if (c.mutation !== undefined && c.mutation !== null) validateMutation(c.mutation, c.id);
    reported.set(c.id, c);
  }
  const marked = testStrengthIds(text);
  const mode = result.broad === true ? 'full' : result.mode;
  const file = verdictFile(root, slug);
  const p = paths(root);

  return withLock(p.lock, () => {
    // Read HEAD BEFORE writing: the recorded commit is the graded commit (D6).
    const head = git(['rev-parse', 'HEAD'], { cwd: root });
    const commit = head.status === 0 ? head.stdout.trim() : null;
    const { verdict: prior } = readVerdict(file);
    const run = prior ? prior.run + 1 : 1;

    const refused = [];
    const criteria = ids.map((id) => {
      if (reported.has(id)) {
        const c = reported.get(id);
        const mutation = c.mutation ?? undefined;
        const e = { id, status: c.passed ? 'passed' : 'failed' };
        if (c.passed && (mutation || marked.includes(id))) {
          const g = mutationGate({ marked: marked.includes(id), mutation });
          if (!g.ok) { e.status = 'failed'; e.refused = g.reason; refused.push({ id, reason: g.reason }); }
        }
        if (mutation) e.mutation = mutation;
        return e;
      }
      if (mode === 'full' || !prior) return { id, status: 'failed' }; // absence of evidence is failure
      const was = prior.criteria.find((c) => c.id === id);
      if (!was) return { id, status: 'failed' };
      const keep = was.mutation ? { mutation: was.mutation } : {};
      if (was.status === 'carried') return { id, status: 'carried', last: was.last, from: was.from, ...keep };
      return { id, status: 'carried', last: was.status, from: { run: prior.run, commit: prior.commit }, ...keep };
    });

    const verdict = {
      version: 1, run, mode, broad: result.broad === true, commit,
      criteria_sha: criteriaHash(text), at: new Date().toISOString(), criteria,
    };
    atomicWriteJSON(file, verdict);

    const passed = mode === 'full' && criteria.every((c) => c.status === 'passed');
    const carried = criteria.filter((c) => c.status === 'carried');
    const out = {
      recorded: true, run, mode, passed, failing: failingOf(verdict), commit,
      criteria_sha: verdict.criteria_sha, carried: carried.length,
      carriedFrom: carried[0]?.from ?? null, ignored, committed: false,
    };
    if (refused.length) out.refused = refused;

    // Commit ONLY this file. No (phase NN tK) stamp: the ADR-041 audit must not see it.
    const num = /^(\d+)/.exec(slug)?.[1] ?? slug;
    const add = git(['add', '--', file], { cwd: root });
    const msg = `chore(verdict): phase ${num} run ${run} — ${mode} ${passed ? 'PASS' : 'FAIL'}`;
    const c = add.status === 0 ? git(['commit', '-m', msg, '--', file], { cwd: root }) : add;
    if (c.status === 0) out.committed = true;
    else out.commitError = (c.stderr || c.stdout || 'git commit failed').trim().split('\n')[0];
    return out;
  });
}

/** `{ ok, reason }` — may this phase move to `verified`? Only a full, all-passed verdict on code that has not moved. */
export function verifiedGate(root, slug) {
  assertSafeSlug(slug);
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const ids = parseCriteriaIds(text);
  // A self-derived bar (astro-fast lane, legacy phases) has no stable ids to record against.
  if (ids.length === 0) return { ok: true, reason: null };
  const no = (reason) => ({ ok: false, reason });
  const { verdict, reason } = readVerdict(verdictFile(root, slug));
  if (!verdict) return no(reason);
  if (verdict.mode !== 'full') return no('the latest verdict is a narrowed run');
  const bad = ids.filter((id) => verdict.criteria.find((c) => c.id === id)?.status !== 'passed');
  if (bad.length) return no(`the latest verdict has no pass for ${bad.join(', ')}`);
  if (verdict.criteria_sha !== criteriaHash(text)) return no('CRITERIA.md changed since the latest verdict');
  if (!isAncestor(root, verdict.commit)) return no('the verdict commit is not an ancestor of HEAD');
  const d = git(['diff', '--name-only', verdict.commit, 'HEAD', '--', '.', ':(exclude).astrocode'], { cwd: root });
  if (d.status !== 0 || d.stdout.trim()) return no('code changed since the verdict was recorded');
  return { ok: true, reason: null };
}
