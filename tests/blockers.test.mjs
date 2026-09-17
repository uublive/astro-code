// A blocker must not outlive the thing it blocks.
//
// Found during UAT of milestone 6: phase 14 was rejected (recording a blocker),
// then accepted once its checklist was amended. It went `complete` but the
// blocker stayed. `completeMilestone` never touches state.json, so it would
// have survived into milestone 7 pointing at a phase no longer in the roadmap —
// unresolvable, because no CLI command removes a blocker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { completeMilestone } from '../lib/milestone.mjs';
import { loadState, updateState } from '../lib/state.mjs';

async function projectWithBlockedPhase() {
  const root = mkdtempSync(join(tmpdir(), 'ac-blk-'));
  initPlanning(root, { name: 'blk' });
  const ph = await addPhase(root, { number: 1, name: 'a phase', milestone: 1 });
  await setPhaseStatus(root, ph.slug, 'rejected');
  await updateState(root, (s) => ({
    ...s,
    blockers: [...(s.blockers || []), { phase: ph.slug, reason: 'nope', at: new Date().toISOString() }],
  }));
  return { root, slug: ph.slug };
}

test('accepting a previously rejected phase clears its blocker', async () => {
  const { root, slug } = await projectWithBlockedPhase();
  assert.equal(loadState(root).blockers.length, 1, 'precondition: the reject recorded one');

  await setPhaseStatus(root, slug, 'complete');

  assert.deepEqual(loadState(root).blockers, [],
    'a phase that is now complete cannot still be blocked');
});

test('completing a milestone clears blockers for the phases it archives', async () => {
  const { root, slug } = await projectWithBlockedPhase();
  // still rejected — the phase is archived unresolved, which is allowed
  await completeMilestone(root);

  const left = loadState(root).blockers || [];
  assert.ok(!left.some((b) => b.phase === slug),
    'a blocker must not outlive the roadmap entry it names — nothing could ever clear it');
});

test('a blocker for a phase that is still live is left alone', async () => {
  const { root } = await projectWithBlockedPhase();
  const other = await addPhase(root, { number: 2, name: 'other', milestone: 1 });
  await setPhaseStatus(root, other.slug, 'complete');
  assert.equal(loadState(root).blockers.length, 1,
    'completing a DIFFERENT phase must not clear an unrelated blocker');
});
