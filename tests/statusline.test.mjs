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
  rampColor, formatETA, renderRateLimits,
} from '../hooks/_astro-ctx.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1_700_000_000; // fixed clock for deterministic activity-age math

// Build a throwaway project with the given state + roadmap on disk.
function project({ state = {}, roadmap = {}, plannedSlugs = [], discussedSlugs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ac-sl-'));
  const ac = join(root, '.astrocode');
  mkdirSync(ac, { recursive: true });
  writeFileSync(join(ac, 'state.json'), JSON.stringify(state));
  writeFileSync(join(ac, 'roadmap.json'), JSON.stringify(roadmap));
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

test('renderBanner is plain multi-line with the creature logo + next action', () => {
  const root = project({ roadmap: ROADMAP });
  const banner = renderBanner(readContext(root, NOW));
  assert.match(banner, /ASTRO·CODE/);
  assert.match(banner, /▛▀▀▀▜/, 'robo-face logo is present');
  assert.match(banner, /next: \/astro-discuss 3/);
  assert.doesNotMatch(banner, /\x1b\[/, 'banner carries no ANSI (rides in a systemMessage)');
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

test('renderClaudeSegment shows model + a coloured fill bar; model-only when no tokens', () => {
  const seg = renderClaudeSegment({ model: { display_name: 'Opus 4.8' }, tokens: 104_000, limit: 200_000 });
  assert.match(seg, /Opus 4\.8/);
  assert.match(seg, /[█░]/, 'graphical bar present');
  assert.match(seg, /52% · 104k\/200k/);
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
  assert.match(r.stdout, /10% · 100k\/1M/, 'context-fill bar (Opus 4.8 → 1M window)');
  assert.match(r.stdout, /⊡ M1 · ‹2 \(P3\)/, 'the project identity segment still there');
});

// --- rate-limit quota: end-to-end through the real hook ----------------------

// A fresh project + isolated HOME per call, so nothing leaks between cases.
function runStatusline({ rateLimits, cost, version, columns = 200 } = {}) {
  const root = project({ state: { project: 'demo' }, roadmap: ROADMAP });
  const home = mkdtempSync(join(tmpdir(), 'ac-sl-rl-'));
  mkdirSync(join(home, '.astro', 'code'), { recursive: true });
  if (version) writeFileSync(join(home, '.astro', 'code', 'version'), `${version}\n`);
  const blob = { session_id: 's1', workspace: { current_dir: root } };
  if (rateLimits !== undefined) blob.rate_limits = rateLimits;
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
  const r = runStatusline({ rateLimits: {
    five_hour: { used_percentage: 23, resets_at: Math.floor(Date.now() / 1000) + 7920 },
  } }); // version omitted → readVersion() finds nothing in this isolated HOME
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

