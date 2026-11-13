// ADR-094 (phase 57 t3): the second provenance link on a fix, `fullcheck_from`, and its readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function proj() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-fcfix-'));
  mkdirSync(join(dir, '.astrocode'), { recursive: true });
  return dir;
}
const from = (o = {}) => ({ milestone: 3, phase: '07-x', criterion: 'C2', test: null, command: 'echo hi', tip: 'abc', ...o });

test('addFix stores fullcheck_from and leaves deferred_from absent; deferredFixes ignores it', async () => {
  const { addFix, deferredFixes } = await import('../lib/fixes.mjs');
  const dir = proj();
  const fix = await addFix(dir, { title: 'full check: phase 7 C2', fullcheckFrom: from() });
  assert.deepEqual(fix.fullcheck_from, from());
  assert.equal(fix.deferred_from, undefined);
  assert.deepEqual(deferredFixes(dir), []);
});

test('fullCheckFixes lists only the milestone\'s non-accepted ones', async () => {
  const { addFix, acceptFix, fullCheckFixes } = await import('../lib/fixes.mjs');
  const dir = proj();
  const a = await addFix(dir, { title: 'a', fullcheckFrom: from() });
  await addFix(dir, { title: 'b', fullcheckFrom: from({ milestone: 4 }) });
  await addFix(dir, { title: 'plain' });
  const c = await addFix(dir, { title: 'c', fullcheckFrom: from() });
  await acceptFix(dir, c.id, { agent: 'test' });
  assert.deepEqual(fullCheckFixes(dir, { milestone: 3 }).map((f) => f.id), [a.id]);
  assert.equal(fullCheckFixes(dir).length, 2);
});

test('findFullCheckFix matches the dedup key and ignores accepted fixes', async () => {
  const { addFix, acceptFix, findFullCheckFix } = await import('../lib/fixes.mjs');
  const dir = proj();
  const a = await addFix(dir, { title: 'a', fullcheckFrom: from() });
  const t = await addFix(dir, { title: 't', fullcheckFrom: from({ criterion: null, test: 'tests/x.test.mjs' }) });
  assert.equal(findFullCheckFix(dir, { milestone: 3, phase: '07-x', criterion: 'C2' }).id, a.id);
  assert.equal(findFullCheckFix(dir, { milestone: 3, phase: '07-x', test: 'tests/x.test.mjs' }).id, t.id);
  assert.equal(findFullCheckFix(dir, { milestone: 3, phase: null, criterion: 'C2' }), null);
  await acceptFix(dir, a.id, { agent: 'test' });
  assert.equal(findFullCheckFix(dir, { milestone: 3, phase: '07-x', criterion: 'C2' }), null);
});
