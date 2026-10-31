// Fix: an entry published after the one-time D-series relabel can still cite an old id in its body
// ("D-037, ADR-034"). `canon pull` and `decision add` relabelled only the local copy before comparing,
// so the local entry no longer matched the registry's byte-identical one and was refused as
// "edited locally after publishing". The relabel now reaches both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeDecisions, mergeRelabeled } from '../lib/canon.mjs';
import { applyRelabel } from '../lib/adr.mjs';

const ENTRY = [
  '# Decisions',
  '',
  '## ADR-0129 — Organization subscriptions',
  '',
  '- **Date:** 2026-10-29',
  '- **Decision:** the engine stays the coworker\'s statement of intent (D-037, ADR-034).',
  '',
].join('\n');
const shared = { backfill: { relabel: { 'ADR-034': 'D-034' }, folder_width: 4 } };

test('the same published entry citing an old id merges cleanly once both sides are relabelled', () => {
  const merged = mergeRelabeled(ENTRY, ENTRY, shared);
  assert.equal(merged.ok, true, JSON.stringify(merged.collisions));
  assert.ok(merged.text.includes('(D-037, D-034)'), 'the merged log carries the relabelled id');
});

test('relabelling only the local side is what used to refuse it (the bug this fixes)', () => {
  const localOnly = mergeDecisions(ENTRY, applyRelabel(ENTRY, shared.backfill.relabel, { folderWidth: 4 }));
  assert.equal(localOnly.ok, false);
  assert.equal(localOnly.collisions[0].kind, 'edited-published');
});

test('a genuinely edited published entry still collides after relabelling both sides', () => {
  const edited = ENTRY.replace('statement of intent', 'statement of choice');
  const merged = mergeRelabeled(ENTRY, edited, shared);
  assert.equal(merged.ok, false);
  assert.equal(merged.collisions[0].id, 'ADR-0129');
});

test('with no relabel map the merge is the plain one', () => {
  assert.deepEqual(mergeRelabeled(ENTRY, ENTRY, null), mergeDecisions(ENTRY, ENTRY));
});
