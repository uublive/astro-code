// Tie a phase or milestone to a feature branch (phase 58): `ac flow link|unlink`, and the automatic
// tie that discuss, plan and execute run while you are on a feature branch.
//
// The tie itself is the registry claim's `feature_branch` (see tieClaim in registry.mjs for why it is
// a new field and not the historic `branch`), so teammates' bars and `ac status` see it.
//
// ADR-009 holds at this layer too: nothing here ever creates or switches a branch. `link` ties to the
// branch you are ALREADY on, and `autoTie` only reads HEAD. This is a separate module from flow.mjs,
// which phase 57 is editing; it imports `loadFlowConfig` from it read-only.
//
// `flowLink` / `flowUnlink` throw an Error the CLI turns into `die(msg)`; `autoTie` NEVER throws and is
// best effort, because it runs inside commands whose stdout and exit code callers compare exactly.
import { loadFlowConfig } from './flow.mjs';
import { findPhase } from './roadmap.mjs';
import { tieClaim, registryBranch } from './registry.mjs';
import { myIdentities } from './identity.mjs';
import { ownership, headBranch } from '../hooks/_astro-team.mjs';

/** `m<N>` is a milestone; `<N>` or a phase slug is a phase. A bare number missing from the roadmap still targets its registry claim. */
export function parseTieTarget(root, s) {
  const ref = String(s ?? '').trim();
  const m = /^m(\d+)$/i.exec(ref);
  if (m) return { type: 'milestone', number: Number(m[1]) };
  if (/^\d+$/.test(ref)) return { type: 'phase', number: Number(ref) };
  const ph = ref ? findPhase(root, ref) : null;
  if (ph) return { type: 'phase', number: ph.number };
  throw new Error(`no phase or milestone "${ref}" — use a phase number or slug, or m<N> for a milestone`);
}

const label = (t) => `${t.type} ${t.number}`;

function assertFlowEnabled(cfg) {
  if (!cfg.enabled) {
    throw new Error('gitflow is disabled — set gitflow.enabled=true (ac config set gitflow.enabled true)');
  }
}

function assertRegistryResult(res, t) {
  if (!res.ok) throw new Error(res.error);
  if (res.source === 'local') throw new Error('no shared registry — run `ac registry init` first, so the tie can be shared');
  if (!res.found) throw new Error(`${label(t)} has no claim in the shared registry`);
}

export function flowLink(root, target) {
  const cfg = loadFlowConfig(root);
  assertFlowEnabled(cfg);
  const branch = headBranch(root);
  if (!branch) throw new Error('HEAD is detached — switch to a feature branch first, then link');
  if (branch === cfg.main || branch === cfg.develop || branch === registryBranch(root)) {
    throw new Error(`cannot tie to ${branch} — switch to a feature branch (e.g. ${cfg.prefixes.feature}/<name>) first`);
  }
  const t = typeof target === 'string' ? parseTieTarget(root, target) : target;
  const res = tieClaim({ root, type: t.type, number: t.number, tie: branch });
  assertRegistryResult(res, t);
  if (!res.changed) return { message: `✓ ${label(t)} already tied to ${branch}` };
  return { message: res.from ? `✓ ${label(t)} moved from ${res.from} to ${branch}` : `✓ ${label(t)} tied to ${branch}` };
}

export function flowUnlink(root, target) {
  assertFlowEnabled(loadFlowConfig(root));
  const t = typeof target === 'string' ? parseTieTarget(root, target) : target;
  const res = tieClaim({ root, type: t.type, number: t.number, tie: null });
  assertRegistryResult(res, t);
  return { message: `✓ ${label(t)} untied` };
}

const tiedElsewhere = (n, other) => `⚠ phase ${n} is tied to ${other} — \`ac flow link ${n}\` moves it`;

/**
 * Tie phase `number` to the feature branch HEAD is on, when every guard holds; otherwise do nothing.
 * Returns `{ line }` — one stderr line, or null for silence. Never throws, never creates or switches a
 * branch, never overwrites a tie, respects an explicit unlink. The local registry ref is read first, so a
 * phase that already shows a tie costs no network call.
 */
export function autoTie(root, number) {
  try {
    const cfg = loadFlowConfig(root);
    if (!cfg.enabled) return { line: null };
    const branch = headBranch(root);
    if (!branch || !branch.startsWith(`${cfg.prefixes.feature}/`)) return { line: null };
    if (branch === cfg.main || branch === cfg.develop || branch === registryBranch(root)) return { line: null };
    const me = [...myIdentities({ root })];

    const own = ownership(root);
    const c = own && own.claims.find((x) => x.number === number);
    if (c) {
      const owner = typeof c.owner === 'string' ? c.owner.trim().toLowerCase() : '';
      if (owner && !me.includes(owner)) return { line: null };
      if ('tie' in c) return { line: typeof c.tie === 'string' && c.tie !== branch ? tiedElsewhere(number, c.tie) : null };
      const ms = own.milestoneTies[c.milestone];
      if (typeof ms === 'string' && ms !== branch) return { line: tiedElsewhere(number, ms) };
    }

    const res = tieClaim({ root, type: 'phase', number, tie: branch, auto: true, me });
    if (!res.ok) return { line: `⚠ could not tie phase ${number} to ${branch}: ${res.error}` };
    if (res.source === 'local' || !res.found) return { line: null };
    if (res.changed) return { line: `• phase ${number} tied to ${branch}` };
    if ((res.skipped === 'tied' || res.skipped === 'milestone-tied') && typeof res.from === 'string' && res.from !== branch) {
      return { line: tiedElsewhere(number, res.from) };
    }
    return { line: null };
  } catch (e) {
    return { line: `⚠ could not tie phase ${number}: ${String(e && e.message ? e.message : e).split('\n')[0]}` };
  }
}
