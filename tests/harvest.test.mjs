// Milestone harvest (P5, phase 23) — the read-only material `ac milestone harvest` and
// `/astro-complete-milestone`'s sweep (D2.4) draw on: ADRs opened since the previous close,
// human CONTEXT.md briefs, human rejection reasons, and surprise notes, all scoped to ONE
// milestone (never the whole project history — C9 fails on that).
//
// ADR-018: `lib/harvest.mjs` does not exist on this branch yet (this is the RED half of a
// paired wave with t6). Every test reaches `milestoneHarvest` only through a dynamic import
// inside its own async body, so the missing export fails just that test at call time rather
// than crashing the whole file at module load. The fixture writers it drives
// (`initPlanning`, `addPhase`, `rejectPhase`, `recordSurprise`, `completeMilestone`,
// `setMilestone`, `setPhaseStatus`) are already on the branch (phase 23 t2/t4 and earlier),
// so those stay static imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initPlanning } from '../lib/planning.mjs';
import { addPhase, rejectPhase, setPhaseStatus, setMilestone } from '../lib/roadmap.mjs';
import { recordSurprise } from '../lib/surprises.mjs';
import { completeMilestone } from '../lib/milestone.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON, atomicWriteJSON } from '../lib/util.mjs';

async function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'ac-harvest-'));
  initPlanning(root, { name: 'harvest' });
  return root;
}

function writeContext(root, slug, { agent } = {}) {
  const marker = agent
    ? `<!-- astro-discuss: captured by agent: ${agent} -->`
    : '<!-- astro-discuss: captured -->';
  writeFileSync(join(paths(root).phases, slug, 'CONTEXT.md'), `${marker}\n\n# Discussion\n\nsome content\n`);
}

function writeStubContext(root, slug) {
  writeFileSync(join(paths(root).phases, slug, 'CONTEXT.md'), '# Discussion\n\nnot really discussed yet\n');
}

// Builds a `.astrocode/milestones/<m>/roadmap.json` snapshot BY HAND rather than through
// `completeMilestone` (whose `closed_at` stamp is t6's job, not this RED file's), so the
// ADR-window scenarios can control `closed_at`/`accepted_at` independently.
function archiveManually(root, m, { closedAt, phases = [] } = {}) {
  const archiveDir = join(paths(root).dir, 'milestones', String(m));
  mkdirSync(join(archiveDir, 'phases'), { recursive: true });
  const snapshot = { version: 1, milestone: m, phases };
  if (closedAt) snapshot.closed_at = closedAt;
  atomicWriteJSON(join(archiveDir, 'roadmap.json'), snapshot);
}

function adrEntry(id, title, date, why, statusLine) {
  return (
    `## ${id} — ${title}\n_${date}_\n\n**Why:** ${why}\n` + (statusLine ? `\n${statusLine}\n` : '')
  );
}

function writeDecisions(root, entries) {
  writeFileSync(
    paths(root).decisions,
    '# Decisions — harvest\n\n' + entries.join('\n\n') + '\n',
  );
}

// --- live scoping ---

test('milestoneHarvest: a later-milestone phase is never read', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const a = await addPhase(root, { number: 1, name: 'in milestone one', milestone: 1 });
  writeContext(root, a.slug);

  const b = await addPhase(root, { number: 2, name: 'in milestone two', milestone: 2 });
  writeContext(root, b.slug);
  await rejectPhase(root, b.slug, { reason: 'not this milestone' });
  await recordSurprise(root, b.slug, { healed: 1, note: 'future phase surprise' });

  const result = await milestoneHarvest(root, 1);

  assert.equal(result.source, 'live');
  assert.ok(!result.contexts.some((c) => c.phase === b.slug), 'later-milestone CONTEXT must be absent');
  assert.ok(!result.rejections.some((r) => r.phase === b.slug), 'later-milestone rejection must be absent');
  assert.ok(!result.surprises.some((s) => s.phase === b.slug), 'later-milestone surprise must be absent');
});

test('milestoneHarvest: human CONTEXT is included, agent CONTEXT is excluded and counted, a stub is ignored', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const human = await addPhase(root, { number: 1, name: 'human discussed', milestone: 1 });
  writeContext(root, human.slug);
  const agent = await addPhase(root, { number: 2, name: 'agent discussed', milestone: 1 });
  writeContext(root, agent.slug, { agent: 'bot' });
  const stub = await addPhase(root, { number: 3, name: 'stub only', milestone: 1 });
  writeStubContext(root, stub.slug);

  const result = await milestoneHarvest(root, 1);

  assert.deepEqual(result.contexts.map((c) => c.phase), [human.slug]);
  assert.equal(result.skipped.agentContexts, 1);
});

test('milestoneHarvest: a human rejection of a phase later accepted still comes back with its reason', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const ph = await addPhase(root, { number: 1, name: 'rejected then accepted', milestone: 1 });
  await rejectPhase(root, ph.slug, { reason: 'checklist item skipped' });
  await setPhaseStatus(root, ph.slug, 'complete', { accepted_by: 'me', accepted_kind: 'human', accepted_at: new Date().toISOString() });

  const result = await milestoneHarvest(root, 1);

  assert.equal(result.rejections.length, 1);
  assert.equal(result.rejections[0].phase, ph.slug);
  assert.equal(result.rejections[0].reason, 'checklist item skipped');
});

test('milestoneHarvest: an agent-signed rejection is excluded and counted', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const ph = await addPhase(root, { number: 1, name: 'agent rejected', milestone: 1 });
  await rejectPhase(root, ph.slug, { reason: 'stale base', agent: 'bot' });

  const result = await milestoneHarvest(root, 1);

  assert.equal(result.rejections.length, 0);
  assert.equal(result.skipped.agentRejections, 1);
});

test('milestoneHarvest: surprises come back with their signals', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const ph = await addPhase(root, { number: 1, name: 'surprising phase', milestone: 1 });
  await recordSurprise(root, ph.slug, { healed: 2, note: 'the heal trap', now: '2026-01-02T00:00:00.000Z' });

  const result = await milestoneHarvest(root, 1);

  assert.equal(result.surprises.length, 1);
  assert.equal(result.surprises[0].phase, ph.slug);
  assert.deepEqual(result.surprises[0].signals, ['healed']);
  assert.equal(result.surprises[0].note, 'the heal trap');
});

// --- after close: source flips to archive, closed_at is on the snapshot ---

test('milestoneHarvest: after completeMilestone the same material comes back with source:"archive", and the snapshot carries closed_at', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  const ph = await addPhase(root, { number: 1, name: 'closed phase', milestone: 1 });
  writeContext(root, ph.slug);
  await rejectPhase(root, ph.slug, { reason: 'first pass rejected' });
  await recordSurprise(root, ph.slug, { healed: 1, note: 'closed-milestone surprise' });
  await setPhaseStatus(root, ph.slug, 'complete', { accepted_by: 'me', accepted_kind: 'human', accepted_at: new Date().toISOString() });

  await completeMilestone(root);

  const snapshot = readJSON(join(paths(root).dir, 'milestones', '1', 'roadmap.json'));
  assert.ok(snapshot.closed_at, 'completeMilestone must stamp closed_at on the snapshot it writes');

  const result = await milestoneHarvest(root, 1);
  assert.equal(result.source, 'archive');
  assert.equal(result.contexts.length, 1);
  assert.equal(result.rejections.length, 1);
  assert.equal(result.surprises.length, 1);
});

// --- ADR window ---

test('milestoneHarvest: no earlier archive — the window is open and every in-force ADR is in it', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  writeDecisions(root, [
    adrEntry('ADR-001', 'first decision', '2026-01-01', 'because'),
    adrEntry('ADR-002', 'second decision', '2026-02-01', 'also because'),
  ]);

  const result = await milestoneHarvest(root, 1);

  assert.equal(result.adrWindow.since, null);
  assert.deepEqual(result.adrs.map((a) => a.id).sort(), ['ADR-001', 'ADR-002']);
});

test('milestoneHarvest: an earlier archive with closed_at — only ADRs dated on or after it are in the window', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  archiveManually(root, 1, { closedAt: '2026-02-01T00:00:00.000Z', phases: [] });
  await setMilestone(root, 2);
  writeDecisions(root, [
    adrEntry('ADR-001', 'too early', '2026-01-15', 'before the close'),
    adrEntry('ADR-002', 'right on the boundary', '2026-02-01', 'on the close day'),
    adrEntry('ADR-003', 'clearly after', '2026-03-01', 'after the close'),
  ]);

  const result = await milestoneHarvest(root, 2);

  assert.equal(result.adrWindow.since, '2026-02-01');
  assert.deepEqual(result.adrs.map((a) => a.id).sort(), ['ADR-002', 'ADR-003']);
});

test('milestoneHarvest: an earlier archive with only a phase accepted_at falls back to it', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  archiveManually(root, 1, {
    phases: [
      { number: 1, name: 'p', slug: '01-p', status: 'complete', milestone: 1, accepted_at: '2026-02-10T00:00:00.000Z' },
    ],
  });
  await setMilestone(root, 2);
  writeDecisions(root, [
    adrEntry('ADR-001', 'too early', '2026-01-01', 'before'),
    adrEntry('ADR-002', 'after the fallback date', '2026-02-15', 'after'),
  ]);

  const result = await milestoneHarvest(root, 2);

  assert.equal(result.adrWindow.since, '2026-02-10');
  assert.deepEqual(result.adrs.map((a) => a.id), ['ADR-002']);
});

test('milestoneHarvest: an earlier archive with neither closed_at nor any accepted_at reports the window as unknown, not empty-since', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  archiveManually(root, 1, {
    phases: [{ number: 1, name: 'p', slug: '01-p', status: 'complete', milestone: 1 }],
  });
  await setMilestone(root, 2);
  writeDecisions(root, [adrEntry('ADR-001', 'irrelevant', '2026-01-01', 'because')]);

  const result = await milestoneHarvest(root, 2);

  assert.equal(result.adrWindow, null, 'ADR-043/054: unknown must never be reported as empty');
  assert.deepEqual(result.adrs, []);
});

test('milestoneHarvest: a superseded ADR inside the window is excluded', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();
  writeDecisions(root, [
    adrEntry('ADR-001', 'still live', '2026-01-01', 'because'),
    adrEntry(
      'ADR-002',
      'superseded decision',
      '2026-01-02',
      'because, once',
      '**Status:** superseded by ADR-003 (2026-01-10) — replaced',
    ),
    adrEntry('ADR-003', 'the replacement', '2026-01-10', 'the better version'),
  ]);

  const result = await milestoneHarvest(root, 1);

  assert.deepEqual(result.adrs.map((a) => a.id).sort(), ['ADR-001', 'ADR-003']);
});

// C9 remediation: `closed_at`/`decisionDate` are both day-granular (DECISIONS.md never
// records a time), so an ADR added just before one milestone's close and another added
// just after — on the SAME calendar day — used to both land inside (or both fall outside)
// the date-only window. `completeMilestone` now stamps `adr_watermark` (lib/milestone.mjs)
// and `resolveSince` compares by ADR NUMBER when it is present, which is immune to the
// same-day ambiguity a pure date range cannot resolve.
test('milestoneHarvest: an ADR added right after a same-day close never leaks into the PRIOR milestone, and vice versa', async () => {
  const { addDecision } = await import('../lib/canon.mjs');
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();

  await addDecision(root, { title: 'Use plain files for state', why: 'simple and diffable' });
  await completeMilestone(root);
  await setMilestone(root, 2);
  await addDecision(root, { title: 'Second decision', why: 'same-day follow-up' });
  await completeMilestone(root);

  const milestone2 = await milestoneHarvest(root, 2);
  assert.deepEqual(
    milestone2.adrs.map((a) => a.title),
    ['Second decision'],
    'ADR-001 belongs to milestone 1 and must not leak into milestone 2\'s same-day harvest',
  );

  const milestone1 = await milestoneHarvest(root, 1);
  assert.deepEqual(
    milestone1.adrs.map((a) => a.title),
    ['Use plain files for state'],
    'ADR-002 belongs to milestone 2 and must not leak into milestone 1\'s archived harvest',
  );
});

test('milestoneHarvest: an unknown milestone — neither current nor archived — throws', async () => {
  const { milestoneHarvest } = await import('../lib/harvest.mjs');
  const root = await scaffold();

  await assert.rejects(() => milestoneHarvest(root, 999), /milestone 999|neither current nor archived/i);
});
