// Shared, dependency-free context reader + renderers for the astro-code hooks
// (the composing statusline and the SessionStart banner).
//
// Hooks are copied STANDALONE into ~/.astro/code/hooks (lib/ is never copied
// there), so this file must NOT import from ../lib — it re-implements the tiny
// bits it needs. Pure functions only; the hooks own all the I/O of stdin/stdout.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, parse } from 'node:path';

// A live activity verb older than this is treated as stale and ignored, so a
// command that crashed before clearing can never pin a verb on the line forever.
export const ACTIVITY_TTL_SECONDS = 20 * 60;

export function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Mirror of lib/planning.mjs CONTEXT_MARKER_RE (this file can't import ../lib):
// only a CONTEXT.md genuinely captured by /astro-discuss carries the marker, so
// a hand-seeded stub doesn't count as "discussed".
const CONTEXT_MARKER_RE = /<!--\s*astro-discuss:\s*captured\s*-->/i;
function phaseDiscussed(root, slug) {
  try {
    return CONTEXT_MARKER_RE.test(readFileSync(join(root, '.astrocode', 'phases', slug, 'CONTEXT.md'), 'utf8'));
  } catch {
    return false;
  }
}

// Walk up from `startDir` until we find a dir holding `.astrocode/` state.
export function findAstroRoot(startDir) {
  let dir = startDir;
  if (!dir || typeof dir !== 'string') return null;
  const top = parse(dir).root;
  while (true) {
    if (existsSync(join(dir, '.astrocode', 'state.json')) ||
        existsSync(join(dir, '.astrocode', 'roadmap.json'))) return dir;
    if (dir === top) return null;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

// Normalize state.json + roadmap.json into one render-ready context object.
// `nowSeconds` is injected (not read from the clock) so renderers stay pure/testable.
export function readContext(root, nowSeconds) {
  const state = readJson(join(root, '.astrocode', 'state.json')) || {};
  const roadmap = readJson(join(root, '.astrocode', 'roadmap.json')) || {};
  const phases = Array.isArray(roadmap.phases) ? roadmap.phases : [];

  // The "current" phase: the active one if state names it, else the lowest-numbered
  // phase that isn't complete (i.e. the next thing to work on).
  let phase = null;
  if (state.active_phase != null) {
    phase = phases.find((p) => p.slug === state.active_phase ||
      String(p.number) === String(state.active_phase)) || null;
  }
  if (!phase) {
    phase = phases.filter((p) => p.status !== 'complete')
      .sort((a, b) => a.number - b.number)[0] || null;
  }

  const done = phases.filter((p) => p.status === 'complete').length;
  const blockers = Array.isArray(state.blockers) ? state.blockers.length : 0;

  // live activity: { text, at } — honored only while fresh.
  let activity = null;
  const a = state.activity;
  if (a && typeof a === 'object' && typeof a.text === 'string' && a.text) {
    const age = typeof a.at === 'number' ? (nowSeconds - a.at) : Infinity;
    if (age <= ACTIVITY_TTL_SECONDS) activity = a.text;
  }

  return {
    project: state.project || roadmap.project || null,
    status: state.status || null,
    milestone: roadmap.milestone ?? null,
    phase: phase ? { number: phase.number, slug: phase.slug, name: phase.name, status: phase.status } : null,
    planned: phase ? existsSync(join(root, '.astrocode', 'phases', phase.slug, 'PLAN.md')) : false,
    discussed: phase ? phaseDiscussed(root, phase.slug) : false,
    done, total: phases.length, blockers, activity,
  };
}

// --- presentation ------------------------------------------------------------

const ANSI = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const useColor = () => !process.env.NO_COLOR;
function paint(s, code) { return useColor() && code ? `${code}${s}${ANSI.reset}` : s; }

// phase lifecycle → colour (also the ⊡ glyph colour): pending→executing→verified→complete
const STATUS_COLOR = {
  pending: ANSI.dim, executing: ANSI.yellow, verified: ANSI.cyan,
  complete: ANSI.green, rejected: ANSI.red,
};
export function statusColor(status) { return STATUS_COLOR[status] || ANSI.dim; }

// The phase number already prefixes the line (`P3`), so drop a redundant numeric
// prefix from the slug for display: `03-close-ci-gates` → `close-ci-gates`.
export function phaseLabel(phase) {
  return String(phase.slug || '').replace(/^\d+[-_]/, '') || phase.slug;
}

// The slash command to suggest next, derived from where the current phase is.
// An unplanned phase routes discuss → plan → execute: discussion is the default
// first step (the /astro-plan gate stays a soft fallback for trivial phases).
export function nextAction(ctx) {
  const p = ctx?.phase;
  if (!p) return '/astro-status';
  switch (p.status) {
    case 'pending':
      if (ctx.planned) return `/astro-execute ${p.number}`;
      return ctx.discussed ? `/astro-plan ${p.number}` : `/astro-discuss ${p.number}`;
    case 'executing': return `/astro-execute ${p.number}`;
    case 'verified': return `/astro-accept ${p.number}`;
    case 'rejected': return `/astro-plan ${p.number}`;
    default: return '/astro-status';
  }
}

// The one-line statusline segment (ANSI colour OK). Empty when there's nothing
// to say (no milestone and no phase).
export function renderSegment(ctx) {
  if (!ctx || (ctx.milestone == null && !ctx.phase)) return '';
  const col = ctx.phase ? statusColor(ctx.phase.status) : ANSI.dim;
  const parts = [`${paint('⊡', col)} ${paint('astro', ANSI.bold)}`];
  if (ctx.milestone != null) parts.push(`M${ctx.milestone}`);
  if (ctx.phase) parts.push(`P${ctx.phase.number} ${phaseLabel(ctx.phase)}`);
  if (ctx.activity) parts.push(paint(ctx.activity, ANSI.yellow));     // live verb wins
  else if (ctx.phase) parts.push(`▸ ${ctx.phase.status}`);
  if (ctx.total) parts.push(`${ctx.done}/${ctx.total}`);
  if (ctx.blockers) parts.push(paint(`⚠${ctx.blockers}`, ANSI.red));
  return parts.join(' · ');
}

// A terse, PLAIN-text continuity note for the PreCompact hook. Context compaction
// summarizes the conversation; this note is emitted right before it so the model's
// astro-code position (milestone/phase/status/next action) survives INTO the summary
// verbatim — the statusline carries it visually, but a summarized transcript may not.
// Points at the on-disk source of truth so re-orientation is one command. Empty when
// there's nothing to say (no milestone and no phase), so non-astro sessions stay quiet.
export function renderResumeNote(ctx) {
  if (!ctx || (ctx.milestone == null && !ctx.phase)) return '';
  const bits = [];
  if (ctx.project) bits.push(ctx.project);
  if (ctx.milestone != null) bits.push(`M${ctx.milestone}`);
  if (ctx.phase) bits.push(`P${ctx.phase.number} ${phaseLabel(ctx.phase)} (${ctx.phase.status})`);
  if (ctx.total) bits.push(`${ctx.done}/${ctx.total} phases`);
  if (ctx.blockers) bits.push(`${ctx.blockers} blocker(s)`);
  return (
    `astro-code — keep this after compaction: ${bits.join(' · ')}. ` +
    `Next: ${nextAction(ctx)}. Full state is on disk in .astrocode/; run /astro-status to re-orient.`
  );
}

// The multi-line SessionStart banner (PLAIN text — it rides in a systemMessage,
// which is not ANSI-rendered, so the art is flat monochrome: no colour, no real
// image, just Unicode block glyphs). The creature is the astro-code mascot; the
// compact ⊡ mark is kept for the single-line statusline (renderSegment).
export function renderBanner(ctx) {
  if (!ctx || (ctx.milestone == null && !ctx.phase)) return '';
  const ctxLine = [];
  if (ctx.milestone != null) ctxLine.push(`M${ctx.milestone}`);
  if (ctx.phase) ctxLine.push(`P${ctx.phase.number} ${phaseLabel(ctx.phase)}`);
  if (ctx.activity) ctxLine.push(ctx.activity);
  else if (ctx.phase) ctxLine.push(ctx.phase.status);
  if (ctx.total) ctxLine.push(`${ctx.done}/${ctx.total} phases`);
  const lines = [
    '  ▛▀▀▀▜',
    '  ▌▘ ▘▐   ASTRO·CODE',
    '  ▙▄▄▄▟',
  ];
  if (ctxLine.length) lines.push('   ' + ctxLine.join(' · '));
  lines.push('   next: ' + nextAction(ctx));
  return lines.join('\n');
}
