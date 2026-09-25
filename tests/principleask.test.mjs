// Phase 25 t5 — spec for `ask` ranking (lib/principleask.mjs), P7 of the phase plan.
// Pure unit tests, C5's fixture: no fs, no git, no network.
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// does not exist on this branch yet (t6 lands it in the same wave); a static import
// here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function entry(id, over = {}) {
  return {
    id, kind: 'convention', strength: 'default', status: 'accepted',
    statement: 'placeholder', why: '', scopes: { stack: [], files: [], work: [] },
    promotions: [], history: [],
    ...over,
  };
}

function fixture() {
  return [
    entry('X', {
      statement: 'Always wrap filesystem mutations in a lock',
      why: 'A concurrency bug corrupted the store when two writers raced.',
      scopes: { stack: ['node'], files: [], work: [] },
    }),
    entry('Y', { statement: 'Prefer named exports over default exports' }),
    entry('Z', { statement: 'Use metric units in reports' }),
    entry('W', {
      status: 'proposed',
      statement: 'How should I guard concurrent filesystem writes',
      why: 'how should I guard concurrent filesystem writes',
    }),
  ];
}

test('question about concurrent filesystem writes ranks X first, explains matches', async () => {
  const { rankPrinciples } = await import('../lib/principleask.mjs');
  const results = rankPrinciples(fixture(), 'how should I guard concurrent filesystem writes', { stack: [] });
  assert.equal(results[0].id, 'X');
  for (const r of results) assert.ok(r.matched.length > 0);
  const ids = results.map((r) => r.id);
  assert.ok(!ids.includes('Z'));
  assert.ok(!ids.includes('W'));
  const fsMatch = results[0].matched.find((m) => m.term === 'filesystem' && m.field === 'statement');
  assert.ok(fsMatch);
  const concMatch = results[0].matched.find((m) => m.field === 'why' && m.entryTerm === 'concurrency');
  assert.ok(concMatch);
});

test('nonsense question returns no results', async () => {
  const { rankPrinciples } = await import('../lib/principleask.mjs');
  const results = rankPrinciples(fixture(), 'quantum chromodynamics', { stack: [] });
  assert.deepEqual(results, []);
});

test('question-stopword-only question returns no results', async () => {
  const { rankPrinciples } = await import('../lib/principleask.mjs');
  const results = rankPrinciples(fixture(), 'how should I', { stack: [] });
  assert.deepEqual(results, []);
});

test('scope hits reported when entry stack in ctx tags', async () => {
  const { rankPrinciples } = await import('../lib/principleask.mjs');
  const results = rankPrinciples(fixture(), 'filesystem lock', { stack: ['node'] });
  const x = results.find((r) => r.id === 'X');
  assert.ok(x.scopeHits.includes('node'));
});

test('renderAsk of empty results says no match', async () => {
  const { renderAsk } = await import('../lib/principleask.mjs');
  const text = renderAsk([], 'quantum chromodynamics');
  assert.ok(text.includes('no principles match'));
  assert.ok(text.includes('quantum chromodynamics'));
});

test('renderAsk caps at ASK_MAX with a +N more line', async () => {
  const { rankPrinciples, renderAsk, ASK_MAX } = await import('../lib/principleask.mjs');
  const many = [];
  for (let i = 0; i < ASK_MAX + 5; i++) {
    many.push(entry(`M${i}`, { statement: 'filesystem lock statement number ' + i }));
  }
  const results = rankPrinciples(many, 'filesystem lock', { stack: [] });
  const text = renderAsk(results, 'filesystem lock');
  assert.ok(text.includes(`+${results.length - ASK_MAX} more`));
});

test('two runs are deep-equal (deterministic)', async () => {
  const { rankPrinciples } = await import('../lib/principleask.mjs');
  const a = rankPrinciples(fixture(), 'concurrent filesystem writes', { stack: ['node'] });
  const b = rankPrinciples(fixture(), 'concurrent filesystem writes', { stack: ['node'] });
  assert.deepEqual(a, b);
});
