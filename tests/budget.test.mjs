// Phase 59 t1 — the adaptive worker budget, the heavy.workers setting, env and command shaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  workerBudget, readAvailableMemory, mergeGoFlags, budgetEnv, shapeSuiteCommand, capToBudget, budgetSetting, resolveBudget,
} from '../lib/budget.mjs';

const GB = 1024 ** 3;

test('11 CPUs with ample memory gets 3 workers and says why', () => {
  const b = workerBudget({ cpus: 11, freeBytes: 18.4 * GB });
  assert.equal(b.n, 3);
  assert.equal(b.source, 'adaptive');
  assert.match(b.reason, /adaptive: 11 CPUs, 18\.4 GB free → 3/);
});

test('11 CPUs with 1 GB free gets exactly 1 worker', () => {
  assert.equal(workerBudget({ cpus: 11, freeBytes: 1 * GB }).n, 1);
});

test('1 CPU gets 1 worker', () => {
  assert.equal(workerBudget({ cpus: 1, freeBytes: 64 * GB }).n, 1);
});

test('64 CPUs with unreadable memory uses the CPU-only rule and says so', () => {
  for (const freeBytes of [null, NaN]) {
    const b = workerBudget({ cpus: 64, freeBytes });
    assert.equal(b.n, 16);
    assert.match(b.reason, /free memory unreadable — CPU-only rule/);
  }
});

test('no input from 1-128 CPUs and 0-1 TB free yields 0 or above ceil(cpus/4)', () => {
  for (let cpus = 1; cpus <= 128; cpus += 1) {
    for (const free of [0, 1 * GB, 3 * GB, 9 * GB, 100 * GB, 1024 * GB, null]) {
      const { n } = workerBudget({ cpus, freeBytes: free });
      assert.ok(n >= 1 && n <= Math.ceil(cpus / 4), `cpus=${cpus} free=${free} n=${n}`);
    }
  }
});

test('the heavy.workers setting wins, even above the cap, and its reason names it', () => {
  const b = workerBudget({ cpus: 4, freeBytes: 1 * GB, setting: 7 });
  assert.deepEqual([b.n, b.source], [7, 'setting']);
  assert.equal(b.reason, 'project setting heavy.workers = 7');
});

test('a bad heavy.workers warns and falls back to adaptive', () => {
  const root = mkdtempSync(join(tmpdir(), 'budget-'));
  mkdirSync(join(root, '.astrocode'));
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ heavy: { workers: 'lots' } }));
  const warnings = [];
  assert.equal(budgetSetting(root, warnings), null);
  assert.deepEqual(warnings, ['heavy.workers "lots" is not an integer >= 1 — ignored']);
  const b = resolveBudget(root, { warnings: [], cpus: 8, freeBytes: 32 * GB });
  assert.equal(b.source, 'adaptive');
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ heavy: { workers: 2 } }));
  assert.equal(resolveBudget(root, { warnings: [], cpus: 8, freeBytes: 32 * GB }).source, 'setting');
  writeFileSync(join(root, '.astrocode', 'config.json'), JSON.stringify({ heavy: { workers: 0 } }));
  assert.equal(budgetSetting(root, []), null);
});

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                               10000.
Pages active:                            500000.
Pages inactive:                           20000.
Pages speculative:                         5000.
Pages wired down:                        100000.
`;

test('vm_stat is parsed as (free + inactive + speculative) pages times the page size', () => {
  const got = readAvailableMemory({ platform: 'darwin', run: () => VM_STAT, readFile: () => { throw new Error('no'); }, constrained: 0 });
  assert.equal(got, 35000 * 16384);
});

test('/proc/meminfo MemAvailable is read on Linux', () => {
  const got = readAvailableMemory({ platform: 'linux', run: () => { throw new Error('no'); }, readFile: () => 'MemTotal: 100 kB\nMemAvailable:    2048 kB\n', constrained: 0 });
  assert.equal(got, 2048 * 1024);
});

test('a container memory limit below the machine total wins when lower', () => {
  const got = readAvailableMemory({ platform: 'linux', readFile: () => 'MemAvailable: 8388608 kB\n', constrained: 1 * GB, total: 16 * GB });
  assert.equal(got, 1 * GB);
});

test('a failing reader gives null and never throws', () => {
  const boom = () => { throw new Error('no'); };
  assert.equal(readAvailableMemory({ platform: 'darwin', run: boom, readFile: boom, constrained: 0 }), null);
  assert.equal(readAvailableMemory({ platform: 'linux', run: boom, readFile: boom, constrained: 0 }), null);
  assert.equal(readAvailableMemory({ platform: 'win32', run: boom, readFile: boom, constrained: 0 }), null);
});

test('mergeGoFlags keeps content, keeps a lower -p, replaces a higher one', () => {
  assert.equal(mergeGoFlags(undefined, 2), '-p=2');
  assert.equal(mergeGoFlags('', 2), '-p=2');
  assert.equal(mergeGoFlags('-short', 2), '-short -p=2');
  assert.equal(mergeGoFlags('-short -p=1', 2), '-short -p=1');
  assert.equal(mergeGoFlags('-p=8 -short', 2), '-p=2 -short');
});

test('budgetEnv sets GOMAXPROCS, ASTRO_WORKERS and GOFLAGS without mutating its input', () => {
  const base = { GOFLAGS: '-short', KEEP: '1' };
  const e = budgetEnv(base, 2);
  assert.deepEqual([e.GOMAXPROCS, e.ASTRO_WORKERS, e.GOFLAGS, e.KEEP], ['2', '2', '-short -p=2', '1']);
  assert.equal(base.GOMAXPROCS, undefined);
});

test('shapeSuiteCommand inserts the flag for node --test and go test only', () => {
  assert.deepEqual(shapeSuiteCommand('node --test', 3), { command: 'node --test --test-concurrency=3', shaped: 'node --test' });
  assert.deepEqual(shapeSuiteCommand('node --test tests/a.test.mjs', 3), { command: 'node --test --test-concurrency=3 tests/a.test.mjs', shaped: 'node --test' });
  assert.deepEqual(shapeSuiteCommand('go test ./...', 3), { command: 'go test -p 3 ./...', shaped: 'go test' });
  assert.deepEqual(shapeSuiteCommand('node --test --test-concurrency=1', 3), { command: 'node --test --test-concurrency=1', shaped: null });
  assert.deepEqual(shapeSuiteCommand('go test -p 1 ./...', 3), { command: 'go test -p 1 ./...', shaped: null });
  assert.deepEqual(shapeSuiteCommand('sh ./run.sh', 3), { command: 'sh ./run.sh', shaped: null });
});

test('capToBudget keeps a lower project value, caps a higher one, notes an unknown one', () => {
  assert.deepEqual(capToBudget(1, 3), { n: 1, project: 1, capped: false, note: null });
  const hi = capToBudget(8, 3);
  assert.deepEqual([hi.n, hi.capped, hi.note], [3, true, 'project value 8 capped to the budget 3']);
  const un = capToBudget(null, 3);
  assert.deepEqual([un.n, un.capped, un.note], [3, false, 'project value unknown']);
});
