// Phase 26 t5 — RED: the watermark / run-record module (P6). Every not-yet-existing
// symbol is reached through a dynamic import inside each async test body (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { git } from '../lib/git.mjs';
import { SECRETS } from './fixtures/minefixtures.mjs';

function storeDir() {
  return mkdtempSync(join(tmpdir(), 'ac-minestate-store-'));
}

function ptr(file, session, start) {
  return { file, host: 'claude', session, start, end: start + 10, ctxStart: start, ctxEnd: start };
}

function sampleRun(id, overrides = {}) {
  return {
    id,
    files: { '/proj/a.jsonl': { offset: 100, ctxOffset: 0, headless: false, host: 'claude', session: 's1' } },
    items: { t1: { at: '2026-09-25T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's1', 0)] } },
    held: [],
    ...overrides,
  };
}

test('paths live under <store>/.local/mine/ (files/<slug>.json, steers.json, runs/)', async () => {
  const { mineDir, writeRun, readRun } = await import('../lib/minestate.mjs');
  const store = storeDir();
  assert.equal(mineDir(store), join(store, '.local', 'mine'));
  writeRun(store, sampleRun('sweep-1'));
  assert.ok(existsSync(join(store, '.local', 'mine', 'runs', 'sweep-1.json')));
  const run = readRun(store, 'sweep-1');
  assert.equal(run.id, 'sweep-1');
});

test('advance moves offsets forward only — a smaller offset never rewinds', async () => {
  const { readFilesState, writeRun, advance } = await import('../lib/minestate.mjs?a=1');
  const store = storeDir();
  writeRun(store, sampleRun('r1', {
    files: { '/proj/a.jsonl': { offset: 500, ctxOffset: 0, headless: false, host: 'claude', session: 's1', slug: 'default' } },
  }));
  await advance(store, 'r1');
  writeRun(store, sampleRun('r2', {
    files: { '/proj/a.jsonl': { offset: 100, ctxOffset: 0, headless: false, host: 'claude', session: 's1', slug: 'default' } },
  }));
  await advance(store, 'r2');
  const state = readFilesState(store, 'default');
  const anyFile = Object.values(state.files)[0];
  assert.equal(anyFile.offset, 500, 'offset must never rewind below a previously recorded value');
});

test('advance replaces in-scope pending with held + kept items and leaves out-of-scope pending untouched', async () => {
  const { writeRun, advance, readSteers, writeSteers } = await import('../lib/minestate.mjs?b=1');
  const store = storeDir();
  writeSteers(store, {
    pending: [
      { reason: 'kept', at: '2026-09-01T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's0', 0)] },
      { reason: 'kept', at: '2026-09-01T00:00:00.000Z', pointers: [ptr('/other/b.jsonl', 's9', 0)] },
    ],
  });
  writeRun(store, sampleRun('r3', {
    files: { '/proj/a.jsonl': { offset: 200, ctxOffset: 0, headless: false, host: 'claude', session: 's1' } },
    items: {
      t1: { at: '2026-09-25T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's1', 30)] },
      t2: { at: '2026-09-25T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's1', 40)] },
    },
    held: [{ at: '2026-09-25T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's1', 10)] }],
  }));
  const res = await advance(store, 'r3', { keep: ['t2'] });
  assert.equal(res.kept, 1);
  const starts = readSteers(store).pending.map((p) => `${p.reason}:${p.pointers[0].file}:${p.pointers[0].start}`).sort();
  assert.deepEqual(starts, ['held:/proj/a.jsonl:10', 'kept:/other/b.jsonl:0', 'kept:/proj/a.jsonl:40']);
});

test('advance refuses an unknown keep id and writes nothing — the run stays advanceable', async () => {
  const { writeRun, advance, readRun, readFilesState, readSteers } = await import('../lib/minestate.mjs?c=1');
  const store = storeDir();
  writeRun(store, sampleRun('r4', {
    files: { '/proj/a.jsonl': { offset: 99, ctxOffset: 0, headless: false, host: 'claude', session: 's1', slug: 'default' } },
  }));
  await assert.rejects(() => advance(store, 'r4', { keep: ['t1', 'nope'] }), /unknown item id "nope"/);
  assert.deepEqual(readFilesState(store, 'default').files, {}, 'no offset was committed');
  assert.deepEqual(readSteers(store).pending, []);
  assert.ok(readRun(store, 'r4'), 'the run record survives a refused advance');
  await advance(store, 'r4', { keep: ['t1'] });
  assert.equal(readSteers(store).pending.length, 1);
});

test('advance bounds pending at PENDING_MAX, dropping the oldest first; a pre-R1 file with seen still reads', async () => {
  const { writeRun, advance, readSteers, PENDING_MAX, mineDir } = await import('../lib/minestate.mjs?j=1');
  const { mkdirSync } = await import('node:fs');
  const store = storeDir();
  mkdirSync(mineDir(store), { recursive: true });
  const old = [];
  for (let i = 0; i < PENDING_MAX; i++) {
    old.push({ keyHash: `k${i}`, explicit: false, sessions: ['s'], at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`, pointers: [ptr(`/other/${i}.jsonl`, 's', 0)] });
  }
  writeFileSync(join(mineDir(store), 'steers.json'), JSON.stringify({ version: 1, pending: old, seen: { k0: { sessions: ['s'], at: 'x' } } }));
  assert.equal(readSteers(store).pending.length, PENDING_MAX);

  writeRun(store, sampleRun('r10', { held: [{ at: '2026-09-25T00:00:00.000Z', pointers: [ptr('/proj/a.jsonl', 's1', 10)] }] }));
  await advance(store, 'r10');
  const after = JSON.parse(readFileSync(join(mineDir(store), 'steers.json'), 'utf8'));
  assert.equal(after.pending.length, PENDING_MAX);
  assert.ok(after.pending.some((p) => p.reason === 'held' && p.pointers[0].file === '/proj/a.jsonl'), 'the newest entry survives');
  assert.ok(!('seen' in after));
  assert.ok(after.pending.every((p) => !('keyHash' in p) && !('sessions' in p)), 'pre-R1 fields are not carried forward');
});

test('advance deletes the run record, and a second advance of the same id rejects', async () => {
  const { writeRun, advance, readRun } = await import('../lib/minestate.mjs?d=1');
  const store = storeDir();
  writeRun(store, sampleRun('r6'));
  await advance(store, 'r6');
  assert.equal(readRun(store, 'r6'), null);
  await assert.rejects(() => advance(store, 'r6'), /unknown or already-advanced sweep/);
});

test('advance of an unknown id rejects with the same message', async () => {
  const { advance } = await import('../lib/minestate.mjs?e=1');
  const store = storeDir();
  await assert.rejects(() => advance(store, 'never-existed'), /unknown or already-advanced sweep/);
});

test('writeRun keeps only the newest RUNS_KEEP', async () => {
  const { writeRun, RUNS_KEEP, mineDir } = await import('../lib/minestate.mjs?f=1');
  const store = storeDir();
  for (let i = 0; i < RUNS_KEEP + 3; i++) {
    writeRun(store, sampleRun(`run-${i}`));
  }
  const files = readdirSync(join(mineDir(store), 'runs'));
  assert.equal(files.length, RUNS_KEEP);
});

test('a corrupt files/<slug>.json reads as empty and is overwritten on advance (never a crash)', async () => {
  const { writeRun, advance, readFilesState, mineDir } = await import('../lib/minestate.mjs?g=1');
  const { mkdirSync } = await import('node:fs');
  const store = storeDir();
  mkdirSync(join(mineDir(store), 'files'), { recursive: true });
  writeFileSync(join(mineDir(store), 'files', 'proj.json'), 'not json{{{');
  writeRun(store, sampleRun('r7', {
    files: { '/proj/a.jsonl': { offset: 42, ctxOffset: 0, headless: false, host: 'claude', session: 's1', slug: 'proj' } },
  }));
  await advance(store, 'r7');
  const state = readFilesState(store, 'proj');
  assert.equal(Object.values(state.files)[0].offset, 42, 'a corrupt state file must be overwritten, not crash');
});

test('C6: after advance, a store made into a git repo shows nothing under .local in git status', async () => {
  const { writeRun, advance } = await import('../lib/minestate.mjs?h=1');
  const store = storeDir();
  git(['init', '--quiet'], { cwd: store });
  git(['config', 'user.email', 'dev@example.com'], { cwd: store });
  git(['config', 'user.name', 'dev'], { cwd: store });
  writeFileSync(join(store, '.gitignore'), '.lock/\n*.tmp-*\n.local/\n');
  git(['add', '-A'], { cwd: store });
  git(['commit', '--quiet', '-m', 'init'], { cwd: store });

  writeRun(store, sampleRun('r8'));
  await advance(store, 'r8');

  const status = git(['status', '--porcelain'], { cwd: store });
  assert.equal(status.stdout.trim(), '', 'nothing under .local/ should show up in git status');
});

test('C3: a run built from secret-bearing candidate metadata never lets a secret reach any .local/mine file', async () => {
  const { writeRun, advance, mineDir } = await import('../lib/minestate.mjs?i=1');
  const store = storeDir();
  const dangerous = sampleRun('r9', {
    // Only whitelisted fields are ever persisted — a caller accidentally attaching a
    // text/excerpt field (as it would if it forgot P6's "pointers, never text" rule)
    // must never survive into the stored record.
    items: { t1: { at: '2026-09-25T00:00:00.000Z', text: SECRETS.join(' '), pointers: [{ ...ptr('/proj/a.jsonl', 's1', 0), excerpt: SECRETS.join(' ') }] } },
    held: [{ text: SECRETS.join(' '), pointers: [ptr('/proj/a.jsonl', 's1', 20)] }],
  });
  writeRun(store, dangerous);
  await advance(store, 'r9', { keep: ['t1'] });
  const { readdirSync: rd } = await import('node:fs');
  const dir = mineDir(store);
  const walk = (d) => rd(d, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]
  ));
  const files = existsSync(dir) ? walk(dir) : [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const secret of SECRETS) {
      assert.ok(!text.includes(secret), `${f} must never contain a raw secret`);
    }
  }
});
