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
  findAstroRoot, readContext, renderSegment, renderBanner, nextAction, ACTIVITY_TTL_SECONDS,
} from '../hooks/_astro-ctx.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = 1_700_000_000; // fixed clock for deterministic activity-age math

// Build a throwaway project with the given state + roadmap on disk.
function project({ state = {}, roadmap = {}, plannedSlugs = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ac-sl-'));
  const ac = join(root, '.astrocode');
  mkdirSync(ac, { recursive: true });
  writeFileSync(join(ac, 'state.json'), JSON.stringify(state));
  writeFileSync(join(ac, 'roadmap.json'), JSON.stringify(roadmap));
  for (const slug of plannedSlugs) {
    mkdirSync(join(ac, 'phases', slug), { recursive: true });
    writeFileSync(join(ac, 'phases', slug, 'PLAN.md'), '# plan');
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

test('a fresh activity verb wins over the static status; a stale one is dropped', () => {
  const fresh = project({ state: { activity: { text: '⚙ executing', at: NOW - 60 } }, roadmap: ROADMAP });
  assert.match(renderSegment(readContext(fresh, NOW)), /⚙ executing/);

  const stale = project({ state: { activity: { text: '⚙ executing', at: NOW - ACTIVITY_TTL_SECONDS - 1 } }, roadmap: ROADMAP });
  const seg = renderSegment(readContext(stale, NOW));
  assert.doesNotMatch(seg, /executing/, 'stale verb ignored');
  assert.match(seg, /▸ pending/, 'falls back to phase status');
});

test('nextAction routes by phase status + planned flag', () => {
  const unplanned = project({ roadmap: ROADMAP });
  assert.equal(nextAction(readContext(unplanned, NOW)), '/astro-plan 3');

  const planned = project({ roadmap: ROADMAP, plannedSlugs: ['close-ci-gates'] });
  assert.equal(nextAction(readContext(planned, NOW)), '/astro-execute 3');

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
  assert.match(banner, /next: \/astro-plan 3/);
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
