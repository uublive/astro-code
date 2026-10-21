// Phase 47 t2 — the once-per-project-per-tool suggestion memory (P2/P3).
// Real tmp `.astrocode/` and real git; modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const LIB = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'mutnotice.mjs');
const proj = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutnotice-'));
  mkdirSync(join(dir, '.astrocode'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  return dir;
};
const rm = (...d) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));

test('a fresh project shows full, then reminder after markShown', async () => {
  const { readNotices, noticeFor, markShown } = await import('../lib/mutnotice.mjs');
  const d = proj();
  try {
    assert.equal(noticeFor(readNotices(d), 'stryker'), 'full');
    await markShown(d, 'stryker');
    assert.equal(noticeFor(readNotices(d), 'stryker'), 'reminder');
  } finally { rm(d); }
});

test('memory is per tool and per project', async () => {
  const { readNotices, noticeFor, markShown } = await import('../lib/mutnotice.mjs');
  const a = proj(); const b = proj();
  try {
    await markShown(a, 'stryker');
    assert.equal(noticeFor(readNotices(a), 'gremlins'), 'full');
    assert.equal(noticeFor(readNotices(b), 'stryker'), 'full');
  } finally { rm(a, b); }
});

test('dismiss gives reminder without ever having shown, and survives markShown', async () => {
  const { readNotices, noticeFor, markShown, dismiss } = await import('../lib/mutnotice.mjs');
  const d = proj();
  try {
    await dismiss(d, 'mutmut');
    assert.equal(noticeFor(readNotices(d), 'mutmut'), 'reminder');
    await markShown(d, 'mutmut');
    assert.equal(readNotices(d).mutmut.dismissed, true);
  } finally { rm(d); }
});

test('corrupt, garbage and wrong-shape files read as empty without throwing', async () => {
  const { readNotices, noticeFor } = await import('../lib/mutnotice.mjs');
  const d = proj();
  try {
    const f = join(d, '.astrocode', '.local', 'mutate-notices.json');
    mkdirSync(dirname(f), { recursive: true });
    for (const body of ['{not json', '[1,2]', '"x"', 'null']) {
      writeFileSync(f, body);
      assert.deepEqual(readNotices(d), {});
    }
    writeFileSync(f, JSON.stringify({ stryker: 'yes', gremlins: { shown_at: 5, dismissed: false }, mutmut: { shown_at: 'x', dismissed: true } }));
    const n = readNotices(d);
    assert.equal(noticeFor(n, 'stryker'), 'full');
    assert.equal(noticeFor(n, 'gremlins'), 'full');
    assert.equal(noticeFor(n, 'mutmut'), 'reminder');
  } finally { rm(d); }
});

test('the memory survives a separate process, and the file is git-ignored by its own .gitignore', async () => {
  const { readNotices, noticeFor } = await import('../lib/mutnotice.mjs');
  const d = proj();
  try {
    const r = spawnSync(process.execPath, ['-e',
      `import(${JSON.stringify(LIB)}).then((m) => m.markShown(${JSON.stringify(d)}, 'stryker'))`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(noticeFor(readNotices(d), 'stryker'), 'reminder');
    assert.equal(readFileSync(join(d, '.astrocode', '.local', '.gitignore'), 'utf8').trim(), '*');
    const f = join(d, '.astrocode', '.local', 'mutate-notices.json');
    assert.equal(spawnSync('git', ['check-ignore', '-q', f], { cwd: d }).status, 0);
  } finally { rm(d); }
});

test('REMINDER is the one-line text', async () => {
  const { REMINDER } = await import('../lib/mutnotice.mjs');
  assert.equal(REMINDER, 'mutation tool not installed — AI mutants used');
});
