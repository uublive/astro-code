// Retrieval orchestration (P1/P4/P8/P10, phase 25) — wires the pure engines
// (lib/stack.mjs, lib/principlebrief.mjs, lib/principleask.mjs, lib/principlecanon.mjs,
// lib/principleusage.mjs) into the shapes `bin/ac.mjs` and the hooks need, keeping
// `bin/` a thin dispatcher (CONVENTIONS).
//
// `brief`/`ask`/`cite` deliberately never call `principlesSync` (P1): they sit on the
// hot path of every agent task and every session start, and a hook must never wait on
// a `git fetch`. They read the local store as it stands; the next `list`/`show`/write
// syncs as before.
import { basename } from 'node:path';
import { findRoot } from './paths.mjs';
import { git, isRepo } from './git.mjs';
import { loadState } from './state.mjs';
import { loadPrinciples, resolvePrinciple } from './principles.mjs';
import { projectStack } from './stack.mjs';
import { selectBrief, renderBrief, workForStage } from './principlebrief.mjs';
import { rankPrinciples, renderAsk } from './principleask.mjs';
import { canonItems, clashCandidates } from './principlecanon.mjs';
import { recordUsage, readUsage, usageReport } from './principleusage.mjs';

/**
 * The project root + name for `cwd` (P5's root rule): `findRoot()` (an `.astrocode/`
 * ancestor), else `git rev-parse --show-toplevel`, else `cwd` itself — `brief`/`ask`
 * work in a directory with no `.astrocode/` at all (C4's go.mod-only project).
 *
 * @param {string} cwd
 * @returns {{ root: string, project: string, hasAstro: boolean }}
 */
export function projectContext(cwd = process.cwd()) {
  const astroRoot = findRoot(cwd);
  if (astroRoot) {
    const project = loadState(astroRoot)?.project || basename(astroRoot);
    return { root: astroRoot, project, hasAstro: true };
  }
  if (isRepo(cwd)) {
    const r = git(['rev-parse', '--show-toplevel'], { cwd });
    if (r.status === 0 && r.stdout.trim()) {
      const top = r.stdout.trim();
      return { root: top, project: basename(top), hasAstro: false };
    }
  }
  return { root: cwd, project: basename(cwd), hasAstro: false };
}

/** clash candidates for every entry, over the project's canon (P6). Read-only. */
export function clashesFor(entries, { root, project }) {
  const items = canonItems(root);
  if (!items.length) return entries;
  return entries.map((e) => ({ ...e, clash: clashCandidates(e, items, { root, project }) }));
}

function stageWork(stage, workFlag) {
  if (workFlag && workFlag.length) return workFlag;
  return workForStage(stage || 'session');
}

async function logServed(dir, brief, { by, stage, project, now }) {
  const events = [
    ...brief.rules.map((r) => ({ event: 'served', id: r.id, by, stage, project })),
    ...brief.index.map((i) => ({ event: 'served', id: i.id, by, stage, project })),
  ];
  if (!events.length) return;
  try {
    await recordUsage(dir, events, { now });
  } catch {
    console.error('⚠ could not record principle usage (shortlist still served)');
  }
}

/**
 * The per-task/session shortlist (P1/P4). Never syncs (see module header).
 *
 * @param {{ dir: string, cwd?: string, stage?: string, work?: string[], files?: string[], rulesOnly?: boolean, by?: string, now?: Date }} opts
 * @returns {{ brief: object, text: string, json: object, ctx: object }}
 */
export async function shortlist({
  dir, cwd = process.cwd(), stage = 'session', work, files = [], rulesOnly = false, by = 'cli', now = new Date(),
} = {}) {
  const { root, project } = projectContext(cwd);
  const stack = projectStack(root);
  const { entries } = loadPrinciples(dir);
  const withClash = clashesFor(entries, { root, project });

  const effectiveWork = stage === 'verify' ? [] : stageWork(stage, work);
  const effectiveRulesOnly = rulesOnly || stage === 'verify';

  const ctx = { stack: stack.tags, work: effectiveWork, files, sources: stack.sources, override: stack.override, stage };
  const brief = selectBrief(withClash, ctx, { rulesOnly: effectiveRulesOnly });
  const text = renderBrief(brief, ctx, { rulesOnly: effectiveRulesOnly });

  await logServed(dir, brief, { by, stage, project, now });

  const jsonOut = {
    stack: { tags: stack.tags, sources: stack.sources, override: stack.override },
    stage, work: effectiveWork, files,
    rules: brief.rules, index: brief.index, more: brief.more, total: brief.total,
  };
  return { brief, text, json: jsonOut, ctx };
}

/**
 * `ask` (P7/P10). Logs its listed results as served, stage defaulting to `ask`.
 *
 * @param {{ dir: string, cwd?: string, question: string, stage?: string, by?: string, now?: Date }} opts
 */
export async function askStore({ dir, cwd = process.cwd(), question, stage = 'ask', by = 'cli', now = new Date() } = {}) {
  const { root, project } = projectContext(cwd);
  const stack = projectStack(root);
  const { entries } = loadPrinciples(dir);
  const results = rankPrinciples(entries, question, { stack: stack.tags });
  const text = renderAsk(results, question);

  const events = results.slice(0, 10).map((r) => ({ event: 'served', id: r.id, by, stage, project }));
  if (events.length) {
    try { await recordUsage(dir, events, { now }); } catch { console.error('⚠ could not record principle usage'); }
  }

  return { results, text };
}

/**
 * `cite` (P9): resolve each ref (unique prefix ok), record the rest as cited.
 *
 * @param {{ dir: string, cwd?: string, refs: string[], stage?: string, by?: string, now?: Date }} opts
 */
export async function cite({ dir, cwd = process.cwd(), refs, stage = 'cli', by = 'cli', now = new Date() } = {}) {
  const { project } = projectContext(cwd);
  const resolved = [];
  const unresolved = [];
  for (const ref of refs) {
    try {
      const entry = resolvePrinciple(dir, ref);
      resolved.push(entry.id);
    } catch {
      unresolved.push(ref);
    }
  }
  if (resolved.length) {
    const events = resolved.map((id) => ({ event: 'cited', id, by, stage, project }));
    try { await recordUsage(dir, events, { now }); } catch { console.error('⚠ could not record principle usage'); }
  }
  return { resolved, unresolved };
}

/**
 * The review surface (P8/D4): served-often-never-cited and never-served, over
 * currently accepted entries.
 *
 * @param {{ dir: string }} opts
 */
export function usageReview({ dir }) {
  const { entries } = loadPrinciples(dir);
  const accepted = entries.filter((e) => e.status === 'accepted');
  const { events } = readUsage(dir);
  return { ...usageReport(accepted, events), log: events };
}
