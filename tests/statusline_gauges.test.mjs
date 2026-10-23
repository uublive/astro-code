// Per-user gauge display modes: each statusline gauge (ctx, 5h, 7d, cap) shows its bar,
// its percent, or both — `ac statusline gauges`, stored in ~/.astro/config.json beside
// agent_tools. Width still decides whether bars fit at all: a mode only removes, and a
// gauge set to `bar` falls back to its percent when the line has no room for bars.
// Colour is disabled so the string assertions are stable.
process.env.NO_COLOR = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { renderClaudeSegment, renderRateLimits, readGaugeModes, phaseBandDrawn, renderSegmentParts } from '../hooks/_astro-ctx.mjs';
import { setGaugeMode, setStatuslineDedupe, statuslineDedupe } from '../lib/statuslinegauges.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const home = () => mkdtempSync(join(tmpdir(), 'ac-gauges-'));
const writeConfig = (h, cfg) => {
  mkdirSync(join(h, '.astro'), { recursive: true });
  writeFileSync(join(h, '.astro', 'config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
};

test('ctx gauge: both, bar or percent — and bar falls back to percent with no room for bars', () => {
  const seg = (mode, bar = true) => renderClaudeSegment({ model: { display_name: 'Opus' }, tokens: 520_000, limit: 1_000_000, bar, mode });
  assert.equal(seg('both'), 'Opus ctx ███░░ 52%');
  assert.equal(seg('bar'), 'Opus ctx ███░░');
  assert.equal(seg('percent'), 'Opus ctx 52%');
  assert.equal(seg(undefined), 'Opus ctx ███░░ 52%', 'no mode is the old behaviour');
  assert.equal(seg('bar', false), 'Opus ctx 52%', 'no room for bars: the number, never nothing');
  assert.equal(seg('both', false), 'Opus ctx 52%');
});

test('quota gauges: each window and the cap take their own mode, in every tier', () => {
  const now = 1_000_000_000;
  // Pace-neutral windows (no resets_at) so only the mode shapes the output.
  const rateLimits = { five_hour: { used_percentage: 48 }, seven_day: { used_percentage: 62 }, spend_limit: { used_percentage: 30 } };
  const modes = { '5h': 'percent', '7d': 'bar', cap: 'both' };
  const r = (detail, m = modes) => renderRateLimits({ rateLimits, nowSeconds: now, detail, modes: m });
  assert.equal(r('full'), '7d ███░░ · 5h 48% · cap ██░░░ 30%');
  assert.equal(r('numbers'), '7d 62% · 5h 48% · cap 30%', 'the bar-only 7d falls back to its number');
  assert.equal(r('hottest'), '7d 62%');
  assert.equal(r('full', {}), '7d ███░░ 62% · 5h ██░░░ 48% · cap ██░░░ 30%', 'no modes: both, as before');
});

test('readGaugeModes: defaults to both, takes valid values, ignores the rest', () => {
  const h = home();
  assert.deepEqual(readGaugeModes(h), { ctx: 'both', '5h': 'both', '7d': 'both', cap: 'both' }, 'no file');
  writeConfig(h, { statusline: { gauges: { '5h': 'percent', '7d': 'sparkles', ctx: 'bar', nope: 'bar' } } });
  assert.deepEqual(readGaugeModes(h), { ctx: 'bar', '5h': 'percent', '7d': 'both', cap: 'both' });
  writeConfig(h, '{ not json');
  assert.deepEqual(readGaugeModes(h), { ctx: 'both', '5h': 'both', '7d': 'both', cap: 'both' }, 'a broken file never breaks the line');
});

test('setGaugeMode: keeps every other key, stores both as absent, refuses a broken file', () => {
  const h = home();
  writeConfig(h, { agent_tools: { '*': ['mcp__x__read'] }, other: 1 });
  assert.equal(setGaugeMode({ home: h, gauge: 'all', mode: 'percent' }).ok, true);
  assert.equal(setGaugeMode({ home: h, gauge: 'ctx', mode: 'both' }).ok, true);
  const cfg = JSON.parse(readFileSync(join(h, '.astro', 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { agent_tools: { '*': ['mcp__x__read'] }, other: 1, statusline: { gauges: { '5h': 'percent', '7d': 'percent', cap: 'percent' } } });
  for (const g of ['5h', '7d', 'cap']) setGaugeMode({ home: h, gauge: g, mode: 'both' });
  assert.deepEqual(JSON.parse(readFileSync(join(h, '.astro', 'config.json'), 'utf8')), { agent_tools: { '*': ['mcp__x__read'] }, other: 1 },
    'all defaults leaves no statusline key behind');

  assert.match(setGaugeMode({ home: h, gauge: 'gpu', mode: 'bar' }).error, /no such gauge: gpu/);
  assert.match(setGaugeMode({ home: h, gauge: '5h', mode: 'pie' }).error, /no such mode: pie/);
  writeConfig(h, '{ not json');
  assert.match(setGaugeMode({ home: h, gauge: '5h', mode: 'bar' }).error, /not valid JSON/);
  assert.equal(readFileSync(join(h, '.astro', 'config.json'), 'utf8'), '{ not json', 'a broken file is not overwritten');
});

test('the statusline hook draws what the user set: quota as numbers, ctx as a bar', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-gauges-repo-'));
  spawnSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8' });
  const h = home();
  mkdirSync(join(h, '.astro', 'code'), { recursive: true });
  writeConfig(h, { statusline: { gauges: { ctx: 'bar', '5h': 'percent', '7d': 'percent' } } });
  const blob = {
    session_id: 's1', workspace: { current_dir: root }, model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    context_window: { context_window_size: 1_000_000, total_input_tokens: 520_000 },
    rate_limits: { five_hour: { used_percentage: 48 }, seven_day: { used_percentage: 62 } },
  };
  const out = spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-statusline.mjs'), join(h, '.claude')], {
    input: JSON.stringify(blob), encoding: 'utf8', env: { ...process.env, HOME: h, NO_COLOR: '1', COLUMNS: '200' },
  }).stdout;
  assert.match(out, /ctx ███░░(?! 52%)/, `ctx as a bar only:\n${out}`);
  assert.match(out, /7d 62% · 5h 48%/, `quota as numbers:\n${out}`);
  assert.doesNotMatch(out, /[57][hd] [█░▏]/, `no quota bars:\n${out}`);
});

// ── dedupe: with the phase-band mod drawing, the line drops what the band shows ──────────
const withPlugin = (h, dir = join(h, '.claude')) => {
  mkdirSync(join(dir, 'plugins'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'astro-mods@astro-code': [{ scope: 'user' }] } }));
  return dir;
};

test('phaseBandDrawn: the switch on, the plugin in this profile, and dedupe not off — all three', () => {
  const h = home();
  const configDir = join(h, '.claude');
  assert.equal(phaseBandDrawn({ home: h, configDir }), false, 'no config at all');
  writeConfig(h, { mods: { 'phase-band': true } });
  assert.equal(phaseBandDrawn({ home: h, configDir }), false, 'switch on but no plugin in this profile');
  withPlugin(h);
  assert.equal(phaseBandDrawn({ home: h, configDir }), true);
  assert.equal(phaseBandDrawn({ home: h, configDir: join(h, 'other-profile') }), false, 'another profile without the plugin');
  writeConfig(h, { mods: { 'phase-band': false } });
  assert.equal(phaseBandDrawn({ home: h, configDir }), false, 'switch off');
  writeConfig(h, { mods: { 'phase-band': true }, statusline: { dedupe: false } });
  assert.equal(phaseBandDrawn({ home: h, configDir }), false, 'dedupe off');
  writeConfig(h, 'not json');
  assert.equal(phaseBandDrawn({ home: h, configDir }), false, 'unreadable config: keep everything');
});

test('renderSegmentParts with band drops version, milestone, track, state, verb and counts; keeps fix, blockers, debt', () => {
  const ctx = {
    version: '0.41.0', milestone: 27, phase: { number: 110, status: 'pending' },
    phases: [{ number: 110, status: 'pending' }, { number: 111, status: 'pending' }],
    activity: '⚙ executing', total: 2, done: 0, verified: 0, blockers: 1,
    fix: { id: '2026-10-13-some-bug', status: 'open' }, debt: { band: 'pay-now', pressure: 66 },
  };
  const full = renderSegmentParts(ctx);
  assert.match(full.identity, /M27/);
  assert.match(full.identity, /v0\.41\.0/);
  assert.match(full.state, /⚙ executing/);
  const lean = renderSegmentParts(ctx, { band: true });
  assert.equal(lean.identity, '⊡', 'the band title carries the version');
  assert.doesNotMatch(lean.state, /executing|pending|0▸|0✓/);
  assert.match(lean.state, /⚑ some-bug/);
  assert.match(lean.state, /⚠1/);
  assert.match(lean.state, /debt 66/);
});

test('ac statusline dedupe on|off writes statusline.dedupe and keeps every other key', () => {
  const h = home();
  writeConfig(h, { agent_tools: { x: 1 }, statusline: { gauges: { '5h': 'percent' } } });
  assert.equal(statuslineDedupe(h), true, 'on by default');
  assert.equal(setStatuslineDedupe({ home: h, on: false }).ok, true);
  let cfg = JSON.parse(readFileSync(join(h, '.astro', 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { agent_tools: { x: 1 }, statusline: { gauges: { '5h': 'percent' }, dedupe: false } });
  assert.equal(statuslineDedupe(h), false);
  setStatuslineDedupe({ home: h, on: true });
  cfg = JSON.parse(readFileSync(join(h, '.astro', 'config.json'), 'utf8'));
  assert.deepEqual(cfg, { agent_tools: { x: 1 }, statusline: { gauges: { '5h': 'percent' } } }, 'on is stored as absent');
  writeConfig(h, 'not json');
  assert.equal(setStatuslineDedupe({ home: h, on: false }).ok, false, 'an unparseable file is refused');
  const r = spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), 'statusline', 'dedupe', 'maybe'], { encoding: 'utf8', env: { ...process.env, HOME: home() } });
  assert.notEqual(r.status, 0);
});

test('the statusline hook leaves the milestone and phase to a drawing band, and shows them without one', async () => {
  const { initPlanning } = await import('../lib/planning.mjs');
  const { addPhase } = await import('../lib/roadmap.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ac-dedupe-repo-'));
  spawnSync('git', ['init', '-q', '-b', 'main', root], { encoding: 'utf8' });
  initPlanning(root, { name: 'dd' });
  await addPhase(root, { number: 1, name: 'First' });
  const h = home();
  mkdirSync(join(h, '.astro', 'code'), { recursive: true });
  const blob = { session_id: 's1', workspace: { current_dir: root }, model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' } };
  const draw = () => spawnSync(process.execPath, [join(FRAMEWORK, 'hooks', 'astro-statusline.mjs'), join(h, '.claude')], {
    input: JSON.stringify(blob), encoding: 'utf8', env: { ...process.env, HOME: h, NO_COLOR: '1', COLUMNS: '200' },
  }).stdout;
  assert.match(draw(), /\(P1\)/, 'no band: the phase track shows');
  writeConfig(h, { mods: { 'phase-band': true } });
  withPlugin(h);
  const lean = draw();
  assert.doesNotMatch(lean, /\(P1\)|▸ pending/, `the band draws it:\n${lean}`);
  assert.match(lean, /Opus 5\.5/, 'everything else stays');
});
