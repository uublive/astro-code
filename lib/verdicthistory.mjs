// The append-only verdict history (phase 54, D9): one JSON line per `ac verdict record`, in
// `VERDICTS.jsonl` beside VERDICT.json.
//
// Why a log next to the verdict: VERDICT.json is rewritten on every record, so only the LATEST run
// survives. A criterion that passed in run 2 and fails in run 5 (the astrobot phase-104/105 pattern:
// ten runs, one new gap each) left no trace of run 2, so nobody could tell a regression from an
// inconsistent verifier. The history keeps every run, in order, so `ac verdict history` can read it
// back and `flappingOf` can compare.
//
// Same shape and same failure rule as `lib/surprises.mjs`: the append is pure (the CALLER holds the
// lock, so it lands inside recordVerdict's own `withLock`, before VERDICT.json is written), earlier
// lines are never rewritten, and a damaged line is counted and skipped, never thrown, so one bad
// line cannot hide the good ones either side of it.
//
// FLAPPING NEVER CHANGES A VERDICT (D9). `flappingOf` only reports; recordVerdict puts the result in
// its output and the history line, never in VERDICT.json, the unmet ids or verifiability.
//
// Import limits: `lib/impact.mjs` and util only. It must NOT import `lib/verdict.mjs` (verdict
// imports this module).
import { existsSync, readFileSync } from 'node:fs';
import { atomicWriteText } from './util.mjs';
import { criterionPaths, touches, trackedFiles, diffSince } from './impact.mjs';

export const VERDICTS_FILE = 'VERDICTS.jsonl';

/** Append one line. Earlier bytes are copied through untouched; a missing trailing newline is added first. */
export function appendHistory(file, entry) {
  let existing = '';
  if (existsSync(file)) existing = readFileSync(file, 'utf8');
  if (existing && !existing.endsWith('\n')) existing += '\n';
  atomicWriteText(file, existing + JSON.stringify(entry) + '\n');
}

/** Read the history oldest-first. Absent file -> empty. A line that does not parse is counted in `damaged`. */
export function readHistory(file) {
  if (!existsSync(file)) return { entries: [], damaged: 0 };
  const entries = [];
  let damaged = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      const e = JSON.parse(s);
      if (e && typeof e === 'object' && !Array.isArray(e)) entries.push(e); else damaged++;
    } catch { damaged++; }
  }
  return { entries, damaged };
}

// The most recent earlier OBSERVATION of `id`: a line that actually looked at it (passed, failed or
// deferred). A cheap-stage line never counts (it can fail a criterion, never pass one), and a
// carried/unobserved line observed nothing.
function lastObservation(history, id) {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (!h || h.stage === 'cheap' || !Array.isArray(h.criteria)) continue;
    const c = h.criteria.find((x) => x && x.id === id);
    if (c && (c.status === 'passed' || c.status === 'failed' || c.status === 'deferred')) return { line: h, status: c.status };
  }
  return null;
}

/**
 * Flag each id in `failedIds` that the most recent earlier observation had PASSED. `files_changed` is
 * whether any file the criterion maps to changed since that pass's commit (`null` = unknown: git
 * failed, or the criterion maps no file). `criteria_changed` is set when the CRITERIA.md hash moved.
 */
export function flappingOf({ history, failedIds, text, root, criteriaSha }) {
  const out = [];
  const hist = Array.isArray(history) ? history : [];
  let mapped = null;
  for (const id of failedIds ?? []) {
    const last = lastObservation(hist, id);
    if (!last || last.status !== 'passed') continue;
    const flag = { id, passed_run: last.line.run, passed_commit: last.line.commit ?? null, files_changed: null };
    mapped ??= criterionPaths(text, trackedFiles(root));
    const ps = mapped.get(id) ?? [];
    const changed = typeof flag.passed_commit === 'string' && ps.length ? diffSince(root, flag.passed_commit) : null;
    if (changed) flag.files_changed = touches(ps, changed);
    if (criteriaSha && last.line.criteria_sha && last.line.criteria_sha !== criteriaSha) flag.criteria_changed = true;
    out.push(flag);
  }
  return out;
}
