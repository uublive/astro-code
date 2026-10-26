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
// Phase 52 (amends ADR-079 for the after-PASS case): a verify after a recorded FULL PASS is
// TARGETED. `chooseMode` computes from the diff since that PASS the floor of criteria the change
// can affect (named files via `lib/impact.mjs`, unmapped criteria, suite criteria, test-strength
// criteria whose mutate scope changed); the verifier may only widen it. Everything else is carried
// from the phase's most recent full PASS (`base`, kept in VERDICT.json), one hop only. ADR-079 stays
// exactly as it was for the re-verify after a FAIL: a FAIL always takes precedence over targeting.
// One decider (`chooseMode`), one scope gatherer (`gatherScope`) shared by plan, record and gate.
//
// Phase 47 (ADR-083) adds optional mutation evidence per criterion. The rules for it live
// here too and nowhere else (9173): the `[mutation]` heading marker (`testStrengthIds`), the
// evidence contract (`MUTANT_STATUSES`, `TRIAGES`, `validateMutation`) and the pass bar
// (`mutationGate`). The bar is a code gate, not prose (ce7b): a test-gap survivor, an
// unjustified equivalent, a capped or incomplete run can never be recorded as a passing
// criterion however the verifier words it. Structural junk is refused outright; a breach of
// the bar is SAVED as `failed` with a `refused` reason, so the remediation loop sees why.
// `version` stays 1: the field is additive.
//
// Phase 49 (ADR-085, amends ADR-084's tag-only gate): the tool's result is the bar for EVERY
// test-strength criterion, tagged or not. One gate (`mutationGate`), four ways in, and the mark
// is sticky per phase. A criterion is test-strength ("marked") when (1) its heading carries
// `[mutation]`, (2) the verifier declares `test_strength: true` on it, (3) the verdict carries
// mutation evidence for it (using the tool's result IS using it for test strength, so the
// verifier forgetting the flag cannot lower the bar), or (4) the prior verdict marked it. The
// mark lives in the committed per-phase VERDICT.json entry, so a later verdict, a fresh clone or
// a re-run of /astro-verify cannot drop it, and another phase's same-numbered criterion is not
// touched (ce7b: code holds the mark; prose only tells the verifier to declare it). A
// `--survivors` re-run is a partial run: its evidence is refused outright, and a pass is refused
// when code changed since the last full run — the recorded verdict is always a full run (ADR-083).
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './paths.mjs';
import { git, gitOk } from './git.mjs';
import { withLock, atomicWriteJSON, atomicWriteText, assertSafeSlug } from './util.mjs';
import { criterionPaths, touches, trackedFiles, diffSince, suiteIds, mutateScopeFiles } from './impact.mjs';

export const VERDICT_FILE = 'VERDICT.json';

// Narrowing is allowed only while few criteria are unmet: at most MAX_NARROW_UNMET, and at
// most a third of all criteria. Past either, the failing set is no longer "a small local
// miss" and a narrowed pass saves little while a broad regression hides. Integer maths only:
// `unmet * NARROW_DENOMINATOR <= total`.
export const MAX_NARROW_UNMET = 3;
export const NARROW_DENOMINATOR = 3;

// Targeted verify (phase 52): past this many changed files, or when over half of the criteria are
// affected, the diff is broad and a targeted run saves little while a regression hides. Integer
// maths only: `affected * TARGETED_DENOMINATOR > total` goes full.
export const MAX_TARGETED_FILES = 20;
export const TARGETED_DENOMINATOR = 2;

const STATUSES = new Set(['passed', 'failed', 'carried']);
const MODES = new Set(['full', 'narrowed', 'targeted']);
// The modes `ac verdict record --result` accepts. `targeted` joins in the record task (phase 52 t4).
const RESULT_MODES = new Set(['full', 'narrowed']);
const EVIDENCES = new Set(['observed', 'carried']);

// ---- Mutation evidence contract (phase 47, ADR-083) ----
// Statuses every mutant lands in. Timeouts count as killed (the tool saw the change);
// `survived` and `no-coverage` are the survivors a verifier must triage.
export const MUTANT_STATUSES = ['killed', 'survived', 'timeout', 'no-coverage', 'error'];
export const SURVIVOR_STATUSES = ['survived', 'no-coverage'];
// `not-configured` (phase 48): the tool is installed but cannot run without configuration. It is
// deliberately NOT a fallback outcome below — an installed tool forbids hand-made mutants (D3), so
// the gate refuses a pass on it like any other non-clean outcome.
export const MUTATION_OUTCOMES = ['clean', 'survivors', 'incomplete', 'no-scope', 'tool-missing', 'no-tool', 'not-configured', 'error'];
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
  // The tag is the token right after the id (`### C4 [mutation] — …`, as the criteria author
  // writes it). A heading that only talks about the tag (`only \`[mutation]\`-tagged criteria…`)
  // is not tagged: matching it anywhere made such a criterion demand mutation evidence. Spaces
  // and tabs only — `\s` would reach a `[mutation]` at the start of the next (body) line.
  for (const m of String(text ?? '').matchAll(/^#{1,6}[ \t]*(C\d+)[ \t]*\[mutation\]/gim)) {
    const id = m[1].toUpperCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
export const oneLine = (x) => typeof x === 'string' && x.trim() !== '' && !/[\r\n]/.test(x);

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

// The run a verdict's evidence must match (C9). The gate used to check only that the evidence
// agreed with itself, so an edited survivor list (padded, a field dropped, a path respelled, a
// survivor invented, counts lowered) could hide one nobody triaged. `ac mutate` now keeps what
// the tool actually produced, per phase, and `ac verdict record` binds the evidence to it.
// Local, never committed (`.astrocode/.local/`, its own `.gitignore`): it is this machine's run.
// Every file one `ac mutate` run leaves lives beside the kept run (phase 48 D7, P7), named from
// ONE function so the log, the full list and the generated configs can never drift apart.
export function mutateRunPaths(root, slug) {
  const dir = join(paths(root).local, 'mutate-runs');
  const at = (ext) => join(dir, `${slug}.${ext}`);
  return {
    dir, run: at('json'), log: at('log'), list: at('mutants.jsonl'),
    strykerConfig: at('stryker.config.mjs'), gremlinsReport: at('gremlins.json'),
    // Stryker's own report of the last full run, and the incremental file `--survivors` crafts from it.
    strykerReport: at('stryker-report.json'), strykerIncremental: at('stryker-incremental.json'),
    // phase 49: the last `--survivors` re-run. Never the file the gate binds to.
    partial: at('survivors.json'),
  };
}

/** Create `.astrocode/.local/mutate-runs/` and the `.gitignore` (`*`) that keeps it uncommitted. */
export function ensureLocalDir(root) {
  const gi = join(paths(root).local, '.gitignore');
  mkdirSync(mutateRunPaths(root, 'x').dir, { recursive: true });
  if (!existsSync(gi)) atomicWriteText(gi, '*\n');
}

const mutateRunFile = (root, slug) => mutateRunPaths(root, slug).run;
const normPath = (f) => String(f ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '');
const survivorKey = (s) => [normPath(s.file), Number(s.line) || 0, s.mutator, s.status, String(s.id ?? '')].join('\0');

// Phase 49: per-survivor fields beyond the binding five. `survivorKey`/`matchesRun` read only the
// binding five, so adding these cannot loosen ADR-083; they let `ac mutate judge` resolve an
// identity key and `--survivors` re-select a mutant without re-parsing the tool's report.
const RUN_SURVIVOR_EXTRA = ['key', 'fn', 'kind', 'text_only', 'group', 'name', 'loc', 'col', 'line_text', 'replacement', 'replacement_line'];
function runPayload(res) {
  return {
    head: res.head ?? null, tool: res.tool?.id ?? null, outcome: res.outcome, capped: !!res.capped,
    complete: !!res.complete, counts: res.counts, tool_installed: !!res.tool_installed,
    started_at: res.started_at ?? null,
    survivors: (res.survivors ?? []).map((s) => {
      const o = { file: s.file, line: s.line, mutator: s.mutator, status: s.status, id: String(s.id ?? '') };
      for (const k of RUN_SURVIVOR_EXTRA) if (s[k] !== undefined) o[k] = s[k];
      return o;
    }),
  };
}

/** Keep the facts of one `ac mutate` run for the verdict gate. Never throws. */
export function saveMutateRun(root, slug, res) {
  try {
    ensureLocalDir(root);
    atomicWriteJSON(mutateRunFile(root, slug), runPayload(res));
  } catch { /* the gate then refuses for lack of a run — visible, never a crash */ }
}

/** Keep a `--survivors` re-run beside — never over — the kept full run. Never throws. */
export function savePartialRun(root, slug, res) {
  try {
    ensureLocalDir(root);
    atomicWriteJSON(mutateRunPaths(root, slug).partial, { ...runPayload(res), partial: true, base_run: res.base_run ?? null });
  } catch { /* a partial run is display only; losing it loses nothing the gate reads */ }
}

/** The last `--survivors` re-run for this phase, or null. */
export function readPartialRun(root, slug) {
  try { return JSON.parse(readFileSync(mutateRunPaths(root, slug).partial, 'utf8')); } catch { return null; }
}

/** The last kept run for this phase, or null. */
export function readMutateRun(root, slug) {
  try { return JSON.parse(readFileSync(mutateRunFile(root, slug), 'utf8')); } catch { return null; }
}

/** Does the evidence describe the kept run exactly? `{ ok }` or `{ ok: false, reason }`. */
function matchesRun(m, run) {
  const no = (reason) => ({ ok: false, reason });
  if (!run) return no('no `ac mutate` run on record for this phase on this machine — run `ac mutate <n> --json`, then record its evidence');
  if (m.head !== run.head) return no(`evidence is for commit ${String(m.head).slice(0, 7)} but the last \`ac mutate\` run graded ${String(run.head).slice(0, 7)}`);
  if (m.outcome !== run.outcome) return no(`evidence says outcome "${m.outcome}" but the \`ac mutate\` run says "${run.outcome}"`);
  if (m.fallback) {
    // no-scope with the tool installed is "nothing for the tool to judge", never a pass (ADR-084).
    if (run.tool_installed) return no('a mutation tool is installed, so a no-scope run is not a pass — bring the code under test into scope with mutation.files and run `ac mutate` again');
    return { ok: true };
  }
  if (!!m.capped !== run.capped || (m.complete === true) !== run.complete) return no('evidence and the `ac mutate` run disagree on capped/complete');
  for (const k of MUTANT_STATUSES) {
    if ((m.counts?.[k] ?? 0) !== (run.counts?.[k] ?? 0)) return no(`evidence counts ${m.counts?.[k] ?? 0} "${k}" but the \`ac mutate\` run counted ${run.counts?.[k] ?? 0}`);
  }
  const want = run.survivors.map(survivorKey).sort();
  const got = m.survivors.map(survivorKey).sort();
  const show = (k) => { const [f, l, mu, , id] = k.split('\0'); return `${f}:${l} ${mu}${id ? ` #${id}` : ''}`; };
  const missing = want.filter((k, i, a) => a.indexOf(k) === i && got.filter((g) => g === k).length < want.filter((w) => w === k).length);
  if (missing.length) return no(`survivor ${show(missing[0])} from the \`ac mutate\` run is not triaged`);
  const extra = got.filter((k, i, a) => a.indexOf(k) === i && got.filter((g) => g === k).length > want.filter((w) => w === k).length);
  if (extra.length) return no(`survivor ${show(extra[0])} is not one the \`ac mutate\` run produced (or is listed twice)`);
  return { ok: true };
}

/**
 * Pure pass bar. `{ ok: true }` or `{ ok: false, reason }`. Applies to a criterion that is
 * marked test-strength (tag, declaration, evidence or sticky mark) AND is reported passed;
 * callers skip the rest. `label` words the "no evidence" refusal for the way it was marked.
 */
export function mutationGate({ marked, mutation, run, label = '[mutation]' }) {
  const no = (reason) => ({ ok: false, reason });
  const m = mutation;
  if (!m) return marked ? no(`marked ${label} but no mutation evidence was recorded`) : { ok: true };
  // A `--survivors` re-run is a partial picture on top of a full run, never a verdict (ADR-085).
  if (m.partial === true) return no('a `--survivors` run is a partial re-test, never the recorded verdict — run `ac mutate <n>` and record that');
  // `run` undefined = a pure check of the evidence alone; `ac verdict record` always passes the
  // kept run (null when there is none), so a recorded pass is always bound to a real run.
  if (run !== undefined) { const b = matchesRun(m, run); if (!b.ok) return b; }
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
  // Same length is not enough: a survivor listed twice would hide one never triaged. Each
  // status must add up, and no survivor may appear twice (the tool's mutant id tells apart
  // mutants that share file, line and mutator).
  for (const k of SURVIVOR_STATUSES) {
    const n = m.survivors.filter((s) => s.status === k).length;
    if (n !== m.counts[k]) return no(`${n} "${k}" survivors listed but counts say ${m.counts[k]} — every survivor must be triaged`);
  }
  const seen = new Set();
  for (const s of m.survivors) {
    const key = [s.file, s.line, s.mutator, s.status, s.id ?? ''].join('\0');
    if (seen.has(key)) return no(`survivor ${s.file}:${s.line} ${s.mutator}${s.id ? ` #${s.id}` : ''} is listed twice — every survivor must be triaged once`);
    seen.add(key);
  }
  for (const s of m.survivors) {
    const at = `${s.file}:${s.line} ${s.mutator}${s.id ? ` #${s.id}` : ''}`;
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

const validRef = (b) => isObj(b) && Number.isInteger(b.run) && typeof b.commit === 'string' && b.commit !== '';

/**
 * The phase's most recent full PASS as `{ run, commit }`, or null. A verdict written before phase 52
 * has no `base` key: a full verdict whose every entry passed is its own base, anything else is none.
 * The one place for that rule (9173).
 */
export function baseOf(verdict) {
  if (!verdict) return null;
  if ('base' in verdict) return verdict.base ?? null;
  const full = verdict.mode === 'full' && verdict.criteria.every((c) => c.status === 'passed');
  return full ? { run: verdict.run, commit: verdict.commit } : null;
}

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
      || !v.criteria.every((c) => c && typeof c.id === 'string' && STATUSES.has(c.status)
        && (c.test_strength === undefined || typeof c.test_strength === 'boolean')
        && (c.suite === undefined || typeof c.suite === 'boolean')
        && (c.evidence === undefined || EVIDENCES.has(c.evidence)))
      || (v.base !== undefined && v.base !== null && !validRef(v.base))) {
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
 * `ancestor` is a boolean the caller computed from git. The ADR-079 narrowing branch is untouched
 * (a latest verdict with an unmet criterion); the targeted rules only run when nothing is unmet.
 */
export function chooseMode({
  full, ids, verdict, verdictReason, hash, ancestor,
  base, baseAncestor, changed, paths: idPaths, suite = [], strength = [], scope = [],
}) {
  const fullBecause = (reason) => ({ mode: 'full', reason, first: [] });
  if (full) return fullBecause('--full passed');
  if (!ids || ids.length === 0) return fullBecause('no criterion ids in CRITERIA.md');
  if (!verdict) return fullBecause(verdictReason || 'no saved verdict');
  if (verdict.criteria_sha !== hash) return fullBecause('CRITERIA.md changed since the saved verdict');
  const failing = failingOf(verdict);
  if (failing.length > 0) {
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
  // ---- targeted (phase 52): nothing unmet, so compare against the most recent full PASS ----
  if (!base) return fullBecause('no full PASS on record to carry from');
  if (baseAncestor !== true) return fullBecause('the full PASS commit is not an ancestor of HEAD');
  if (!Array.isArray(changed)) return fullBecause('the diff since the full PASS is unavailable');
  if (changed.length > MAX_TARGETED_FILES) {
    return fullBecause(`broad diff: ${changed.length} files changed since the full PASS (over ${MAX_TARGETED_FILES})`);
  }
  const of = (id) => idPaths?.get(id) ?? [];
  const affected = ids.filter((id) => touches(of(id), changed));
  if (affected.length * TARGETED_DENOMINATOR > ids.length) {
    return fullBecause(`broad diff: ${affected.length} of ${ids.length} criteria affected (over half)`);
  }
  const hit = scope.filter((f) => changed.includes(f));
  const why = {};
  for (const id of ids) {
    const named = changed.filter((f) => touches(of(id), [f]));
    if (named.length) why[id] = `named file changed: ${named[0]}`;
    else if (suite.includes(id)) why[id] = 'suite criterion: observe it, or cite a receipt (ac suite receipt)';
    else if (of(id).length === 0) why[id] = 'names no files';
    else if (strength.includes(id) && hit.length) why[id] = `test-strength: mutate scope changed (${hit[0]})`;
  }
  const floor = ids.filter((id) => why[id] !== undefined);
  if (floor.length === ids.length) return fullBecause('every criterion is in the floor');
  if (floor.length === 0 && changed.length > 0) return fullBecause('the diff touches no criterion\'s files');
  const floorWhy = Object.fromEntries(floor.map((id) => [id, why[id]]));
  return {
    mode: 'targeted',
    reason: `${floor.length} of ${ids.length} criteria affected since full PASS at ${String(base.commit).slice(0, 7)} (run ${base.run})`,
    first: [], floor, why: floorWhy,
    carry: ids.filter((id) => !floor.includes(id)).map((id) => ({ id, from: { run: base.run, commit: base.commit } })),
  };
}

/**
 * Collect every input once and decide: the single scope gatherer shared by plan, record and gate
 * (9173). Git is only asked for what the rules reach. Never throws on a bad/absent verdict.
 */
export function gatherScope(root, slug, { full = false } = {}) {
  assertSafeSlug(slug);
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const ids = parseCriteriaIds(text);
  const { verdict, reason } = readVerdict(verdictFile(root, slug));
  const hash = text ? criteriaHash(text) : null;
  const ancestor = verdict ? isAncestor(root, verdict.commit) : false;
  const base = baseOf(verdict);
  const input = { full, ids, verdict, verdictReason: reason, hash, ancestor, base };
  const reaches = !full && ids.length > 0 && verdict && verdict.criteria_sha === hash && failingOf(verdict).length === 0 && base;
  let paths = new Map();
  let suite = [];
  let strength = [];
  let scope = [];
  let changed;
  if (reaches) {
    input.baseAncestor = isAncestor(root, base.commit);
    changed = input.baseAncestor ? diffSince(root, base.commit) : null;
    paths = criterionPaths(text, trackedFiles(root));
    const marked = (k) => verdict.criteria.filter((c) => c[k] === true).map((c) => c.id);
    suite = ids.filter((id) => suiteIds(text).includes(id) || marked('suite').includes(id));
    strength = ids.filter((id) => testStrengthIds(text).includes(id) || marked('test_strength').includes(id));
    if (strength.length) scope = mutateScopeFiles(root, slug);
    Object.assign(input, { changed, paths, suite, strength, scope });
  }
  const decision = chooseMode(input);
  const unmapped_files = decision.mode === 'targeted'
    ? changed.filter((f) => !ids.some((id) => touches(paths.get(id) ?? [], [f]))) : [];
  return {
    text, ids, verdict, base, decision, changed: decision.mode === 'targeted' ? changed : [], unmapped_files,
    paths, suite, strength, scope,
  };
}

/** Gather the inputs, decide. Never throws on a bad/absent verdict. */
export function planReverify(root, slug, { full = false } = {}) {
  const g = gatherScope(root, slug, { full });
  const d = g.decision;
  const targeted = d.mode === 'targeted';
  return {
    mode: d.mode,
    reason: d.reason,
    first: d.first,
    ids: g.ids,
    total: g.ids.length,
    saved: g.verdict ? { run: g.verdict.run, commit: g.verdict.commit, mode: g.verdict.mode } : null,
    range: targeted ? `${g.base.commit}..HEAD` : (g.verdict ? `${g.verdict.commit}..HEAD` : null),
    floor: d.floor ?? [],
    carry: d.carry ?? [],
    why: d.why ?? {},
    base: g.base,
    changed: g.changed,
    unmapped_files: g.unmapped_files,
  };
}

function validateResult(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('verdict result must be a JSON object');
  if (!RESULT_MODES.has(r.mode)) throw new Error('verdict result needs mode "full" or "narrowed"');
  if (!Array.isArray(r.criteria)
      || !r.criteria.every((c) => c && typeof c.id === 'string' && typeof c.passed === 'boolean')) {
    throw new Error('verdict result needs criteria: [{ id, passed }]');
  }
  for (const c of r.criteria) {
    if (c.test_strength !== undefined && typeof c.test_strength !== 'boolean') {
      throw new Error(`criterion ${c.id}: test_strength must be true or false`);
    }
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
  const tagged = testStrengthIds(text);
  const mode = result.broad === true ? 'full' : result.mode;
  const file = verdictFile(root, slug);
  const p = paths(root);

  return withLock(p.lock, async () => {
    // Read HEAD BEFORE writing: the recorded commit is the graded commit (D6).
    const head = git(['rev-parse', 'HEAD'], { cwd: root });
    const commit = head.status === 0 ? head.stdout.trim() : null;
    const { verdict: prior } = readVerdict(file);
    const run = prior ? prior.run + 1 : 1;

    const refused = [];
    const mutateRun = readMutateRun(root, slug);
    // ADR-085: the one marked-set. Sticky ids come from the prior verdict's committed entries.
    const sticky = new Set((prior?.criteria ?? []).filter((c) => c.test_strength === true).map((c) => c.id));
    const marked = new Set(ids.filter((id) => tagged.includes(id) || sticky.has(id)
      || (reported.has(id) && (reported.get(id).test_strength === true
        || (reported.get(id).mutation !== undefined && reported.get(id).mutation !== null)))));
    const markKept = ids.filter((id) => sticky.has(id) && reported.get(id)?.test_strength !== true);
    // Unchanged since the full run, outside `.astrocode/`? (same test as `verifiedGate`)
    const codeMoved = () => {
      const h = mutateRun?.head;
      if (typeof h !== 'string' || !commit || h === commit) return false;
      const d = git(['diff', '--name-only', h, 'HEAD', '--', '.', ':(exclude).astrocode'], { cwd: root });
      // A head git cannot resolve is a short fake only in tests; a real one is 40 hex and means the
      // run's commit is gone (rebased away), so the code cannot be shown unchanged.
      if (d.status !== 0) return /^[0-9a-f]{40}$/i.test(h);
      return d.stdout.trim() !== '';
    };
    // SURVIVORS.json is the one store of judgements (9173): a survivor in the evidence with no triage
    // of its own takes the judgement recorded for the same kept-run survivor. An explicit triage in
    // the evidence wins. Loaded here, not at the top: survivors.mjs imports this module.
    const { readJudgements, survivorsFile } = await import('./survivors.mjs');
    const sfile = survivorsFile(root, slug);
    const byKey = new Map(readJudgements(sfile).judgements.map((j) => [j.key, j]));
    const keyOf = new Map((mutateRun?.survivors ?? []).filter((x) => x.key).map((x) => [survivorKey(x), x.key]));
    const overlay = (m) => {
      if (!m || m.fallback || !byKey.size) return m;
      return { ...m, survivors: m.survivors.map((sv) => {
        const j = sv.triage === undefined ? byKey.get(keyOf.get(survivorKey(sv))) : null;
        return j ? { ...sv, triage: j.triage, ...(j.justification ? { justification: j.justification } : {}) } : sv;
      }) };
    };
    const criteria = ids.map((id) => {
      const mk = marked.has(id) ? { test_strength: true } : {};
      if (reported.has(id)) {
        const c = reported.get(id);
        const mutation = overlay(c.mutation ?? undefined);
        const e = { id, status: c.passed ? 'passed' : 'failed', evidence: 'observed', ...mk };
        if (c.passed && marked.has(id)) {
          const label = tagged.includes(id) ? '[mutation]' : 'test-strength';
          let g = mutationGate({ marked: true, mutation, run: mutateRun, label });
          if (g.ok && mutation && !mutation.fallback && codeMoved()) {
            g = { ok: false, reason: 'code changed since the last full `ac mutate` run — run `ac mutate <n>` again and record that' };
          }
          if (!g.ok) { e.status = 'failed'; e.refused = g.reason; refused.push({ id, reason: g.reason }); }
        }
        if (mutation) e.mutation = mutation;
        return e;
      }
      if (mode === 'full' || !prior) return { id, status: 'failed', evidence: 'observed', ...mk }; // absence of evidence is failure
      const was = prior.criteria.find((c) => c.id === id);
      if (!was) return { id, status: 'failed', evidence: 'observed', ...mk };
      const keep = was.mutation ? { mutation: was.mutation } : {};
      if (was.status === 'carried') return { id, status: 'carried', evidence: 'carried', last: was.last, from: was.from, ...mk, ...keep };
      return { id, status: 'carried', evidence: 'carried', last: was.status, from: { run: prior.run, commit: prior.commit }, ...mk, ...keep };
    });

    // The base (phase 52): a full, all-passed record is its own base; every other record copies the
    // prior verdict's base forward, so a FAIL, narrowed or targeted run never moves it.
    const base = mode === 'full' && criteria.every((c) => c.status === 'passed') ? { run, commit } : baseOf(prior);
    const verdict = {
      version: 1, run, mode, broad: result.broad === true, commit,
      criteria_sha: criteriaHash(text), at: new Date().toISOString(), base, criteria,
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
    out.test_strength = ids.filter((id) => marked.has(id));
    if (markKept.length) out.mark_kept = markKept;

    // Commit ONLY these files (VERDICT.json, plus SURVIVORS.json when it exists). No (phase NN tK) stamp: the ADR-041 audit must not see it.
    const num = /^(\d+)/.exec(slug)?.[1] ?? slug;
    // SURVIVORS.json rides along when it exists: the judgements the verdict leaned on are committed
    // with it, so a teammate and a reviewer see the same bar (ADR-085).
    const files = existsSync(sfile) ? [file, sfile] : [file];
    const add = git(['add', '--', ...files], { cwd: root });
    const msg = `chore(verdict): phase ${num} run ${run} — ${mode} ${passed ? 'PASS' : 'FAIL'}`;
    const c = add.status === 0 ? git(['commit', '-m', msg, '--', ...files], { cwd: root }) : add;
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
