// The astro-code statusline + SessionStart banner: the pure context renderers
// (_astro-ctx.mjs), the `ac activity` verb, and an end-to-end spawn of the
// statusline hook with a fake Claude stdin blob. Colour is disabled so the
// string assertions are stable.
process.env.NO_COLOR = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  findAstroRoot, readContext, renderSegment, renderBanner, nextAction, renderResumeNote, ACTIVITY_TTL_SECONDS,
  modelLimit, readContextTokens, readRecap, progressBar, renderClaudeSegment, renderRecap, truncate, phaseTrack,
  isBusy, renderStatus, SESSION_STALE_SECONDS,
  termWidth, visibleWidth, truncateVisible, packStatus, renderSegmentParts, STATUS_SEP,
  rampColor, formatETA, renderRateLimits, paceOvershoot, paceColor,
  renderPromptCache, formatClock, cacheMissLabel, CACHE_MISS_FRESH_SECONDS,
} from '../hooks/_astro-ctx.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1_700_000_000; // fixed clock for deterministic activity-age math

// Build a throwaway project with the given state + roadmap on disk.
function project({ state = {}, roadmap = {}, plannedSlugs = [], discussedSlugs = [], astrocode = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ac-sl-'));
  const ac = join(root, '.astrocode');
  mkdirSync(ac, { recursive: true });
  writeFileSync(join(ac, 'state.json'), JSON.stringify(state));
  writeFileSync(join(ac, 'roadmap.json'), JSON.stringify(roadmap));
  // Extra `.astrocode/` files (fixes.json, debt.json, …), e.g. for a longer project state.
  for (const [name, body] of Object.entries(astrocode)) writeFileSync(join(ac, name), JSON.stringify(body));
  for (const slug of plannedSlugs) {
    mkdirSync(join(ac, 'phases', slug), { recursive: true });
    writeFileSync(join(ac, 'phases', slug, 'PLAN.md'), '# plan');
  }
  for (const slug of discussedSlugs) {
    mkdirSync(join(ac, 'phases', slug), { recursive: true });
    writeFileSync(join(ac, 'phases', slug, 'CONTEXT.md'), '<!-- astro-discuss: captured -->\n# context');
  }
  return root;
}

const ROADMAP = {
  milestone: 1,
  phases: [
    { number: 1, slug: 'bootstrap', name: 'Bootstrap', status: 'complete' },
    { number: 2, slug: 'auth', name: 'Auth', status: 'complete' },
    { number: 3, slug: 'close-ci-gates', name: 'Close CI gates', status: 'pending' },
    { number: 4, slug: 'ship', name: 'Ship', status: 'pending' },
  ],
};

test('findAstroRoot walks up from a nested cwd', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const nested = join(root, 'src', 'deep', 'dir');
  mkdirSync(nested, { recursive: true });
  assert.equal(findAstroRoot(nested), root);
  assert.equal(findAstroRoot(tmpdir()), null, 'no .astrocode above tmpdir');
});

test('readContext picks the lowest open phase + counts progress/blockers', () => {
  const root = project({ state: { project: 'demo', blockers: [{ x: 1 }] }, roadmap: ROADMAP });
  const ctx = readContext(root, NOW);
  assert.equal(ctx.milestone, 1);
  assert.equal(ctx.phase.slug, 'close-ci-gates', 'first non-complete phase is current');
  assert.equal(ctx.done, 2);
  assert.equal(ctx.total, 4);
  assert.equal(ctx.blockers, 1);
});

test('state.active_phase overrides the next-open heuristic', () => {
  const root = project({ state: { active_phase: 'ship' }, roadmap: ROADMAP });
  assert.equal(readContext(root, NOW).phase.slug, 'ship');
});

test('renderSegment shows ⊡, milestone, phase, progress, blockers', () => {
  const root = project({ state: { blockers: [1] }, roadmap: ROADMAP });
  const seg = renderSegment(readContext(root, NOW));
  assert.match(seg, /⊡/);
  assert.doesNotMatch(seg, /\bastro\b/, 'D7: the redundant word is gone — the glyph carries the identity');
  assert.match(seg, /M1/);
  assert.match(seg, /‹2 \(P3\) P4/, 'windowed track: 2 behind, current, one queued');
  assert.doesNotMatch(seg, /close-ci-gates/, 'the slug is no longer on the status line');
  assert.match(seg, /▸ pending/);
  assert.match(seg, /0▸ 2✓/, 'verified vs human-accepted, not one blended count');
  assert.match(seg, /⚠1/);
});

test('renderSegment shows the astro-code version by the brand mark when provided', () => {
  const root = project({ roadmap: ROADMAP });
  const seg = renderSegment({ ...readContext(root, NOW), version: '0.5.2' });
  assert.match(seg, /⊡ v0\.5\.2 · M1/, 'version sits right after the glyph');
  // absent version → the milestone folds onto the glyph with a plain space, so
  // the fallback never reads as a dangling middot ("⊡ ·") — D7's open question.
  const noV = renderSegment(readContext(root, NOW));
  assert.match(noV, /⊡ M1/);
  assert.doesNotMatch(noV, /⊡\s*·/, 'no dangling separator right off the bare glyph');
  assert.doesNotMatch(noV, /v0\.5\.2|\bastro\b|⊡\s*$|⊡\s*v\b/);
});

test('renderResumeNote (PreCompact) carries project/phase/status + next action + on-disk pointer', () => {
  const root = project({ state: { project: 'demo', blockers: [1] }, roadmap: ROADMAP });
  const note = renderResumeNote(readContext(root, NOW));
  assert.match(note, /after compaction/, 'flags itself as continuity context');
  assert.match(note, /demo/, 'names the project');
  assert.match(note, /M1/);
  assert.match(note, /P3 close-ci-gates \(pending\)/, 'phase + status');
  assert.match(note, /2\/4 phases/);
  assert.match(note, /1 blocker/);
  assert.match(note, /Next: \/astro-discuss 3/, 'derives the next action (undiscussed → discuss first)');
  assert.match(note, /\.astrocode\/.*\/astro-status/s, 'points at on-disk state + how to re-orient');
});

test('renderResumeNote is empty outside a project (no milestone/phase) so non-astro sessions stay quiet', () => {
  const empty = project({ state: {}, roadmap: {} });
  assert.equal(renderResumeNote(readContext(empty, NOW)), '');
});

test('a fresh activity verb wins over the static status; a stale one is dropped', () => {
  const fresh = project({ state: { activity: { text: '⚙ executing', at: NOW - 60 } }, roadmap: ROADMAP });
  assert.match(renderSegment(readContext(fresh, NOW)), /⚙ executing/);

  const stale = project({ state: { activity: { text: '⚙ executing', at: NOW - ACTIVITY_TTL_SECONDS - 1 } }, roadmap: ROADMAP });
  const seg = renderSegment(readContext(stale, NOW));
  assert.doesNotMatch(seg, /executing/, 'stale verb ignored');
  assert.match(seg, /▸ pending/, 'falls back to phase status');
});

test('nextAction routes by phase status + discussed/planned flags (discuss → plan → execute)', () => {
  const undiscussed = project({ roadmap: ROADMAP });
  assert.equal(nextAction(readContext(undiscussed, NOW)), '/astro-discuss 3');

  const discussed = project({ roadmap: ROADMAP, discussedSlugs: ['close-ci-gates'] });
  assert.equal(nextAction(readContext(discussed, NOW)), '/astro-plan 3');

  const stub = project({ roadmap: ROADMAP });
  mkdirSync(join(stub, '.astrocode', 'phases', 'close-ci-gates'), { recursive: true });
  writeFileSync(join(stub, '.astrocode', 'phases', 'close-ci-gates', 'CONTEXT.md'), '# seeded, no marker');
  assert.equal(nextAction(readContext(stub, NOW)), '/astro-discuss 3', 'a stub CONTEXT.md is not "discussed"');

  const planned = project({ roadmap: ROADMAP, plannedSlugs: ['close-ci-gates'] });
  assert.equal(nextAction(readContext(planned, NOW)), '/astro-execute 3', 'a plan trumps the discuss nudge');

  const verifying = project({ state: { active_phase: 'close-ci-gates' }, roadmap: {
    milestone: 1, phases: [{ number: 3, slug: 'close-ci-gates', name: 'x', status: 'verified' }] } });
  assert.equal(nextAction(readContext(verifying, NOW)), '/astro-accept 3');
});

test('a numeric slug prefix is dropped where the name IS shown (banner/resume note)', () => {
  // The status line no longer carries the slug, but the banner and resume note
  // still do — that is where the redundant `03-` prefix must be stripped.
  const root = project({ roadmap: { milestone: 2, phases: [
    { number: 3, slug: '03-close-ci-gates', name: 'Close CI gates', status: 'pending' }] } });
  const note = renderResumeNote(readContext(root, NOW));
  assert.match(note, /P3 close-ci-gates/);
  assert.doesNotMatch(note, /03-close/);
});

test('the phase track windows around the current phase and counts the rest', () => {
  const track = (phases, number, lookahead) => phaseTrack({
    phase: { number, status: phases.find((p) => p.number === number).status },
    phases,
  }, lookahead);
  const many = Array.from({ length: 12 }, (_, i) => ({ number: i + 1, status: 'pending' }));

  // on the LAST phase: nothing queued, and the line says so by showing nothing
  assert.match(track(many, 12, 2), /‹11 \(P12\)$/);
  // mid-milestone: neighbours shown, remainder collapsed to a count
  assert.match(track(many, 3, 2), /‹2 \(P3\) P4 P5 \+7/);
  // a narrow screen shrinks the look-ahead, never the current phase
  assert.match(track(many, 3, 1), /‹2 \(P3\) P4 \+8/);
  assert.match(track(many, 3, 0), /‹2 \(P3\) \+9/);
  // first phase: no "behind" marker at all
  assert.match(track(many, 1, 1), /^\(P1\) P2 \+10/);
});

test('renderBanner is plain multi-line with the Astrolize logo + next action', () => {
  const root = project({ roadmap: ROADMAP });
  const banner = renderBanner(readContext(root, NOW));
  assert.match(banner, /4str0\|ize · astro-code/, 'the wordmark is present');
  assert.match(banner, /ääZPäP/, 'the Astrolize mark is present');
  assert.doesNotMatch(banner, /\x1b\[/, 'plain: a systemMessage does not render ANSI');
  assert.match(banner, /next: \/astro-discuss 3/);
  assert.doesNotMatch(banner, /\x1b\[/, 'banner carries no ANSI (rides in a systemMessage)');
});

// Claude Code trims leading blank lines from a SessionStart systemMessage AND prints the
// message's first line on the same row as "SessionStart:resume says:". One U+2800 (renders
// blank, is not whitespace) only filled that row, so the mark still sat directly under it.
// Two do it: the first rides the "says:" row, the second is the visible blank line.
test('the banner opens with a visible blank row between "says:" and the mark', () => {
  const root = project({ roadmap: ROADMAP });
  const [first, second, third] = renderBanner(readContext(root, NOW)).split('\n');
  assert.equal(first, '\u2800', 'the first line rides the "SessionStart says:" row');
  assert.equal(second, '\u2800', 'the second line is the visible blank row');
  assert.match(third, /PZ/, "the mark's top row starts after the blank row");
});

test('ac activity sets {text, at} and clear nulls it', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const ac = (args) => spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args],
    { cwd: root, encoding: 'utf8' });

  assert.equal(ac(['activity', '⚙ executing']).status, 0);
  let st = JSON.parse(readFileSync(join(root, '.astrocode', 'state.json'), 'utf8'));
  assert.equal(st.activity.text, '⚙ executing');
  assert.equal(typeof st.activity.at, 'number');

  assert.equal(ac(['activity', 'clear']).status, 0);
  st = JSON.parse(readFileSync(join(root, '.astrocode', 'state.json'), 'utf8'));
  assert.equal(st.activity, null);
});

// --- busy / idle activity dot -------------------------------------------------

test('isBusy: prompt after stop = busy; stop after prompt = idle; stale = idle', () => {
  assert.equal(isBusy({ prompt: NOW, at: NOW }, NOW), true, 'a fresh prompt with no stop is busy');
  assert.equal(isBusy({ prompt: NOW - 100, stop: NOW - 10, at: NOW - 10 }, NOW), false, 'stop after prompt is idle');
  assert.equal(isBusy({ prompt: NOW - 5, stop: NOW - 50, at: NOW - 5 }, NOW), true, 'a newer prompt than stop is busy again');
  assert.equal(isBusy({ prompt: NOW - SESSION_STALE_SECONDS - 1, at: NOW - SESSION_STALE_SECONDS - 1 }, NOW), false, 'a turn that never stopped goes stale → idle');
  assert.equal(isBusy(null, NOW), false, 'no record → idle');
});

test('renderStatus is a green ● when busy, a dim ○ when idle', () => {
  assert.equal(renderStatus(true), '●');   // NO_COLOR strips the ANSI
  assert.equal(renderStatus(false), '○');
});

test('the session-state hook toggles busy/idle per session_id and stays SILENT', () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-ss-'));
  const hook = join(FRAMEWORK, 'hooks', 'astro-session-state.mjs');
  const fire = (kind) => spawnSync(process.execPath, [hook, kind], {
    input: JSON.stringify({ session_id: 's1' }), env: { ...process.env, HOME: home }, encoding: 'utf8',
  });
  const stateFile = join(home, '.astro', 'code', 'session-state.json');

  const p = fire('prompt');
  assert.equal(p.status, 0);
  assert.equal(p.stdout, '', 'UserPromptSubmit hook must print nothing (stdout is injected into context)');
  let rec = JSON.parse(readFileSync(stateFile, 'utf8')).s1;
  assert.ok(typeof rec.prompt === 'number' && rec.stop == null, 'prompt stamped, no stop yet');

  fire('stop');
  rec = JSON.parse(readFileSync(stateFile, 'utf8')).s1;
  assert.ok(rec.stop >= rec.prompt, 'stop stamped after prompt');
});

test('the statusline hook leads with the busy/idle dot from session-state', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-dot-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  writeFileSync(join(home, '.astro', 'code', 'session-state.json'),
    JSON.stringify({ live: { prompt: now, at: now } }));   // busy: prompt, no stop
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const run = (sid) => spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify({ session_id: sid, workspace: { current_dir: join(root, 'src') } }),
    env: { ...process.env, HOME: home, NO_COLOR: '1' }, encoding: 'utf8',
  }).stdout;

  assert.match(run('live'), /^● /, 'busy session leads with a solid dot');
  assert.match(run('other'), /^○ /, 'a session with no record leads with a hollow dot');
});

// --- Claude-session segment: recap · model · context-fill bar ----------------

test('modelLimit: current gen (Opus 4.6+/Sonnet 4.6+/Fable/Sonnet-5) = 1M; Haiku + legacy = 200K', () => {
  // current generation → 1M (the whole reason the 236% bug existed)
  assert.equal(modelLimit({ id: 'claude-opus-4-8', display_name: 'Opus 4.8' }), 1_000_000);
  assert.equal(modelLimit({ id: 'claude-sonnet-5' }), 1_000_000);
  assert.equal(modelLimit({ id: 'claude-fable-5' }), 1_000_000);
  assert.equal(modelLimit({ id: 'claude-opus-4-6' }), 1_000_000);
  assert.equal(modelLimit({ id: 'claude-sonnet-4-6' }), 1_000_000);
  assert.equal(modelLimit(null), 1_000_000, 'unknown → 1M (what Claude Code runs today)');
  // Haiku + legacy tier → 200K
  assert.equal(modelLimit({ id: 'claude-haiku-4-5' }), 200_000);
  assert.equal(modelLimit({ id: 'claude-opus-4-5-20251101' }), 200_000);
  assert.equal(modelLimit({ id: 'claude-opus-4-1' }), 200_000);
  assert.equal(modelLimit({ id: 'claude-sonnet-4-5' }), 200_000);
  assert.equal(modelLimit({ id: 'claude-3-5-sonnet-20241022' }), 200_000);
});

test('readContextTokens sums the LAST usage line (fresh input + both cache tiers)', () => {
  const transcript = [
    JSON.stringify({ message: { usage: { input_tokens: 1, cache_read_input_tokens: 1 } } }),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),           // no usage — skipped
    JSON.stringify({ message: { usage: { input_tokens: 5_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 90_000 } } }),
    '', 'not json',
  ].join('\n');
  assert.equal(readContextTokens('x', () => transcript), 97_000);
  assert.equal(readContextTokens('x', () => null), null, 'no transcript → null');
  assert.equal(readContextTokens('x', () => '{"type":"user"}'), null, 'no usage → null');
});

test('readContextTokens skips trailing ALL-ZERO usage markers (context-limit / aborted turns)', () => {
  // Claude Code writes zeroed usage markers at the context limit; the last non-zero turn
  // is the real occupancy. Taking the last block blindly would read 0 → "0% · 0/1M" on a FULL session.
  const transcript = [
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 2, cache_read_input_tokens: 973_242, cache_creation_input_tokens: 1_980 } } }),
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }),
  ].join('\n');
  assert.equal(readContextTokens('x', () => transcript), 975_224, 'ignore zeroed markers → last real occupancy');
  // A transcript with ONLY zeroed usage → null (segment shows model only), never 0.
  assert.equal(readContextTokens('x', () => JSON.stringify({ message: { usage: { input_tokens: 0, cache_read_input_tokens: 0 } } })), null);
});

test('readRecap returns the last human text turn, skipping tool-results + command meta', () => {
  const transcript = [
    JSON.stringify({ type: 'user', message: { content: 'first ask' } }),
    JSON.stringify({ type: 'assistant', message: { content: 'ok' } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'text', text: 'the real task' }] } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'output' }] } }), // no text → skip
    JSON.stringify({ type: 'user', message: { content: '<command-name>/astro-plan</command-name>' } }),    // meta → skip
  ].join('\n');
  assert.equal(readRecap('x', () => transcript), 'the real task');
  assert.equal(readRecap('x', () => null), '');
});

test('progressBar fills proportionally and clamps out-of-range', () => {
  assert.equal(progressBar(0, 10), '░'.repeat(10));
  assert.equal(progressBar(1, 10), '█'.repeat(10));
  assert.equal(progressBar(0.5, 10), '█████░░░░░');
  assert.equal(progressBar(2, 4), '████', 'clamps >1');
  assert.equal(progressBar(-1, 4), '░░░░', 'clamps <0');
});

test('truncate collapses whitespace and ellipsizes past the cap', () => {
  assert.equal(truncate('  a   b\n c ', 10), 'a b c');
  assert.equal(truncate('abcdefghij', 5), 'abcd…');
});

test('renderClaudeSegment shows model + a ctx gauge drawn like the quota; model-only when no tokens', () => {
  const seg = renderClaudeSegment({ model: { display_name: 'Opus 4.8' }, tokens: 104_000, limit: 200_000 });
  assert.match(seg, /Opus 4\.8/);
  assert.match(seg, /ctx [█░]{5} 52%/, 'label, 5-cell bar (the quota width), percent');
  assert.doesNotMatch(seg, /104k|200k/, 'no tokens/limit tail');
  assert.equal(
    renderClaudeSegment({ model: { display_name: 'Opus 4.8' }, tokens: 104_000, limit: 200_000, bar: false }),
    'Opus 4.8 ctx 52%',
    'bar shed first, like the quota numbers tier',
  );
  assert.equal(renderClaudeSegment({ model: { display_name: 'Opus 4.8' }, tokens: null, limit: 200_000 }), 'Opus 4.8');
  assert.equal(renderClaudeSegment({}), '', 'empty with no model');
});

// --- rate-limit quota gauge ---------------------------------------------------

test('rampColor: green below 60%, yellow from 60%, red from 85% (matches the context bar)', () => {
  assert.equal(rampColor(0.59), rampColor(0.5), 'both cool → same colour');
  assert.equal(rampColor(0.6), rampColor(0.84), 'both mid-band → same colour');
  assert.equal(rampColor(0.85), rampColor(0.99), 'both hot → same colour');
  const green = rampColor(0.1), yellow = rampColor(0.6), red = rampColor(0.85);
  assert.notEqual(green, yellow);
  assert.notEqual(yellow, red);
  assert.notEqual(green, red);
});

test('formatETA renders a relative duration, never a raw epoch, and clamps a past reset at zero', () => {
  const now = 1_700_000_000;
  assert.equal(formatETA(now + 7920, now), '2h12m');
  assert.equal(formatETA(now + 300, now), '5m');
  assert.equal(formatETA(now - 60, now), '0m', 'an already-passed reset never goes negative');
});

test('paceOvershoot: the window-average pace over the window, judged after 10% of it', () => {
  const now = 1_000_000_000;
  const day = 86_400;
  const hour = 3600;
  // 3 of 7 days gone (42.86%), 50% used -> 116.67% at the reset: +16.67.
  assert.ok(Math.abs(paceOvershoot('seven_day', 50, now + 4 * day, now) - (50 * 7 / 3 - 100)) < 1e-9);
  assert.equal(paceOvershoot('seven_day', 40, now + 4 * day, now), null, '93.3%: on track');
  assert.equal(paceOvershoot('five_hour', 30, now + 4.75 * hour, now), null, 'only 5% of the window gone');
  assert.ok(Math.abs(paceOvershoot('five_hour', 60, now + 2.5 * hour, now) - 20) < 1e-9, 'half gone, 60% used');
  assert.equal(paceOvershoot('five_hour', 60, undefined, now), null, 'no reset time, no pace');
  assert.equal(paceOvershoot('spend_limit', 60, now + hour, now), null, 'the spend cap has no window');
});

test('paceColor: dim up to 5%, green 10%, yellow 20%, orange 30%, red beyond', () => {
  const [dim, green, yellow, orange, red] = [0.5, 10, 20, 30, 162].map(paceColor);
  assert.equal(paceColor(5), dim);
  assert.equal(paceColor(5.01), green);
  assert.equal(paceColor(10), green);
  assert.equal(paceColor(15), yellow);
  assert.equal(paceColor(25), orange);
  assert.equal(paceColor(30.1), red);
  assert.equal(new Set([dim, green, yellow, orange, red]).size, 5, 'five distinct colours');
});

test('renderRateLimits appends each outpacing window its pace, in every tier that shows it', () => {
  const now = 1_000_000_000;
  const rateLimits = {
    five_hour: { used_percentage: 60, resets_at: now + 2.5 * 3600 },     // +20
    seven_day: { used_percentage: 40, resets_at: now + 4 * 86_400 },     // on track: no pace
  };
  const full = renderRateLimits({ rateLimits, nowSeconds: now, detail: 'full' }).replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(full, /5h [█░▏]{5} 60% ⚠ pace \+20%/);
  assert.doesNotMatch(full, /7d [█░▏]{5} 40% ⚠/, 'a window on track shows no pace');
  const hottest = renderRateLimits({ rateLimits, nowSeconds: now, detail: 'hottest' }).replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(hottest, '5h 60% ⚠ pace +20%');
  const both = renderRateLimits({ rateLimits: { ...rateLimits, seven_day: { used_percentage: 50, resets_at: now + 4 * 86_400 } },
    nowSeconds: now, detail: 'numbers' }).replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(both, '5h 60% ⚠ pace +20% · 7d 50% ⚠ pace +17%', 'both windows outpacing at once');
});

test('a window up to 5% over pace shows no warning tail; just past it, it does', () => {
  const now = 1_000_000_000;
  const day = 86_400;
  const plain = (pct) => renderRateLimits({ rateLimits: { seven_day: { used_percentage: pct, resets_at: now + 4 * day } },
    nowSeconds: now, detail: 'numbers' }).replace(/\x1b\[[0-9;]*m/g, '');
  // 3 of 7 days gone: 44% projects 102.7% (+2.7), 45% projects 105% (+5), 46% projects 107.3% (+7.3).
  assert.equal(plain(44), '7d 44%', '+2.7 over pace is noise, not a warning');
  assert.equal(plain(45), '7d 45%', 'exactly +5 is still the dim band');
  assert.equal(plain(46), '7d 46% ⚠ pace +7%');
});

test('a judged window\'s bar carries a one-cell pace marker at the elapsed share, without widening it', () => {
  const now = 1_000_000_000;
  const day = 86_400;
  const bar = (rl, detail = 'full') => renderRateLimits({ rateLimits: rl, nowSeconds: now, detail })
    .replace(/\x1b\[[0-9;]*m/g, '').match(/[█░▏]{5}/)[0];
  // 3 of 7 days gone (42.86% -> cell 2 of 5), 40% used (2 cells): the clock is at the edge of the fill.
  assert.equal(bar({ seven_day: { used_percentage: 40, resets_at: now + 4 * day } }), '██▏░░');
  // Marker inside the unused part: 20% used (1 cell), same clock.
  assert.equal(bar({ seven_day: { used_percentage: 20, resets_at: now + 4 * day } }), '█░▏░░');
  // Both ends: 10% gone -> cell 0; the window's very end (and beyond) -> the last cell.
  assert.equal(bar({ seven_day: { used_percentage: 5, resets_at: now + 6.3 * day } }), '▏░░░░');
  assert.equal(bar({ five_hour: { used_percentage: 100, resets_at: now } }), '████▏');
  assert.equal(bar({ five_hour: { used_percentage: 100, resets_at: now - 60 } }), '████▏');
  // Not judged: no resets_at, or under 10% of the window gone: the plain bar, as before.
  assert.equal(bar({ five_hour: { used_percentage: 40 } }), '██░░░');
  assert.equal(bar({ five_hour: { used_percentage: 40, resets_at: now + 4.75 * 3600 } }), '██░░░');
  assert.equal(renderRateLimits({ rateLimits: { spend_limit: { used_percentage: 40 } }, nowSeconds: now, detail: 'full' })
    .replace(/\x1b\[[0-9;]*m/g, ''), 'cap ██░░░ 40%');
  // The marker never widens a tier.
  const rl = { five_hour: { used_percentage: 60, resets_at: now + 2.5 * 3600 }, seven_day: { used_percentage: 40, resets_at: now + 4 * day } };
  assert.equal(visibleWidth(renderRateLimits({ rateLimits: rl, nowSeconds: now, detail: 'full' })),
    '5h █████ 60% ⚠ pace +20% · 7d █████ 40%'.length);
});

test('past the marker the used cells take the pace colour; before it, and on track, the ramp colour', (t) => {
  const now = 1_000_000_000;
  const day = 86_400;
  delete process.env.NO_COLOR;   // the file runs plain; this test reads the colour codes
  t.after(() => { process.env.NO_COLOR = '1'; });
  const render = (rateLimits) => renderRateLimits({ rateLimits, nowSeconds: now, detail: 'full' });
  const reset = '\x1b[0m';
  const bold = '\x1b[1m';
  // 70% used, 3 of 7 days gone: +63.3 -> red tail; ramp yellow. 4 cells filled, marker in cell 2:
  // cells 0-1 ramp, the marker, cell 3 (used, past it) red, cell 4 (unused) ramp.
  const yellow = rampColor(0.7);
  const red = paceColor(63.3);
  assert.ok(render({ seven_day: { used_percentage: 70, resets_at: now + 4 * day } })
    .startsWith(`7d ${yellow}██${reset}${bold}▏${reset}${red}█${reset}${yellow}░${reset} `));
  // 50% used, a quarter of 5h gone: +100 -> red tail on a green ramp. Marker in cell 1: cell 0 ramp, marker,
  // cell 2 (used, past it) red, cells 3-4 unused ramp.
  const green = rampColor(0.5);
  assert.ok(render({ five_hour: { used_percentage: 50, resets_at: now + 3.75 * 3600 } })
    .startsWith(`5h ${green}█${reset}${bold}▏${reset}${red}█${reset}${green}░░${reset} `));
  // On track (30% used, 3 of 7 days gone): the marker, and no stronger colour anywhere.
  const track = render({ seven_day: { used_percentage: 30, resets_at: now + 4 * day } });
  assert.ok(track.includes('▏') && !track.includes(red) && !track.includes(paceColor(20)));
});

test('renderRateLimits shows both windows with a distinct marker + bar each, at any usage level', () => {
  const seg = renderRateLimits({ rateLimits: {
    five_hour: { used_percentage: 23, resets_at: 1_700_100_000 },
    seven_day: { used_percentage: 41, resets_at: 1_700_500_000 },
  }, nowSeconds: 1_700_000_000 });
  assert.match(seg, /5h/);
  assert.match(seg, /7d/);
  assert.match(seg, /23%/);
  assert.match(seg, /41%/);
  assert.match(seg, /[█░]/, 'a graphical bar accompanies the numbers');

  // Far below any alarm threshold — D1 says always visible, never threshold-gated.
  const low = renderRateLimits({ rateLimits: {
    five_hour: { used_percentage: 5 }, seven_day: { used_percentage: 8 },
  } });
  assert.match(low, /5%/);
  assert.match(low, /8%/);
});

test('renderRateLimits is empty when there is nothing valid to show', () => {
  assert.equal(renderRateLimits({}), '');
  assert.equal(renderRateLimits({ rateLimits: null }), '');
  assert.equal(renderRateLimits({ rateLimits: {} }), '');
  assert.equal(renderRateLimits({ rateLimits: { five_hour: null, seven_day: { used_percentage: 'abc' } } }), '');
});

test('renderRateLimits appends a reset countdown only on a hot (>=85%) window', () => {
  const cool = renderRateLimits({ rateLimits: { seven_day: { used_percentage: 60, resets_at: 1_700_400_000 } }, nowSeconds: 1_700_000_000 });
  assert.doesNotMatch(cool, /\d+h\d+m|\d+m/, 'sub-red window carries no countdown');

  const hot = renderRateLimits({ rateLimits: { five_hour: { used_percentage: 88, resets_at: 1_700_007_920 } }, nowSeconds: 1_700_000_000 });
  assert.match(hot, /·2h12m/);
});

test('renderRateLimits: spend_limit shows the real percentage past 100% while the bar clamps', () => {
  const at100 = renderRateLimits({ rateLimits: { spend_limit: { used_percentage: 100 } } });
  const at142 = renderRateLimits({ rateLimits: { spend_limit: { used_percentage: 142 } } });
  assert.match(at142, /142%/);
  // The bar glyphs (stripped of the trailing percentage) must be identical.
  const bars = (s) => s.match(/[█░]+/)[0];
  assert.equal(bars(at100), bars(at142), 'the bar stops at 100% while the number keeps climbing');
});

test('renderRateLimits: narrower detail tiers shed bars before numbers, then to the hottest window only', () => {
  const rl = { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 95 } };
  const full = renderRateLimits({ rateLimits: rl, detail: 'full' });
  const numbers = renderRateLimits({ rateLimits: rl, detail: 'numbers' });
  const hottest = renderRateLimits({ rateLimits: rl, detail: 'hottest' });

  assert.match(full, /[█░]/);
  assert.match(full, /10%/);
  assert.match(full, /95%/);

  assert.doesNotMatch(numbers, /[█░]/, 'numbers tier drops the bars');
  assert.match(numbers, /10%/);
  assert.match(numbers, /95%/);

  assert.doesNotMatch(hottest, /10%/, 'the coolest window is shed first');
  assert.match(hottest, /95%/, 'the window nearest its limit survives');
});

test('renderRateLimits: width auto-picks the widest tier that fits; unknown width means roomy', () => {
  const rl = { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 95 } };
  const full = renderRateLimits({ rateLimits: rl, detail: 'full' });
  assert.equal(renderRateLimits({ rateLimits: rl }), full, 'no width → assume roomy → full tier');
  const narrow = renderRateLimits({ rateLimits: rl, width: 6 });
  assert.ok(visibleWidth(narrow) <= 6);
  assert.match(narrow, /95%/);
});

test('renderRecap prefixes ❯ and is empty for blank text', () => {
  assert.match(renderRecap('do the thing'), /❯ do the thing/);
  assert.equal(renderRecap(''), '');
});

test('the statusline hook renders the project segment from a Claude stdin blob', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-sl-home-'));   // isolate: no chain/cache to run
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const r = spawnSync(process.execPath, [hook, join(fakeHome, '.claude')], {
    input: JSON.stringify({ workspace: { current_dir: join(root, 'src') } }),
    env: { ...process.env, HOME: fakeHome, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /⊡ M1 · ‹2 \(P3\)/);
});

test('the statusline hook composes model + context bar from stdin + transcript', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-sl-home-'));
  const tp = join(fakeHome, 'transcript.jsonl');
  writeFileSync(tp, [
    JSON.stringify({ type: 'user', message: { content: 'ship the statusline' } }),
    JSON.stringify({ message: { usage: { input_tokens: 10_000, cache_read_input_tokens: 90_000 } } }),
  ].join('\n'));
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const r = spawnSync(process.execPath, [hook, join(fakeHome, '.claude')], {
    input: JSON.stringify({
      workspace: { current_dir: join(root, 'src') },
      model: { id: 'claude-opus-4-8', display_name: 'Opus 4.8' },
      transcript_path: tp,
    }),
    env: { ...process.env, HOME: fakeHome, NO_COLOR: '1' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  // No task recap: it echoed the prompt the user had just typed, which is
  // already on screen right above the status line.
  assert.ok(!r.stdout.includes('ship the statusline'), 'the prompt is NOT echoed back');
  assert.match(r.stdout, /Opus 4\.8/, 'model');
  assert.match(r.stdout, /ctx [█░]{5} 10%/, 'context gauge (Opus 4.8 → 1M window)');
  assert.match(r.stdout, /⊡ M1 · ‹2 \(P3\)/, 'the project identity segment still there');
});

// The window Claude Code itself uses — `context_window` in the stdin blob — beats our
// model table. The table only knows Claude ids, so a local model (Qwen via LiteLLM, a
// 131,072 window) read as a 1M window: ~100k tokens showed "10%" while Claude Code was
// already auto-compacting. Claude Code's own figure is what compaction runs on.
function runWithContextWindow(contextWindow, model = { id: 'Qwen3.8-27B-FP8', display_name: 'Qwen3.8-27B-FP8' }) {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const fakeHome = mkdtempSync(join(tmpdir(), 'ac-sl-cw-'));
  const tp = join(fakeHome, 'transcript.jsonl');
  writeFileSync(tp, JSON.stringify({ message: { usage: { input_tokens: 10_000, cache_read_input_tokens: 90_000 } } }));
  const blob = { workspace: { current_dir: root }, model, transcript_path: tp };
  if (contextWindow !== undefined) blob.context_window = contextWindow;
  return spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-statusline.mjs'), join(fakeHome, '.claude')], {
    input: JSON.stringify(blob),
    env: { ...process.env, HOME: fakeHome, NO_COLOR: '1' },
    encoding: 'utf8',
  });
}

test('the context gauge uses the window Claude Code reports, not the model table (a local model)', () => {
  const r = runWithContextWindow({ context_window_size: 131_072, total_input_tokens: 100_000, used_percentage: 76 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /ctx [█░]{5} 76%/, `a 131,072 window at 100k tokens is 76%, not 10%:\n${r.stdout}`);
});

test("Claude Code's window is used even when it reports no token count yet — the transcript fills in", () => {
  const r = runWithContextWindow({ context_window_size: 131_072, total_input_tokens: 0, used_percentage: null });
  assert.match(r.stdout, /ctx [█░]{5} 76%/, `the transcript's 100k over the reported window:\n${r.stdout}`);
});

test('with no context_window in the blob (older Claude Code) the model table still decides', () => {
  const r = runWithContextWindow(undefined, { id: 'claude-opus-4-8', display_name: 'Opus 4.8' });
  assert.match(r.stdout, /ctx [█░]{5} 10%/, 'Opus 4.8 → 1M from the table');
});

// --- rate-limit quota: end-to-end through the real hook ----------------------

// A fresh project + isolated HOME per call, so nothing leaks between cases.
//
// The fixture renders the MAXIMAL realistic line by default — model, version and a real
// git branch all present — and a caller opts OUT by passing null, rather than opting in.
// That default is the whole point of this helper and it is not cosmetic: it previously
// built a blob with no `model`, no `version` and no git repo at all, so the two width
// guards below measured a line missing the three segments that consume most of the
// budget. They passed at 110 and 100 columns while the real hook wrapped to two rows at
// both. A budget assertion is only worth as much as its fixture, and a minimal fixture
// certifies a line that never renders.
//
// `branch` inits a real git repo checked out on that name; the default is deliberately
// long because `ac flow` generates 45-character milestone branches, and the branch is
// the one segment whose width is user data rather than bounded by construction.
const FIXTURE_MODEL = { display_name: 'Opus 5' };
const FIXTURE_VERSION = '0.25.1';
const FIXTURE_BRANCH = 'feature/m8-agent-output-that-respects-the-reader';

function runStatusline({
  rateLimits,
  promptCache,
  cost,
  version = FIXTURE_VERSION,
  columns = 200,
  branch = FIXTURE_BRANCH,
  model = FIXTURE_MODEL,
  astrocode = {},
} = {}) {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP, astrocode });
  if (branch) {
    spawnSync('git', ['init', '-q', '-b', branch, root], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'config', 'user.email', 'a@b.c'], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'config', 'user.name', 'a'], { encoding: 'utf8' });
    spawnSync('git', ['-C', root, 'commit', '-q', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
  }
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-rl-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  if (version) writeFileSync(join(home, '.astro', 'code', 'version'), `${version}\n`);
  const blob = { session_id: 's1', workspace: { current_dir: root } };
  if (model) blob.model = model;
  if (rateLimits !== undefined) blob.rate_limits = rateLimits;
  if (promptCache !== undefined) blob.prompt_cache = promptCache;
  if (cost !== undefined) blob.cost = { total_cost_usd: cost };
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  return spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify(blob),
    env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: String(columns) },
    encoding: 'utf8',
  });
}

test('rate-limit quota: present data shows both windows on the live hook, at any usage level', () => {
  const now = Math.floor(Date.now() / 1000);
  const r = runStatusline({ rateLimits: {
    five_hour: { used_percentage: 23, resets_at: now + 7920 },
    seven_day: { used_percentage: 41, resets_at: now + 400_000 },
  } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /5h/);
  assert.match(r.stdout, /7d/);
  assert.match(r.stdout, /23%/);
  assert.match(r.stdout, /41%/);

  const low = runStatusline({ rateLimits: { five_hour: { used_percentage: 5 }, seven_day: { used_percentage: 8 } } });
  assert.match(low.stdout, /5%/);
  assert.match(low.stdout, /8%/, 'far below any alarm threshold — still shown (D1: never gated)');
});

test('rate-limit quota: absence is silent — the usual line renders, with no placeholder or broken value', () => {
  const cases = [
    undefined,                                                          // (a) no key at all
    { five_hour: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 7920 } },   // (b) five_hour only
    { seven_day: { used_percentage: 30, resets_at: Math.floor(Date.now() / 1000) + 7920 } },   // (c) seven_day only
    { five_hour: null, seven_day: { used_percentage: 'abc' }, spend_limit: {} },                // (d) garbage
  ];
  for (const rateLimits of cases) {
    const r = runStatusline({ rateLimits });
    assert.equal(r.status, 0);
    assert.ok(r.stdout.trim().length > 0, 'a non-empty line still renders');
    assert.match(r.stdout, /⊡/, 'identity mark still present');
    assert.doesNotMatch(r.stdout, /NaN|undefined|null|Infinity|--%/, 'no broken/placeholder value leaks through');
  }
  // (a)/(d): nothing valid → no percentages at all.
  for (const rateLimits of [cases[0], cases[3]]) {
    const r = runStatusline({ rateLimits });
    assert.doesNotMatch(r.stdout, /\d+%/, 'no rate-limit numbers when there is nothing valid');
  }
  // (b)/(c): exactly the one supplied window shows, the other stays silent.
  const bOut = runStatusline({ rateLimits: cases[1] }).stdout;
  assert.match(bOut, /30%/);
  assert.match(bOut, /5h/);
  assert.doesNotMatch(bOut, /7d/);
  const cOut = runStatusline({ rateLimits: cases[2] }).stdout;
  assert.match(cOut, /30%/);
  assert.match(cOut, /7d/);
  assert.doesNotMatch(cOut, /5h/);
});

test('rate-limit quota: an empty stdin blob still exits 0 with a non-empty line', () => {
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-empty-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const r = spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: '', env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: '200' }, encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.length >= 0, 'never throws on empty stdin');
});

test('D8: no dollar cost segment renders at any width, even when cost.total_cost_usd is present', () => {
  for (const columns of [200, 120, 80, 40]) {
    const r = runStatusline({ cost: 4.2, columns });
    assert.doesNotMatch(r.stdout, /\$\d/, `no $-amount at ${columns} cols`);
  }
});

test('D7: with no version the identity mark still reads coherently — no dangling separator, no empty v', () => {
  // Opt OUT of the fixture's default version — the point of this case is the absent one.
  const r = runStatusline({
    version: null,
    rateLimits: {
      five_hour: { used_percentage: 23, resets_at: Math.floor(Date.now() / 1000) + 7920 },
    },
  });
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /⊡\s*·/, 'no dangling middot right off the glyph');
  assert.doesNotMatch(r.stdout, /⊡\s*v(?!\d)/, 'no empty "v"');
  assert.match(r.stdout, /⊡ M1/, 'the mark still binds the glyph to the milestone');
});

// --- narrow screens: iPad, phone, split pane ---------------------------------
// A single status line loses its TAIL when the terminal is narrow, and the astro
// segment sits near the tail — so milestone/phase/version were exactly what got
// cut on an iPad. These pin the reflow that fixes it.

test('termWidth reads COLUMNS — the only width a statusline can see', () => {
  // Claude Code CAPTURES stdout, so process.stdout.columns/`tput cols` are blind
  // in a statusline; it exports COLUMNS instead. Unknown width must mean "roomy",
  // never a guessed number, or a desktop line would reflow for no reason.
  assert.equal(termWidth({ COLUMNS: '80' }), 80);
  assert.equal(termWidth({ COLUMNS: '0' }), 0);
  assert.equal(termWidth({ COLUMNS: 'wide' }), 0);
  assert.equal(termWidth({}), 0, 'no COLUMNS → 0 → treated as unlimited');
});

test('visibleWidth ignores colour codes', () => {
  assert.equal(visibleWidth('abc'), 3);
  assert.equal(visibleWidth('\x1b[31mabc\x1b[0m'), 3, 'ANSI occupies no columns');
  assert.equal(visibleWidth(''), 0);
});

test('truncateVisible cuts by printable width and keeps colour intact', () => {
  assert.equal(truncateVisible('abcdef', 10), 'abcdef', 'short enough → untouched');
  const cut = truncateVisible('abcdefghij', 5);
  assert.equal(visibleWidth(cut), 5, 'result occupies exactly the budget');
  assert.ok(cut.includes('…'));
  // A coloured string must not be cut by byte offset — that would eat the codes.
  const coloured = truncateVisible('\x1b[31mabcdefghij\x1b[0m', 5);
  assert.equal(visibleWidth(coloured), 5);
  assert.ok(coloured.startsWith('\x1b[31m'), 'opening colour survives');
});

test('packStatus keeps ONE line whenever it fits — desktop is unchanged', () => {
  const wide = ['aaa', 'bbb', 'ccc'];
  const groups = [['aaa'], ['bbb'], ['ccc']];
  assert.deepEqual(packStatus({ wide, groups, width: 200 }), [wide.join(STATUS_SEP)]);
  assert.deepEqual(packStatus({ wide, groups, width: 0 }), [wide.join(STATUS_SEP)],
    'unknown width must not reflow');
});

test('packStatus splits into rows when narrow, each row within the budget', () => {
  const wide = ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc'];
  const groups = [['aaaaaaaaaa'], ['bbbbbbbbbb'], ['cccccccccc']];
  const rows = packStatus({ wide, groups, width: 12 });
  assert.equal(rows.length, 3);
  for (const r of rows) assert.ok(visibleWidth(r) <= 12, `row within budget: ${r}`);
});

test('a row drops a whole segment rather than slicing it', () => {
  // Half of "⎇ feature-branch" is worse than none of it, so overflow drops the
  // segment; only a leading segment that alone overruns is truncated.
  const rows = packStatus({
    wide: ['keepme', 'dropme'],
    groups: [['keepme', 'dropme']],
    width: 8,
  });
  assert.deepEqual(rows, ['keepme'], 'the segment that does not fit is dropped whole');
});

test('renderSegmentParts splits identity from state; renderSegment still joins them', () => {
  const ctx = {
    milestone: 6,
    phase: { number: 15, slug: '15-a-very-long-phase-slug-indeed', status: 'verified' },
    version: '0.14.0', done: 0, total: 5,
  };
  const { identity, state } = renderSegmentParts(ctx);
  assert.match(identity, /⊡/);
  assert.match(identity, /v0\.14\.0/);
  assert.match(identity, /M6/);
  assert.match(identity, /P15/);
  assert.match(state, /verified/);
  assert.ok(!identity.includes('verified'), 'state must not leak into identity');
  // The joined form is what the single-line layout has always rendered.
  assert.equal(renderSegment(ctx), [identity, state].join(' · '));
});



test('on an iPad-width terminal the statusline still shows version, milestone and phase', () => {
  // The actual regression: at 60 columns every row must fit, and the identity
  // the user navigates by must be present and NOT sliced away.
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-narrow-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  writeFileSync(join(home, '.astro', 'code', 'version'), '0.14.0\n');
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');

  const render = (columns) => spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify({ session_id: 's', workspace: { current_dir: root } }),
    env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: String(columns) },
    encoding: 'utf8',
  }).stdout;

  for (const columns of [45, 60, 80, 110]) {
    const out = render(columns);
    const rows = out.split('\n');
    for (const row of rows) {
      assert.ok(visibleWidth(row) <= columns,
        `at ${columns} cols a row overflowed (${visibleWidth(row)}): ${row}`);
    }
    assert.match(out, /⊡ v0\.14\.0/, `version visible at ${columns} cols`);
    assert.match(out, /M\d/, `milestone visible at ${columns} cols`);
    assert.match(out, /P\d/, `phase visible at ${columns} cols`);
  }
});

test('a roomy terminal still renders exactly one line', () => {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-wide-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const out = spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify({ session_id: 's', workspace: { current_dir: root } }),
    env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: '300' },
    encoding: 'utf8',
  }).stdout;
  assert.equal(out.split('\n').length, 1, 'no reflow when there is room');
});

test('packStatus with an empty `wide` goes straight to rows', () => {
  // The caller passes [] to mean "I already know one line will not fit". An
  // earlier version treated the empty string as a fitting line and returned
  // nothing at all, blanking the statusline on narrow terminals.
  const rows = packStatus({ wide: [], groups: [['aaa'], ['bbb']], width: 40 });
  assert.deepEqual(rows, ['aaa', 'bbb']);
});

test('one line when it fits, two rows when it does not — identity always intact', () => {
  // The rule is width-driven, not a fixed threshold: a line that fits stays one
  // line; a line that does not becomes two READABLE rows rather than one crammed
  // row. Either way the identity half (version/milestone/phase) is never sliced.
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-rows-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  writeFileSync(join(home, '.astro', 'code', 'version'), '0.14.0\n');
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');

  const render = (columns) => spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify({ session_id: 's', workspace: { current_dir: root } }),
    env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: String(columns) },
    encoding: 'utf8',
  }).stdout;

  const wide = render(300);
  assert.equal(wide.split('\n').length, 1, 'a roomy terminal keeps one line');
  // Pick narrow widths from the fixture's own single-line length, so the test
  // does not depend on how long this fixture's phase slug happens to be (D7's
  // word removal shortened the line, which is exactly why this must be derived
  // rather than hardcoded).
  const wideLen = visibleWidth(wide.trim());
  for (const columns of [wideLen - 20, wideLen - 10]) {
    const out = render(columns);
    assert.ok(out.split('\n').length >= 2, `at ${columns} cols it should use rows:\n${out}`);
    for (const row of out.split('\n')) {
      assert.ok(visibleWidth(row) <= columns,
        `row overflowed at ${columns} (${visibleWidth(row)}): ${row}`);
    }
    assert.match(out, /⊡ v0\.14\.0/, `version survives at ${columns}`);
    assert.match(out, /M\d/, `milestone survives at ${columns}`);
    assert.match(out, /P\d/, `phase survives at ${columns}`);
  }
});

// --- width sweep: priority-aware degradation + the 110-column budget ---------

test('width sweep: the window nearest its limit survives; detail only ever decreases', () => {
  const sweep = (rateLimits, coolPct, hotPct) => {
    const widths = [200, 160, 140, 120, 100, 90, 80, 70, 60, 50, 40];
    // level: 3 = bar+both numbers, 2 = both numbers no bar, 1 = hottest number
    // only, 0 = absent. Fixed-width, no COLOR — the raw substrings are exact.
    let prevLevel = Infinity;
    for (const columns of widths) {
      const out = runStatusline({ rateLimits, columns }).stdout;
      const hasBar = /[█░]/.test(out);
      const hasCool = out.includes(`${coolPct}%`);
      const hasHot = out.includes(`${hotPct}%`);
      // (1) never sheds the hot window while keeping the cool one.
      assert.ok(!(hasCool && !hasHot), `at ${columns} cols the cool window survived while the hot one did not:\n${out}`);
      // (2) a bar never survives at a width where a number was dropped.
      if (hasBar) assert.ok(hasCool && hasHot, `at ${columns} cols a bar rode without both numbers:\n${out}`);
      const level = hasBar ? 3 : (hasCool && hasHot) ? 2 : hasHot ? 1 : 0;
      // (3) detail only ever decreases as the screen narrows.
      assert.ok(level <= prevLevel, `detail INCREASED at ${columns} cols (level ${level} > ${prevLevel}):\n${out}`);
      prevLevel = level;
      // (4) no fragment cut mid-token: every window label is followed by its own %.
      for (const label of ['5h', '7d']) {
        const at = out.indexOf(label);
        if (at >= 0) assert.match(out.slice(at), /%/, `"${label}" rode with no trailing % (cut mid-token) at ${columns} cols:\n${out}`);
      }
      // every row stays within its own budget — no overflow/wrap.
      for (const row of out.split('\n')) assert.ok(visibleWidth(row) <= columns, `row overflowed at ${columns}: ${row}`);
      assert.ok(out.split('\n').every((r) => r.length > 0), `no empty row at ${columns} cols`);
    }
  };

  // cool=5h(10%), hot=7d(95%) — the 7d window must be the one that survives.
  sweep({ five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 95 } }, 10, 95);
  // swapped: now 5h is the hot one — the SURVIVOR must flip with it.
  sweep({ five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 10 } }, 10, 95);
});

test('outside a project the single line keeps its bars whenever it fits them, branch untruncated', () => {
  // A fixed 150-column floor hid the bars from a 147-column terminal whose line was 80 columns
  // wide with them, while the row layout of the same terminal drew them from 130 columns.
  // The decision is now measured: bars when the whole line (full branch) fits, numbers when not.
  const root = mkdtempSync(join(tmpdir(), 'ac-sl-plain-'));
  spawnSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8' });
  spawnSync('git', ['-C', root, '-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-q', '--allow-empty', '-m', 'init'],
    { encoding: 'utf8' });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-plain-home-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const blob = {
    session_id: 's1', workspace: { current_dir: root }, model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    context_window: { context_window_size: 1_000_000, total_input_tokens: 520_000 },
    rate_limits: { five_hour: { used_percentage: 48, resets_at: now + 3600 },
                   seven_day: { used_percentage: 62, resets_at: now + 4 * 86_400 } },
  };
  const hook = join(FRAMEWORK, 'hooks', 'astro-statusline.mjs');
  const render = (columns) => spawnSync(process.execPath, [hook, join(home, '.claude')], {
    input: JSON.stringify(blob), encoding: 'utf8',
    env: { ...process.env, HOME: home, NO_COLOR: '1', COLUMNS: String(columns) },
  }).stdout;

  const at147 = render(147);
  assert.equal(at147.split('\n').length, 1, `one line at 147:\n${at147}`);
  assert.match(at147, /ctx [█░]{5} 52%/, `the context bar at 147:\n${at147}`);
  assert.match(at147, /7d [█░▏]{5} 62%/, `the quota bars at 147:\n${at147}`);
  assert.match(at147, /⎇ main/, 'the branch in full');

  // Exactly as wide as the line with bars: bars. One column less: numbers, never a cut branch.
  const barredWidth = visibleWidth(at147);
  const exact = render(barredWidth);        // the columns the line with bars takes, dot included
  assert.match(exact, /[█░]/, `bars at their own width:\n${exact}`);
  assert.match(exact, /⎇ main/, `and the branch whole:\n${exact}`);
  const tighter = render(barredWidth - 1);
  assert.doesNotMatch(tighter, /[█░]/, `no bars one column short:\n${tighter}`);
  assert.match(tighter, /⎇ main/, `the branch is not cut to make room for bars:\n${tighter}`);
  for (const [out, columns] of [[at147, 147], [exact, barredWidth], [tighter, barredWidth - 1]]) {
    for (const row of out.split('\n')) assert.ok(visibleWidth(row) <= columns, `overflow at ${columns}: ${row}`);
  }
});

test('the wide line with both quota bars fits a typical terminal at 110 and 100 columns', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = {
    five_hour: { used_percentage: 23, resets_at: now + 7920 },
    seven_day: { used_percentage: 41, resets_at: now + 400_000 },
  };
  for (const columns of [110, 100]) {
    const out = runStatusline({ rateLimits, columns }).stdout;
    assert.equal(out.split('\n').length, 1, `${columns} cols should still be a single line`);
    assert.ok(visibleWidth(out) <= columns, `line exceeded its own budget at ${columns}: ${visibleWidth(out)}`);

    // The width assertion above CANNOT fail on its own any more: the branch is the
    // elastic segment, so it truncates until the line fits whatever it was given. That
    // makes "it fits" true by construction and therefore worthless as a guard — the
    // second unfalsifiable assertion this phase produced.
    //
    // What is actually load-bearing is WHICH detail tier a typical terminal gets. The
    // bars are the 12 columns that pushed the one-line render to 145 and forced the
    // reflow, so at 110 and 100 the quota segment must be numbers-only. Assert that,
    // because it is the thing that can regress.
    assert.doesNotMatch(
      out,
      /[█░]/,
      `quota bars must not render at ${columns} cols — they are what overran the line, and ` +
        'the branch silently truncating to absorb them is not the fix',
    );
    assert.match(out, /5h\s+23%/, `the 5h number must survive at ${columns} cols`);
    assert.match(out, /7d\s+41%/, `the 7d number must survive at ${columns} cols`);
  }

  // ...and the bars must still exist somewhere, or "numbers-only at 110" would be
  // satisfied by having removed them altogether, which C1 forbids.
  const wide = runStatusline({ rateLimits, columns: 200 }).stdout;
  assert.match(wide, /[█░]/, 'a genuinely wide terminal must still get the bars');
});

// A hot window (>=85%) grows a D2 reset countdown, which is exactly the case
// the two tests above never exercised (both stayed below the hot threshold,
// so `resets_at` never rendered). The countdown text — plus row2's segment
// ORDER, which `fitRow` treats as a priority list since it drops whatever
// overflows — is what let the quota segment disappear and then reappear as
// the screen kept narrowing.

test('width sweep with a hot window + live reset countdown never lets the quota segment reappear once shed', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = {
    five_hour: { used_percentage: 10, resets_at: now + 7200 },
    seven_day: { used_percentage: 95, resets_at: now + 86_400 * 3 },
  };
  // A real, long branch name — the ⎇ segment competes with the quota segment
  // for row space, which is exactly what made the shed non-monotonic.
  const branch = 'feature/a-fairly-long-branch-name-like-real-repos-have';
  const widths = [200, 160, 140, 120, 100, 90, 80, 70, 60, 50, 40];
  let seenGone = false;
  for (const columns of widths) {
    const out = runStatusline({ rateLimits, columns, branch }).stdout;
    const hasHot = out.includes('95%');
    const hasCool = out.includes('10%');
    // (1) the hot window must never be shed while the cool one still shows.
    assert.ok(!(hasCool && !hasHot), `at ${columns} cols the cool window survived while the hot one did not:\n${out}`);
    // (2) once the hot window is gone at some width, it must stay gone at
    // every narrower width — no reappearing as the screen keeps shrinking.
    if (!hasHot) seenGone = true;
    else assert.ok(!seenGone, `95% reappeared at ${columns} cols after being shed at a wider width:\n${out}`);
    for (const row of out.split('\n')) assert.ok(visibleWidth(row) <= columns, `row overflowed at ${columns}: ${row}`);
  }
});

// A long project state — an open fix plus debt pressure — does not fit beside the
// identity on row 1. It used to LEAD row 2 instead, and because `fitRow` drops every
// segment that no longer fits, model/context, the quota (which D1 promises stays
// visible) and the branch all vanished behind it. The state gets a row of its own; the width is
// derived from the fixture's own project segment so it does not depend on slug lengths.
test('a project state too long for row 1 gets its own row — model and quota are not crowded out', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = {
    five_hour: { used_percentage: 5, resets_at: now + 3 * 3600 },
    seven_day: { used_percentage: 31, resets_at: now + 5 * 86_400 },
  };
  const astrocode = {
    'fixes.json': { fixes: [{ id: '2026-01-01-login-redirect-loses-the-return-url', title: 'login redirect', status: 'open' }] },
    // Two open items on one file: the hotspot interest puts the register in the pay-now band.
    'debt.json': { debt: [
      { id: 'd1', status: 'open', cost: 'small', file: 'src/auth.js' },
      { id: 'd2', status: 'open', cost: 'small', file: 'src/auth.js' },
    ] },
  };
  const wide = runStatusline({ rateLimits, astrocode, columns: 300 }).stdout;
  const projectSeg = wide.split(STATUS_SEP).find((s) => s.startsWith('⊡'));
  assert.ok(projectSeg && /⚑ login-redirect/.test(projectSeg) && /debt 50/.test(projectSeg),
    `precondition: the fixture's project segment carries the fix and the debt:\n${wide}`);
  // Narrower than identity + state on one row (the `○ ` dot takes 2), wide enough for both quota numbers.
  for (const columns of [visibleWidth(projectSeg) + 3, visibleWidth(projectSeg) - 7]) {
    assert.ok(columns >= 90, `precondition: ${columns} cols keeps both quota numbers`);
    const out = runStatusline({ rateLimits, astrocode, columns }).stdout;
    const rows = out.split('\n');
    for (const row of rows) assert.ok(visibleWidth(row) <= columns, `row overflowed at ${columns}: ${row}`);
    assert.ok(rows.every((r) => r.trim().length > 0), `no empty row at ${columns} cols:\n${out}`);
    assert.match(out, /⚑ login-redirect/, `the fix survives at ${columns} cols:\n${out}`);
    assert.match(out, /Opus 5/, `the model survives at ${columns} cols:\n${out}`);
    assert.match(out, /5h\s+5%/, `the 5h quota survives at ${columns} cols:\n${out}`);
    assert.match(out, /7d\s+31%/, `the 7d quota survives at ${columns} cols:\n${out}`);
    assert.match(out, /⎇ feature\//, `the branch survives at ${columns} cols:\n${out}`);
    assert.ok(rows.length >= 3, `at ${columns} cols the state should have a row of its own:\n${out}`);
  }
});

test('a hot window with a live reset countdown still leaves the wide line fitting ~100-110 columns', () => {
  // D2's countdown text is the one thing that can blow the always-visible
  // quota segment (D1) past the reflow budget the phase costed it against —
  // confirm it still does not push the single-line reflow point away from
  // the ~100-column budget C8/D7/D8 were funded to protect.
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = {
    five_hour: { used_percentage: 10, resets_at: now + 7200 },
    seven_day: { used_percentage: 95, resets_at: now + 86_400 * 3 },
  };
  for (const columns of [110, 100]) {
    const out = runStatusline({ rateLimits, columns }).stdout;
    assert.equal(out.split('\n').length, 1, `${columns} cols should still be a single line:\n${out}`);
    assert.ok(visibleWidth(out) <= columns, `line exceeded its own budget at ${columns}: ${visibleWidth(out)}`);
  }
});


// --- prompt-cache segment -----------------------------------------------------

const warmCache = (now, over = {}) => ({
  warm: true, caching_observed: true, ttl: '1h', expires_at: now + 3300,
  requests: 42, misses: 1, expected_rebuilds: 0, hit_ratio: 0.964,
  cache_write_tokens: 200_000, miss_recache_tokens: 150_000,
  last_miss_at: null, last_miss_cause: null, miss_causes: {},
  recache_tokens_if_cold: 184_000,
  ...over,
});

test('renderPromptCache is empty with no data, no requests, or caching never observed', () => {
  assert.equal(renderPromptCache({}), '');
  assert.equal(renderPromptCache({ promptCache: null }), '');
  const now = 1_800_000_000;
  assert.equal(renderPromptCache({ promptCache: warmCache(now, { requests: 0 }), nowSeconds: now }), '');
  assert.equal(renderPromptCache({ promptCache: warmCache(now, { caching_observed: false }), nowSeconds: now }), '');
});

test('renderPromptCache: warm shows the expiry as a clock time; hit ratio only in full', () => {
  const now = 1_800_000_000;
  const pc = warmCache(now);
  const full = renderPromptCache({ promptCache: pc, nowSeconds: now, detail: 'full' });
  assert.ok(full.includes(`→${formatClock(pc.expires_at)}`), full);
  assert.match(full, /96%/);
  const compact = renderPromptCache({ promptCache: pc, nowSeconds: now, detail: 'compact' });
  assert.ok(compact.includes(`→${formatClock(pc.expires_at)}`), compact);
  assert.doesNotMatch(compact, /%/, 'compact sheds the hit ratio');
  assert.match(formatClock(pc.expires_at), /^\d\d:\d\d$/);
});

test('renderPromptCache: cold says so, and full carries what the next turn re-writes', () => {
  const now = 1_800_000_000;
  const pc = warmCache(now, { warm: false, expires_at: null });
  assert.match(renderPromptCache({ promptCache: pc, nowSeconds: now }), /cold ·184k/);
  const compact = renderPromptCache({ promptCache: pc, nowSeconds: now, detail: 'compact' });
  assert.match(compact, /cold/);
  assert.doesNotMatch(compact, /184k/);
});

test('renderPromptCache: a fresh miss names its cause; a stale one is dropped', () => {
  const now = 1_800_000_000;
  const cause = { causes: ['tools_changed'], tools_added: 3, tools_removed: 1 };
  const fresh = warmCache(now, { last_miss_at: now - 60, last_miss_cause: cause });
  assert.match(renderPromptCache({ promptCache: fresh, nowSeconds: now }), /miss: tools \+3\/-1/);
  assert.match(renderPromptCache({ promptCache: fresh, nowSeconds: now, detail: 'compact' }), /miss: tools(?! \+)/);

  const stale = warmCache(now, { last_miss_at: now - CACHE_MISS_FRESH_SECONDS - 1, last_miss_cause: cause });
  assert.doesNotMatch(renderPromptCache({ promptCache: stale, nowSeconds: now }), /miss/);

  const multi = warmCache(now, { last_miss_at: now - 10, last_miss_cause: { causes: ['model_changed', 'effort_changed'] } });
  assert.match(renderPromptCache({ promptCache: multi, nowSeconds: now }), /miss: model \+1/);
});

test('renderPromptCache minimal carries one fact: fresh miss, else cold, else the deadline', () => {
  const now = 1_800_000_000;
  const min = (over) => renderPromptCache({ promptCache: warmCache(now, over), nowSeconds: now, detail: 'minimal' });
  assert.equal(min({ last_miss_at: now - 5, last_miss_cause: { causes: ['model_changed'] } }), 'cache miss: model');
  assert.equal(min({ warm: false, expires_at: null }), 'cache cold');
  assert.equal(min({}), `cache →${formatClock(now + 3300)}`);
});

test('the cache is dropped from the single line rather than forcing a second row', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = { five_hour: { used_percentage: 23 }, seven_day: { used_percentage: 41 } };
  // A cache fact far too long for the room left, so the only way to keep one row is to drop it.
  const promptCache = warmCache(now, { last_miss_at: now - 5, last_miss_cause: { causes: ['a_very_long_future_cause_code_that_does_not_fit_anywhere'] } });
  const base = runStatusline({ rateLimits, columns: 100 }).stdout;
  assert.equal(base.split('\n').length, 1, `precondition: one row without the cache:\n${base}`);
  const out = runStatusline({ rateLimits, promptCache, columns: 100 }).stdout;
  assert.equal(out.split('\n').length, 1, `the cache forced a second row:\n${out}`);
  assert.doesNotMatch(out, /cache/);
});

test('cacheMissLabel maps known codes and still reads an unknown one', () => {
  assert.equal(cacheMissLabel('fast_mode_changed'), 'fast mode');
  assert.equal(cacheMissLabel('ttl_expired_5m'), 'idle >5m');
  assert.equal(cacheMissLabel('some_new_cause'), 'some new cause');
});

test('prompt cache on the live hook: shown when sent, absent when not', () => {
  const now = Math.floor(Date.now() / 1000);
  const pc = warmCache(now);
  const out = runStatusline({ promptCache: pc }).stdout;
  assert.ok(out.includes(`cache 96% →${formatClock(pc.expires_at)}`), out);
  assert.doesNotMatch(runStatusline({}).stdout, /cache/);
});

test('prompt cache + quota + a fresh miss still leave a single line at 110 and 100 columns, quota intact', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = {
    five_hour: { used_percentage: 23, resets_at: now + 7920 },
    seven_day: { used_percentage: 41, resets_at: now + 400_000 },
  };
  const promptCache = warmCache(now, {
    last_miss_at: now - 30, last_miss_cause: { causes: ['tools_changed'], tools_added: 3, tools_removed: 0 },
  });
  for (const columns of [110, 100]) {
    const out = runStatusline({ rateLimits, promptCache, columns }).stdout;
    assert.equal(out.split('\n').length, 1, `${columns} cols should still be a single line:\n${out}`);
    assert.ok(visibleWidth(out) <= columns, `line exceeded its own budget at ${columns}: ${visibleWidth(out)}`);
    // Load-bearing, as in the quota guard above: the tier. One fact below the bar floor —
    // and when the cache shows at all, the fact is the fresh miss, not the deadline.
    assert.doesNotMatch(out, /96%|\+3\/-0|→/, `cache must be minimal at ${columns} cols:\n${out}`);
    if (out.includes('cache')) assert.match(out, /cache miss: tools/, `minimal must pick the miss at ${columns}:\n${out}`);
    assert.match(out, /5h\s+23%/, `the quota must survive the cache segment at ${columns} cols`);
    assert.match(out, /7d\s+41%/);
  }
});

test('width sweep: the cache segment never evicts the quota, and no row overflows', () => {
  const now = Math.floor(Date.now() / 1000);
  const rateLimits = { five_hour: { used_percentage: 10 }, seven_day: { used_percentage: 95 } };
  const promptCache = warmCache(now, { last_miss_at: now - 30, last_miss_cause: { causes: ['model_changed'] } });
  for (const columns of [200, 160, 140, 120, 100, 90, 80, 70, 60, 50, 40]) {
    const out = runStatusline({ rateLimits, promptCache, columns }).stdout;
    if (out.includes('cache')) assert.ok(out.includes('95%'), `cache rode while the hot quota was shed at ${columns}:\n${out}`);
    for (const row of out.split('\n')) assert.ok(visibleWidth(row) <= columns, `row overflowed at ${columns}: ${row}`);
  }
});

test('phaseTrack: only the current milestone, rejected phases hidden (the current one kept)', async () => {
  const { phaseTrack } = await import('../hooks/_astro-ctx.mjs');
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const phases = [{ number: 54, status: 'rejected', milestone: 2 }, { number: 84, status: 'pending', milestone: 2 },
    { number: 103, status: 'rejected', milestone: 5 }, { number: 104, status: 'pending', milestone: 5 }, { number: 105, status: 'pending', milestone: 5 }];
  assert.equal(strip(phaseTrack({ milestone: 5, phase: { number: 104, status: 'pending' }, phases })), '(P104) P105');
  assert.equal(strip(phaseTrack({ milestone: 5, phase: { number: 103, status: 'rejected' }, phases })), '(P103) P104 P105');
});

test('readContext: with no active phase, the current milestone is where you are, not an old leftover', async () => {
  const { readContext } = await import('../hooks/_astro-ctx.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'ac-cur-'));
  try {
    mkdirSync(join(root, '.astrocode'));
    writeFileSync(join(root, '.astrocode', 'state.json'), '{}');
    writeFileSync(join(root, '.astrocode', 'roadmap.json'), JSON.stringify({ milestone: 5, phases: [
      { number: 54, slug: '54-a', status: 'rejected', milestone: 2 }, { number: 84, slug: '84-b', status: 'pending', milestone: 2 },
      { number: 104, slug: '104-c', status: 'pending', milestone: 5 }] }));
    const ctx = readContext(root, 1_700_000_000);
    assert.equal(ctx.phase.number, 104);
    assert.equal(ctx.phases.find((p) => p.number === 84).milestone, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
