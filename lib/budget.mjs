// The worker budget of a heavy job (phase 59, ADR-096): how many things a test suite or a
// mutation run may do at once.
//
// Why adaptive: Gremlins with no config starts one worker per CPU, each running `go test` on every
// CPU; on an 11-CPU Mac already holding Docker, Chrome and a few dozen sessions that starved the
// machine into a watchdog kernel panic. A fixed number is wrong both ways (too hot on a small box,
// needlessly slow on a big idle one), so the budget is computed at the start of each heavy job from
// the CPUs and the memory that is free right now: a quarter of the cores, fewer when memory is
// tight, never under 1. A project setting (`heavy.workers`) is the owner's explicit choice and wins.
//
// Why not `os.freemem()`: on macOS it counts only the truly free pages and ignores the inactive
// and speculative ones the kernel hands back on demand, so it reads a healthy Mac as nearly full.
// `vm_stat` (macOS) and `MemAvailable` (Linux) are the numbers the OS itself calls available. A
// container limit (`process.constrainedMemory()`) lowers it further when it is below the machine.
//
// Pure core (`workerBudget`, `mergeGoFlags`, `shapeSuiteCommand`, `capToBudget`) plus thin readers
// that never throw: a reader that fails returns null and the budget falls back to the CPU rule.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, platform as osPlatform, totalmem } from 'node:os';
import { loadConfig } from './config.mjs';

const GIB = 1024 ** 3;
export const RESERVE_BYTES = 2 * GIB;
export const PER_WORKER_BYTES = 2 * GIB;

export function workerBudget({ cpus, freeBytes, setting } = {}) {
  const c = Math.max(1, Math.floor(Number(cpus)) || 1);
  const free = Number.isFinite(freeBytes) ? freeBytes : null;
  if (Number.isInteger(setting) && setting >= 1) {
    return { n: setting, source: 'setting', reason: `project setting heavy.workers = ${setting}`, cpus: c, free_bytes: free };
  }
  const cap = Math.ceil(c / 4);
  if (free === null) {
    const n = Math.max(1, cap);
    return { n, source: 'adaptive', reason: `adaptive: ${c} CPUs, free memory unreadable — CPU-only rule → ${n}`, cpus: c, free_bytes: null };
  }
  const byMem = Math.floor((free - RESERVE_BYTES) / PER_WORKER_BYTES);
  const n = Math.max(1, Math.min(cap, byMem));
  return { n, source: 'adaptive', reason: `adaptive: ${c} CPUs, ${(free / GIB).toFixed(1)} GB free → ${n}`, cpus: c, free_bytes: free };
}

// Memory the OS says is available, in bytes, or null. Every input is injectable for the tests.
export function readAvailableMemory({
  platform = osPlatform(),
  run = (cmd) => execFileSync(cmd, [], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }),
  readFile = (p) => readFileSync(p, 'utf8'),
  constrained = typeof process.constrainedMemory === 'function' ? process.constrainedMemory() : 0,
  total = totalmem(),
} = {}) {
  let avail = null;
  try {
    if (platform === 'darwin') {
      const out = String(run('vm_stat'));
      const page = Number(/page size of (\d+) bytes/.exec(out)?.[1]);
      const pages = (name) => Number(new RegExp(`^Pages ${name}:\\s+(\\d+)`, 'm').exec(out)?.[1]);
      const sum = pages('free') + pages('inactive') + pages('speculative');
      if (Number.isFinite(page) && Number.isFinite(sum)) avail = sum * page;
    } else if (platform === 'linux') {
      const kb = Number(/^MemAvailable:\s+(\d+)\s*kB/m.exec(String(readFile('/proc/meminfo')))?.[1]);
      if (Number.isFinite(kb)) avail = kb * 1024;
    }
  } catch { avail = null; }
  if (avail === null || !(avail >= 0)) return null;
  if (constrained > 0 && constrained < total) avail = Math.min(avail, constrained);
  return avail;
}

// `heavy.workers` from .astrocode/config.json: an integer >= 1, else a warning and null.
export function budgetSetting(root, warnings = []) {
  const raw = loadConfig(root)?.heavy?.workers;
  if (raw === undefined) return null;
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1) return n;
  warnings.push(`heavy.workers "${raw}" is not an integer >= 1 — ignored`);
  return null;
}

export function resolveBudget(root, { warnings = [], cpus = availableParallelism(), freeBytes } = {}) {
  const setting = budgetSetting(root, warnings);
  // The memory read is skipped when a setting decides, so an explicit number costs no `vm_stat`.
  const free = setting !== null ? null : freeBytes === undefined ? readAvailableMemory() : freeBytes;
  return workerBudget({ cpus, freeBytes: free, setting });
}

// Keep every existing GOFLAGS word; an existing `-p=K` stays only when K < n, else it becomes `-p=n`.
export function mergeGoFlags(existing, n) {
  const words = String(existing ?? '').split(/\s+/).filter(Boolean);
  const at = words.findIndex((w) => /^-p=\d+$/.test(w));
  if (at < 0) return [...words, `-p=${n}`].join(' ');
  if (Number(words[at].slice(3)) < n) return words.join(' ');
  words[at] = `-p=${n}`;
  return words.join(' ');
}

export function budgetEnv(env, n) {
  return { ...env, GOMAXPROCS: String(n), ASTRO_WORKERS: String(n), GOFLAGS: mergeGoFlags(env.GOFLAGS, n) };
}

// Insert the runner's own flag right after a leading `node --test` / `go test`. A command that
// already carries the flag, or is anything else (opaque), is returned untouched and gets the env only.
export function shapeSuiteCommand(command, n) {
  const c = String(command);
  const node = /^(\s*node\s+--test)(?=\s|$)/.exec(c);
  if (node) {
    if (/--test-concurrency\b/.test(c)) return { command: c, shaped: null };
    return { command: `${node[1]} --test-concurrency=${n}${c.slice(node[1].length)}`, shaped: 'node --test' };
  }
  const go = /^(\s*go\s+test)(?=\s|$)/.exec(c);
  if (go) {
    if (/\s-p[=\s]\d/.test(c)) return { command: c, shaped: null };
    return { command: `${go[1]} -p ${n}${c.slice(go[1].length)}`, shaped: 'go test' };
  }
  return { command: c, shaped: null };
}

// A tool's own config (`workers`, `concurrency`): lower is respected, higher is capped and said so.
// `undefined` means the project sets nothing (no note); `null` means it set something unreadable.
export function capToBudget(projectValue, n) {
  if (projectValue === undefined) return { n, project: null, capped: false, note: null };
  const p = Number(projectValue);
  if (projectValue === null || !Number.isInteger(p) || p < 1) return { n, project: null, capped: false, note: 'project value unknown' };
  if (p < n) return { n: p, project: p, capped: false, note: null };
  if (p > n) return { n, project: p, capped: true, note: `project value ${p} capped to the budget ${n}` };
  return { n, project: p, capped: false, note: null };
}
