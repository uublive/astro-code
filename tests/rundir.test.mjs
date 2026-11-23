// Phase 59 t3 — per-run folders and the dead-run sweep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeRunDir, removeRunDir, sweepDeadRuns } from '../lib/rundir.mjs';

const home = () => mkdtempSync(join(tmpdir(), 'rundir-'));
const mkRun = (h, name, owner) => {
  const d = join(h, 'runs', name);
  mkdirSync(join(d, 'tmp'), { recursive: true });
  writeFileSync(join(d, 'tmp', 'f'), 'x'.repeat(100));
  if (owner) writeFileSync(join(d, 'owner.json'), JSON.stringify(owner));
  return d;
};

test('two makeRunDir calls give distinct folders, each with owner.json and tmp', () => {
  const h = home();
  const a = makeRunDir(h);
  const b = makeRunDir(h);
  assert.notEqual(a.dir, b.dir);
  for (const r of [a, b]) {
    assert.ok(existsSync(join(r.dir, 'owner.json')));
    assert.ok(existsSync(r.tmp));
    assert.match(basename(r.dir), /^ac-run-\d+-[a-z0-9]{6}$/);
  }
});

test('removeRunDir deletes a populated folder and refuses a path outside runs/ac-run-', () => {
  const h = home();
  const r = makeRunDir(h);
  writeFileSync(join(r.tmp, 'a'), 'x');
  removeRunDir(r.dir);
  assert.equal(existsSync(r.dir), false);
  const other = join(h, 'mine');
  mkdirSync(other);
  assert.throws(() => removeRunDir(other), /refusing/);
  assert.throws(() => removeRunDir(join(h, 'runs')), /refusing/);
  assert.ok(existsSync(other));
});

test('the sweep removes a dead owner, keeps a live one and a fresh ownerless folder, and reports bytes', () => {
  const h = home();
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  const dead = mkRun(h, `ac-run-${deadPid}-abc123`, { pid: deadPid, started_ms: 1 });
  const live = mkRun(h, `ac-run-${process.pid}-abc123`, { pid: process.pid, started_ms: Date.now() - process.uptime() * 1000 });
  const fresh = mkRun(h, 'ac-run-1-fresh1', null);
  const r = sweepDeadRuns(h);
  assert.deepEqual(r.removed, [`ac-run-${deadPid}-abc123`]);
  assert.ok(r.bytes >= 100);
  assert.equal(existsSync(dead), false);
  assert.ok(existsSync(live));
  assert.ok(existsSync(fresh));
});

test('an ownerless folder older than 60 s is swept', () => {
  const h = home();
  const old = mkRun(h, 'ac-run-2-old111', null);
  const past = new Date(Date.now() - 120000);
  utimesSync(old, past, past);
  assert.deepEqual(sweepDeadRuns(h).removed, ['ac-run-2-old111']);
});

test('the sweep ignores non-matching names, a symlink to an outside folder, and files', () => {
  const h = home();
  const outside = mkdtempSync(join(tmpdir(), 'outside-'));
  writeFileSync(join(outside, 'keep'), 'k');
  mkdirSync(join(h, 'runs'), { recursive: true });
  for (const n of ['gremlins-x', 'mine']) mkdirSync(join(h, 'runs', n));
  symlinkSync(outside, join(h, 'runs', 'ac-run-3-link11'));
  writeFileSync(join(h, 'runs', 'ac-run-4-file11'), 'x');
  const r = sweepDeadRuns(h, { isAlive: () => false, now: () => Date.now() + 1e9 });
  assert.deepEqual(r.removed, []);
  assert.ok(existsSync(join(outside, 'keep')));
  assert.ok(existsSync(join(h, 'runs', 'gremlins-x')));
});

test('a missing runs folder sweeps nothing', () => {
  assert.deepEqual(sweepDeadRuns(home()), { removed: [], bytes: 0 });
});
