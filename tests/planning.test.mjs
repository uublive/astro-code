// Unit tests for the discuss-gate classifier in lib/planning.mjs.
//
// Regression target: /astro-plan used to gate on mere PRESENCE of CONTEXT.md, so a
// hand-seeded stub (or a CONTEXT.md the planning side wrote itself) silently
// satisfied the gate and the discussion never happened. phaseContextStatus()
// distinguishes a genuine /astro-discuss capture (carries the provenance marker)
// from a stub, so the gate keys off substance, not existence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning, phaseContextStatus, CONTEXT_MARKER } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';

// Scaffold a throwaway project and return its root. initPlanning creates
// .astrocode/ with the phases/ dir so phaseContextStatus can resolve paths.
function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'ac-planning-'));
  initPlanning(root, { name: 'oracle', vision: 'test' });
  return root;
}

// Write a phase's CONTEXT.md with arbitrary body (creates the phase dir).
function writeContext(root, slug, body) {
  const dir = join(paths(root).phases, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CONTEXT.md'), body);
}

test('phaseContextStatus: no CONTEXT.md → "missing"', () => {
  const root = scaffold();
  assert.equal(phaseContextStatus(root, '04-oracle'), 'missing');
});

test('phaseContextStatus: CONTEXT.md without the marker → "stub" (the seeded-placeholder bug)', () => {
  const root = scaffold();
  // Exactly the failure mode: a plausible-looking CONTEXT.md that was never discussed.
  writeContext(root, '04-oracle', '# Phase 04 context\n\nSome decisions go here.\n');
  assert.equal(phaseContextStatus(root, '04-oracle'), 'stub');
});

test('phaseContextStatus: CONTEXT.md with the provenance marker → "ready"', () => {
  const root = scaffold();
  writeContext(root, '04-oracle', `${CONTEXT_MARKER}\n\n# Phase 04 context\n\nDiscussed decisions.\n`);
  assert.equal(phaseContextStatus(root, '04-oracle'), 'ready');
});

test('phaseContextStatus: marker is whitespace-tolerant and case-insensitive', () => {
  const root = scaffold();
  writeContext(root, '04-oracle', '<!--   Astro-Discuss:   captured   -->\n\nbody\n');
  assert.equal(phaseContextStatus(root, '04-oracle'), 'ready');
});

test('phaseContextStatus: an empty CONTEXT.md is a "stub", not "ready"', () => {
  const root = scaffold();
  writeContext(root, '04-oracle', '');
  assert.equal(phaseContextStatus(root, '04-oracle'), 'stub');
});
