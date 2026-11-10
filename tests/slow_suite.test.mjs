// Phase 56 t1 — slow-suite measurement: threshold setting, latest timing, one speed answer (ADR-093).
// Real tmp git; receipts written straight into receiptDir; modules by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const CMD = 'make test';
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'slow-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  mkdirSync(join(root, '.astrocode'), { recursive: true });
  writeFileSync(join(root, 'a'), 'x');
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', 'init');
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
const setMinutes = (root, v) => writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ verify: { slow_suite_minutes: v } }));
let n = 0;
async function seed(root, { seconds, at, exit = 0, command = CMD, commit = 'c'.repeat(40) }) {
  const { receiptDir, receiptKey } = await import('../lib/receipts.mjs');
  const key = receiptKey({ commit: commit + (n++), tree: 't', command });
  mkdirSync(receiptDir(root), { recursive: true });
  writeFileSync(join(receiptDir(root), `${key}.json`), JSON.stringify({ key, command, commit, tree: 't', exit, seconds, at, started_at: at }));
}
const T = (i) => new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString();
const speed = async (root, cmd = CMD, w = []) => (await import('../lib/receipts.mjs')).suiteSpeed(root, cmd, w);

test('default threshold is 10 minutes, strictly greater is slow', async () => {
  for (const [s, slow] of [[590, false], [600, false], [610, true]]) {
    const r = repo();
    try { await seed(r.root, { seconds: s, at: T(1) }); assert.equal((await speed(r.root)).slow, slow, `${s}s`); } finally { r.done(); }
  }
});

test('a project setting changes the threshold, in minutes', async () => {
  const r = repo();
  try {
    await seed(r.root, { seconds: 120, at: T(1) });
    setMinutes(r.root, 1);
    assert.equal((await speed(r.root)).slow, true);
    await seed(r.root, { seconds: 610, at: T(2) });
    setMinutes(r.root, 30);
    const s = await speed(r.root);
    assert.equal(s.slow, false);
    assert.equal(s.threshold_seconds, 1800);
  } finally { r.done(); }
});

test('a bad setting falls back to 10 with one warning each', async () => {
  for (const bad of ['abc', -5, 0, null]) {
    const r = repo();
    try {
      await seed(r.root, { seconds: 900, at: T(1) });
      setMinutes(r.root, bad);
      const w = [];
      const s = await speed(r.root, CMD, w);
      assert.equal(s.slow, true);
      assert.equal(s.threshold_seconds, 600);
      assert.equal(w.length, 1);
      assert.match(w[0], /verify\.slow_suite_minutes .* is not a positive number — using 10/);
    } finally { r.done(); }
  }
});

test('the most recent run decides; another command and older commits do not matter', async () => {
  const r = repo();
  try {
    await seed(r.root, { seconds: 900, at: T(1) });
    await seed(r.root, { seconds: 30, at: T(2) });
    assert.equal((await speed(r.root)).slow, false);
    await seed(r.root, { seconds: 900, at: T(3), command: 'other' });
    assert.equal((await speed(r.root)).slow, false);
    await seed(r.root, { seconds: 900, at: T(4) });
    const s = await speed(r.root);
    assert.equal(s.slow, true);
    assert.match(s.reason, /last run 900s > 600s threshold/);
  } finally { r.done(); }
});

test('no timing is slow; corrupt and non-hex files are skipped', async () => {
  const r = repo();
  try {
    const { receiptDir } = await import('../lib/receipts.mjs');
    mkdirSync(receiptDir(r.root), { recursive: true });
    writeFileSync(join(receiptDir(r.root), 'junk.json'), '{');
    writeFileSync(join(receiptDir(r.root), `${'a'.repeat(64)}.json`), 'not json');
    const s = await speed(r.root);
    assert.equal(s.slow, true);
    assert.match(s.reason, /^no recorded run of this command on this machine/);
    await seed(r.root, { seconds: 30, at: T(1) });
    assert.match((await speed(r.root)).reason, /last run 30s ≤ 600s threshold/);
  } finally { r.done(); }
});

// Re-verify finding (C2/C3/C6): the newest recorded run decides whatever its exit status. A fast failing
// run is a timing (a red suite during remediation keeps running early, its failure visible), and an older
// longer passing run never hides it; the reason names that run and its exit.
test('the newest run decides whatever its exit status, and the reason names it', async () => {
  const r = repo();
  try {
    await seed(r.root, { seconds: 900, at: T(1) });
    await seed(r.root, { seconds: 20, at: T(2), exit: 1 });
    const s = await speed(r.root);
    assert.equal(s.slow, false, 'a newer fast failure is not hidden behind an older 900s pass');
    assert.match(s.reason, /last run 20s \(exit 1\)/);
  } finally { r.done(); }
  const r2 = repo();
  try {
    await seed(r2.root, { seconds: 30, at: T(1) });
    await seed(r2.root, { seconds: 900, at: T(2), exit: 1 });
    assert.equal((await speed(r2.root)).slow, true, 'a newer slow failure is slow');
  } finally { r2.done(); }
  const r3 = repo();
  try {
    await seed(r3.root, { seconds: 20, at: T(1), exit: 1 });
    assert.equal((await speed(r3.root)).slow, false, 'a fast failing run alone is a timing, not "no recorded run"');
  } finally { r3.done(); }
});
