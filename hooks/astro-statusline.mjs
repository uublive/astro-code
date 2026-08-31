#!/usr/bin/env node
// Composing statusline wrapper. Invoked as:  node astro-statusline.mjs <configDir>
//
// astro-code must not clobber a statusline the user already runs (e.g. GSD's). At
// install time we save the original `statusLine.command` for each config dir into
// ~/.astro/code/statusline-chain.json; here we run it first (feeding it the same
// stdin Claude gave us), then append astro segments. From Claude's stdin blob we
// render, in order: a recap of the task in flight, the running model, a graphical
// context-window-fill bar, the live project state (milestone/phase/status/activity),
// the git branch, and the session cost — then, when the clone is behind origin, an
// update nudge. Uninstall restores the original command from that same map.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import {
  findAstroRoot, readContext, renderSegment,
  readContextTokens, renderClaudeSegment, modelLimit,
  isBusy, renderStatus, termWidth, visibleWidth, packStatus, renderSegmentParts, STATUS_SEP,
} from './_astro-ctx.mjs';

const HOME = join(homedir(), '.astro', 'code');
const configDir = process.argv[2] || '';

// Claude pipes a JSON context blob on stdin — forward it verbatim to the wrapped line.
let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// astro-code's own version, for the statusline brand mark (⊡ astro v0.5.2). Prefer the
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

// (0) the leading busy/idle dot — is a turn in flight for this session? The
// astro-session-state hooks stamp turn boundaries; we read this session's record.
let status = '';
try {
  const sid = data?.session_id;
  const map = readJson(join(HOME, 'session-state.json')) || {};
  status = renderStatus(isBusy(sid ? map[sid] : null, Math.floor(Date.now() / 1000)));
} catch { /* default: idle */ }

// (1) the original statusline, if any — runs first, keeps its own place.
let base = '';
const chain = readJson(join(HOME, 'statusline-chain.json')) || {};
const prev = chain[configDir];
if (prev && typeof prev.command === 'string' && prev.command) {
  const r = spawnSync(prev.command, { shell: true, input, encoding: 'utf8' });
  base = (r.stdout || '').replace(/\n+$/, '');
}

// (2) model + context-fill bar, read from Claude's own live session (stdin
// model + the transcript it points at).
//
// There is deliberately NO task recap here: it echoed the prompt the user had
// just typed, which is already on screen directly above the status line — it
// spent the most columns of any segment to say the least.
let claude = '';
if (data) {
  const tp = data.transcript_path;
  const tokens = readContextTokens(tp);
  let limit = modelLimit(data.model);
  // Safety net: a real request can never exceed its context window, so if the measured
  // occupancy is above our table limit, the table is stale — bump it. This makes a
  // misleading >100% reading (the 236% bug) structurally impossible even if a model's
  // window grows and modelLimit hasn't caught up.
  if (tokens != null && limit && tokens > limit) limit = Math.max(1_000_000, tokens);
  claude = renderClaudeSegment({ model: data.model, tokens, limit });
}

// (5) the astro project segment — current milestone/phase/status + live activity.
// The cwd comes from Claude's stdin blob; from it we walk up to the `.astrocode/`.
let projCtx = null;
const cwd = data?.workspace?.current_dir || data?.cwd || process.cwd();
const cols = termWidth();
try {
  const projRoot = findAstroRoot(cwd);
  if (projRoot) projCtx = { ...readContext(projRoot, Math.floor(Date.now() / 1000)), version: readVersion() };
} catch { /* not inside an astro-code project */ }

// The phase track shrinks by dropping look-ahead entries, so a narrow screen
// loses "what's queued after next" before it loses where you actually are.
const projectAt = (lookahead) => (projCtx
  ? renderSegmentParts(projCtx, { lookahead })
  : { identity: '', state: '' });

// (6) git branch + (7) session cost — cheap, always-useful context.
let branch = '';
try {
  const r = spawnSync('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  const b = (r.stdout || '').trim();
  if (b && b !== 'HEAD') branch = `⎇ ${b}`;
} catch { /* not a git repo */ }
const usd = data?.cost?.total_cost_usd;
const cost = typeof usd === 'number' && usd > 0 ? `$${usd < 1 ? usd.toFixed(2) : usd.toFixed(1)}` : '';

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

// Phase state rides with the identity when there's room, and drops to the next
// row when there isn't — rather than being silently dropped for lack of space.
const stateFitsRow1 = !rowWidth ||
  visibleWidth([identity, state].filter(Boolean).join(STATUS_SEP)) <= rowWidth;

const lines = packStatus({
  wide: [base, claude, project, branch, cost, update],
  groups: [
    // where am I — the answer the statusline exists to give, never sliced
    stateFitsRow1 ? [identity, state] : [identity],
    stateFitsRow1 ? [branch, claude, cost] : [state, branch, claude, cost],
    [base, update],
  ],
  width: rowWidth,
});

process.stdout.write(
  lines.length
    ? lines.map((l, i) => (i === 0 ? dot + l : pad + l)).join('\n')
    : dot.trimEnd(),
);
