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

function sampleRun(id, overrides = {}) {
  return {
    id,
    files: { '/proj/a.jsonl': { offset: 100, ctxOffset: 0, headless: false, host: 'claude', session: 's1' } },
    emitted: [{ keyHash: 'hk1', sessions: ['s1'] }],
    held: [],
    below: [],
    sighted: [],
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

test('advance replaces in-scope pending with held and leaves out-of-scope pending untouched', async () => {
  const { writeRun, advance, readSteers, writeSteers } = await import('../lib/minestate.mjs?b=1');
  const store = storeDir();
  writeSteers(store, {
    version: 1,
    pending: [
      { keyHash: 'in-scope', explicit: false, sessions: ['s0'], pointers: [{ file: '/proj/a.jsonl', host: 'claude', session: 's0', start: 0, end: 10, ctxStart: 0, ctxEnd: 0 }] },
      { keyHash: 'out-of-scope', explicit: false, sessions: ['s9'], pointers: [{ file: '/other/b.jsonl', host: 'claude', session: 's9', start: 0, end: 10, ctxStart: 0, ctxEnd: 0 }] },
    ],
    seen: {},
  });
  const run = sampleRun('r3', {
    files: { '/proj/a.jsonl': { offset: 200, ctxOffset: 0, headless: false, host: 'claude', session: 's1' } },
    held: [{ keyHash: 'new-held', explicit: false, sessions: ['s1'], pointers: [{ file: '/proj/a.jsonl', host: 'claude', session: 's1', start: 10, end: 20, ctxStart: 0, ctxEnd: 0 }] }],
  });
  writeRun(store, run);
  await advance(store, 'r3');
  const steers = readSteers(store);
  const keys = steers.pending.map((p) => p.keyHash);
  assert.ok(!keys.includes('in-scope'), 'in-scope pending must be replaced');
  assert.ok(keys.includes('out-of-scope'), 'out-of-scope pending must survive untouched');
  assert.ok(keys.includes('new-held'), 'held candidates from the run must become pending');
});

test('advance unions seen sessions for emitted/below/sighted keys and caps at SEEN_MAX', async () => {
  const { writeRun, advance, readSteers, SEEN_MAX } = await import('../lib/minestate.mjs?c=1');
  const store = storeDir();
  assert.equal(typeof SEEN_MAX, 'number');
  writeRun(store, sampleRun('r4', {
    emitted: [{ keyHash: 'k1', sessions: ['s1'] }],
    below: [{ keyHash: 'k2', sessions: ['s2'] }],
    sighted: [{ keyHash: 'k3', sessions: ['s3'] }],
  }));
  await advance(store, 'r4');
  const steers = readSteers(store);
  assert.ok(steers.seen.k1);
  assert.ok(steers.seen.k2);
  assert.ok(steers.seen.k3);
  assert.deepEqual(steers.seen.k1.sessions, ['s1']);

  // A second advance for the same key unions sessions rather than replacing them.
  writeRun(store, sampleRun('r5', { emitted: [{ keyHash: 'k1', sessions: ['s4'] }] }));
  await advance(store, 'r5');
  const steers2 = readSteers(store);
  assert.deepEqual(steers2.seen.k1.sessions.sort(), ['s1', 's4'].sort());
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
    // text/excerpt field (as it would if it forgot P6's "pointers and hashes, never
    // text" rule) must never survive into the stored record.
    emitted: [{ keyHash: 'k1', sessions: ['s1'], text: SECRETS.join(' ') }],
  });
  writeRun(store, dangerous);
  await advance(store, 'r9');
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
