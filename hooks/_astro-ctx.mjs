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

// Shiny palette. Truecolor terminals (COLORTERM=truecolor|24bit) get vivid neon
// tones; everyone else falls back to the bright ANSI set (bold + 9x) — still
// punchy, and universally supported. NO_COLOR strips it all.
const TRUECOLOR = /^(truecolor|24bit)$/i.test(process.env.COLORTERM || '');
const rgb = (r, g, b) => `\x1b[1;38;2;${r};${g};${b}m`;        // bold + 24-bit fg
const ANSI = TRUECOLOR ? {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[38;2;128;140;168m',
  red: rgb(255, 71, 108), green: rgb(57, 255, 150), yellow: rgb(255, 209, 71),
  cyan: rgb(56, 224, 255), magenta: rgb(199, 125, 255),
} : {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[90m',
  red: '\x1b[1;91m', green: '\x1b[1;92m', yellow: '\x1b[1;93m', cyan: '\x1b[1;96m', magenta: '\x1b[1;95m',
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
  const brand = `${paint('⊡', col)} ${paint('astro', ANSI.magenta)}` +
    (ctx.version ? paint(` v${ctx.version}`, ANSI.dim) : '');
  const parts = [brand];
  if (ctx.milestone != null) parts.push(`M${ctx.milestone}`);
  if (ctx.phase) parts.push(`P${ctx.phase.number} ${phaseLabel(ctx.phase)}`);
  if (ctx.activity) parts.push(paint(ctx.activity, ANSI.yellow));     // live verb wins
  else if (ctx.phase) parts.push(`▸ ${ctx.phase.status}`);
  if (ctx.total) parts.push(`${ctx.done}/${ctx.total}`);
  if (ctx.blockers) parts.push(paint(`⚠${ctx.blockers}`, ANSI.red));
  return parts.join(' · ');
}

// --- busy / idle activity dot -------------------------------------------------
// The statusline can't tell from its own stdin whether a turn is in flight, so
// two hooks record turn boundaries into a per-session record: UserPromptSubmit
// stamps `prompt` (a turn started), Stop stamps `stop` (it ended). We're busy
// when the last boundary was a prompt — unless the record has gone stale (a turn
// that crashed before Stop can't pin the dot green forever).
export const SESSION_STALE_SECONDS = 20 * 60;

export function isBusy(rec, nowSeconds, ttl = SESSION_STALE_SECONDS) {
  if (!rec || typeof rec !== 'object') return false;
  const prompt = typeof rec.prompt === 'number' ? rec.prompt : -Infinity;
  const stop = typeof rec.stop === 'number' ? rec.stop : -Infinity;
  if (stop >= prompt) return false;            // last boundary was a Stop → idle
  const at = typeof rec.at === 'number' ? rec.at : prompt;
  return (nowSeconds - at) <= ttl;             // busy, unless the turn went stale
}

// The leading status glyph: a solid green ● while working, a hollow dim ○ when idle.
export function renderStatus(busy) {
  return busy ? paint('●', ANSI.green) : paint('○', ANSI.dim);
}

// --- Claude-session segment: recap · model · context-fill bar ----------------
// These read Claude's own live session (the stdin blob + the transcript it points
// at), not the .astrocode/ project state. Kept here so the statusline hook stays
// pure I/O glue and every renderer is unit-testable. The transcript reader is
// injectable so tests don't need a file on disk.

function defaultRead(p) {
  try { return p ? readFileSync(p, 'utf8') : null; } catch { return null; }
}

// Nominal context window (max input tokens) for the running model — the fill bar's
// denominator. Authoritative sizes from the Claude models catalog (claude-api skill,
// cached 2026-06-24): the whole CURRENT generation — Opus 4.6/4.7/4.8, Sonnet 4.6/5,
// Fable 5, Mythos 5 — is **1M**. Only **Haiku** and the **legacy** tier (Opus ≤4.5,
// Sonnet ≤4.5, Claude 3/2/instant) are **200K**. There is NO `[1m]` opt-in variant —
// 1M is simply the default and the max for current models (the earlier `[1m]` check was
// wrong and made `claude-opus-4-8` read 200K → a misleading 236%). Unknown ids default to
// 1M (matching every model Claude Code runs today); the statusline hook also bumps the
// limit if measured tokens ever exceed it, so a future change can't resurrect a >100%.
const CTX_200K = /haiku|opus-4-(0|1|5)|sonnet-4-(0|5)|sonnet-3|claude-[123]-|claude-2|instant/i;
export function modelLimit(model) {
  const id = String((model && (model.id || model.display_name)) || '');
  return CTX_200K.test(id) ? 200_000 : 1_000_000;
}

// Current context-window occupancy, from the session transcript: the LAST line
// carrying a `usage` block reflects how full the window is right now. The whole
// input side occupies the window — fresh input + both cache tiers. We scan from
// the end and stop at the first hit (cheap on big transcripts). null → no usage.
export function readContextTokens(transcriptPath, read = defaultRead) {
  const text = read(transcriptPath);
  if (text == null) return null;
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s) continue;
    let obj; try { obj = JSON.parse(s); } catch { continue; }
    const u = (obj.message && obj.message.usage) || obj.usage;
    if (!u) continue;
    const sum = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    // Skip all-zero usage blocks. Claude Code writes trailing assistant markers — at the
    // context limit, or on an aborted/empty turn — with a ZEROED usage object; taking the
    // last usage block blindly then reads 0 and renders "0% · 0/1M" on a session that's
    // actually FULL. A real turn always consumes the window (cache_read or input > 0), so
    // return the last turn that genuinely did.
    if (sum > 0) return sum;
  }
  return null;
}

// A short "what's Claude doing" recap: the last human turn in the transcript,
// squished to one line. Tool-result turns (content is tool_result blocks, no
// text) and slash-command/meta turns (wrapped in <…> or […]) are skipped.
export function readRecap(transcriptPath, read = defaultRead) {
  const text = read(transcriptPath);
  if (text == null) return '';
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const s = lines[i].trim();
    if (!s) continue;
    let obj; try { obj = JSON.parse(s); } catch { continue; }
    if (obj.type !== 'user' || !obj.message) continue;
    const c = obj.message.content;
    let t = '';
    if (typeof c === 'string') t = c;
    else if (Array.isArray(c)) t = c.filter((b) => b && b.type === 'text').map((b) => b.text || '').join(' ');
    t = t.trim();
    if (!t || t.startsWith('<') || t.startsWith('[')) continue; // tool-result / command meta
    return t;
  }
  return '';
}

// Collapse whitespace and cap a string to `n` visible chars with an ellipsis.
export function truncate(s, n = 48) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// A graphical █░ progress bar for a 0..1 fraction.
export function progressBar(fraction, width = 10) {
  const f = Math.max(0, Math.min(1, Number(fraction) || 0));
  const filled = Math.round(f * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

const kfmt = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M`
  : n >= 1e5 ? `${Math.round(n / 1e3)}k`
    : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`);

// The dim, leading recap segment. Empty when there's no task text.
export function renderRecap(text) {
  const t = truncate(text, 48);
  return t ? paint(`❯ ${t}`, ANSI.dim) : '';
}

// model name + a context-fill bar (bar+percent+tokens/limit). `tokens`/`limit`
// may be null (no transcript yet) → only the model shows. Colour ramps
// green→yellow→red as the window fills. Empty when there's no model at all.
export function renderClaudeSegment({ model, tokens, limit } = {}) {
  const parts = [];
  const name = model && (model.display_name || model.id);
  if (name) parts.push(paint(name, ANSI.cyan));
  if (tokens != null && limit) {
    const f = tokens / limit;
    const col = f >= 0.85 ? ANSI.red : f >= 0.6 ? ANSI.yellow : ANSI.green;
    parts.push(`${paint(progressBar(f), col)} ${Math.round(f * 100)}% · ${kfmt(tokens)}/${kfmt(limit)}`);
  }
  return parts.join(' ');
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
