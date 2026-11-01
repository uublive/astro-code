// `--stale` is one flag with two meanings: open 30+ days (age) OR open debt whose recorded
// file no longer exists. These tests pin the file-gone half (phase 55 t5) and that the union
// neither loses the age hits nor reports an entry twice. Real fs + real planning dir, no stubs.
// The new export is reached through `await import` (ADR-018) so a half-done task fails only
// these tests, never the file load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDebt, dropDebt } from '../lib/debt.mjs';
import { initPlanning } from '../lib/planning.mjs';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'ac-debt-stale-'));
  initPlanning(root, { name: 'staledemo' });
  return root;
}
const ids = (rows) => rows.map((d) => d.title).sort();

test('missingFileDebt lists only open debt whose recorded file is gone', async () => {
  const { missingFileDebt } = await import('../lib/debt.mjs');
  const root = project();
  writeFileSync(join(root, 'keep.mjs'), 'x\n');
  writeFileSync(join(root, 'empty.mjs'), '');
  await addDebt(root, { title: 'kept', file: 'keep.mjs' });
  await addDebt(root, { title: 'gone', file: 'gone.mjs' });
  await addDebt(root, { title: 'nofile' });
  await addDebt(root, { title: 'empty but present', file: 'empty.mjs' });
  const closed = await addDebt(root, { title: 'closed', file: 'gone2.mjs' });
  await dropDebt(root, closed.entry.id, { reason: 'no longer true' });
  assert.deepEqual(ids(missingFileDebt(root)), ['gone']);
});

test('missingFileDebt resolves paths against the project root, never process.cwd()', async () => {
  const { missingFileDebt } = await import('../lib/debt.mjs');
  const root = project();
  mkdirSync(join(root, 'sub'));
  writeFileSync(join(root, 'keep.mjs'), 'x\n');
  await addDebt(root, { title: 'kept', file: 'keep.mjs' });
  const elsewhere = mkdtempSync(join(tmpdir(), 'ac-debt-elsewhere-'));
  const here = process.cwd();
  process.chdir(elsewhere);
  try {
    assert.deepEqual(missingFileDebt(root), []);
  } finally {
    process.chdir(here);
  }
});

test('staleDebt returns age hits and file-gone hits as a de-duplicated union', async () => {
  const { staleDebt } = await import('../lib/debt.mjs');
  const root = project();
  writeFileSync(join(root, 'old.mjs'), 'x\n');
  writeFileSync(join(root, 'new.mjs'), 'x\n');
  const longAgo = new Date(Date.now() - 90 * 86_400_000);
  await addDebt(root, { title: 'old but file exists', file: 'old.mjs', now: longAgo });
  await addDebt(root, { title: 'old and gone', file: 'old-gone.mjs', now: longAgo });
  await addDebt(root, { title: 'fresh and gone', file: 'fresh-gone.mjs' });
  await addDebt(root, { title: 'fresh and present', file: 'new.mjs' });
  const stale = staleDebt(root);
  assert.deepEqual(ids(stale), ['fresh and gone', 'old and gone', 'old but file exists']);
  assert.equal(new Set(stale.map((d) => d.id)).size, stale.length, 'no duplicates');
});
