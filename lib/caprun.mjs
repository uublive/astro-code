// Spawn a command under a wall-clock cap and kill its WHOLE process group (phase 47, P7).
//
// Why a group kill: Stryker and Gremlins spawn test runners as grandchildren. Killing only
// the direct child at the cap leaves those runners alive, burning CPU after `ac mutate` has
// reported. So the child is `detached` (its own process group) and the cap signals
// `-pid`: SIGTERM, then SIGKILL after a grace period. No shell is involved, so an argv
// element is never interpreted. On Windows there are no process groups, so it falls back
// to `child.kill()`.
//
// Total: never throws. A missing binary resolves `{ status: null, error }`.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function runCapped(argv, { cwd, env, capMs, logFile, graceMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = '';
    let stderr = '';
    let capped = false;
    let settled = false;
    let timer;
    let killer;
    const done = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killer);
      resolve({ status: null, capped, stdout, stderr, durationMs: Date.now() - t0, ...extra });
    };
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      return done({ error });
    }
    const signal = (sig) => {
      try {
        if (process.platform === 'win32') child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch { /* already gone */ }
    };
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => {
      stderr += d;
      if (logFile) { try { appendFileSync(logFile, d); } catch { /* log is best effort */ } }
    });
    child.on('error', (error) => done({ error }));
    // 'close' waits for stdio to drain; after a group kill the pipes close with the group.
    child.on('close', (status, sig) => {
      // Sweep stragglers (grandchildren that outlived a clean exit) — harmless if none.
      if (capped) signal('SIGKILL');
      done({ status: capped ? null : status, signal: sig ?? null });
    });
    if (capMs > 0) {
      timer = setTimeout(() => {
        capped = true;
        signal('SIGTERM');
        killer = setTimeout(() => { signal('SIGKILL'); }, graceMs);
        // Do not wait forever for a child that ignores both signals or holds the pipes.
        setTimeout(() => done({ signal: 'SIGKILL' }), graceMs + 500).unref?.();
      }, capMs);
    }
  });
}
