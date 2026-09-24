// Rejection provenance + persistence (phase 23, P2). `/astro-accept` proposes a
// principle from a HUMAN rejection reason (D2.3) — never an agent-signed one (D6,
// ADR-033/058) — and the milestone-close sweep (D2.4) must still see a rejection that
// happened phases ago, after the phase went on to be accepted and archived. Both readers
// need the reason to survive `setPhaseStatus`'s later writes and `completeMilestone`'s
// archive, which is why it lives on the phase entry as an append-only `rejections` array
// rather than a single "last reject reason" field that a later accept could clobber.
//
// Per ADR-018 `rejectPhase` is a new export of an EXISTING module (`lib/roadmap.mjs`), so
// a plain `import { rejectPhase } from '../lib/roadmap.mjs'` would throw a SyntaxError at
// module load — before any test runs — the moment this file lands ahead of the
// implementation task. `addPhase`/`setPhaseStatus`/`loadRoadmap` already exist, but they
// are pulled through the SAME dynamic import as `rejectPhase` rather than a static one, so
// this file only ever has one way of reaching `lib/roadmap.mjs` to keep straight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initPlanning } from '../lib/planning.mjs';
import { completeMilestone } from '../lib/milestone.mjs';

async function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'ac-reject-'));
  initPlanning(root, { name: 'reject' });
  const { addPhase } = await import('../lib/roadmap.mjs');
  const ph = await addPhase(root, { number: 1, name: 'a phase', milestone: 1 });
  return { root, slug: ph.slug };
}

test('a human reject sets status rejected and records one provenance-tagged reason', async () => {
  const { rejectPhase, loadRoadmap } = await import('../lib/roadmap.mjs');
  const { root, slug } = await scaffold();

  await rejectPhase(root, slug, { reason: 'checklist item 3 was skipped' });

  const ph = loadRoadmap(root).phases.find((p) => p.slug === slug);
  assert.equal(ph.status, 'rejected');
  assert.equal(ph.rejections.length, 1);
  assert.equal(ph.rejections[0].reason, 'checklist item 3 was skipped');
  assert.equal(ph.rejections[0].kind, 'human');
  assert.equal('by' in ph.rejections[0], false, 'a human reject carries no `by`');
  assert.ok(ph.rejections[0].at, 'each rejection is timestamped');
});

test('an --agent reject is tagged kind:agent with by set to the agent name', async () => {
  const { rejectPhase, loadRoadmap } = await import('../lib/roadmap.mjs');
  const { root, slug } = await scaffold();

  await rejectPhase(root, slug, { reason: 'stale base', agent: 'bot' });

  const ph = loadRoadmap(root).phases.find((p) => p.slug === slug);
  assert.equal(ph.rejections.length, 1);
  assert.equal(ph.rejections[0].kind, 'agent');
  assert.equal(ph.rejections[0].by, 'bot');
});

test('two rejections accumulate in order rather than replacing each other', async () => {
  const { rejectPhase, loadRoadmap } = await import('../lib/roadmap.mjs');
  const { root, slug } = await scaffold();

  await rejectPhase(root, slug, { reason: 'first reason' });
  await rejectPhase(root, slug, { reason: 'second reason' });

  const ph = loadRoadmap(root).phases.find((p) => p.slug === slug);
  assert.equal(ph.rejections.length, 2);
  assert.equal(ph.rejections[0].reason, 'first reason');
  assert.equal(ph.rejections[1].reason, 'second reason');
});

test('a later accept keeps the rejection history intact', async () => {
  const { rejectPhase, setPhaseStatus, loadRoadmap } = await import('../lib/roadmap.mjs');
  const { root, slug } = await scaffold();

  await rejectPhase(root, slug, { reason: 'not yet' });
  await setPhaseStatus(root, slug, 'complete');

  const ph = loadRoadmap(root).phases.find((p) => p.slug === slug);
  assert.equal(ph.status, 'complete');
  assert.equal(ph.rejections.length, 1, 'accepting must not clear the history the milestone sweep reads');
  assert.equal(ph.rejections[0].reason, 'not yet');
});

test('completeMilestone carries the rejection into the archived snapshot', async () => {
  const { rejectPhase, setPhaseStatus } = await import('../lib/roadmap.mjs');
  const { root, slug } = await scaffold();

  await rejectPhase(root, slug, { reason: 'rework the approach' });
  await setPhaseStatus(root, slug, 'complete');
  const { readJSON } = await import('../lib/util.mjs');
  const { paths } = await import('../lib/paths.mjs');

  await completeMilestone(root);

  const snapshot = readJSON(join(paths(root).dir, 'milestones', '1', 'roadmap.json'));
  const archived = snapshot.phases.find((p) => p.slug === slug);
  assert.ok(archived, 'the phase must still be in the archived snapshot');
  assert.equal(archived.rejections.length, 1);
  assert.equal(archived.rejections[0].reason, 'rework the approach');
});

test('rejecting an unknown slug throws', async () => {
  const { rejectPhase } = await import('../lib/roadmap.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ac-reject-'));
  initPlanning(root, { name: 'reject' });

  await assert.rejects(() => rejectPhase(root, 'no-such-phase', { reason: 'x' }));
});
