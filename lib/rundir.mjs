// Per-run folders of a heavy job (phase 59, ADR-096): `<home>/runs/ac-run-<pid>-<rand6>/` holds the
// run's private TMPDIR (`tmp/`) and an `owner.json` naming the process that owns it.
//
// Why: Gremlins' work folders and a suite's temp files used to pile up in the shared temp root
// (6 GB of `gremlins-*` left by crashed runs). A run now owns one folder, removed when the run
// ends; a run that died (kill -9, power loss) cannot clean up, so the NEXT run sweeps dead owners.
//
// The sweep is deliberately narrow, because it deletes: only direct children of `runs/`, named
// `ac-run-<digits>-<alnum>`, that are real directories (`lstat`: a symlink is never followed or
// removed), whose owner is dead, or that have no owner.json and are older than 60 s (a run killed
// between mkdir and the owner write). Anything ac did not create is never touched.
//
// The liveness rule is the machine lock's, kept as a small local copy so the modules stay independent.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const NAME = /^ac-run-\d+-[a-z0-9]+$/;
const NO_OWNER_GRACE_MS = 60000;
const START_SLACK_MS = 2000;

function startedMsOf(pid) {
  try {
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

/** An owner is alive unless its pid is gone, or reused by a process started at a different time. */
export function ownerAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { return e.code !== 'ESRCH'; }
  if (!Number.isFinite(owner.started_ms)) return true;
  const actual = startedMsOf(pid);
  return actual === null || Math.abs(actual - owner.started_ms) <= START_SLACK_MS;
}

export function makeRunDir(home) {
  const dir = join(home, 'runs', `ac-run-${process.pid}-${randomBytes(3).toString('hex')}`);
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, started_ms: Date.now() - process.uptime() * 1000 }));
  return { dir, tmp };
}

/** Remove one run folder. Refuses (throws) anything that is not `<…>/runs/ac-run-*`. */
export function removeRunDir(dir) {
  if (basename(dirname(dir)) !== 'runs' || !NAME.test(basename(dir))) throw new Error(`refusing to remove ${dir}: not a run folder`);
  const rm = () => rmSync(dir, { recursive: true, force: true });
  try { rm(); } catch (e) { if (e.code === 'ENOTEMPTY') rm(); else throw e; }
}

function sizeOf(p) {
  let st;
  try { st = lstatSync(p); } catch { return 0; }
  if (!st.isDirectory()) return st.size;
  let sum = 0;
  try { for (const n of readdirSync(p)) sum += sizeOf(join(p, n)); } catch { /* unreadable: counted as 0 */ }
  return sum;
}

export function sweepDeadRuns(home, { isAlive = ownerAlive, now = Date.now } = {}) {
  const runs = join(home, 'runs');
  const removed = [];
  let bytes = 0;
  let names = [];
  try { names = readdirSync(runs); } catch { return { removed, bytes }; }
  for (const name of names) {
    if (!NAME.test(name)) continue;
    const dir = join(runs, name);
    let st;
    try { st = lstatSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    let owner = null;
    try { owner = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8')); } catch { /* no owner yet */ }
    const dead = owner ? !isAlive(owner) : now() - st.mtimeMs > NO_OWNER_GRACE_MS;
    if (!dead) continue;
    const size = sizeOf(dir);
    try { removeRunDir(dir); } catch { continue; }
    removed.push(name);
    bytes += size;
  }
  return { removed, bytes };
}
