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
  modelLimit, readContextTokens, readRecap, progressBar, renderClaudeSegment, renderRecap, truncate,
  isBusy, renderStatus, SESSION_STALE_SECONDS,
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
  assert.match(seg, /⊡ astro/);
  assert.match(seg, /M1/);
  assert.match(seg, /P3 close-ci-gates/);
  assert.match(seg, /▸ pending/);
  assert.match(seg, /2\/4/);
  assert.match(seg, /⚠1/);
});

test('renderSegment shows the astro-code version by the brand mark when provided', () => {
  const root = project({ roadmap: ROADMAP });
  const seg = renderSegment({ ...readContext(root, NOW), version: '0.5.2' });
  assert.match(seg, /⊡ astro v0\.5\.2 · M1/, 'version sits right after the astro mark');
  // absent version → unchanged brand (never a bare "v")
  const noV = renderSegment(readContext(root, NOW));
  assert.match(noV, /⊡ astro · M1/);
  assert.doesNotMatch(noV, /v0\.5\.2|astro v/);
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

test('a numeric slug prefix is dropped for display (P3 already shows the number)', () => {
  const root = project({ roadmap: { milestone: 2, phases: [
    { number: 3, slug: '03-close-ci-gates', name: 'Close CI gates', status: 'pending' }] } });
  const seg = renderSegment(readContext(root, NOW));
  assert.match(seg, /P3 close-ci-gates/);
  assert.doesNotMatch(seg, /03-close/);
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
  assert.match(r.stdout, /⊡ astro · M1 · P3 close-ci-gates/);
});

test('the statusline hook composes recap + model + context bar from stdin + transcript', () => {
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
  assert.match(r.stdout, /❯ ship the statusline/, 'recap first');
  assert.match(r.stdout, /Opus 4\.8/, 'model');
  assert.match(r.stdout, /10% · 100k\/1M/, 'context-fill bar (Opus 4.8 → 1M window)');
  assert.match(r.stdout, /⊡ astro · M1 · P3 close-ci-gates/, 'astro segment still there');
});
