// Phase 54 t12 (C13): the core/edge tag the criteria author is told to write is exactly the one the
// code reads. The test extracts the example block the contract prescribes and feeds it to `edgeIds`
// (ADR-018: dynamic import). Only the edge example is recognised; moving the tag into the claim text
// gives nothing; the contract asks for the tag before any plan exists and for the optional Cheap line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MD = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'astro-criteria-author.md'), 'utf8');

function exampleBlock() {
  const sec = MD.slice(MD.indexOf('Tag every criterion `[core]` or `[edge]`'));
  const m = /```\n([\s\S]*?)```/.exec(sec);
  assert.ok(m, 'the core/edge section has a fenced example block');
  return m[1];
}

test('the prescribed example block: only the [edge] heading is recognised as edge', async () => {
  const { edgeIds, criterionBlocks } = await import('../lib/impact.mjs');
  const block = exampleBlock();
  assert.equal(criterionBlocks(block).length, 2, 'the block has an edge and a core example');
  assert.deepEqual(edgeIds(block), ['C2']);
});

test('moving the tag into the claim text makes the example core', async () => {
  const { edgeIds } = await import('../lib/impact.mjs');
  const moved = exampleBlock().replace(/^### (C\d+) \[edge\] — /gm, '### $1 — [edge] ');
  assert.notEqual(moved, exampleBlock());
  assert.deepEqual(edgeIds(moved), []);
});

test('the contract asks for the tag before any plan exists, never on a suite criterion, and documents the Cheap line', async () => {
  const { cheapCommands } = await import('../lib/impact.mjs');
  assert.match(MD, /before any plan exists/);
  assert.match(MD, /Never tag a `\[suite\]` criterion `\[edge\]`/);
  assert.match(MD, /untagged or misplaced criterion is core/);
  const cheap = /```\n(- \*\*Cheap:\*\* [^\n]*)\n```/.exec(MD);
  assert.ok(cheap, 'the Cheap example is a fenced block');
  assert.equal(cheapCommands(`### C1 — x\n${cheap[1]}\n`).get('C1'), 'node scripts/check-c2.mjs');
});
