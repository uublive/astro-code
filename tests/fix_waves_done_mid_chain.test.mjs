// Fix 2026-11-09-a-done-task-mid-chain-makes-its (GitHub #187): in a strictly serial chain, a task
// marked done in the middle (stamps landed out of order after a heal) made its dependents ready at
// once, alongside the true head of the chain — so a 38-task chain got waves 3 wide and `auto` chose
// `parallel`. A done task now stands in for its own pending predecessors.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const chain = (n, done) => Array.from({ length: n }, (_, i) => ({
  id: `rb${i + 1}`, file: `src/f${i + 1}.mjs`, done: done.has(`rb${i + 1}`), depends_on: i ? [`rb${i}`] : [],
}));
const call = (tasks, buildWaves) => {
  const pre = new Set(tasks.filter((t) => t.done).map((t) => t.id));
  const doneDeps = new Map(tasks.filter((t) => t.done).map((t) => [t.id, t.depends_on]));
  return buildWaves(tasks.filter((t) => !t.done), pre, doneDeps);
};

test('#187: the issue\'s 38-task chain with rb1, rb2, rb17, rb19 done stays one task per wave, in chain order', async () => {
  const { buildWaves } = await import('../lib/waves.mjs');
  const { waves } = call(chain(38, new Set(['rb1', 'rb2', 'rb17', 'rb19'])), buildWaves);
  assert.deepEqual(waves.map((w) => w.length), Array(34).fill(1), 'every wave holds one task');
  const order = waves.flat().map((t) => t.id);
  const expected = chain(38, new Set()).map((t) => t.id).filter((id) => !['rb1', 'rb2', 'rb17', 'rb19'].includes(id));
  assert.deepEqual(order, expected, 'rb18 waits for rb16, rb20 waits for rb18');
});

test('#187: a done task whose predecessors are all done still satisfies its dependents at once', async () => {
  const { buildWaves } = await import('../lib/waves.mjs');
  const { waves } = call(chain(5, new Set(['rb1', 'rb2'])), buildWaves);
  assert.equal(waves[0][0].id, 'rb3');
  assert.deepEqual(waves.map((w) => w.length), [1, 1, 1]);
});

test('#187: without the done map the old behaviour is unchanged (existing callers)', async () => {
  const { buildWaves } = await import('../lib/waves.mjs');
  const tasks = chain(5, new Set(['rb3']));
  const { waves } = buildWaves(tasks.filter((t) => !t.done), new Set(['rb3']));
  assert.deepEqual(waves[0].map((t) => t.id).sort(), ['rb1', 'rb4']);
});
