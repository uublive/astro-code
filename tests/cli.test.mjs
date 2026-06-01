// Unit tests for the local (no-remote) behaviour: scaffolding, state, roadmap,
// and the local numbering fallback used when there is no coordinated remote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { loadState, updateState } from '../lib/state.mjs';
import { addPhase, loadRoadmap, renderRoadmapMd, slugify } from '../lib/roadmap.mjs';
import { claim } from '../lib/registry.mjs';
import { loadConfig, updateConfig } from '../lib/config.mjs';
import { completeMilestone } from '../lib/milestone.mjs';

const fresh = () => mkdtempSync(join(tmpdir(), 'ac-cli-'));

test('init scaffolds .planning with state, roadmap, config, PROJECT.md', () => {
  const root = fresh();
  const res = initPlanning(root, { name: 'demo', vision: 'do things' });
  assert.equal(res.created, true);
  const p = paths(root);
  assert.ok(existsSync(p.state) && existsSync(p.roadmap) && existsSync(p.config) && existsSync(p.project));
  assert.equal(loadState(root).project, 'demo');
  assert.match(readFileSync(p.project, 'utf8'), /do things/);
  // second init is a no-op
  assert.equal(initPlanning(root, { name: 'demo' }).created, false);
});

test('state set/get roundtrip is atomic and stamps updated_at', async () => {
  const root = fresh();
  initPlanning(root, { name: 'demo' });
  const next = await updateState(root, (s) => ({ ...s, status: 'executing' }));
  assert.equal(next.status, 'executing');
  assert.ok(next.updated_at);
  assert.equal(loadState(root).status, 'executing');
});

test('addPhase appends, sorts, and renders a hook-greppable ROADMAP.md', async () => {
  const root = fresh();
  initPlanning(root, { name: 'demo' });
  await addPhase(root, { number: 2, name: 'Auth Layer', milestone: 1 });
  await addPhase(root, { number: 1, name: 'Foundation', milestone: 1 });
  const rm = loadRoadmap(root);
  assert.deepEqual(rm.phases.map((p) => p.number), [1, 2]);
  assert.equal(rm.phases[0].slug, '01-foundation');
  const md = readFileSync(paths(root).roadmapMd, 'utf8');
  assert.match(md, /\*\*Milestone 1\*\*/);
  assert.match(md, /Phase 1 — Foundation/);
  // phase dir created
  assert.ok(existsSync(join(paths(root).phases, '01-foundation')));
});

test('duplicate phase number is rejected', async () => {
  const root = fresh();
  initPlanning(root, { name: 'demo' });
  await addPhase(root, { number: 1, name: 'a', milestone: 1 });
  await assert.rejects(() => addPhase(root, { number: 1, name: 'b', milestone: 1 }), /already exists/);
});

test('local claim fallback numbers sequentially from the roadmap', async () => {
  const root = fresh(); // not a git repo → no remote → local numbering
  initPlanning(root, { name: 'demo' });
  const c1 = claim({ root, type: 'phase', milestone: 1 });
  assert.equal(c1.source, 'local');
  assert.equal(c1.number, 1);
  await addPhase(root, { number: c1.number, name: 'first', milestone: 1 });
  const c2 = claim({ root, type: 'phase', milestone: 1 });
  assert.equal(c2.number, 2);
});

test('slugify normalizes names', () => {
  assert.equal(slugify('  Auth & Billing!! '), 'auth-billing');
});

test('renderRoadmapMd handles the empty roadmap', () => {
  assert.match(renderRoadmapMd({ milestone: 1, phases: [] }), /No phases yet/);
});

test('config ships model tiers and is updatable', async () => {
  const root = fresh();
  initPlanning(root, { name: 'demo' });
  assert.equal(loadConfig(root).models.executor, 'sonnet');
  const next = await updateConfig(root, (c) => ({ ...c, models: { ...c.models, executor: 'opus' } }));
  assert.equal(next.models.executor, 'opus');
  assert.equal(loadConfig(root).models.executor, 'opus');
});

test('completeMilestone archives phases and clears the active roadmap', async () => {
  const root = fresh();
  initPlanning(root, { name: 'demo' });
  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  await addPhase(root, { number: 2, name: 'beta', milestone: 1 });
  const res = await completeMilestone(root);
  assert.equal(res.milestone, 1);
  assert.equal(res.archived, 2);
  assert.equal(loadRoadmap(root).phases.length, 0);
  assert.ok(existsSync(join(paths(root).planning, 'milestones', '1', 'phases', '01-alpha')));
  assert.ok(existsSync(join(paths(root).planning, 'milestones', '1', 'ROADMAP.md')));
});
