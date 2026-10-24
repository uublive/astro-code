// D-NNN entry ids parse everywhere ADR-NNN does, from one exported pattern (phase 53, ADR-087).
// Dynamic import: the new `ENTRY_ID` export must not crash module load while absent (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const dec = () => import('../lib/decisions.mjs');

const LOG = [
  '# Decisions',
  '',
  '## ADR-0003 — Mirror thing',
  '_2026-01-01_',
  '**Why:** a',
  '',
  '## D-001 — Old series',
  '_2026-01-02_',
  '**Why:** b',
  '',
  '## ADR-0004 — After',
  '**Why:** c',
  '',
].join('\n');

test('a D-NNN heading starts its own entry and is not swallowed by the previous one', async () => {
  const { parseDecisionEntries, ENTRY_ID } = await dec();
  assert.equal(ENTRY_ID, '(?:ADR|D)-\\d+');
  const e = parseDecisionEntries(LOG);
  assert.deepEqual(e.map((x) => x.id), ['ADR-0003', 'D-001', 'ADR-0004']);
  assert.ok(!e[0].text.includes('D-001'));
});

test('parseDecisions keys D-001 and ADR-0003 entries side by side', async () => {
  const { parseDecisions } = await dec();
  assert.deepEqual([...parseDecisions(LOG).keys()], ['ADR-0003', 'D-001', 'ADR-0004']);
});

test('normalizeDecision and decisionTitle strip a D- heading id like an ADR- one, so sameDecision converges `## ADR-003 — X` and `## ADR-0003 — X`', async () => {
  const { normalizeDecision, decisionTitle, sameDecision } = await dec();
  assert.equal(decisionTitle('## D-007 — Hello'), 'Hello');
  assert.equal(normalizeDecision('## D-007 — Hello\nbody'), 'Hello body');
  assert.ok(sameDecision('## ADR-003 — X\nb', '## ADR-0003 — X\nb'));
  assert.ok(sameDecision('## D-003 — X\nb', '## ADR-0003 — X\nb'));
});

test('inForceText keeps D- entries and stubs a superseded D- entry', async () => {
  const { inForceText } = await dec();
  const t = [
    '# P', '',
    '## D-001 — Keep', 'x', '',
    '## D-002 — Gone', 'y', '**Status:** superseded by D-001 (2026-01-01)', '',
  ].join('\n');
  const out = inForceText(t);
  assert.match(out, /## D-001 — Keep/);
  assert.match(out, /- D-002 — Gone · superseded by D-001/);
  assert.ok(!out.includes('## D-002'));
});

test('decisionStatus reads `superseded by D-002` and `duplicate of D-002`', async () => {
  const { decisionStatus } = await dec();
  assert.equal(decisionStatus('## D-1 — a\n**Status:** superseded by D-002 (2026-01-01)').by, 'D-002');
  assert.equal(decisionStatus('## D-1 — a\n**Status:** duplicate of D-002 (2026-01-01)').by, 'D-002');
});

test('a log with only ADR-NNN headings parses byte-identically to before', async () => {
  const { parseDecisionEntries, inForceText } = await dec();
  const t = '# P\n\n## ADR-001 — A\nx\n\n## ADR-002 — B\ny\n';
  assert.deepEqual(parseDecisionEntries(t), [
    { id: 'ADR-001', text: '## ADR-001 — A\nx' },
    { id: 'ADR-002', text: '## ADR-002 — B\ny' },
  ]);
  assert.equal(inForceText(t), '# P\n\n## ADR-001 — A\nx\n\n## ADR-002 — B\ny\n');
});
