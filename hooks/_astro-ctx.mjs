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

// --- debt pressure -----------------------------------------------------------
//
// The KPI that answers ONE question: is it worth stopping to pay debt down, or
// should you keep building? It lives HERE, in the dependency-free hook helper,
// because both `ac debt score` and the statusline need it and a second copy would
// drift — `lib/debt.mjs` imports it from this file rather than reimplementing it.
//
// ## Why it is not "how much debt do we have"
//
// Volume is a guilt meter, not a decision signal: it only ever rises, so it says
// "pay debt" on every day of the project, which is the same as saying nothing.
// Debt sitting in code you never touch genuinely costs nothing, and a metric that
// cannot express that is lying.
//
// So this measures what the debt is CHARGING you, against what it would cost to
// clear — the interest-vs-principal shape the debt metaphor already implies:
//
//   principal  what paying it off would cost:  small 1 · medium 3 · large 8
//   interest   evidence it is costing you NOW, and only things actually observed:
//                · recurrence (×3) — the verifier hit the same item again in a
//                  LATER phase. The strongest signal there is: you demonstrably
//                  keep walking over this ground. Weighted above one small item's
//                  entire principal, because a cheap thing you have already
//                  tripped over twice should simply be paid.
//                · hotspot (×1) — other open debt in the same file. Concentration
//                  is how a file becomes a place you dread touching.
//                · stale-AND-recurring (×2) — old debt you keep re-hitting and
//                  still have not paid. Age ALONE is deliberately worth nothing.
//
//   pressure = 100 · interest / (interest + principal)
//
// The load-bearing property, and the one the tests pin: **filing more debt cannot
// raise the score by itself.** A fresh, isolated finding is pure principal, so it
// pushes pressure DOWN. Only evidence of the debt actually hurting pushes it up.
// That is what makes this safe to put on a statusline — it can never become a
// number that scolds you for the verifier doing its job.
export const DEBT_PRINCIPAL = Object.freeze({ small: 1, medium: 3, large: 8 });
export const DEBT_STALE_DAYS = 30;
// Bands, deliberately coarse: this is a signal for a judgement call, not a
// measurement. `watch` means something is concentrating; `pay-now` means the
// register is charging you about as much as clearing it would cost.
export const DEBT_BANDS = Object.freeze({ watch: 25, payNow: 50 });

export function debtPressure(db, nowMs = Date.now()) {
  const all = Array.isArray(db?.debt) ? db.debt : [];
  const live = all.filter((d) => d && (d.status === 'open' || d.status === 'paying'));

  const perFile = new Map();
  for (const d of live) {
    if (d.file) perFile.set(d.file, (perFile.get(d.file) || 0) + 1);
  }

  let principal = 0;
  let interest = 0;
  const totals = { recurrence: 0, hotspot: 0, stale: 0 };

  const items = live.map((d) => {
    const p = DEBT_PRINCIPAL[d.cost] ?? DEBT_PRINCIPAL.small;
    const recurrence = Array.isArray(d.also_found_in) ? d.also_found_in.length : 0;
    const hotspot = d.file ? (perFile.get(d.file) || 1) - 1 : 0;
    const found = Date.parse(d.found_at || '');
    const ageDays = Number.isFinite(found) ? Math.max(0, Math.floor((nowMs - found) / 86_400_000)) : 0;
    // Age counts ONLY alongside recurrence. Old-and-untouched is cheap by
    // definition; charging for it would just be the volume metric again.
    const stale = ageDays >= DEBT_STALE_DAYS && recurrence > 0 ? 1 : 0;
    const own = recurrence * 3 + hotspot * 1 + stale * 2;

    principal += p;
    interest += own;
    totals.recurrence += recurrence;
    totals.hotspot += hotspot;
    totals.stale += stale;

    return { id: d.id, title: d.title, file: d.file || '', cost: d.cost, principal: p, recurrence, hotspot, ageDays, interest: own };
  });

  const denom = interest + principal;
  const pressure = denom === 0 ? 0 : Math.round((100 * interest) / denom);
  const band = pressure >= DEBT_BANDS.payNow ? 'pay-now' : pressure >= DEBT_BANDS.watch ? 'watch' : 'healthy';

  // Verifier precision. `dismissed` means a human said the finding was never real,
  // which is feedback about the FEED rather than about the code — a climbing rate
  // is the signal to tighten the verifier, not to work harder on debt.
  const count = (s) => all.filter((d) => d && d.status === s).length;
  const dismissed = count('dismissed');
  const resolved = dismissed + count('paid') + count('dropped');

  return {
    open: live.length,
    principal,
    interest,
    pressure,
    band,
    totals,
    items,
    // Worst-first by friction per unit of effort: what to pay to move the number
    // most per hour spent. Items with no interest are not recommendations.
    worst: items.filter((i) => i.interest > 0)
      .sort((a, b) => (b.interest / b.principal) - (a.interest / a.principal) || b.interest - a.interest),
    files: [...perFile.entries()].map(([file, n]) => ({ file, n })).sort((a, b) => b.n - a.n),
    filed: all.length,
    dismissed,
    falsePositiveRate: resolved === 0 ? 0 : Math.round((100 * dismissed) / resolved),
  };
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

  // `done` is phases the HUMAN accepted (`complete`); `verified` is phases the
  // AI checked but that are still waiting on /astro-accept. Conflating the two
  // reads as "nothing finished" on a milestone where everything passed.
  const verified = phases.filter((p) => p.status === 'verified').length;

  // An in-flight bugfix. A fix INTERRUPTS a phase rather than replacing it, so
  // both are carried: the status line must be able to say "you are on a fix,
  // and P15 is still where you were".
  const fixesDb = readJson(join(root, '.astrocode', 'fixes.json')) || {};
  const allFixes = Array.isArray(fixesDb.fixes) ? fixesDb.fixes : [];
  const openFixes = allFixes.filter((f) => f && f.status !== 'accepted');
  // Newest first — ids are date-prefixed, so a plain string sort is chronological.
  openFixes.sort((a, b) => String(b.id).localeCompare(String(a.id)));
  const fix = openFixes[0]
    ? { id: openFixes[0].id, title: openFixes[0].title, status: openFixes[0].status }
    : null;

  return {
    project: state.project || roadmap.project || null,
    status: state.status || null,
    milestone: roadmap.milestone ?? null,
    phase: phase ? { number: phase.number, slug: phase.slug, name: phase.name, status: phase.status } : null,
    // Ordered phase list, for the statusline's "what comes next" track.
    phases: phases
      .map((p) => ({ number: p.number, status: p.status }))
      .sort((a, b) => a.number - b.number),
    planned: phase ? existsSync(join(root, '.astrocode', 'phases', phase.slug, 'PLAN.md')) : false,
    discussed: phase ? phaseDiscussed(root, phase.slug) : false,
    done, verified, total: phases.length, blockers, activity,
    fix, openFixes: openFixes.length,
    // Debt pressure, for the statusline. One small file read; the band is what
    // decides whether the segment renders at all (see renderSegmentParts).
    debt: debtPressure(readJson(join(root, '.astrocode', 'debt.json')), nowSeconds * 1000),
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

/**
 * The milestone's phases as a window around the current one:
 *
 *   ‹4 (P15)              — 4 phases behind, on the last one, nothing queued
 *   ‹2 (P13) P14 P15      — 2 behind, two still to come
 *   ‹2 (P13) P14 P15 +5   — …and five more beyond those
 *
 * The point is answering "is there anything after this?" at a glance. It
 * replaces the phase slug, which was the widest thing on the line and told you
 * a name you already know. Each number is coloured by its OWN status, so the
 * track doubles as a progress read-out. `lookahead` shrinks on narrow screens.
 */
export function phaseTrack(ctx, lookahead = 2) {
  const phase = ctx?.phase;
  if (!phase) return '';
  const all = Array.isArray(ctx.phases) ? ctx.phases : [];
  const idx = all.findIndex((p) => p.number === phase.number);
  const current = paint(`(P${phase.number})`, statusColor(phase.status));
  if (idx < 0) return current;             // not in the list — show it alone

  const parts = [];
  if (idx > 0) parts.push(paint(`‹${idx}`, ANSI.dim));
  parts.push(current);
  const after = all.slice(idx + 1);
  const shown = lookahead > 0 ? after.slice(0, lookahead) : [];
  for (const p of shown) parts.push(paint(`P${p.number}`, statusColor(p.status)));
  const rest = after.length - shown.length;
  if (rest > 0) parts.push(paint(`+${rest}`, ANSI.dim));
  return parts.join(' ');
}

/**
 * The project segment split at its natural seam:
 *
 *   identity — ⊡ astro v0.14.0 · M6 · ‹4 (P15)   (WHERE you are)
 *   state    — ▸ verified · 5▸ 0✓ · ⚠1           (HOW it's going)
 *
 * One line joins them. A narrow screen puts them on separate rows, so the
 * identity half — the version/milestone/phase you navigate by — survives
 * intact instead of being sliced.
 */
export function renderSegmentParts(ctx, { lookahead = 2 } = {}) {
  if (!ctx || (ctx.milestone == null && !ctx.phase)) return { identity: '', state: '' };
  const col = ctx.phase ? statusColor(ctx.phase.status) : ANSI.dim;
  // D7: the `⊡` glyph already carries the identity — the word "astro" was ~6
  // columns of redundancy on the most width-pressured line, funding the
  // always-visible rate-limit bars (D1/D8).
  const glyph = paint('⊡', col);
  const hasVersion = Boolean(ctx.version);
  const head = hasVersion ? `${glyph} ${paint(`v${ctx.version}`, ANSI.dim)}` : glyph;

  const rest = [];
  if (ctx.milestone != null) rest.push(`M${ctx.milestone}`);
  const track = phaseTrack(ctx, lookahead);
  if (track) rest.push(track);

  // No version → the head is a bare glyph, and the usual " · " joiner would
  // then read as a dangling separator right off it (`⊡ ·`) — the word "astro"
  // used to fill that gap before D7 dropped it (CONTEXT.md open question 1).
  // Fold the first surviving item onto the glyph with a plain space instead;
  // everything after it still joins on the normal middot.
  const identity = hasVersion || !rest.length
    ? [head, ...rest]
    : [`${head} ${rest[0]}`, ...rest.slice(1)];

  const state = [];
  // A live bugfix leads the state half: it is what you are actually doing right
  // now, and the phase behind it is still shown in the identity half.
  if (ctx.fix) {
    const label = String(ctx.fix.id).replace(/^\d{4}-\d{2}-\d{2}-/, '');
    state.push(paint(`⚑ ${label}`, ANSI.red));
    state.push(paint(ctx.fix.status, ANSI.yellow));
  }
  if (ctx.activity) state.push(paint(ctx.activity, ANSI.yellow));     // live verb wins
  else if (ctx.phase) state.push(`▸ ${ctx.phase.status}`);
  // Verified (AI-checked) vs accepted (human-signed-off) are different facts and
  // a single done/total hid the gap — five phases awaiting /astro-accept read as
  // "0 done" before this.
  if (ctx.total) {
    state.push(`${paint(`${ctx.verified ?? 0}▸`, ANSI.dim)} ${paint(`${ctx.done ?? 0}✓`, ANSI.dim)}`);
  }
  if (ctx.blockers) state.push(paint(`⚠${ctx.blockers}`, ANSI.red));
  // Debt rides the line ONLY once it is actually charging you. A permanent
  // "debt 6" would be wallpaper — read once, ignored forever — and worse, it
  // would punish the verifier for filing, which is the behavior we want. So the
  // healthy band renders nothing at all, and the segment appearing IS the signal.
  // Spelled out rather than glyphed: ⚖ read as noise at statusline size, and every
  // other segment here is either a word or a symbol with an obvious referent (⎇, $).
  if (ctx.debt && ctx.debt.band !== 'healthy') {
    state.push(paint(`debt ${ctx.debt.pressure}`, ctx.debt.band === 'pay-now' ? ANSI.red : ANSI.yellow));
  }
  return { identity: identity.join(' · '), state: state.join(' · ') };
}

export function renderSegment(ctx, opts = {}) {
  const { identity, state } = renderSegmentParts(ctx, opts);
  return [identity, state].filter(Boolean).join(' · ');
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

// The shared green→yellow→red ramp: yellow from 60%, red from 85%. Every gauge
// on the line (context-fill, rate-limit quota) reuses this ONE function so two
// bars never disagree about what "yellow" means (ADR: match renderClaudeSegment's
// existing ramp rather than invent a second one for quota).
export function rampColor(fraction) {
  const f = Number(fraction) || 0;
  return f >= 0.85 ? ANSI.red : f >= 0.6 ? ANSI.yellow : ANSI.green;
}

// model name + a context-fill gauge drawn exactly like the quota windows:
// `ctx █░░░░ 13%` — label, 5-cell bar, percent, one ramp. `bar: false` sheds the
// bar first, as the quota does on a narrow line. The old `130k/1M` tail is gone:
// the percent answers "how full", and the denominator was 1M on every current model.
// `tokens`/`limit` may be null (no transcript yet) → only the model shows. Empty
// when there's no model at all.
export function renderClaudeSegment({ model, tokens, limit, bar = true } = {}) {
  const parts = [];
  const name = model && (model.display_name || model.id);
  if (name) parts.push(paint(name, ANSI.cyan));
  if (tokens != null && limit) {
    const f = tokens / limit;
    const col = rampColor(f);
    const bits = ['ctx'];
    if (bar) bits.push(paint(progressBar(f, RATE_LIMIT_BAR_WIDTH), col));
    bits.push(paint(`${Math.round(f * 100)}%`, col));
    parts.push(bits.join(' '));
  }
  return parts.join(' ');
}

// --- rate-limit quota gauge ---------------------------------------------------
// `rate_limits` on the statusline stdin blob: two rolling windows (5h/7d, each
// independently optional) plus an optional gateway-only spend cap. See phase 21
// CONTEXT.md — always visible when present (D1), never threshold-gated.

// Human-readable time-to-reset, e.g. `2h12m` / `12m`. `resetsAt`/`nowSeconds`
// are both Unix epoch seconds; NEVER render the raw epoch or an absolute clock
// time (D2). Clamped at zero so an already-passed `resets_at` reads `0m`
// instead of going negative.
export function formatETA(resetsAt, nowSeconds) {
  const secs = Math.max(0, Math.round(Number(resetsAt) - Number(nowSeconds)));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h${m}m` : `${m}m`;
}

const RATE_LIMIT_WINDOW_LABELS = { five_hour: '5h', seven_day: '7d' };
// D6: the countdown (D2) rides the same red threshold as the colour ramp.
const isHotWindow = (pct) => pct >= 85;

function validPct(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function buildWindow(key, data) {
  if (!data || typeof data !== 'object' || !validPct(data.used_percentage)) return null;
  return { key, label: RATE_LIMIT_WINDOW_LABELS[key], pct: data.used_percentage, resetsAt: data.resets_at };
}

// Quota bars ride narrower than the context-fill bar (which owns the whole
// line to itself) — 5 cells, matching the CONTEXT.md D2/D4 illustrations
// ("5h ▓▓▓▓░ 88%"). Up to two of these plus a spend cap share one line with
// everything else, so the default 10-wide progressBar would blow the wide
// line's reflow point far past the ~100-column budget D1's "always visible"
// promise was costed against.
const RATE_LIMIT_BAR_WIDTH = 5;

// One window's rendering at a given detail: `bar` toggles the graphical fill
// (D4 sheds bars before numbers); the reset countdown only ever appears once
// the window is hot (D2/D6).
function renderWindow(w, bar, nowSeconds) {
  const col = rampColor(w.pct / 100);
  const bits = [w.label];
  if (bar) bits.push(paint(progressBar(w.pct / 100, RATE_LIMIT_BAR_WIDTH), col));
  bits.push(paint(`${Math.round(w.pct)}%`, col));
  let out = bits.join(' ');
  if (isHotWindow(w.pct) && validPct(w.resetsAt)) {
    out += ` ·${formatETA(w.resetsAt, nowSeconds)}`;
  }
  return out;
}

// The spend cap: costs nothing when absent (D3). `used_percentage` may exceed
// 100 — the text keeps climbing while `progressBar` (already clamped) stops.
function renderSpend(pct, bar) {
  const col = rampColor(Math.min(1, pct / 100));
  const bits = ['cap'];
  if (bar) bits.push(paint(progressBar(pct / 100, RATE_LIMIT_BAR_WIDTH), col));
  bits.push(paint(`${Math.round(pct)}%`, col));
  return bits.join(' ');
}

/**
 * Render the rate-limit quota segment.
 *
 * `detail` explicitly picks a tier (`'full' | 'numbers' | 'hottest'`), for
 * direct testing and for the hook's cols-based ladder (mirroring `phaseTrack`'s
 * `lookahead`). `width` instead auto-picks the WIDEST tier that fits — used the
 * same way `termWidth`'s "unknown means roomy" contract works: no width → full.
 *
 * D4's narrow-degradation order: bars go before numbers, and the windows are
 * sorted hottest-first so a shrinking line sheds the COOLEST window first —
 * the one nearest its limit is what survives.
 */
export function renderRateLimits({ rateLimits, nowSeconds = Math.floor(Date.now() / 1000), width, detail } = {}) {
  if (!rateLimits || typeof rateLimits !== 'object') return '';

  const windows = ['five_hour', 'seven_day']
    .map((k) => buildWindow(k, rateLimits[k]))
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);

  const spendPct = rateLimits.spend_limit && rateLimits.spend_limit.used_percentage;
  const spend = validPct(spendPct) ? spendPct : null;

  if (!windows.length && spend == null) return '';

  const tiers = [];
  if (windows.length) {
    tiers.push(() => [
      ...windows.map((w) => renderWindow(w, true, nowSeconds)),
      ...(spend != null ? [renderSpend(spend, true)] : []),
    ]);
    tiers.push(() => [
      ...windows.map((w) => renderWindow(w, false, nowSeconds)),
      ...(spend != null ? [renderSpend(spend, false)] : []),
    ]);
    tiers.push(() => [renderWindow(windows[0], false, nowSeconds)]);
  } else {
    tiers.push(() => [renderSpend(spend, true)]);
    tiers.push(() => [renderSpend(spend, false)]);
  }
  const TIER_NAMES = windows.length ? ['full', 'numbers', 'hottest'] : ['full', 'numbers'];

  if (detail) {
    const i = TIER_NAMES.indexOf(detail);
    const build = tiers[i < 0 ? 0 : i];
    return build().join(' · ');
  }

  if (!width) return tiers[0]().join(' · ');   // unknown width → assume roomy

  for (const build of tiers) {
    const s = build().join(' · ');
    if (visibleWidth(s) <= width) return s;
  }
  return '';
}

// --- prompt-cache gauge -------------------------------------------------------
// `prompt_cache` on the statusline stdin blob (Claude Code 2.1.280+): whether the
// session's prompt cache is warm, when it goes cold, the session hit ratio and the
// cause of the most recent miss. Absent before the first request — like the quota
// segment, absence costs zero columns. The number that matters in a 1M-context
// session is the deadline: idle past it and the next turn re-writes the whole
// prefix into the cache.

// Short labels for Claude Code's miss-cause codes. An unmapped code falls back to
// the code itself with underscores as spaces, so a new cause still reads.
const CACHE_MISS_LABELS = {
  system_prompt_changed: 'system prompt',
  tools_changed: 'tools',
  model_changed: 'model',
  fast_mode_changed: 'fast mode',
  cache_scope_or_ttl_changed: 'ttl',
  betas_changed: 'betas',
  effort_changed: 'effort',
  thinking_mode_changed: 'thinking',
  thinking_display_changed: 'thinking',
  auto_mode_changed: 'auto mode',
  overage_changed: 'usage limit',
  extra_body_changed: 'request',
  defer_loading_changed: 'tool loading',
  messages_rewritten: 'history',
  ttl_expired_5m: 'idle >5m',
  ttl_expired_1h: 'idle >1h',
  likely_server_side: 'server',
  unknown: 'unknown',
};

// How long a miss's cause stays on the line. Long enough to connect "I just
// switched model" to "that turn was slow"; after that it is history, not signal.
export const CACHE_MISS_FRESH_SECONDS = 300;

export function cacheMissLabel(code) {
  return CACHE_MISS_LABELS[code] || String(code).replace(/_/g, ' ');
}

// Wall-clock HH:MM for an epoch-seconds instant, in local time. Unlike the quota
// reset (D2, relative), the cache deadline is shown as a CLOCK time: the line only
// re-renders on events, and the case that matters — you walked away — is exactly
// when nothing re-renders, so a relative "4m" would sit there going stale. Claude
// Code re-renders at `expires_at` itself, so the flip to cold is still live.
export function formatClock(epochSeconds) {
  const d = new Date(Number(epochSeconds) * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Render the prompt-cache segment. `detail` picks a tier:
 *   'full'    — hit ratio, deadline or cold + re-cache cost, miss cause with tool deltas
 *   'compact' — deadline or cold, plus a fresh miss cause
 *   'minimal' — ONE fact, the most actionable: a fresh miss, else cold, else the deadline
 * Empty when the blob has no cache data or caching was never observed.
 */
export function renderPromptCache({ promptCache: pc, nowSeconds = Math.floor(Date.now() / 1000), detail = 'full' } = {}) {
  if (!pc || typeof pc !== 'object' || !pc.requests || !pc.caching_observed) return '';
  const full = detail === 'full';
  const bits = ['cache'];

  const miss = pc.last_miss_cause;
  const causes = (miss && Array.isArray(miss.causes)) ? miss.causes : [];
  const fresh = causes.length > 0 && validPct(pc.last_miss_at) && nowSeconds - pc.last_miss_at <= CACHE_MISS_FRESH_SECONDS;

  if (detail === 'minimal') {
    if (fresh) return paint(`cache miss: ${cacheMissLabel(causes[0])}`, ANSI.yellow);
    if (!pc.warm) return paint('cache cold', ANSI.yellow);
    return validPct(pc.expires_at) ? `cache ${paint(`→${formatClock(pc.expires_at)}`, ANSI.green)}` : '';
  }

  if (full && validPct(pc.hit_ratio)) {
    bits.push(paint(`${Math.round(pc.hit_ratio * 100)}%`, rampColor(1 - pc.hit_ratio)));
  }
  if (pc.warm && validPct(pc.expires_at)) {
    bits.push(paint(`→${formatClock(pc.expires_at)}`, ANSI.green));
  } else if (!pc.warm) {
    const cost = full && validPct(pc.recache_tokens_if_cold) && pc.recache_tokens_if_cold > 0
      ? ` ·${kfmt(pc.recache_tokens_if_cold)}` : '';
    bits.push(paint(`cold${cost}`, ANSI.yellow));
  }
  let out = bits.join(' ');

  if (fresh) {
    let why = cacheMissLabel(causes[0]);
    if (full && causes[0] === 'tools_changed' && validPct(miss.tools_added)) {
      why += ` +${miss.tools_added}/-${miss.tools_removed || 0}`;
    }
    if (causes.length > 1) why += ` +${causes.length - 1}`;
    out += ` · ${paint(`miss: ${why}`, ANSI.yellow)}`;
  }
  return out;
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

// --- terminal width & narrow-screen layout -----------------------------------
// Claude Code CAPTURES the statusline's stdout rather than wiring it to the tty,
// so `process.stdout.columns` and `tput cols` are both blind in here. It exports
// COLUMNS/LINES with the real terminal size instead — that env var is the ONLY
// way a statusline can know how much room it has. Unknown width means "assume
// roomy": we must never reflow a desktop line on a guess.
export function termWidth(env = process.env) {
  const n = parseInt(env.COLUMNS, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const ANSI_CODE = /\x1b\[[0-9;]*m/;
const ANSI_CODE_G = /\x1b\[[0-9;]*m/g;

/** Printable width — colour codes occupy no columns on screen. */
export function visibleWidth(s) {
  return [...String(s || '').replace(ANSI_CODE_G, '')].length;
}

/** Truncate to `max` printable columns, copying colour codes through verbatim. */
export function truncateVisible(s, max) {
  const str = String(s || '');
  if (max <= 0) return '';
  if (visibleWidth(str) <= max) return str;
  let out = '';
  let count = 0;
  let i = 0;
  while (i < str.length) {
    const m = ANSI_CODE.exec(str.slice(i));
    if (m && m.index === 0) { out += m[0]; i += m[0].length; continue; }
    if (count >= max - 1) break;
    out += str[i];
    count += 1;
    i += 1;
  }
  return `${out}…\x1b[0m`;
}

export const STATUS_SEP = '  ·  ';

/**
 * One line when it fits, rows when it doesn't.
 *
 * `wide` is the desktop order — used verbatim whenever the whole line fits, so
 * a roomy terminal renders exactly as it always has. `groups` is the fallback
 * row split for a narrow screen (an iPad, a phone, a split pane), each row
 * hard-truncated to the terminal width so nothing is silently cut mid-segment.
 *
 * Claude Code renders each output line as its own status row.
 */
export function packStatus({ wide, groups, width, sep = STATUS_SEP }) {
  // An empty `wide` means the caller already knows the single line is out —
  // go straight to rows rather than "fitting" an empty string and returning it.
  const segs = (wide || []).filter(Boolean);
  const one = segs.join(sep);
  if (segs.length && (!width || visibleWidth(one) <= width)) return [one];
  return (groups || [])
    .map((g) => fitRow((g || []).filter(Boolean), width, sep))
    .filter(Boolean);
}

/**
 * Fill one row with whole segments. A segment that would overflow is DROPPED,
 * not sliced — half of `⎇ feature-branch` tells you less than nothing, and the
 * segments are ordered so the droppable ones sit at the end. Only when the
 * leading segment alone overruns the row is it truncated, since something has
 * to give.
 */
function fitRow(segments, width, sep = STATUS_SEP) {
  if (!segments.length) return '';
  let row = truncateVisible(segments[0], width);
  for (const seg of segments.slice(1)) {
    const candidate = `${row}${sep}${seg}`;
    if (visibleWidth(candidate) <= width) row = candidate;
  }
  return row;
}
