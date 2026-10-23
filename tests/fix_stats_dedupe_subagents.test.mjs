// Fix 2026-10-23-ac-stats-double-counts-one-api-response (GitHub #152, #153): `ac stats` added the
// usage of every transcript line (Claude Code writes one API response as several lines sharing a
// message.id), and read only the top-level *.jsonl, skipping <session>/subagents/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const line = (id, ts, u) => JSON.stringify({ type: 'assistant', timestamp: ts, message: { id, usage: u } });
const U = (i, o, cc, cr) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: cc, cache_read_input_tokens: cr });

async function fixture({ subagent = false, differing = false } = {}) {
  const cfg = mkdtempSync(join(tmpdir(), 'ac-stats-cfg-'));
  const root = mkdtempSync(join(tmpdir(), 'ac-stats-proj-'));
  process.env.CLAUDE_CONFIG_DIR = cfg;
  const { transcriptDir } = await import('../lib/stats.mjs');
  const dir = transcriptDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'sess1.jsonl'), [
    JSON.stringify({ type: 'user', timestamp: '2026-10-20T10:00:00.000Z' }),
    line('msg_A', '2026-10-20T10:00:01.000Z', U(10, 100, 1000, 5000)),
    line('msg_A', '2026-10-20T10:00:02.000Z', differing ? U(10, 120, 1000, 5000) : U(10, 100, 1000, 5000)),
    line('msg_B', '2026-10-20T10:00:10.000Z', U(5, 50, 0, 6000)),
  ].join('\n') + '\n');
  if (subagent) {
    mkdirSync(join(dir, 'sess1', 'subagents'), { recursive: true });
    writeFileSync(join(dir, 'sess1', 'subagents', 'agent-a1.jsonl'), line('msg_S', '2026-10-20T10:01:00.000Z', U(20, 1000, 4000, 50000)) + '\n');
    writeFileSync(join(dir, 'sess1', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'astro-verifier' }));
  }
  return root;
}

test('#152: one API response is counted once, however many transcript lines carry it', async () => {
  const { collectStats } = await import('../lib/stats.mjs');
  const s = collectStats(await fixture());
  assert.deepEqual({ turns: s.turns, input: s.input, output: s.output, cacheCreate: s.cacheCreate, cacheRead: s.cacheRead },
    { turns: 2, input: 15, output: 150, cacheCreate: 1000, cacheRead: 11000 });
});

test('#152: when lines of one message.id differ, the last line\'s usage is the one counted', async () => {
  const { collectStats } = await import('../lib/stats.mjs');
  const s = collectStats(await fixture({ differing: true }));
  assert.equal(s.output, 170);
});

test('#153: subagent transcripts under <session>/subagents/ are counted, and the session filter keeps them', async () => {
  const { collectStats } = await import('../lib/stats.mjs');
  const root = await fixture({ subagent: true });
  const s = collectStats(root);
  assert.equal(s.output, 1150);
  assert.equal(s.cacheRead, 61000);
  assert.equal(s.turns, 3);
  assert.equal(collectStats(root, { session: 'sess1' }).output, 1150);
  assert.equal(collectStats(root, { session: 'other' }).output, 0);
});
