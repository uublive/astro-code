// Phase 54 t14 (C6): `statusJson` carries `deferred_fixes`, the open fixes a human deferred a
// criterion into, and omits the key when there are none. Real project on a real filesystem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';
import { addFix, acceptFix } from '../lib/fixes.mjs';
import { statusJson } from '../lib/nextstep.mjs';

const NOW = 1_800_000_000;

test('statusJson lists open deferred fixes as { id, title, status, phase, criterion } and drops them once accepted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-dstat-'));
  initPlanning(root, { name: 'demo' });
  assert.equal('deferred_fixes' in statusJson(root, NOW), false, 'absent when there are none');
  await addFix(root, { title: 'plain bug' });
  assert.equal('deferred_fixes' in statusJson(root, NOW), false, 'a plain fix is not a deferred one');
  const fix = await addFix(root, { title: 'deferred: phase 54 C2 — claim', deferredFrom: { phase: '54-x', criterion: 'C2', run: 2, commit: 'abc' } });
  assert.deepEqual(statusJson(root, NOW).deferred_fixes, [
    { id: fix.id, title: fix.title, status: 'open', phase: '54-x', criterion: 'C2' },
  ]);
  await acceptFix(root, fix.id, { by: 'me' });
  assert.equal('deferred_fixes' in statusJson(root, NOW), false);
});
