// Fix 2026-10-23-ac-backlog-list-says-oldest-first-but: `ac backlog list` promises "oldest first"
// but sorted on the date-prefixed id, so ideas captured the same day came out in slug order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';
import { addBacklog, openBacklog } from '../lib/backlog.mjs';

test('ideas captured the same day list in capture order, oldest first', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ac-bl-order-'));
  initPlanning(root, { name: 'p' });
  // captured first, but its slug sorts last
  await addBacklog(root, { title: 'zebra crossing for the roadmap', now: new Date('2026-10-23T13:36:58.851Z') });
  await addBacklog(root, { title: 'apple of discord in the canon', now: new Date('2026-10-23T13:36:58.900Z') });
  assert.deepEqual(openBacklog(root).map((b) => b.title), ['zebra crossing for the roadmap', 'apple of discord in the canon']);
});
