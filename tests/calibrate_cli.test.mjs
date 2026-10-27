// Phase 51 t8 — `ac verify calibrate`: the flags, the bill gate and the output (C1, C10, and the
// surface of C2 and C5). Spawns `node bin/ac.mjs` against the calibration fixture with the recording
// stub `claude` first on PATH, a private TMPDIR and a private CLAUDE_CONFIG_DIR.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeCalibrationProject, writeVerifierStub, readStubLog, sh } from './fixtures/calibrate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');

// A fixture project, a stub verifier and an environment where nothing outside them is reachable.
async function rig(projectOpts = {}, script = {}) {
  const p = await makeCalibrationProject(projectOpts);
  const scratch = mkdtempSync(join(tmpdir(), 'ac-cal-rig-'));
  p.scratch = scratch;
  p.tmp = join(scratch, 'tmp'); mkdirSync(p.tmp);
  p.log = join(scratch, 'stub.log');
  p.bin = join(scratch, 'bin');
  writeVerifierStub(p.bin, { original: p.dir, logFile: p.log, script });
  p.env = { ...process.env, PATH: [p.bin, dirname(process.execPath), '/usr/bin', '/bin'].join(delimiter), TMPDIR: p.tmp, CLAUDE_CONFIG_DIR: join(scratch, 'cfg'), HOME: join(scratch, 'home') };
  return p;
}
const done = (p) => { rmSync(p.dir, { recursive: true, force: true }); rmSync(p.scratch, { recursive: true, force: true }); };
const ac = (p, args) => spawnSync(process.execPath, [AC, ...args], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 120000 });
const state = (p) => `${sh(p.dir, 'status', '--porcelain').stdout}|${sh(p.dir, 'rev-parse', 'HEAD').stdout}|${existsSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl'))}`;

test('`--run 5`, `--defects 0`, `--runs abc`, a bare `--seed`, `--budget -1` and `--yes 3` each exit non-zero, with zero stub invocations', async () => {
  const p = await rig();
  try {
    for (const bad of [['--run', '5'], ['--defects', '0'], ['--runs', 'abc'], ['--seed'], ['--budget', '-1'], ['--yes', '3'], ['--defects', '1.5'], ['--seed', '-1'], ['--budget', '0']]) {
      const before = state(p);
      const r = ac(p, ['verify', 'calibrate', ...bad, ...(bad[0] === '--yes' ? [] : ['--yes'])]);
      assert.notEqual(r.status, 0, bad.join(' '));
      assert.match(r.stderr, /✖/);
      assert.equal(state(p), before);
    }
    assert.deepEqual(readStubLog(p.log), []);
    assert.deepEqual(readdirSync(p.tmp), []);
  } finally { done(p); }
});

test('no --yes prints the bill (cost, defects × runs, seed, budget, --yes needed) and leaves the stub log empty, the log byte-identical, `git status` unchanged and no `ac-v-` dir in TMPDIR', async () => {
  const p = await rig();
  try {
    const before = state(p);
    const r = ac(p, ['verify', 'calibrate', '--defects', '4', '--runs', '2']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /bill: about \$24\.00 for 4 defects × 2 runs = 8 trials/);
    assert.match(r.stdout, /seed \d+/);
    assert.match(r.stdout, /budget: \$36\.00/);
    assert.match(r.stdout, /add --yes to run it/);
    assert.ok(r.stdout.trim().split('\n').length <= 5);
    assert.deepEqual(readStubLog(p.log), []);
    assert.equal(state(p), before);
    assert.deepEqual(readdirSync(p.tmp), []);
  } finally { done(p); }
});

test('the bill for --runs 4 exceeds the bill for --runs 2', async () => {
  const p = await rig();
  try {
    const bill = (runs) => Number(/bill: about \$([\d.]+)/.exec(ac(p, ['verify', 'calibrate', '--defects', '4', '--runs', String(runs), '--seed', '3']).stdout)[1]);
    assert.ok(bill(4) > bill(2));
    assert.equal(bill(4), 2 * bill(2));
    // a given seed is echoed and not marked as drawn
    assert.doesNotMatch(ac(p, ['verify', 'calibrate', '--seed', '3']).stdout, /drawn/);
    assert.match(ac(p, ['verify', 'calibrate']).stdout, /drawn; pass --seed to repeat it/);
  } finally { done(p); }
});

test('--json without --yes returns the bill with needs_yes and never implies consent', async () => {
  const p = await rig();
  try {
    const r = ac(p, ['verify', 'calibrate', '--defects', '4', '--runs', '2', '--seed', '9', '--json']);
    assert.equal(r.status, 0);
    const j = JSON.parse(r.stdout);
    assert.equal(j.needs_yes, true);
    assert.equal(j.ran, false);
    assert.deepEqual([j.requested, j.selected, j.seed, j.bill.usd, j.budget_usd], [{ defects: 4, runs: 2 }, { easy: 2, hard: 2 }, 9, 24, 36]);
    assert.ok(j.defects.every((d) => d.id && d.set && d.phase && d.tool && d.key && !('file' in d) && !('replacement' in d)));
    assert.deepEqual(readStubLog(p.log), []);
  } finally { done(p); }
});

test('a --yes --json run returns sets, defects and the log path, and the human run leads its summary with both rates', async () => {
  const p = await rig({ killed: 4 }, { default: ['fail'], cost: 1 });
  try {
    const r = ac(p, ['verify', 'calibrate', '--defects', '4', '--runs', '2', '--seed', '5', '--yes', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(j.sets), ['easy', 'hard']);
    assert.ok(j.sets.easy.defect_rate && j.sets.hard.trial_rate && j.sets.easy.pass_k);
    assert.equal(j.defects.length, 4);
    assert.equal(j.completed.trials, 8);
    assert.equal(j.log.committed, true);
    assert.match(j.log.file, /CALIBRATION\.jsonl$/);
    assert.equal(readStubLog(p.log).length, 8);
    assert.ok(j.trials.every((t) => Array.isArray(t.scrubbed)));
    assert.equal(sh(p.dir, 'status', '--porcelain').stdout, '');
    assert.deepEqual(readdirSync(p.tmp), [], 'no copy outlives the command');

    const h = ac(p, ['verify', 'calibrate', '--defects', '4', '--runs', '1', '--seed', '5', '--yes']);
    assert.equal(h.status, 0, h.stderr);
    const lines = h.stdout.trim().split('\n');
    const first = lines.findIndex((l) => l.startsWith('false PASS by defect'));
    assert.ok(first >= 0 && first <= 4, 'the rates line follows the short bill');
    assert.match(lines[first], /easy \d+\/\d+ \d+% \(\d+%–\d+%\) · hard \d+\/\d+/);
    assert.ok(lines.length <= 5 + 8 + 20 + 1);
  } finally { done(p); }
});

test('`ac verify` with no or an unknown subcommand dies with usage', async () => {
  const p = await rig();
  try {
    for (const args of [['verify'], ['verify', 'frobnicate'], ['verify', 'calibrate', 'extra']]) {
      const r = ac(p, args);
      assert.equal(r.status, 1, args.join(' '));
      assert.match(r.stderr, /ac verify calibrate/);
    }
  } finally { done(p); }
});

test('the help lists `ac verify calibrate`', async () => {
  const p = await rig();
  try {
    assert.match(ac(p, ['help']).stdout, /ac verify calibrate \[--defects N\] \[--runs K\] \[--seed S\] \[--budget USD\] \[--yes\] \[--json\]/);
  } finally { done(p); }
});

test('no accepted-phase defects at all exits 0, says why, runs nothing and writes no log', async () => {
  const p = await rig({ tools: ['gremlins'] });
  try {
    const r = ac(p, ['verify', 'calibrate', '--yes']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /nothing to calibrate/);
    assert.match(r.stdout, /Gremlins is not supported/);
    assert.deepEqual(readStubLog(p.log), []);
    assert.equal(existsSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl')), false);
  } finally { done(p); }
});
