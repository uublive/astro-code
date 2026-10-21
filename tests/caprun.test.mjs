// Phase 47 t3 — spawn under a wall-clock cap, killing the whole process group (P7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => mkdtempSync(join(tmpdir(), 'caprun-'));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 4000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return fn();
};

test('a fast command returns status, output and timing', async () => {
  const { runCapped } = await import('../lib/caprun.mjs');
  const d = tmp();
  try {
    const r = await runCapped([process.execPath, '-e', 'console.log("hi");console.error("err")'], { cwd: d, capMs: 10000 });
    assert.equal(r.status, 0); assert.equal(r.capped, false);
    assert.equal(r.stdout.trim(), 'hi'); assert.equal(r.stderr.trim(), 'err');
    assert.equal(typeof r.durationMs, 'number');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a sleeper with a sleeping child is capped and both die', async () => {
  const { runCapped } = await import('../lib/caprun.mjs');
  const d = tmp();
  try {
    const script = join(d, 'sleeper.mjs');
    writeFileSync(script, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const c = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(join(d, 'pids'))}, process.pid + ' ' + c.pid);
setTimeout(() => {}, 60000);
`);
    const t0 = Date.now();
    const r = await runCapped([process.execPath, script], { cwd: d, capMs: 1000 });
    assert.equal(r.capped, true);
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0}ms`);
    const [a, b] = readFileSync(join(d, 'pids'), 'utf8').split(' ').map(Number);
    assert.ok(await until(() => !alive(a) && !alive(b)), 'both pids are gone');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('a missing binary resolves with an error and does not throw', async () => {
  const { runCapped } = await import('../lib/caprun.mjs');
  const r = await runCapped(['/nonexistent/definitely-not-here'], { capMs: 1000 });
  assert.equal(r.status, null); assert.ok(r.error);
});

test('no shell: an argv element is passed literally', async () => {
  const { runCapped } = await import('../lib/caprun.mjs');
  const d = tmp();
  try {
    const r = await runCapped([process.execPath, '-e', 'console.log(process.argv[1])', '; touch x'], { cwd: d, capMs: 10000 });
    assert.equal(r.stdout.trim(), '; touch x');
    assert.equal(existsSync(join(d, 'x')), false);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('stderr is appended to the log file', async () => {
  const { runCapped } = await import('../lib/caprun.mjs');
  const d = tmp();
  try {
    const log = join(d, 'tool.log');
    writeFileSync(log, 'before\n');
    await runCapped([process.execPath, '-e', 'console.error("boom")'], { cwd: d, capMs: 10000, logFile: log });
    assert.equal(readFileSync(log, 'utf8'), 'before\nboom\n');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
