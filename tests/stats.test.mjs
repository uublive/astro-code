// collectStats reads token usage + wall-clock from Claude Code transcripts. Runs
// against a throwaway CLAUDE_CONFIG_DIR so it never touches real session history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = '/tmp/demo/proj';

function seed() {
  const cfg = mkdtempSync(join(tmpdir(), 'ac-cfg-'));
  const dir = join(cfg, 'projects', ROOT.replaceAll('/', '-'));
  mkdirSync(dir, { recursive: true });
  const lines = [
    JSON.stringify({ timestamp: '2026-06-01T10:00:00.000Z', message: { usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 200, cache_read_input_tokens: 1000 } } }),
    JSON.stringify({ timestamp: '2026-06-01T10:01:40.000Z', message: { usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 3000 } } }),
    'not json — skipped',
  ].join('\n');
  writeFileSync(join(dir, 'sess.jsonl'), lines);
  return cfg;
}

async function withCfg(cfg, fn) {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = cfg;
  try {
    return await fn(await import(`../lib/stats.mjs?c=${encodeURIComponent(cfg)}`));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prev;
  }
}

test('collectStats sums usage, separates cache reads, computes wall-clock', async () => {
  await withCfg(seed(), ({ collectStats }) => {
    const s = collectStats(ROOT);
    assert.equal(s.available, true);
    assert.equal(s.turns, 2);
    assert.equal(s.output, 70);
    assert.equal(s.input, 110);
    assert.equal(s.cacheCreate, 200);
    assert.equal(s.cacheRead, 4000);
    assert.equal(s.fresh, 310); // input + cache-creation
    assert.equal(s.wallMs, 100_000); // 100s between the two timestamps
    assert.ok(s.cacheHitRatio > 0.9); // 4000 / (110 + 200 + 4000)
  });
});

test('collectStats --since windows out earlier turns', async () => {
  await withCfg(seed(), ({ collectStats }) => {
    const s = collectStats(ROOT, { since: '2026-06-01T10:01:00.000Z' });
    assert.equal(s.turns, 1); // only the 10:01:40 turn
    assert.equal(s.output, 20);
    assert.equal(s.cacheRead, 3000);
  });
});

test('collectStats reports unavailable when the project has no transcripts', async () => {
  await withCfg(mkdtempSync(join(tmpdir(), 'ac-cfg-')), ({ collectStats }) => {
    assert.equal(collectStats(ROOT).available, false);
  });
});
