// The machine-wide heavy-job lock (phase 59, ADR-096): one test suite or mutation run at a time per
// user, whatever project it belongs to. A second job WAITS its turn and says what it waits for.
//
// It is NOT `withLock` (lib/util.mjs). That mutex reclaims a lock after 10 s by mtime, which is right
// for a millisecond state write and wrong here: a mutation run holds the lock for minutes, so a
// mtime rule would steal a live holder's lock and run two heavy jobs at once, the very thing this
// lock exists to stop. Here a holder is dead only when its process is provably gone.
//
// Liveness (a live holder is NEVER stolen): `process.kill(pid, 0)` throwing ESRCH means dead (EPERM
// means alive). A live pid whose start time differs from the recorded one by over 2 s is a reused
// pid, so dead. If `ps` fails we cannot tell, and "alive" is the safe answer. A lock directory with
// no holder.json older than 30 s was left by a holder killed between mkdir and write: dead.
//
// Synchronous on purpose (`runSuite` is sync): `mkdirSync` is the atomic acquire, waits use
// `Atomics.wait`. The first attempt is immediate (no pre-sleep), so a free lock adds no delay.
// Reentrant: a nested `ac` launched by the holder's own child (the suite runs `ac suite run`)
// carries `ASTRO_HEAVY_LOCK=<token>` and must not deadlock on its own parent.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const POLL_START_MS = 100;
const POLL_MAX_MS = 1000;
const REMIND_MS = 30000;
const START_SLACK_MS = 2000;
const NO_HOLDER_GRACE_MS = 30000;

/** Home of all machine state: `ASTRO_HEAVY_DIR`, else `~/.astro/heavy` (the principles-dir pattern). */
export function heavyHome(env = process.env) {
  return env.ASTRO_HEAVY_DIR || join(env.HOME || homedir(), '.astro', 'heavy');
}

const lockDir = (env) => join(heavyHome(env), 'lock');
const holderFile = (dir) => join(dir, 'holder.json');

// The process whose lock this is, in this process: set on a real acquire, cleared on release.
let held = null;

function readHolder(dir) {
  try { return JSON.parse(readFileSync(holderFile(dir), 'utf8')); } catch { return null; }
}

// Start time of a live pid in ms, or null when `ps` cannot say.
function startedMsOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/** True when the holder's process is provably gone (see the module header). */
export function holderIsDead(holder) {
  const pid = Number(holder?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try { process.kill(pid, 0); } catch (e) { return e.code === 'ESRCH'; }
  if (!Number.isFinite(holder.started_ms)) return false;
  const actual = startedMsOf(pid);
  return actual !== null && Math.abs(actual - holder.started_ms) > START_SLACK_MS;
}

const defaultSleep = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const defaultOnWait = (line) => { try { writeSync(2, `${line}\n`); } catch { /* a closed stderr never blocks the wait */ } };

function age(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

export function acquireMachineLock({ project = '', command = '', env = process.env, onWait = defaultOnWait, sleep = defaultSleep, now = Date.now } = {}) {
  const t0 = now();
  const dir = lockDir(env);
  if (held && held.dir === dir) return { release() {}, token: held.token, waited_ms: 0, took_over: null, reentrant: true };
  if (env.ASTRO_HEAVY_LOCK && readHolder(dir)?.token === env.ASTRO_HEAVY_LOCK) {
    return { release() {}, token: env.ASTRO_HEAVY_LOCK, waited_ms: 0, took_over: null, reentrant: true };
  }
  mkdirSync(heavyHome(env), { recursive: true });
  const token = randomBytes(8).toString('hex');
  let tookOver = null;
  let poll = POLL_START_MS;
  let lastWarn = null;
  let slept = false;
  for (;;) {
    try {
      mkdirSync(dir);
      const holder = { pid: process.pid, started_ms: Date.now() - process.uptime() * 1000, acquired_ms: now(), project, command, token };
      writeFileSync(holderFile(dir), JSON.stringify(holder));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const holder = readHolder(dir);
    let dead = false;
    if (holder) dead = holderIsDead(holder);
    else {
      try { dead = now() - statSync(dir).mtimeMs > NO_HOLDER_GRACE_MS; } catch { continue; }
    }
    if (dead) {
      // The rename is atomic: of several racers exactly one moves the directory away.
      const grave = `${dir}.dead-${process.pid}-${randomBytes(3).toString('hex')}`;
      try { renameSync(dir, grave); } catch { continue; }
      const moved = readHolder(grave);
      if ((moved?.token ?? null) !== (holder?.token ?? null)) {
        // We moved a NEWER live holder's lock (it was taken over between our read and our rename): put it back.
        try { renameSync(grave, dir); } catch { /* someone already re-created it; the grave is then rmed below */ }
        try { rmSync(grave, { recursive: true, force: true }); } catch { /* best effort */ }
        continue;
      }
      try { rmSync(grave, { recursive: true, force: true }); } catch { /* best effort */ }
      tookOver = { project: holder?.project ?? null, command: holder?.command ?? null, pid: holder?.pid ?? null };
      continue;
    }
    const nowMs = now();
    if (lastWarn === null || nowMs - lastWarn >= REMIND_MS) {
      lastWarn = nowMs;
      const since = holder?.acquired_ms ?? nowMs;
      onWait(`⊡ waiting for the machine lock: ${holder?.project ?? '?'} \`${holder?.command ?? '?'}\` (held ${age(nowMs - since)}, pid ${holder?.pid ?? '?'}) — starts when it ends`);
    }
    slept = true;
    sleep(poll);
    poll = Math.min(POLL_MAX_MS, poll * 2);
  }
  held = { dir, token };
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (held?.token === token) held = null;
    if (readHolder(dir)?.token !== token) return;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* a stale dir is taken over next time */ }
  };
  return { release, token, waited_ms: slept ? now() - t0 : 0, took_over: tookOver, reentrant: false };
}
