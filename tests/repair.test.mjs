// ADR-094 (phase 57 t8): bounded repair of check-created fixes. Each fix's command appends to a marker or
// reads a flag file OUTSIDE the repo, so a run is countable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });

async function project({ attempts } = {}) {
  const { addFix } = await import('../lib/fixes.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'ac-repair-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-repair-out-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, '.astrocode'), { recursive: true });
  writeFileSync(join(dir, '.astrocode', 'config.json'), JSON.stringify(attempts ? { verify: { repair_attempts: attempts } } : {}));
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'init');
  const markA = join(out, 'a');
  const markB = join(out, 'b');
  writeFileSync(markA, ''); writeFileSync(markB, '');
  const from = (command) => ({ milestone: 3, phase: '07-x', criterion: 'C2', test: null, command, tip: 'abc' });
  const a = await addFix(dir, { title: 'fix a', fullcheckFrom: from(`echo x >> '${markA}'; exit 0`) });
  const b = await addFix(dir, { title: 'fix b', fullcheckFrom: from(`echo x >> '${markB}'; exit 1`) });
  const plain = await addFix(dir, { title: 'plain' });
  const deferred = await addFix(dir, { title: 'deferred', deferredFrom: { phase: '07-x', criterion: 'C1' } });
  sh(dir, 'add', '-A'); sh(dir, 'commit', '-qm', 'fixes');
  const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean).length;
  return { dir, a, b, plain, deferred, runsA: () => lines(markA), runsB: () => lines(markB) };
}

test('a passing re-check moves the fix to verified on attempt 1 and leaves the tree clean', async () => {
  const { repairFix } = await import('../lib/repair.mjs');
  const { findFix } = await import('../lib/fixes.mjs');
  const p = await project();
  const r = await repairFix(p.dir, p.a.id);
  assert.deepEqual(r, { id: p.a.id, attempt: 1, limit: 2, passed: true, exhausted: false });
  assert.equal(findFix(p.dir, p.a.id).status, 'verified');
  assert.equal(sh(p.dir, 'status', '--porcelain').stdout.trim(), '');
  assert.match(sh(p.dir, 'log', '-1', '--format=%s').stdout, /^chore\(fullcheck\): repair .* attempt 1 — fixed/);
});

test('a never-passing fix gets two attempts, then exhausted runs nothing', async () => {
  const { repairFix } = await import('../lib/repair.mjs');
  const { findFix } = await import('../lib/fixes.mjs');
  const p = await project();
  assert.equal((await repairFix(p.dir, p.b.id)).passed, false);
  assert.equal((await repairFix(p.dir, p.b.id)).attempt, 2);
  assert.equal(p.runsB(), 2);
  assert.equal(sh(p.dir, 'status', '--porcelain').stdout.trim(), '');
  const third = await repairFix(p.dir, p.b.id);
  assert.equal(third.exhausted, true);
  assert.equal(p.runsB(), 2, 'nothing ran');
  assert.equal(findFix(p.dir, p.b.id).status, 'open');
});

test('verify.repair_attempts: 3 allows a third attempt', async () => {
  const { repairFix } = await import('../lib/repair.mjs');
  const p = await project({ attempts: 3 });
  for (let i = 0; i < 3; i += 1) assert.equal((await repairFix(p.dir, p.b.id)).exhausted, false);
  assert.equal(p.runsB(), 3);
  assert.equal((await repairFix(p.dir, p.b.id)).exhausted, true);
});

test('a deferred fix or a plain fix is refused', async () => {
  const { repairFix } = await import('../lib/repair.mjs');
  const p = await project();
  await assert.rejects(repairFix(p.dir, p.plain.id), /not opened by the milestone full check/);
  await assert.rejects(repairFix(p.dir, p.deferred.id), /not opened by the milestone full check/);
});

test('repairReport lists the verified fix as fixed and the stuck one as open with its attempts', async () => {
  const { repairFix, repairReport } = await import('../lib/repair.mjs');
  const p = await project();
  await repairFix(p.dir, p.a.id);
  await repairFix(p.dir, p.b.id);
  await repairFix(p.dir, p.b.id);
  const rep = repairReport(p.dir, { milestone: 3 });
  assert.deepEqual(rep.fixed.map((f) => f.id), [p.a.id]);
  assert.equal(rep.open.length, 1);
  assert.equal(rep.open[0].id, p.b.id);
  assert.equal(rep.open[0].attempts, 2);
  assert.equal(rep.open[0].limit, 2);
});
