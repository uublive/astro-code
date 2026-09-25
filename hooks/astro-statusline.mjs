#!/usr/bin/env node
// Composing statusline wrapper. Invoked as:  node astro-statusline.mjs <configDir>
//
// astro-code must not clobber a statusline the user already runs. At
// install time we save the original `statusLine.command` for each config dir into
// ~/.astro/code/statusline-chain.json; here we run it first (feeding it the same
// stdin Claude gave us), then append astro segments. From Claude's stdin blob we
// render, in order: a recap of the task in flight, the running model, a graphical
// context-window-fill bar, subscription rate-limit quota bars (5h/7d/spend cap,
// when Claude sends them), the prompt-cache state (warm-until / cold / last miss
// cause, when Claude sends it), the live project state (milestone/phase/status/activity),
// and the git branch — then, when the clone is behind origin, an update nudge.
// Uninstall restores the original command from that same map. There is
// deliberately no session-cost segment: it was an estimate, not actionable
// mid-session, and cost columns that now go to the rate-limit quota bars
// (phase 21) instead — the number that actually binds.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  findAstroRoot, readContext, renderSegment,
  readContextTokens, renderClaudeSegment, modelLimit,
  isBusy, renderStatus, termWidth, visibleWidth, truncateVisible, packStatus, renderSegmentParts, STATUS_SEP,
  renderRateLimits, renderPromptCache,
} from './_astro-ctx.mjs';

const HOME = join(homedir(), '.astro', 'code');
const configDir = process.argv[2] || '';

// Claude pipes a JSON context blob on stdin — forward it verbatim to the wrapped line.
let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// astro-code's own version, for the statusline brand mark (⊡ v0.5.2). Prefer the
// explicit `version` file written at install; fall back to the clone's package.json via
// the `source` pointer. NEVER read HOME/package.json — it can be a stale leftover.
function readVersion() {
  try {
    const v = readFileSync(join(HOME, 'version'), 'utf8').trim();
    if (v) return v;
  } catch { /* fall through */ }
  try {
    const src = readFileSync(join(HOME, 'source'), 'utf8').trim();
    const v = (JSON.parse(readFileSync(join(src, 'package.json'), 'utf8')) || {}).version;
    if (v) return String(v);
  } catch { /* none */ }
  return null;
}

let data = null;
try { data = JSON.parse(input); } catch { /* no/!json stdin */ }

const nowSeconds = Math.floor(Date.now() / 1000);

// (0) the leading busy/idle dot — is a turn in flight for this session? The
// astro-session-state hooks stamp turn boundaries; we read this session's record.
let status = '';
try {
  const sid = data?.session_id;
  const map = readJson(join(HOME, 'session-state.json')) || {};
  status = renderStatus(isBusy(sid ? map[sid] : null, nowSeconds));
} catch { /* default: idle */ }

// (1) the original statusline, if any — runs first, keeps its own place.
let base = '';
const chain = readJson(join(HOME, 'statusline-chain.json')) || {};
const prev = chain[configDir];
if (prev && typeof prev.command === 'string' && prev.command) {
  const r = spawnSync(prev.command, { shell: true, input, encoding: 'utf8', windowsHide: true });
  base = (r.stdout || '').replace(/\n+$/, '');
}

// (2) model + context-fill bar, read from Claude's own live session (stdin
// model + the transcript it points at).
//
// There is deliberately NO task recap here: it echoed the prompt the user had
// just typed, which is already on screen directly above the status line — it
// spent the most columns of any segment to say the least.
// Terminal width, read once. Needed by the context and rate-limit gauges as well
// as the row layout, so it is resolved before any of them.
const cols = termWidth();

// The narrowest single line on which the gauge BARS still fit alongside model,
// branch, version and project state. Measured, not guessed: with bars the one-line
// render is ~145 columns, so anything below this reflows — which is exactly the
// C8 failure. Above it the bars are free; below it they cost a second row.
const BAR_WIDTH_FLOOR = 150;
const barsFit = cols === 0 || cols >= BAR_WIDTH_FLOOR;

let claude = '';
if (data) {
  const tp = data.transcript_path;
  // The window Claude Code itself runs on — the one auto-compaction uses — arrives in the
  // blob as `context_window`, and wins over our table. The table knows only Claude ids,
  // so a local model (Qwen via LiteLLM, 131,072 tokens) read as 1M: ~100k showed "10%"
  // while Claude Code was already compacting. The table stays as the fallback for a
  // Claude Code too old to send it; the transcript fills in a token count not yet reported.
  const cw = data.context_window || {};
  const reportedWindow = Number(cw.context_window_size) > 0 ? Number(cw.context_window_size) : null;
  const reportedTokens = Number(cw.total_input_tokens) > 0 ? Number(cw.total_input_tokens) : null;
  const tokens = reportedTokens ?? readContextTokens(tp);
  let limit = reportedWindow ?? modelLimit(data.model);
  // Safety net: a real request can never exceed its context window, so if the measured
  // occupancy is above our table limit, the table is stale — bump it. This makes a
  // misleading >100% reading (the 236% bug) structurally impossible even if a model's
  // window grows and modelLimit hasn't caught up. Claude Code's own figure is not second-guessed.
  if (!reportedWindow && tokens != null && limit && tokens > limit) limit = Math.max(1_000_000, tokens);
  // Drawn like the quota gauges and shed the same way: bar above the floor, number below.
  claude = renderClaudeSegment({ model: data.model, tokens, limit, bar: barsFit });
}

// (3) subscription rate-limit quota — how much of the rolling 5h/7d windows
// (plus a gateway-only spend cap) is spent. Absent before the first API
// response and for non-subscribers (D1's "absence is normal" — the segment
// costs zero columns then), never threshold-gated once present. `full` is the
// desktop tier tried first via `wide`; `rlDetail` is the cols-based fallback
// for the row layout — the same lookahead-ladder shape `lookahead` below uses,
// so a shrinking screen sheds bars, then all-but-the-hottest window (D4),
// never a slice mid-token.
// The single line carries BARS only when the terminal is wide enough to hold them.
// It used to ask for `full` unconditionally, which is what pushed the one-line render
// to 145 columns and split a 110-column terminal into two rows: the bars were bought
// with width the line did not have. Numbers alone still answer "how much is left",
// which is the question; the bar is the luxury, so it is the first thing to go.
const rlWide = barsFit ? 'full' : 'numbers';
const rateLimitsFull = data ? renderRateLimits({ rateLimits: data.rate_limits, nowSeconds, detail: rlWide }) : '';

// (4) prompt cache — warm until when, or cold and what the next turn re-writes, plus
// the cause of a miss for a few minutes after it. On the single line below the bar
// floor it gets ONE fact (the `minimal` tier), and further down it is dropped from the
// single line rather than being the segment that forces a second row — see below.
const pcWide = barsFit ? 'full' : 'minimal';
let cacheWide = data ? renderPromptCache({ promptCache: data.prompt_cache, nowSeconds, detail: pcWide }) : '';

// (5) the astro project segment — current milestone/phase/status + live activity.
// The cwd comes from Claude's stdin blob; from it we walk up to the `.astrocode/`.
let projCtx = null;
const cwd = data?.workspace?.current_dir || data?.cwd || process.cwd();
try {
  const projRoot = findAstroRoot(cwd);
  if (projRoot) projCtx = { ...readContext(projRoot, nowSeconds), version: readVersion() };
} catch { /* not inside an astro-code project */ }

// The phase track shrinks by dropping look-ahead entries, so a narrow screen
// loses "what's queued after next" before it loses where you actually are.
const projectAt = (lookahead) => (projCtx
  ? renderSegmentParts(projCtx, { lookahead })
  : { identity: '', state: '' });

// (6) git branch — cheap, always-useful context.
let branch = '';
try {
  const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', windowsHide: true });
  const b = (r.stdout || '').trim();
  if (b && b !== 'HEAD') branch = `⎇ ${b}`;
} catch { /* not a git repo */ }

// (8) the astro update segment
let update = '';
const cache = readJson(join(HOME, 'update-check.json'));
if (cache && cache.update_available) {
  update = `⬆ astro-code ${cache.behind} behind — /astro-update`;
}

// One line while it fits; stacked rows when it doesn't. On a narrow screen (an
// iPad, a phone, a split pane) the single line loses its TAIL — and the astro
// segment sits near the tail, so milestone/phase/version were precisely what got
// cut. The row layout leads with project state instead and demotes the recap,
// which is the longest segment and the easiest to lose.
//
// `wide` is the historical order, used verbatim whenever the line fits, so a
// roomy terminal renders exactly as before. Width comes from COLUMNS (Claude
// Code exports it; stdout is captured, so nothing else can measure the tty).
const dot = status ? status + ' ' : '';
const pad = ' '.repeat(visibleWidth(dot));
const rowWidth = cols ? Math.max(1, cols - visibleWidth(dot)) : 0;

// A roomy terminal keeps the single line it has always had. Anything narrower
// gets two rows — identity on the first, everything else on the second. Two
// readable rows beat one crammed row: we do NOT shave the phase slug down just
// to avoid wrapping, only enough that a row never has to be sliced.
// The track shrinks by showing fewer upcoming phases, never by slicing.
const lookahead = cols === 0 || cols >= 110 ? 3 : cols >= 70 ? 2 : 1;
const { identity, state } = projectAt(lookahead);
const project = [identity, state].filter(Boolean).join(' · ');

// D4's narrow-degradation: bars go first, then all windows but the hottest
// (the one nearest its limit — see renderRateLimits' hottest-first sort). D5:
// no promotion to row 1 — this rides row 2 with branch/claude like every other
// non-identity segment, shed wholesale by `packStatus`'s normal fit rules.
const rlDetail = cols === 0 || cols >= 130 ? 'full' : cols >= 90 ? 'numbers' : 'hottest';
const rateLimitsRow = data ? renderRateLimits({ rateLimits: data.rate_limits, nowSeconds, detail: rlDetail }) : '';
const cacheRow = data
  ? renderPromptCache({ promptCache: data.prompt_cache, nowSeconds, detail: cols === 0 || cols >= 130 ? 'full' : 'compact' })
  : '';

// Phase state rides with the identity when there's room, and drops to the next
// row when there isn't — rather than being silently dropped for lack of space.
const stateFitsRow1 = !rowWidth ||
  visibleWidth([identity, state].filter(Boolean).join(STATUS_SEP)) <= rowWidth;

// `fitRow` fills a row greedily in array order and DROPS whatever comes
// after the budget runs out — so the array order IS a priority order, not
// just cosmetic. `rateLimitsRow` sits ahead of `branch` here (mirroring its
// position ahead of `branch` in `wide` above) so a shrinking width always
// sheds the branch name before it touches the quota gauge D1 promised stays
// visible; putting the quota segment LAST made its survival depend on
// whether `branch` happened to fit first, which is non-monotonic — a
// narrower width could free room by dropping `branch` and let the quota
// segment reappear after it had already been shed at a wider column count.
// The branch is the only segment whose length is USER data — a branch name can be
// four characters or a hundred, and `ac flow` itself generates 45-character ones. Every
// other segment on the line is bounded by construction, so when the single line overruns
// it is almost always the branch that did it. Rather than let one long name force a
// second row, the branch is the ELASTIC segment: it gets whatever width is left after
// the bounded segments have taken theirs, and is truncated to it.
//
// Truncation, not elision: a dropped branch answers "which branch?" with nothing, while
// a truncated one still disambiguates most pairs and shows a trailing `…` so nobody
// mistakes it for the whole name. Below a floor it is dropped instead — three characters
// and an ellipsis is worse than silence.
const BRANCH_MIN = 12;
// The cache is the one segment allowed to vanish from the single line to keep it single:
// a cold cache costs tokens, a second row costs the layout every render. If the other
// bounded segments fit but adding the cache would not, it goes. When the line is going
// to split regardless, it keeps its place and rides row 2 via `cacheRow`.
if (cacheWide && rowWidth) {
  const without = [base, claude, rateLimitsFull, project, update].filter(Boolean);
  const fitsWithout = visibleWidth(without.join(STATUS_SEP)) <= rowWidth;
  const fitsWith = visibleWidth([...without, cacheWide].join(STATUS_SEP)) <= rowWidth;
  if (fitsWithout && !fitsWith) cacheWide = '';
}
let branchWide = branch;
if (branch && rowWidth) {
  const bounded = [base, claude, rateLimitsFull, cacheWide, project, update].filter(Boolean);
  const spent = visibleWidth(bounded.join(STATUS_SEP)) + (bounded.length ? visibleWidth(STATUS_SEP) : 0);
  const room = rowWidth - spent;
  if (room < BRANCH_MIN) branchWide = '';
  else if (room < visibleWidth(branch)) branchWide = truncateVisible(branch, room);
}

const lines = packStatus({
  wide: [base, claude, rateLimitsFull, cacheWide, project, branchWide, update],
  groups: [
    // where am I — the answer the statusline exists to give, never sliced
    stateFitsRow1 ? [identity, state] : [identity],
    // cache sits after quota: a quota limit stops you, a cold cache only costs you.
    stateFitsRow1 ? [claude, rateLimitsRow, cacheRow, branch] : [state, claude, rateLimitsRow, cacheRow, branch],
    [base, update],
  ],
  width: rowWidth,
});

process.stdout.write(
  lines.length
    ? lines.map((l, i) => (i === 0 ? dot + l : pad + l)).join('\n')
    : dot.trimEnd(),
);
