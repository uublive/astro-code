// The "what next" payload for `ac status --json` and the text `Next:` line (phase 43).
//
// The PRIMARY recommendation lives in exactly one place: `nextAction(readContext(root, now))`
// in hooks/_astro-ctx.mjs, which the SessionStart banner and the statusline already print.
// This module never re-derives it -- it relays it verbatim and adds only the two things that
// rule does not carry: SIBLINGS (what else is sensible right now) and ADMISSIBILITY (which
// loop verbs a phase's state allows, so a sibling is never a command `ac` would refuse).
//
// `lib/` may import from `hooks/_astro-ctx.mjs` (ADR-046's direction: hooks never import lib).
import { readContext, nextAction } from '../hooks/_astro-ctx.mjs';
import { loadRoadmap, isPhasePlanned } from './roadmap.mjs';
import { phaseContextStatus } from './planning.mjs';
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
export function siblingCommands(phases, next) {
  const m = NEXT_RE.exec(String(next));
  if (!m || !Array.isArray(phases)) return [];
  const verb = m[1];
  const n = Number(m[2]);
  const out = [];
  if (verb === 'execute' || verb === 'accept') {
    const feed = phases.find((p) => p.number > n && p.status === 'pending' && !p.planned);
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

/** The `ac status --json` payload. No registry read: it must stay fast and offline. */
export function statusJson(root, nowSeconds) {
  const ctx = readContext(root, nowSeconds);
  const next = nextAction(ctx);
  const phases = [...loadRoadmap(root).phases]
    .sort((a, b) => a.number - b.number)
    .map((p) => ({
      number: p.number, name: p.name, slug: p.slug, status: p.status,
      planned: isPhasePlanned(root, p.slug),
      discussed: phaseContextStatus(root, p.slug) === 'ready',
    }));
  // While `/astro-execute N` is running (its live verb is up), executing N again is not a next
  // step: the first sensible sibling (planning the next phase, say) is offered in its place.
  // Teammates' phases (readContext read them from the local registry ref): an owner tag on the
  // ones in this roadmap, and the ones only in the registry appended. Never offered as a next step.
  const owner = new Map(ctx.phases.filter((p) => p.owner).map((p) => [p.number, p.owner]));
  const team = [
    ...phases.map((p) => (owner.has(p.number) ? { ...p, owner: owner.get(p.number) } : p)),
    ...ctx.phases.filter((p) => p.remote).map((p) => ({ number: p.number, status: p.status, owner: p.owner, remote: true, planned: false, discussed: false })),
  ].sort((a, b) => a.number - b.number);
  let siblings = siblingCommands(phases, next);
  let shown = next;
  if (ctx.phase && next === `/astro-execute ${ctx.phase.number}` && EXECUTING_RE.test(ctx.activity ?? '')) {
    shown = siblings[0] ?? null;
    siblings = siblings.slice(1);
  }
  return {
    root,
    version: ownVersion(),
    project: ctx.project,
    milestone: ctx.milestone,
    phase: ctx.phase,
    next: shown,
    siblings,
    phases: team,
    activity: ctx.activity,
    activityUntil: ctx.activityUntil,
  };
}
