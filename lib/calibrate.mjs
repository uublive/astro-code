// Verifier calibration (phase 51, ADR-088): plant real `ac mutate` mutants in accepted phases, run
// the verifier on each exactly as `/astro-verify` would, and report its false-PASS rate.
//
// Part 2 (further down) runs the trials: one throwaway copy per trial, the budget stop, the summary and
// the record. Part 1 (read-only): which phases are accepted, which defects they offer, the seeded selection,
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
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { atomicWriteText, withLock } from './util.mjs';
import { loadRoadmap } from './roadmap.mjs';
import { readMutateRun, mutateRunPaths, parseCriteriaIds, SURVIVOR_STATUSES } from './verdict.mjs';
import { readJudgements } from './survivors.mjs';
import { pickTool } from './mutate.mjs';
import { plantChange } from './plant.mjs';
import { selectSeeded, splitCounts, newSeed, parseSeed, summarizeSet, DEFINITIONS, MIN_DEFECTS_PER_SET } from './calstats.mjs';
import { makeCopy, removeCopy, blindnessCheck, trialEnv } from './plant.mjs';
import { verifierContract, trialPrompt, trialArgv, runTrial, promptFingerprint, VERIFIER_AGENT } from './verifyrun.mjs';
import { resolveModels } from './config.mjs';
import { runCapped } from './caprun.mjs';

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

// ---- Part 2: the trial loop (P5 to P9) ----

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round4 = (n) => Math.round(n * 10000) / 10000;

function whyUnavailable(plan, set) {
  if (plan.requested_split[set] === 0) return `not requested at --defects ${plan.requested.defects}`;
  if (plan.available[set] === 0) {
    if (plan.unsupported.length) return `unsupported: ${plan.unsupported.join('; ')}`;
    return set === 'easy' ? 'no killed mutants usable in accepted phases' : 'no test-gap survivors usable in accepted phases';
  }
  return 'no defects ran';
}

/**
 * Run the planned trials and append ONE record to the log. Trials go in rounds (round r gives every
 * defect its r-th trial), so a stop leaves defects with k or k-1 trials, never K and none. Before each
 * trial it starts only if `spent + expected <= budget`; reaching the limit is a clean `stopped: budget`
 * with the completed counts, and every rate covers only trials that ran. An invalid trial (a crash, a
 * cap, no readable verdict, a failed plant or blindness check) is neither PASS nor FAIL and is
 * excluded from every n. `signal` aborts BETWEEN trials: a running verifier is never killed from here,
 * so an interrupt takes effect when the current trial returns. Never writes a phase file (ADR-006).
 *
 * `check` is the blindness check (injectable for tests only). `completed.trials` counts the trials that
 * spawned the verifier, valid or not, so `spent / completed.trials` is a per-trial cost.
 *
 * Returns `{ record, trials, log, notes }`: `record` is what was logged, byte for byte.
 */
export async function runCalibration(root, plan, { run = runCapped, signal, now = () => new Date(), env = process.env, tmp, check = blindnessCheck } = {}) {
  const fp = promptFingerprint({ env });
  const contract = verifierContract();
  const model = resolveModels(root).verifier ?? null;
  const childEnv = trialEnv(env);
  const byId = new Map(plan.defects.map((d) => [d.id, { def: d, outcomes: [] }]));
  const trials = [];
  const reported = new Set();
  const costs = [];
  let spent = 0;
  let stopped = null;

  rounds:
  for (let r = 1; r <= plan.requested.runs; r += 1) {
    for (const def of plan.defects) {
      if (signal?.aborted) { stopped = 'interrupted'; break rounds; }
      const expected = costs.length ? mean(costs) : plan.per_trial_usd;
      if (spent + expected > plan.budget_usd) { stopped = 'budget'; break rounds; }
      const t = await oneTrial({ root, def, round: r, plan, contract, model, childEnv, run, tmp, reported, remaining: plan.budget_usd - spent, check });
      byId.get(def.id).outcomes.push(t.outcome);
      trials.push(t);
      if (t.cost !== null) { spent += t.cost; costs.push(t.cost); }
      if (t.no_verifier) { stopped = 'no-verifier'; break rounds; }
    }
  }

  const sets = {};
  const defects = [];
  for (const set of ['easy', 'hard']) {
    const mine = plan.defects.filter((d) => d.set === set);
    const sum = summarizeSet(mine.map((d) => ({ id: d.id, outcomes: byId.get(d.id).outcomes })), { reason: whyUnavailable(plan, set) });
    const { defects: rows, ...rest } = sum;
    sets[set] = rest;
    for (const row of rows) {
      const d = byId.get(row.id).def;
      defects.push({ id: d.id, set, phase: d.phase, tool: d.tool, key: d.key, ...row });
    }
  }
  const spawned = trials.filter((t) => t.spawned);
  const measured = spawned.filter((t) => !t.cost_estimated).length;
  const record = {
    schema: 1, date: now().toISOString(), head: plan.head, seed: plan.seed,
    requested: plan.requested, selected: plan.selected,
    completed: { trials: spawned.length, planned_trials: plan.planned_trials },
    stopped, budget_usd: plan.budget_usd, spent_usd: round4(spent),
    cost_basis: !spawned.length ? 'none' : measured === spawned.length ? 'measured' : measured ? 'mixed' : 'estimated',
    verifier: { model: model ?? 'inherit', agent: VERIFIER_AGENT, ...fp },
    definitions: DEFINITIONS, sets, defects, shortfall: plan.shortfall, unsupported: plan.unsupported,
    defect_set_hash: defectSetHash(plan.defects),
  };
  const log = await appendLog(root, record);
  return { record, trials, log, notes: { blindness_reported: [...reported].sort() } };
}

// One trial in a fresh copy that is always removed. Never throws.
async function oneTrial({ root, def, round, plan, contract, model, childEnv, run, tmp, reported, remaining, check }) {
  const base = { defect: def.id, round, spawned: false, cost: null, cost_estimated: false, scrubbed: [] };
  const invalid = (reason, extra = {}) => ({ ...base, outcome: 'invalid', reason, ...extra });
  let copy;
  try {
    copy = makeCopy(root, def, tmp ? { tmp } : {});
  } catch (e) {
    return invalid(`plant: ${e.message}`);
  }
  try {
    const criteriaPath = join(copy.repo, relative(root, def.dir), 'CRITERIA.md');
    const { prompt, frame } = trialPrompt({ number: def.phase, slug: def.slug, goal: def.goal, criteriaPath, contract });
    const blind = check(copy.repo, { prompt, frame, env: childEnv });
    for (const x of blind.reported) reported.add(x);
    if (!blind.ok) return invalid(`blindness: ${blind.reasons.join('; ')}`, { scrubbed: copy.scrubbed });
    const argv = trialArgv({ prompt, model, maxBudgetUsd: round4(Math.max(0, remaining)) });
    const res = await runTrial({ cwd: copy.repo, argv, env: childEnv, criteriaIds: def.criteria_ids, run });
    const spawned = !res.no_verifier;
    const estimated = spawned && res.cost === null;
    return {
      ...base, spawned, scrubbed: copy.scrubbed, outcome: res.outcome,
      ...(res.reason ? { reason: res.reason } : {}), ...(res.failed_ids ? { failed_ids: res.failed_ids } : {}),
      ...(res.no_verifier ? { no_verifier: true } : {}),
      cost: spawned ? (res.cost ?? plan.per_trial_usd) : null, cost_estimated: estimated,
    };
  } finally { removeCopy(copy); }
}

// ---- The human output (P10) ----

const pct = (x) => `${Math.round(x * 100)}%`;
const fmtRate = (r) => (r && r.n > 0 ? `${r.x}/${r.n} ${pct(r.p)} (${pct(r.lo)}–${pct(r.hi)})` : 'n/a');
const fmtK = (ks) => (ks.length ? ks.map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(2))).join(' ') : '-');
const DEFECT_LINES = 20;

/**
 * At most 8 summary lines, then one line per defect (20 at most, then `+N more — --json`). The first
 * line leads with both defect rates. Built from the record that was logged, so it cannot disagree.
 */
export function renderSummary({ record: rec, log }) {
  const both = (f) => ['easy', 'hard'].map((s) => `${s} ${rec.sets[s].unavailable ? `unavailable (${rec.sets[s].unavailable})` : f(rec.sets[s])}`).join(' · ');
  const lines = [
    `false PASS by defect — ${both((x) => fmtRate(x.defect_rate))}`,
    `false PASS by trial — ${both((x) => fmtRate(x.trial_rate))}`,
    `pass^k (caught on all k runs) — ${both((x) => fmtK(x.pass_k))}`,
    `ran ${rec.completed.trials} of ${rec.completed.planned_trials} planned trials on ${rec.defects.length} defects (easy ${rec.selected.easy}, hard ${rec.selected.hard}), `
      + `${rec.defects.reduce((n, d) => n + d.invalid, 0)} invalid · spent $${rec.spent_usd.toFixed(2)} of $${rec.budget_usd.toFixed(2)} (${rec.cost_basis})`
      + `${rec.stopped ? ` · stopped: ${rec.stopped}` : ''}`,
  ];
  const few = ['easy', 'hard'].filter((s) => rec.sets[s].too_few && !rec.sets[s].unavailable);
  if (few.length) lines.push(`too few defects to rely on (under ${MIN_DEFECTS_PER_SET}): ${few.map((s) => `${s} ${rec.defects.filter((d) => d.set === s && d.trials > 0).length}`).join(', ')}`);
  const left = Object.entries(rec.shortfall).map(([k, v]) => `${k} ${v}`);
  if (left.length || rec.unsupported.length) lines.push(`left out: ${[...left, ...rec.unsupported.map((u) => `unsupported: ${u}`)].join(', ') || 'nothing'}`);
  lines.push(rec.definitions);
  lines.push(`seed ${rec.seed} · verifier ${rec.verifier.model} · prompt ${rec.verifier.prompt_hash} · log ${CALIBRATION_FILE}${log?.committed ? ' (committed)' : log ? ` (not committed: ${log.reason})` : ''}`);
  const shown = rec.defects.slice(0, DEFECT_LINES).map((d) => {
    const what = d.trials ? `caught ${d.caught}/${d.trials}, pass^k ${fmtK(d.pass_k)}` : 'no valid trial';
    return `${d.id} phase ${d.phase} ${d.tool} ${d.key}: ${what}${d.invalid ? `, ${d.invalid} invalid` : ''}`;
  });
  if (rec.defects.length > DEFECT_LINES) shown.push(`+${rec.defects.length - DEFECT_LINES} more — --json`);
  return [...lines.slice(0, 8), ...shown];
}

// ---- The command surface (P10): flags and the bill ----

export const CALIBRATE_USAGE = 'usage: ac verify calibrate [--defects N] [--runs K] [--seed S] [--budget USD] [--yes] [--json]';

/**
 * Validate the flags of `ac verify calibrate` BEFORE anything is read or spent (ADR-029): an invalid
 * value is an error, never a silent fall back to the default. `{ error }` or the parsed options.
 */
export function parseCalibrateFlags(flags, pos = []) {
  if (pos.length) return { error: `unexpected argument "${pos.join(' ')}" — ${CALIBRATE_USAGE}` };
  const count = (name, dflt) => {
    const v = flags[name];
    if (v === undefined) return dflt;
    return typeof v === 'string' && /^\d+$/.test(v) && Number(v) >= 1 ? Number(v) : null;
  };
  const defects = count('defects', 10);
  if (defects === null) return { error: `--defects takes a whole number of at least 1 (got ${flags.defects === true ? 'nothing' : flags.defects})` };
  const runs = count('runs', 3);
  if (runs === null) return { error: `--runs takes a whole number of at least 1 (got ${flags.runs === true ? 'nothing' : flags.runs})` };
  let seed;
  if (flags.seed !== undefined) {
    seed = parseSeed(flags.seed);
    if (seed === null) return { error: `--seed takes a whole number from 0 to 4294967295 (got ${flags.seed === true ? 'nothing' : flags.seed})` };
  }
  let budget;
  if (flags.budget !== undefined) {
    budget = typeof flags.budget === 'string' && /^\d+(\.\d+)?$/.test(flags.budget) ? Number(flags.budget) : NaN;
    if (!(budget > 0)) return { error: `--budget takes a dollar amount above 0 (got ${flags.budget === true ? 'nothing' : flags.budget})` };
  }
  for (const f of ['yes', 'json']) {
    if (flags[f] !== undefined && flags[f] !== true) return { error: `--${f} takes no value (got ${flags[f]})` };
  }
  return { defects, runs, seed, budget, yes: flags.yes === true, json: flags.json === true };
}

/** The bill, at most 5 lines: the cost, what it buys, the seed and the budget, and what is left out. */
export function renderBill(plan, { needsYes = true } = {}) {
  const n = plan.defects.length;
  const lines = [];
  if (!n) {
    lines.push('⊡ nothing to calibrate: no usable defects in the accepted phases');
  } else {
    lines.push(`bill: about $${plan.bill_usd.toFixed(2)} for ${n} defects × ${plan.requested.runs} runs = ${plan.planned_trials} trials (${plan.cost_basis})`);
    lines.push(`defects: easy ${plan.selected.easy} of ${plan.requested_split.easy} asked, hard ${plan.selected.hard} of ${plan.requested_split.hard} asked · seed ${plan.seed}${plan.seed_given ? '' : ' (drawn; pass --seed to repeat it)'}`);
    lines.push(`budget: $${plan.budget_usd.toFixed(2)}${plan.budget_given ? '' : ' (1.5× the bill; --budget <usd> to change)'}`);
  }
  const left = [...Object.entries(plan.shortfall).map(([k, v]) => `${k} ${v}`), ...plan.unsupported.map((u) => `unsupported: ${u}`)];
  if (left.length) lines.push(`left out: ${left.join(', ')}`);
  if (n && needsYes) lines.push('nothing ran — add --yes to run it');
  return lines;
}

/** What a bill or a run exposes about a defect: its identity and place, never the change itself. */
export const publicDefect = (d) => ({ id: d.id, set: d.set, phase: d.phase, tool: d.tool, key: d.key });
