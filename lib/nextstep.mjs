// The "what next" payload for `ac status --json` and the text `Next:` line (phase 43).
//
// The PRIMARY recommendation lives in exactly one place: `nextAction(readContext(root, now))`
// in hooks/_astro-ctx.mjs, which the SessionStart banner and the statusline already print.
// This module never re-derives it -- it relays it verbatim and adds only the two things that
// rule does not carry: SIBLINGS (what else is sensible right now) and ADMISSIBILITY (which
// loop verbs a phase's state allows, so a sibling is never a command `ac` would refuse).
//
// Ownership and branch ties (phase 58) come from the LOCAL registry ref only, never a fetch:
// `ownership` and `headBranch` in hooks/_astro-team.mjs read ref files and one cached `git show`.
//
// `lib/` may import from `hooks/_astro-ctx.mjs` (ADR-046's direction: hooks never import lib).
import { readContext, nextAction } from '../hooks/_astro-ctx.mjs';
import { ownership, headBranch, isMine, ownerTags } from '../hooks/_astro-team.mjs';
import { loadFlowConfig } from './flow.mjs';
import { registryBranch } from './registry.mjs';
import { loadRoadmap, isPhasePlanned } from './roadmap.mjs';
import { phaseContextStatus } from './planning.mjs';
import { deferredFixes } from './fixes.mjs';
import { pendingPhases } from './fullcheck.mjs';
import { readFileSync } from 'node:fs';

// astro-code's own version, for the phase band's title (`✦ astro-code v0.50.0`).
const ownVersion = () => { try { return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version ?? null; } catch { return null; } };

/** Does `phase`'s state admit loop verb `verb`? Mirrors what each command accepts. */
export function admits(phase, verb) {
  const s = phase?.status;
  switch (verb) {
    case 'discuss':
    case 'plan': return s === 'pending' || s === 'rejected';
    case 'execute': return (s === 'pending' && !!phase.planned) || s === 'executing';
    case 'verify': return s === 'executing';
    case 'accept': return s === 'verified';
    default: return false;
  }
}

const NEXT_RE = /^\/astro-(discuss|plan|execute|verify|accept) (\d+)$/;
const MAX_SIBLINGS = 2;
// the verb /astro-execute sets for its run (commands/astro-execute.md step 2)
const EXECUTING_RE = /^⚙ executing\b/;

/**
 * Up to two sensible commands besides `next`, as a pure function of the ordered phase list
 * `[{ number, status, planned, discussed }]`:
 *   - pipeline feed (astro-status.md 3b): while N executes or waits for accept, the first later
 *     pending, unplanned phase gets discuss (or plan once discussed), so the next phase's
 *     groundwork overlaps;
 *   - waiting human gate: the lowest `verified` phase other than N gets accept.
 * `/astro-status` or an unparseable `next` has no siblings. Every entry is admissible.
 */
export function siblingCommands(phases, next, activeMilestone = null) {
  const m = NEXT_RE.exec(String(next));
  if (!m || !Array.isArray(phases)) return [];
  const verb = m[1];
  const n = Number(m[2]);
  const out = [];
  if (verb === 'execute' || verb === 'accept') {
    // Milestone order, then phase order (#142): the active milestone's phases first, later
    // milestones only when it has none left, earlier milestones never. A phase with no milestone
    // counts as the active one's.
    const ms = (p) => (p.milestone ?? activeMilestone);
    const feed = phases
      .filter((p) => p.number > n && p.status === 'pending' && !p.planned)
      .filter((p) => activeMilestone == null || ms(p) == null || ms(p) >= activeMilestone)
      .sort((a, b) => (activeMilestone == null ? 0 : (ms(a) ?? activeMilestone) - (ms(b) ?? activeMilestone)) || a.number - b.number)[0];
    if (feed) out.push(`/astro-${feed.discussed ? 'plan' : 'discuss'} ${feed.number}`);
  }
  const gate = phases.find((p) => p.status === 'verified' && p.number !== n);
  if (gate) out.push(`/astro-accept ${gate.number}`);
  return [...new Set(out)]
    .filter((c) => c !== next)
    .filter((c) => {
      const [, v, num] = NEXT_RE.exec(c);
      return admits(phases.find((p) => p.number === Number(num)), v);
    })
    .slice(0, MAX_SIBLINGS);
}

const CLOSED_CLAIM = new Set(['complete', 'retired']);

// The roadmap rows plus registry-only rows, each carrying who owns it and what it is tied to.
// A tie is the claim's `feature_branch`: its own (`null` = explicitly untied) else its milestone's. The
// historic claim `branch` is never read, and a tie that names main, develop, the registry branch or HEAD
// counts as untied. `mine` follows the claim's owner email; no claim or no owner is mine (fail open).
function withOwnership(root, phases, own, branch) {
  const flow = loadFlowConfig(root);
  const ignored = new Set([flow.main, flow.develop, registryBranch(root), 'HEAD']);
  const claimOf = new Map(own.claims.map((c) => [c.number, c]));
  const known = new Set(phases.map((p) => p.number));
  const registryOnly = own.claims
    .filter((c) => !known.has(c.number) && !CLOSED_CLAIM.has(c.status))
    .map((c) => ({ number: c.number, name: c.name, milestone: c.milestone, status: 'pending', planned: false, discussed: false, remote: true }));
  const rows = [...phases, ...registryOnly].map((p) => {
    const c = claimOf.get(p.number);
    let tie = null;
    let by = null;
    if (c && 'tie' in c) tie = c.tie;
    else if (own.milestoneTies[p.milestone ?? c?.milestone] != null) { tie = own.milestoneTies[p.milestone ?? c?.milestone]; by = 'milestone'; }
    if (typeof tie !== 'string' || !tie || ignored.has(tie)) { tie = null; by = null; }
    const owner = c && typeof c.owner === 'string' && c.owner.trim() ? c.owner : null;
    return {
      ...p,
      ...(owner ? { owner } : {}),
      mine: isMine(owner, own.me),
      ...(tie ? { feature_branch: tie } : {}),
      ...(by ? { tied_by: by } : {}),
      onBranch: !!tie && tie === branch,
    };
  });
  const tags = ownerTags([...new Set(rows.filter((p) => !p.mine).map((p) => p.owner))]);
  return rows
    .map((p) => (p.mine ? p : { ...p, owner_tag: tags.get(p.owner) }))
    .sort((a, b) => a.number - b.number);
}

/** The `ac status --json` payload. Local registry REF only, never a fetch: it must stay fast and offline. */
export function statusJson(root, nowSeconds) {
  const ctx = readContext(root, nowSeconds);
  const next = nextAction(ctx);
  const roadmapPhases = [...loadRoadmap(root).phases].sort((a, b) => a.number - b.number);
  // ADR-094: phases verified in fast mode that no passing milestone full check covers yet. The key is ABSENT
  // per phase and at the top level when there are none, like `deferred_fixes`.
  const pending = new Set(pendingPhases(root, roadmapPhases).map((p) => p.number));
  const phases = roadmapPhases
    .map((p) => ({
      number: p.number, name: p.name, slug: p.slug, status: p.status, milestone: p.milestone ?? null,
      planned: isPhasePlanned(root, p.slug),
      discussed: phaseContextStatus(root, p.slug) === 'ready',
      ...(pending.has(p.number) ? { full_check_pending: true } : {}),
    }));
  // While `/astro-execute N` is running (its live verb is up), executing N again is not a next
  // step: the first sensible sibling (planning the next phase, say) is offered in its place.
  // Ownership and ties (phase 58), from the local registry ref. When the ref is unreadable the rows carry
  // NONE of these keys and there is no top-level `registry`, which is the band's cue to show the full view
  // (ADR-043: unknown ownership is never read as "nothing is mine").
  let own = null;
  try { own = ownership(root, nowSeconds); } catch { /* none */ }
  const branch = headBranch(root);
  const team = own ? withOwnership(root, phases, own, branch) : phases;
  let siblings = siblingCommands(phases, next, ctx.milestone ?? null);
  let shown = next;
  if (ctx.phase && next === `/astro-execute ${ctx.phase.number}` && EXECUTING_RE.test(ctx.activity ?? '')) {
    shown = siblings[0] ?? null;
    siblings = siblings.slice(1);
  }
  // Phase 54 (D3): open fixes a human deferred a criterion into. The key is ABSENT when there are none,
  // so a project that never defers carries no new field (the band and `ac status` read this one list).
  const deferred = deferredFixes(root).map((f) => ({
    id: f.id, title: f.title, status: f.status, phase: f.deferred_from.phase, criterion: f.deferred_from.criterion,
  }));
  return {
    root,
    version: ownVersion(),
    project: ctx.project,
    milestone: ctx.milestone,
    phase: ctx.phase,
    ...(branch ? { branch } : {}),
    ...(own ? { registry: true, registry_ref: own.refPath } : {}),
    next: shown,
    siblings,
    phases: team,
    activity: ctx.activity,
    activityUntil: ctx.activityUntil,
    ...(deferred.length ? { deferred_fixes: deferred } : {}),
    ...(pending.size ? { full_check_pending: [...pending] } : {}),
  };
}
