// Phase 18 t4 — spec for the decision-identity engine (lib/decisions.mjs).
// Pure unit tests, no git, no filesystem: these pin the normalization rules
// ADR-053 settled (dash-variant tolerance, date-stamp exclusion, strict
// equality only) so a future "improvement" that reintroduces fuzzy matching
// or over-broad stripping fails loudly here first.
//
// Reached via `await import(...)` inside each async test body per ADR-018 —
// the module already exists (t2), but this keeps the pattern uniform across
// the phase's test files and never risks a load-time crash if that changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function entry(id, { sep = ' — ', title = 'Some Title', date = '2026-01-01', why = 'because.' } = {}) {
  return `## ${id}${sep}${title}\n_${date}_\n\n**Why:** ${why}\n`;
}

test('em dash, en dash, plain hyphen and no separator all normalize to the same identity', async () => {
  const { sameDecision } = await import('../lib/decisions.mjs');

  const em = entry('ADR-100', { sep: ' — ' });
  const en = entry('ADR-101', { sep: ' – ' });
  const hyphen = entry('ADR-102', { sep: ' - ' });
  const none = entry('ADR-103', { sep: ' ' });

  assert.equal(sameDecision(em, en), true);
  assert.equal(sameDecision(em, hyphen), true);
  assert.equal(sameDecision(em, none), true);
  assert.equal(sameDecision(en, hyphen), true);
  assert.equal(sameDecision(hyphen, none), true);
});

test('a hyphen inside the title itself is preserved, not stripped by the separator fix', async () => {
  const { normalizeDecision, sameDecision } = await import('../lib/decisions.mjs');

  const emDashHeading = entry('ADR-142', { sep: ' — ', title: 'Multi-word Title' });
  const hyphenHeading = entry('ADR-143', { sep: ' - ', title: 'Multi-word Title' });

  assert.match(normalizeDecision(emDashHeading), /Multi-word Title/);
  assert.equal(sameDecision(emDashHeading, hyphenHeading), true);
});

test('two decisions with the same heading but a differing body are not the same', async () => {
  const { sameDecision } = await import('../lib/decisions.mjs');

  const a = entry('ADR-200', { why: 'because of reason A.' });
  const b = entry('ADR-201', { why: 'because of reason B.' });

  assert.equal(sameDecision(a, b), false);
});

test('two decisions with the same body but a differing title are not the same', async () => {
  const { sameDecision } = await import('../lib/decisions.mjs');

  const a = entry('ADR-210', { title: 'First Title' });
  const b = entry('ADR-211', { title: 'Second Title' });

  assert.equal(sameDecision(a, b), false);
});

test('a **Why:** line that merely looks like a date stamp is not eaten by the date-stamp rule', async () => {
  const { sameDecision } = await import('../lib/decisions.mjs');

  // The real `_date_` stamp comes first (right after the heading) and is the
  // one the rule must strip. A second, unrelated line further down that
  // happens to match the same `_YYYY-MM-DD_` shape lives inside the body and
  // must survive normalization intact — so two entries differing ONLY in
  // that embedded lookalike line must NOT be treated as the same decision.
  const a = `## ADR-300 — Some Title\n_2026-01-01_\n\n**Why:** see the note below.\n_2026-05-05_\nmore context.\n`;
  const b = `## ADR-301 — Some Title\n_2026-01-02_\n\n**Why:** see the note below.\n_2026-06-06_\nmore context.\n`;

  assert.equal(sameDecision(a, b), false);
});

test('findDuplicates reports an exact-match pair and stays silent on a near-duplicate pair', async () => {
  const { findDuplicates } = await import('../lib/decisions.mjs');

  const exactA = entry('ADR-005', { date: '2026-01-01' });
  const exactB = entry('ADR-010', { date: '2026-02-02' });
  const nearA = entry('ADR-020', { why: 'because of reason A.' });
  const nearB = entry('ADR-021', { why: 'because of reason B.' });

  const text = [exactA, exactB, nearA, nearB].join('\n');
  const dupes = findDuplicates(text);

  assert.equal(dupes.length, 1);
  assert.deepEqual(dupes[0].ids.sort(), ['ADR-005', 'ADR-010']);
});

test('collapseDuplicates keeps the lowest id and leaves near-duplicates untouched', async () => {
  const { collapseDuplicates } = await import('../lib/decisions.mjs');

  const exactA = entry('ADR-005', { date: '2026-01-01' });
  const exactB = entry('ADR-010', { date: '2026-02-02' });
  const nearA = entry('ADR-020', { why: 'because of reason A.' });
  const nearB = entry('ADR-021', { why: 'because of reason B.' });

  const text = [exactA, exactB, nearA, nearB].join('\n');
  const { text: collapsed, removed } = collapseDuplicates(text);

  assert.equal(removed.length, 1);
  assert.equal(removed[0].id, 'ADR-010');
  assert.equal(removed[0].keptId, 'ADR-005');

  assert.match(collapsed, /## ADR-005/);
  // #45/#36: the collapsed id stays as a stub pointing at the kept one — never a gap whose
  // number the next `decision add` would hand out again
  assert.match(collapsed, /## ADR-010 — .*\n\*\*Status:\*\* duplicate of ADR-005 \(\d{4}-\d{2}-\d{2}\)/);
  assert.equal((collapsed.match(/^## ADR-010/gm) || []).length, 1);
  assert.match(collapsed, /## ADR-020/);
  assert.match(collapsed, /## ADR-021/);
});
