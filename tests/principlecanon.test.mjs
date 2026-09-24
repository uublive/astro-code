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

test('a preamble line before any ## heading is never turned into a canon item (no "CONVENTIONS §" with no section name)', async () => {
  const { canonItems } = await import('../lib/principlecanon.mjs');
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(
    join(root, '.astrocode', 'CONVENTIONS.md'),
    `# Conventions\n\n> The rules new code MUST follow.\n\n## Naming\n\n- Named function exports only, no default exports\n`,
  );
  writeFileSync(join(root, '.astrocode', 'DECISIONS.md'), DECISIONS);
  const items = canonItems(root);
  assert.ok(!items.some((i) => i.ref === 'CONVENTIONS §'), 'a preamble bullet must not produce a headingless ref');
});

test('a long canon paragraph sharing only two generic, low-signal words with an unrelated principle is not flagged (ratio guard)', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(
    join(root, '.astrocode', 'CONVENTIONS.md'),
    '# Conventions\n\n## Process\n\n'
      + '- Keep pull requests small, reviewers read every diff line by line and leave notes '
      + 'inline, then the author addresses each one before merge and the branch is deleted '
      + 'once the pipeline goes green across every stage\n',
  );
  writeFileSync(join(root, '.astrocode', 'DECISIONS.md'), '');
  const items = canonItems(root);
  const e = entry('Read the existing code before touching anything');
  const candidates = clashCandidates(e, items, { root, project: basename(root) });
  assert.deepEqual(candidates, []);
});

test('three words shared with a long ADR title is still too thin a slice of that title to flag', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'CONVENTIONS.md'), '# Conventions\n\n## Naming\n\n- Files end in .mjs\n');
  writeFileSync(
    join(root, '.astrocode', 'DECISIONS.md'),
    "## ADR-037 — ADR-034's canon-pull rescue anchors to true end-of-input so a preserved ADR "
      + 'keeps its body, not just its heading; the discuss gate accepts ADR-035\'s agent marker '
      + 'as well as the human one and exposes contextAuthor(); and every remaining haiku '
      + "recommendation is purged from the agent-facing docs the ADR-035 revert missed.\n"
      + '_2026-01-01_\n\n**Why:** narrows a rescue path and drops stale guidance.\n',
  );
  const items = canonItems(root);
  const e = entry('Keep pull requests small, one concern each');
  const candidates = clashCandidates(e, items, { root, project: basename(root) });
  assert.deepEqual(candidates, []);
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

// Phase 25 verify, C7 — the fresh-template false positives, the basename collision and
// the doubled ref, each pinned.
function rootWith(conventions) {
  const root = mkdtempSync(join(tmpdir(), 'astro-canon-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'CONVENTIONS.md'), conventions);
  return root;
}

test('an unfilled template (label-only bullets, wrapped Voice prose) flags no ordinary principle', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const template = readFileSync(new URL('../templates/CONVENTIONS.md', import.meta.url), 'utf8');
  const root = rootWith(template);
  const items = canonItems(root);
  for (const statement of [
    'Cover error handling paths with tests',
    'Load config and secrets from the environment',
    'Pin the language runtime version in CI',
    'Name test files after the module they cover',
    'Keep functions short',
    'Status messages should be one line',
    'ZEBRAMULTI first sentence here. Second sentence follows.',
  ]) {
    assert.deepEqual(clashCandidates({ id: 'x', statement, promotions: [] }, items, { root }), [], statement);
  }
});

test('a promotion into a different project with the SAME basename still flags', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = tempRoot();
  const items = canonItems(root);
  const e = {
    id: 'e1', statement: 'Use default exports for modules',
    promotions: [{ project: basename(root), path: '/elsewhere/' + basename(root), as: 'decision', ref: 'ADR-001' }],
  };
  assert.ok(clashCandidates(e, items, { root }).length > 0, 'a shared directory name is not the same project');
});

test('several bullets in one section yield that section once', async () => {
  const { canonItems, clashCandidates } = await import('../lib/principlecanon.mjs');
  const root = rootWith('# C\n\n## Naming\n\n- Named function exports only\n- Default exports are banned in modules\n');
  const refs = clashCandidates({ id: 'x', statement: 'Use default exports for modules', promotions: [] }, canonItems(root), { root })
    .map((c) => c.ref);
  assert.deepEqual(refs, [...new Set(refs)]);
  assert.deepEqual(refs, ['CONVENTIONS §Naming']);
});
