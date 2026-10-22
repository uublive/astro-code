// Spawn a command under a wall-clock cap and kill its WHOLE process group (phase 47, P7).
//
// Why a group kill: Stryker and Gremlins spawn test runners as grandchildren. Killing only
// the direct child at the cap leaves those runners alive, burning CPU after `ac mutate` has
// reported. So the child is `detached` (its own process group) and the cap signals
// `-pid`: SIGTERM, then SIGKILL after a grace period. No shell is involved, so an argv
// element is never interpreted. On Windows there are no process groups, so it falls back
// to `child.kill()`.
//
// Both streams go to `logFile` by default (phase 48 D4/D7): Stryker and Gremlins print their
// progress on STDOUT, so a stderr-only log hid which step a capped run was in. `logStdout: false`
// restores stderr-only for collect steps whose stdout is the payload. `onData(chunk, stream)` sees
// every chunk in order so a caller can scan for step markers while the run is live, and
// `tailBytes` bounds the returned `stdout` to its last N bytes (a 5,000-mutant run prints
// megabytes; the log file has them all) — the default stays the full output for collect steps.
//
// Total: never throws. A missing binary resolves `{ status: null, error }`.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';

export function runCapped(argv, { cwd, env, capMs, logFile, graceMs = 2000, logStdout = true, onData, tailBytes } = {}) {
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
      if (tailBytes > 0) stdout = Buffer.from(stdout).subarray(-tailBytes).toString();
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
    const log = (d) => { if (logFile) { try { appendFileSync(logFile, d); } catch { /* log is best effort */ } } };
    child.stdout.on('data', (d) => {
      stdout += d;
      // Keep a little over the bound so a multi-byte character cut at the edge is not mid-sequence.
      if (tailBytes > 0 && stdout.length > tailBytes * 2) stdout = stdout.slice(-tailBytes * 2);
      if (logStdout) log(d);
      if (onData) { try { onData(String(d), 'stdout'); } catch { /* a hook never breaks the run */ } }
    });
    child.stderr.on('data', (d) => {
      stderr += d;
      log(d);
      if (onData) { try { onData(String(d), 'stderr'); } catch { /* a hook never breaks the run */ } }
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
