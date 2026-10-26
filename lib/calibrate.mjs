// Verifier calibration (phase 51, ADR-088): plant real `ac mutate` mutants in accepted phases, run
// the verifier on each exactly as `/astro-verify` would, and report its false-PASS rate.
//
// Part 1 (here, read-only): which phases are accepted, which defects they offer, the seeded selection,
// the bill, and the committed log. Nothing in this half writes a file or makes a directory, so
// `ac verify calibrate` without `--yes` can print the bill and stop with the project untouched.
//
// Why the defects come from the KEPT `ac mutate` runs and never from re-running the tool: a re-run is
// expensive, needs the tool installed, and would grade a different commit than the one the phase was
// accepted on. Killed mutants are not committed anywhere, so the kept run on this machine is the only
// honest source; when it is missing or predates this phase the shortfall says so (b940) and nothing is
// guessed or padded (D6).
//
// Why every candidate rule is exact (333f): EASY is a mutant the project's own tests killed (a real
// bug by construction, `status: killed` and nothing else: a timeout can hang the verifier's suite);
// HARD is a survivor a human judged `test-gap` (a real bug no test catches). Equivalent and unjudged
// survivors are never drawn, because planting an equivalent mutant is not a defect at all.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { atomicWriteText, withLock } from './util.mjs';
import { loadRoadmap } from './roadmap.mjs';
import { readMutateRun, mutateRunPaths, parseCriteriaIds, SURVIVOR_STATUSES } from './verdict.mjs';
import { readJudgements } from './survivors.mjs';
import { pickTool } from './mutate.mjs';
import { plantChange } from './plant.mjs';
import { selectSeeded, splitCounts, newSeed } from './calstats.mjs';

export const CALIBRATION_FILE = '.astrocode/CALIBRATION.jsonl';
export const DEFAULT_TRIAL_USD = 3.0;
export const BUDGET_FACTOR = 1.5;
const RECENT_RUNS = 5;

const readJSONSafe = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const cents = (n) => Math.round(n * 100) / 100;

// ---- Accepted phases (P2) ----

/**
 * Every roadmap entry with `status: "complete"`: the live roadmap plus every milestone snapshot, which
 * includes archived milestones. `{ number, slug, name, dir, archived, criteria_ids }`, by number. An
 * archived entry's directory is `milestones/<n>/phases/<slug>` when it exists, else the live one.
 */
export function acceptedPhases(root) {
  const p = paths(root);
  const out = new Map();
  const add = (ph, dir, archived) => {
    if (ph?.status !== 'complete' || typeof ph.slug !== 'string' || out.has(ph.slug)) return;
    let text = '';
    try { text = readFileSync(join(dir, 'CRITERIA.md'), 'utf8'); } catch { /* no bar */ }
    out.set(ph.slug, { number: ph.number, slug: ph.slug, name: ph.name ?? ph.slug, dir, archived, criteria_ids: parseCriteriaIds(text) });
  };
  for (const ph of loadRoadmap(root).phases ?? []) add(ph, join(p.phases, ph.slug), false);
  const msDir = join(p.dir, 'milestones');
  let ms = [];
  try { ms = readdirSync(msDir); } catch { /* none archived */ }
  for (const m of ms) {
    const rm = readJSONSafe(join(msDir, m, 'roadmap.json'));
    for (const ph of rm?.phases ?? []) {
      const archivedDir = join(msDir, m, 'phases', String(ph?.slug));
      add(ph, existsSync(archivedDir) ? archivedDir : join(p.phases, String(ph?.slug)), true);
    }
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

// ---- Candidates (P1, P3) ----

function listLines(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return null; }
  const rows = [];
  for (const l of text.split('\n')) {
    if (!l.trim()) continue;
    try { rows.push(JSON.parse(l)); } catch { /* a torn line is skipped, never guessed */ }
  }
  return rows;
}

/**
 * The defects accepted phases offer, `{ easy, hard, shortfall, unsupported, runs }`. `shortfall` counts
 * why candidates were left out, per reason; `unsupported` is a list of one-line notes (Gremlins);
 * `runs` is how many accepted phases had a kept run at all.
 */
export function gatherCandidates(root) {
  const easy = [];
  const hard = [];
  const shortfall = {};
  const unsupported = [];
  const miss = (reason, n = 1) => { shortfall[reason] = (shortfall[reason] ?? 0) + n; };
  const noPatch = 'gremlins (it reports no patch)';
  const headText = new Map();
  const atHead = (file) => {
    if (!headText.has(file)) {
      const r = git(['show', `HEAD:${file}`], { cwd: root });
      headText.set(file, r.status === 0 ? r.stdout : null);
    }
    return headText.get(file);
  };
  const drift = new Map();
  const drifted = (head, file) => {
    const k = `${head}\0${file}`;
    if (!drift.has(k)) {
      drift.set(k, git(['cat-file', '-e', `${head}^{commit}`], { cwd: root }).status !== 0
        || git(['diff', '--quiet', head, 'HEAD', '--', file], { cwd: root }).status !== 0);
    }
    return drift.get(k);
  };
  const accepted = acceptedPhases(root);
  if (!accepted.length) miss('no accepted phases');
  let runs = 0;
  for (const ph of accepted) {
    if (!ph.criteria_ids.length) { miss('no CRITERIA.md'); continue; }
    const run = readMutateRun(root, ph.slug);
    const rows = run ? listLines(mutateRunPaths(root, ph.slug).list) : null;
    if (!run || !rows) { miss('no kept run'); continue; }
    runs += 1;
    if (run.tool === 'gremlins') { if (!unsupported.includes(noPatch)) unsupported.push(noPatch); continue; }
    const inScope = rows.filter((r) => r.scope === 'in');
    if (inScope.some((r) => typeof r.key !== 'string')) { miss('kept list predates calibration'); continue; }
    const gap = new Set(readJudgements(join(ph.dir, 'SURVIVORS.json')).judgements.filter((j) => j.triage === 'test-gap').map((j) => j.key));
    for (const r of inScope) {
      const set = r.status === 'killed' ? 'easy' : SURVIVOR_STATUSES.includes(r.status) && gap.has(r.key) ? 'hard' : null;
      if (!set) continue;
      if (typeof run.head !== 'string' || drifted(run.head, r.file)) { miss('drifted'); continue; }
      const cand = {
        set, phase: ph.number, slug: ph.slug, goal: ph.name, dir: ph.dir, criteria_ids: ph.criteria_ids, tool: run.tool,
        key: r.key, file: r.file, line: r.line, mutator: r.mutator, fn: r.fn ?? null, kind: r.kind ?? null,
        ...(typeof r.replacement_line === 'string' ? { line_text: r.line_text, replacement_line: r.replacement_line } : {}),
        ...(typeof r.replacement === 'string' && r.loc ? { replacement: r.replacement, loc: r.loc } : {}),
      };
      // mutmut: only a change the generated source gave as one line is exact. Both tools: the change
      // must apply cleanly to the file as it is at HEAD (the same rule makeCopy enforces).
      let exact = typeof r.replacement_line === 'string' ? r.exact === true : typeof r.replacement === 'string';
      const text = atHead(r.file);
      if (exact) { try { plantChange(text ?? '', cand); } catch { exact = false; } }
      if (!exact) { miss('not exact'); continue; }
      (set === 'easy' ? easy : hard).push(cand);
    }
  }
  // With no kept run to read, the detected tool still tells a Go project that Gremlins cannot be used.
  if (!runs) {
    const picked = pickTool(root);
    if (picked.row?.id === 'gremlins' && !unsupported.includes(noPatch)) unsupported.push(noPatch);
  }
  return { easy, hard, shortfall, unsupported, runs };
}

// ---- The log ----

/** Every record of `.astrocode/CALIBRATION.jsonl`, oldest first; a torn line is skipped. */
export function readLog(root) {
  const rows = listLines(join(root, CALIBRATION_FILE));
  return rows ?? [];
}

/** Compare two records only when this matches: the same defects, whatever the verifier did with them. */
export function defectSetHash(defects) {
  const ids = defects.map((d) => `${d.set}:${d.key}`).sort();
  return createHash('sha1').update(ids.join('\n')).digest('hex').slice(0, 12);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---- The bill (P7) ----

function perTrial(root) {
  const measured = readLog(root).slice(-RECENT_RUNS)
    .filter((r) => r.cost_basis === 'measured' && r.completed?.trials > 0 && Number.isFinite(r.spent_usd))
    .map((r) => r.spent_usd / r.completed.trials);
  if (!measured.length) return { usd: DEFAULT_TRIAL_USD, basis: `estimate — no recorded runs, $${DEFAULT_TRIAL_USD.toFixed(2)} per trial` };
  const usd = median(measured);
  return { usd, basis: `median of ${measured.length} recorded run${measured.length === 1 ? '' : 's'}, $${usd.toFixed(2)} per trial` };
}

const POOL_KEY = (c) => [c.phase, c.file, c.line ?? 0, c.key];

/**
 * The read-only plan: seeded selection (EASY gets ceil(N/2), HARD floor(N/2), a short set is never
 * refilled from the other), the bill and the budget. Writes nothing and makes no directory.
 */
export function planCalibration(root, { defects = 10, runs = 3, seed, budget } = {}) {
  const cands = gatherCandidates(root);
  const given = seed !== undefined && seed !== null;
  const useSeed = given ? seed : newSeed();
  const want = splitCounts(defects);
  const pick = (pool, n, prefix) => selectSeeded(pool, n, useSeed, POOL_KEY).map((c, i) => ({ ...c, id: `${prefix}${i + 1}` }));
  const easy = pick(cands.easy, want.easy, 'E');
  const hard = pick(cands.hard, want.hard, 'H');
  const chosen = [...easy, ...hard];
  const trial = perTrial(root);
  const planned = chosen.length * runs;
  const bill = cents(planned * trial.usd);
  const head = git(['rev-parse', 'HEAD'], { cwd: root }).stdout.trim() || null;
  return {
    head, seed: useSeed, seed_given: given, requested: { defects, runs }, requested_split: want,
    selected: { easy: easy.length, hard: hard.length }, available: { easy: cands.easy.length, hard: cands.hard.length },
    defects: chosen, shortfall: cands.shortfall, unsupported: cands.unsupported,
    per_trial_usd: trial.usd, cost_basis: trial.basis, planned_trials: planned, bill_usd: bill,
    budget_usd: budget !== undefined && budget !== null ? budget : cents(bill * BUDGET_FACTOR), budget_given: budget !== undefined && budget !== null,
  };
}

/**
 * Append one record to the log under the project lock, keeping every earlier line byte-identical, then
 * commit that one file with a neutral subject (later copies clone this history, so it must not name
 * what the file is). A commit failure is `committed: false` with its reason (b940).
 */
export async function appendLog(root, record) {
  const file = join(root, CALIBRATION_FILE);
  return withLock(paths(root).lock, () => {
    let old = '';
    try { old = readFileSync(file, 'utf8'); } catch { /* first record */ }
    atomicWriteText(file, `${old}${old && !old.endsWith('\n') ? '\n' : ''}${JSON.stringify(record)}\n`);
    const add = git(['add', '--', CALIBRATION_FILE], { cwd: root });
    const subject = `chore(astro): verifier run log ${String(record.date ?? '').slice(0, 10)}`.trim();
    const c = add.status === 0 ? git(['commit', '-q', '-m', subject, '--', CALIBRATION_FILE], { cwd: root }) : add;
    return {
      file, committed: c.status === 0,
      ...(c.status === 0 ? {} : { reason: (c.stderr || c.stdout || 'git commit failed').trim().split('\n')[0] }),
    };
  });
}
