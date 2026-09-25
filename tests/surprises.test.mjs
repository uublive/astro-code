// Surprise-note engine (P3, D3) — /astro-execute records a short note when a run hits a
// signal (healed something, needed remediation, or stopped without finishing) and proposes
// nothing itself; the milestone-close sweep (phase 23 D2.4, lib/harvest.mjs) is the only
// reader that can see recurrence across phases.
//
// ADR-018: lib/surprises.mjs does not exist on this branch yet (this is the RED half of a
// paired wave with t2). Every test dynamically imports it inside its own async body so a
// missing export fails only these tests at call time, not the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase } from '../lib/roadmap.mjs';
import { paths } from '../lib/paths.mjs';

async function scratchPhase() {
  const root = mkdtempSync(join(tmpdir(), 'ac-surprises-'));
  initPlanning(root, { name: 'surprises' });
  const ph = await addPhase(root, { number: 1, name: 'a phase', milestone: 1 });
  return { root, slug: ph.slug, dir: join(paths(root).phases, ph.slug) };
}

// --- surpriseSignals: pure signal mapping ---

test('surpriseSignals: a healed count > 0 signals "healed"', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ healed: 2 }), ['healed']);
});

test('surpriseSignals: a healed array signals "healed" too', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ healed: ['t3'] }), ['healed']);
});

test('surpriseSignals: remediationCycles > 0 signals "remediation"', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ remediationCycles: 1 }), ['remediation']);
});

test('surpriseSignals: stoppedReason "no-progress" signals "no-progress"', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ stoppedReason: 'no-progress' }), ['no-progress']);
});

test('surpriseSignals: stoppedReason "max-cycles" signals "max-cycles"', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ stoppedReason: 'max-cycles' }), ['max-cycles']);
});

test('surpriseSignals: any other stoppedReason is not a signal', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ stoppedReason: 'no-tasks' }), []);
  assert.deepEqual(surpriseSignals({ stoppedReason: null }), []);
  assert.deepEqual(surpriseSignals({ stoppedReason: undefined }), []);
});

test('surpriseSignals: a clean run (no healed, no remediation, no stop signal) is []', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(surpriseSignals({ healed: 0, remediationCycles: 0, stoppedReason: null }), []);
  assert.deepEqual(surpriseSignals({ healed: [], remediationCycles: 0 }), []);
  assert.deepEqual(surpriseSignals({}), []);
});

test('surpriseSignals: multiple signals come back in a fixed order — healed, remediation, no-progress, max-cycles', async () => {
  const { surpriseSignals } = await import('../lib/surprises.mjs');
  assert.deepEqual(
    surpriseSignals({ healed: 1, remediationCycles: 1, stoppedReason: 'max-cycles' }),
    ['healed', 'remediation', 'max-cycles'],
  );
});

// --- recordSurprise: the writer ---

test('recordSurprise: a clean run writes nothing — {written:false} and the phase dir is unchanged', async () => {
  const { recordSurprise } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();
  const before = readdirSync(dir).sort();

  const result = await recordSurprise(root, slug, { healed: 0, remediationCycles: 0, stoppedReason: null });

  assert.deepEqual(result, { written: false });
  assert.deepEqual(readdirSync(dir).sort(), before, 'no file must appear for a signal-free run');
});

test('recordSurprise: a signal writes exactly one JSONL line with at/phase/signals/note', async () => {
  const { recordSurprise, SURPRISES_FILE } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();

  const result = await recordSurprise(root, slug, {
    healed: 2,
    remediationCycles: 0,
    stoppedReason: null,
    note: 'the heal trap: retried the wrong file',
    now: '2026-01-02T03:04:05.000Z',
  });

  assert.equal(result.written, true);
  const file = join(dir, SURPRISES_FILE);
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.at, '2026-01-02T03:04:05.000Z');
  assert.equal(entry.phase, slug);
  assert.deepEqual(entry.signals, ['healed']);
  assert.equal(entry.note, 'the heal trap: retried the wrong file');
  assert.deepEqual(result.entry, entry);
});

test('recordSurprise: a second call appends — two lines, the first byte-identical', async () => {
  const { recordSurprise, SURPRISES_FILE } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();
  const file = join(dir, SURPRISES_FILE);

  await recordSurprise(root, slug, { healed: 1, note: 'first', now: '2026-01-01T00:00:00.000Z' });
  const afterFirst = readFileSync(file, 'utf8');

  await recordSurprise(root, slug, { remediationCycles: 1, note: 'second', now: '2026-01-02T00:00:00.000Z' });
  const afterSecond = readFileSync(file, 'utf8');

  const lines = afterSecond.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0] + '\n', afterFirst, 'the first line must be byte-identical after the append');
});

test('recordSurprise: a note carrying a GitHub token is masked before it is written', async () => {
  const { recordSurprise, SURPRISES_FILE } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();
  const token = 'ghp_' + 'a'.repeat(36);

  await recordSurprise(root, slug, { healed: 1, note: `retried with ${token} in the log`, now: '2026-01-01T00:00:00.000Z' });

  const raw = readFileSync(join(dir, SURPRISES_FILE), 'utf8');
  assert.ok(!raw.includes(token), 'the raw token must never reach disk');
  assert.match(raw, /\[REDACTED\]/);
});

test('recordSurprise: a long multi-line note collapses to one line, capped at 300 chars', async () => {
  const { recordSurprise, SURPRISES_FILE } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();
  const longNote = Array.from({ length: 20 }, (_, i) => `line ${i} `.repeat(10)).join('\n');
  assert.ok(longNote.length > 300, 'precondition: the note must actually be long');
  assert.ok(longNote.includes('\n'), 'precondition: the note must actually be multi-line');

  const result = await recordSurprise(root, slug, { healed: 1, note: longNote, now: '2026-01-01T00:00:00.000Z' });

  const raw = readFileSync(join(dir, SURPRISES_FILE), 'utf8');
  const lines = raw.trim().split('\n');
  assert.equal(lines.length, 1, 'the note must not introduce extra JSONL lines');
  const entry = JSON.parse(lines[0]);
  assert.ok(!entry.note.includes('\n'), 'the stored note must be collapsed to one line');
  assert.ok(entry.note.length <= 300, `note must be capped at 300 chars, got ${entry.note.length}`);
  assert.equal(result.entry.note, entry.note);
});

test('recordSurprise: a slug escaping the phase dir throws and writes nothing', async () => {
  const { recordSurprise } = await import('../lib/surprises.mjs');
  const { root, dir } = await scratchPhase();
  const before = existsSync(dir) ? readdirSync(dir).sort() : null;

  await assert.rejects(
    () => recordSurprise(root, '../x', { healed: 1, note: 'escape attempt' }),
    /\.\.|slug/i,
  );

  assert.deepEqual(existsSync(dir) ? readdirSync(dir).sort() : null, before,
    'a rejected slug must never write outside — or inside — the legitimate phase dir');
});

// --- readSurprises: the harvest-side reader ---

test('readSurprises: an absent file reads as empty, no throw', async () => {
  const { readSurprises } = await import('../lib/surprises.mjs');
  const { dir } = await scratchPhase();
  const result = readSurprises(join(dir, 'SURPRISES.jsonl'));
  assert.deepEqual(result, { entries: [], damaged: 0 });
});

test('readSurprises: a garbage line is counted as damaged, the good lines still come back', async () => {
  const { recordSurprise, readSurprises, SURPRISES_FILE } = await import('../lib/surprises.mjs');
  const { root, slug, dir } = await scratchPhase();
  const file = join(dir, SURPRISES_FILE);

  await recordSurprise(root, slug, { healed: 1, note: 'good one', now: '2026-01-01T00:00:00.000Z' });
  const { appendFileSync } = await import('node:fs');
  appendFileSync(file, 'not json at all\n');
  await recordSurprise(root, slug, { remediationCycles: 1, note: 'good two', now: '2026-01-02T00:00:00.000Z' });

  const result = readSurprises(file);
  assert.equal(result.damaged, 1);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].note, 'good one');
  assert.equal(result.entries[1].note, 'good two');
});
