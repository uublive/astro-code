// `enterHeavy`: the ONE entry every heavy job (a test suite, a mutation run) goes through (phase 59,
// ADR-096). It composes the machine lock, the worker budget, the dead-run sweep, the per-run folder,
// the private Go cache and the signal handlers, so `runSuite` and `runMutate` each make one call and
// one `leave()` instead of six.
//
// Why the order is lock -> budget -> sweep -> run dir -> cache:
// - lock first: a second job waits before it measures anything. The budget reads FREE MEMORY, and the
//   number read while another job still runs would be too low (and, while it waits, stale). Read once
//   the lock is held, it is the memory the job will actually start with.
// - sweep before the run dir, so a fresh folder is never mistaken for a dead one.
// - the cache trim only for mutation: see below.
//
// Why suites do not get GOCACHE: a mutation run recompiles for every mutant and fills the cache with
// throwaway entries, so it gets a private, capped one. A normal `go test` suite builds the project's
// own packages and benefits from the user's warm cache; moving it would slow every suite to a cold build.
//
// Cleanup on every ending: `leave()` (idempotent) runs in the caller's `finally`; SIGINT/SIGTERM/SIGHUP
// kill the live child groups (a test runner left burning CPU is the failure this phase exists to stop),
// then leave and exit 128+signal; an `exit` hook covers `die()` paths that never reach a `finally`.
// A `kill -9` cannot run any of this, so the next run's sweep removes that run's folder.
import { mkdirSync } from 'node:fs';
import { constants } from 'node:os';
import { acquireMachineLock, heavyHome } from './machinelock.mjs';
import { budgetEnv, resolveBudget } from './budget.mjs';
import { makeRunDir, removeRunDir, sweepDeadRuns } from './rundir.mjs';
import { goCacheDir, goCacheMaxMb, trimGoCache } from './gocache.mjs';
import { killLiveGroups, liveGroups } from './caprun.mjs';

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const TERM_GRACE_MS = 2000;

const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const groupAlive = (pid) => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

// Ask the live groups to stop, give them 2 s, then force it. Synchronous: it runs inside a signal handler.
function stopLiveGroups() {
  const pids = liveGroups();
  if (!pids.length) return;
  killLiveGroups('SIGTERM');
  const end = Date.now() + TERM_GRACE_MS;
  while (Date.now() < end && pids.some(groupAlive)) sleepSync(50);
  killLiveGroups('SIGKILL');
}

export function enterHeavy(root, { kind, command = '', env = process.env, onWait, sleep } = {}) {
  const home = heavyHome(env);
  const lockArgs = { project: root, command, env };
  if (onWait) lockArgs.onWait = onWait;
  if (sleep) lockArgs.sleep = sleep;
  const lock = acquireMachineLock(lockArgs);
  let run;
  let handlers = [];
  try {
    const warnings = [];
    const workers = resolveBudget(root, { warnings });
    const swept = sweepDeadRuns(home);
    run = makeRunDir(home);
    let goCache = null;
    const childEnv = {
      ...budgetEnv(env, workers.n),
      TMPDIR: run.tmp, TMP: run.tmp, TEMP: run.tmp, GOTMPDIR: run.tmp,
      ASTRO_HEAVY_LOCK: lock.token,
    };
    const cap = () => goCacheMaxMb(root, warnings) * 1024 * 1024;
    if (kind === 'mutation') {
      const dir = goCacheDir(home);
      mkdirSync(dir, { recursive: true });
      childEnv.GOCACHE = dir;
      goCache = { dir, ...trimGoCache(dir, cap()) };
    }

    let left = false;
    const heavy = {
      workers,
      env: childEnv,
      run_dir: run.dir,
      tmp: run.tmp,
      lock: { waited_ms: lock.waited_ms, took_over: lock.took_over, reentrant: lock.reentrant },
      cleaned: swept.removed.length ? { count: swept.removed.length, bytes: swept.bytes, names: swept.removed } : null,
      go_cache: goCache,
      warnings,
      leave() {
        if (left) return;
        left = true;
        for (const [ev, fn] of handlers) process.removeListener(ev, fn);
        handlers = [];
        try { removeRunDir(run.dir); } catch { /* the next run's sweep removes it */ }
        if (goCache) Object.assign(goCache, trimGoCache(goCache.dir, cap()));
        lock.release();
      },
    };
    for (const sig of SIGNALS) {
      const fn = () => {
        stopLiveGroups();
        heavy.leave();
        process.exit(128 + (constants.signals[sig] ?? 0));
      };
      handlers.push([sig, fn]);
      process.on(sig, fn);
    }
    const onExit = () => heavy.leave();
    handlers.push(['exit', onExit]);
    process.on('exit', onExit);
    return heavy;
  } catch (e) {
    for (const [ev, fn] of handlers) process.removeListener(ev, fn);
    if (run) { try { removeRunDir(run.dir); } catch { /* swept later */ } }
    lock.release();
    throw e;
  }
}
