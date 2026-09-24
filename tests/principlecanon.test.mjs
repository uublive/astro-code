// Phase 25 t7 — spec for canon-clash candidates (lib/principlecanon.mjs), P6 of the
// phase plan. Real `mkdtempSync` roots with hand-written .astrocode/CONVENTIONS.md
// and .astrocode/DECISIONS.md (lib/decisions.mjs's exact entry format).
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// does not exist on this branch yet (t8 lands it in the same wave); a static import
// here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const CONVENTIONS = `# Conventions

## Naming

- Named function exports only, no default exports
- Files end in .mjs
`;

const DECISIONS = `## ADR-001 — Named exports only, never a default export
_2026-01-01_

**Why:** default exports rename silently at the import site.

## ADR-002 — Old rule about default exports
_2026-01-01_

**Why:** superseded reasoning.

**Status:** retired (2026-01-02) — superseded by ADR-001
`;

function tempRoot({ withPromotion } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'CONVENTIONS.md'), CONVENTIONS);
  writeFileSync(join(root, '.astrocode', 'DECISIONS.md'), withPromotion ? DECISIONS : DECISIONS);
  return root;
}

function entry(statement, over = {}) {
  return {
    id: 'e1', statement, promotions: [],
    ...over,
  };
}

test('candidate names live ADR and CONVENTIONS heading, never the retired ADR', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const items = canonItems(root);
  const e = entry('Use default exports for modules');
  const candidates = clashCandidates(e, items, { root, project: basename(root) });
  const refs = candidates.map((c) => c.ref);
  assert.ok(refs.includes('ADR-001'));
  assert.ok(refs.includes('CONVENTIONS §Naming'));
  assert.ok(!refs.includes('ADR-002'));
  for (const c of candidates) {
    assert.ok(c.shared.includes('default'));
    assert.ok(c.shared.includes('export'));
  }
});

test('unrelated statement yields no candidates', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const items = canonItems(root);
  const e = entry('Use metric units in reports');
  const candidates = clashCandidates(e, items, { root, project: basename(root) });
  assert.deepEqual(candidates, []);
});

test('a promotion into THIS project suppresses the clash', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const items = canonItems(root);
  const project = basename(root);
  const e = entry('Use default exports for modules', {
    promotions: [{ project, path: root, as: 'decision', ref: 'ADR-001' }],
  });
  const candidates = clashCandidates(e, items, { root, project });
  assert.deepEqual(candidates, []);
});

test('a promotion into a DIFFERENT project still flags', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const items = canonItems(root);
  const e = entry('Use default exports for modules', {
    promotions: [{ project: 'some-other-project', path: '/somewhere/else', as: 'decision', ref: 'ADR-001' }],
  });
  const candidates = clashCandidates(e, items, { root, project: basename(root) });
  assert.ok(candidates.length > 0);
});

test('no .astrocode/ ⇒ canonItems is []', async () => {
  const { canonItems } = await import('../lib/principlecanon.mjs');
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-none-'));
  assert.deepEqual(canonItems(root), []);
});

test('canon files are byte-identical afterwards (read-only)', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const before = {
    conv: readFileSync(join(root, '.astrocode', 'CONVENTIONS.md'), 'utf8'),
    dec: readFileSync(join(root, '.astrocode', 'DECISIONS.md'), 'utf8'),
  };
  const items = canonItems(root);
  clashCandidates(entry('Use default exports for modules'), items, { root, project: basename(root) });
  const after = {
    conv: readFileSync(join(root, '.astrocode', 'CONVENTIONS.md'), 'utf8'),
    dec: readFileSync(join(root, '.astrocode', 'DECISIONS.md'), 'utf8'),
  };
  assert.deepEqual(before, after);
});
