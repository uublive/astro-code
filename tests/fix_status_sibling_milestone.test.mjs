// Fix 2026-10-23-ac-status-suggests-discussing-a-phase (GitHub #142): the "also" suggestion took the
// first higher-numbered pending phase, ignoring milestones, so a later milestone's phase jumped
// ahead of an undiscussed phase in the active milestone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { statusJson, siblingCommands } from '../lib/nextstep.mjs';

test('#142 fixture: the sibling is the active milestone\'s next phase, not a later milestone\'s', () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-sib-'));
  mkdirSync(join(root, '.astrocode', 'phases', '01-build-core'), { recursive: true });
  writeFileSync(join(root, '.astrocode', 'roadmap.json'), JSON.stringify({ version: 1, milestone: 1, phases: [
    { number: 1, slug: '01-build-core', name: 'build core', status: 'pending', milestone: 1 },
    { number: 2, slug: '02-later-extension', name: 'later extension', status: 'pending', milestone: 2 },
    { number: 3, slug: '03-finish-core', name: 'finish core', status: 'pending', milestone: 1 },
  ] }));
  writeFileSync(join(root, '.astrocode', 'state.json'), JSON.stringify({ active_phase: '01-build-core' }));
  writeFileSync(join(root, '.astrocode', 'phases', '01-build-core', 'PLAN.md'), 'plan');
  const s = statusJson(root, 1_700_000_000);
  assert.equal(s.next, '/astro-execute 1');
  assert.deepEqual(s.siblings, ['/astro-discuss 3']);
});

test('later milestones are offered only once the active one has no candidate; earlier ones never', () => {
  const ph = (number, milestone, extra = {}) => ({ number, milestone, status: 'pending', planned: false, discussed: false, ...extra });
  // active milestone 2: nothing left in it after 5, so milestone 3's phase is next; milestone 1's never
  assert.deepEqual(siblingCommands([ph(5, 2, { planned: true }), ph(6, 1), ph(7, 3)], '/astro-execute 5', 2), ['/astro-discuss 7']);
  // milestone order beats phase number: 9 (milestone 3) before 8 (milestone 4)
  assert.deepEqual(siblingCommands([ph(5, 2, { planned: true }), ph(8, 4), ph(9, 3)], '/astro-execute 5', 2), ['/astro-discuss 9']);
});
