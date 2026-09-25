// Phase 25 t9 — spec for the usage log (lib/principleusage.mjs), P8 of the phase
// plan. Real `mkdtempSync` store dirs, no git.
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// does not exist on this branch yet (t10 lands it in the same wave); a static
// import here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'astro-usage-'));
}

test('usageFile ends in .local/usage.jsonl', async () => {
  const { usageFile } = await import('../lib/principleusage.mjs');
  const dir = tempDir();
  assert.ok(usageFile(dir).endsWith(join('.local', 'usage.jsonl')));
});

test('20 concurrent recordUsage calls yield 20 well-formed lines, no statement text', async () => {
  const { usageFile, recordUsage } = await import('../lib/principleusage.mjs');
  const dir = tempDir();
  await Promise.all(Array.from({ length: 20 }, (_, i) => recordUsage(dir, [
    { event: 'served', id: `p${i}`, by: 'cli', stage: 'execute', project: 'proj' },
  ])));
  const lines = readFileSync(usageFile(dir), 'utf8').trim().split('\n');
  assert.equal(lines.length, 20);
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.ok(obj.at);
    assert.ok(obj.event);
    assert.ok(obj.id);
    assert.ok(obj.by);
    assert.ok(obj.stage);
    assert.ok(obj.project);
    assert.ok(!('statement' in obj));
  }
});

test('a garbage line is skipped and counted', async () => {
  const { usageFile, recordUsage, readUsage } = await import('../lib/principleusage.mjs');
  const dir = tempDir();
  await recordUsage(dir, [{ event: 'served', id: 'p1', by: 'cli', stage: 'execute', project: 'proj' }]);
  const file = usageFile(dir);
  const existing = readFileSync(file, 'utf8');
  writeFileSync(file, existing + 'not json\n');
  const { events, ignored } = readUsage(dir);
  assert.equal(events.length, 1);
  assert.equal(ignored, 1);
});

test('usageReport: ignored = served >= 2 and never cited, unused = never served', async () => {
  const { recordUsage, readUsage, usageReport, IGNORED_MIN_SERVES } = await import('../lib/principleusage.mjs');
  const dir = tempDir();
  await recordUsage(dir, [
    { event: 'served', id: 'U1', by: 'cli', stage: 'execute', project: 'proj' },
    { event: 'served', id: 'U1', by: 'cli', stage: 'execute', project: 'proj' },
    { event: 'cited', id: 'U1', by: 'cli', stage: 'execute', project: 'proj' },
    { event: 'served', id: 'U2', by: 'cli', stage: 'execute', project: 'proj' },
    { event: 'served', id: 'U2', by: 'cli', stage: 'execute', project: 'proj' },
  ]);
  const { events } = readUsage(dir);
  const accepted = [{ id: 'U1' }, { id: 'U2' }, { id: 'U3' }];
  const report = usageReport(accepted, events);
  assert.ok(IGNORED_MIN_SERVES >= 2);
  const ignoredIds = report.ignored.map((r) => r.id);
  assert.deepEqual(ignoredIds, ['U2']);
  assert.equal(report.ignored[0].served, 2);
  const unusedIds = report.unused.map((r) => r.id);
  assert.deepEqual(unusedIds, ['U3']);
  assert.ok(!ignoredIds.includes('U1'));
  assert.ok(!unusedIds.includes('U1'));
});

test('recordUsage on an absent dir with [] events creates nothing', async () => {
  const { recordUsage } = await import('../lib/principleusage.mjs');
  const dir = join(tmpdir(), 'astro-usage-absent-' + Math.random().toString(36).slice(2));
  await recordUsage(dir, []);
  assert.ok(!existsSync(dir));
});
