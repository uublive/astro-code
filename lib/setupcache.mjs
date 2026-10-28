// Setup cache (phase 54, D8): a declared expensive setup step (build the pre-phase binary at commit X,
// stand up a scratch world) is run once per (commit, exact command) and reused after that.
//
// The bug this prevents: criteria were heavy scenarios rebuilt from scratch on every verify run (the
// astrobot phase-104/105 pattern: a pre-phase binary build per run, ten runs over ~22 h). The result
// of a build at a fixed commit does not change, so rebuilding it is pure cost.
//
// The declaration is DATA, in `.astrocode/config.json` (333f), the `mutation.files` precedent:
//   setup.steps.<name> = { command, commit? }   (commit defaults to HEAD)
//   setup.max_mb       = cap on the whole cache  (default 2048)
// set with `ac config set`. Nothing is guessed from prose.
//
// Reuse is code, never judgement (333f/ce7b), and keyed like a suite receipt: sha256(<resolved FULL
// sha> NUL <exact command>), so a different commit or a one-character change of the command is a
// different key and can never be served a stale result. An entry is reusable only when its
// `entry.json` says exit 0 for that command and commit and its `out/` is present. A failing step is
// NEVER stored: reusing a failure would turn one flaky build into a permanent one.
//
// The store lives under `.astrocode/.local/setup-cache/<key>/` (entry.json + out/). `.local` carries
// a `*` .gitignore, so a cached build never shows up as something to commit.
//
// A miss runs the step in a DETACHED `git worktree` of the resolved commit under the OS temp dir (so
// it builds exactly that commit whatever the working tree holds) and removes it afterwards. The env
// carries AC_SETUP_COMMIT, AC_SETUP_OUT (the entry's `out/`, where results go) and AC_PROJECT_ROOT.
//
// Eviction runs after a store under the project lock: oldest first by `entry.json.at` (creation time,
// never refreshed on reuse, so the rule is deterministic), until the total is at most the cap. An
// entry larger than the cap on its own is not kept, and the result says so.
//
// `ensureLocalDir` is reached by a dynamic import inside the function, so this module cannot form a
// load cycle with `lib/verdict.mjs`.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { loadConfig } from './config.mjs';
import { atomicWriteJSON, withLock } from './util.mjs';

export const DEFAULT_MAX_MB = 2048;
const MB = 1024 * 1024;

export const setupKey = ({ commit, command }) =>
  createHash('sha256').update(`${commit}\0${command}`).digest('hex');

export const setupDir = (root) => join(paths(root).local, 'setup-cache');

/** The declared steps as `{ name: { command, commit } }`; a malformed entry is skipped. */
export function declaredSteps(root) {
  const steps = loadConfig(root)?.setup?.steps;
  const out = {};
  if (steps && typeof steps === 'object' && !Array.isArray(steps)) {
    for (const [name, s] of Object.entries(steps)) {
      if (s && typeof s.command === 'string' && s.command.trim()) {
        out[name] = { command: s.command, commit: typeof s.commit === 'string' && s.commit ? s.commit : 'HEAD' };
      }
    }
  }
  return out;
}

export function maxMb(root) {
  const v = loadConfig(root)?.setup?.max_mb;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_MB;
}

function dirBytes(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : lstatSync(p).size;
  }
  return n;
}

const readEntry = (root, key) => {
  try { return JSON.parse(readFileSync(join(setupDir(root), key, 'entry.json'), 'utf8')); } catch { return null; }
};

/** Every stored entry, oldest first. */
export function storedEntries(root) {
  const dir = setupDir(root);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const e = readEntry(root, d.name);
    if (e && typeof e.key === 'string') out.push(e);
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)) || a.key.localeCompare(b.key));
}

/** `{ steps, max_mb, entries }` for `ac setup list`. */
export function listSetup(root) {
  return { steps: declaredSteps(root), max_mb: maxMb(root), entries: storedEntries(root) };
}

/**
 * Evict oldest-first until the cache total is at most `max_mb`. `keep` (a key) is evicted last, so a
 * tie on `at` never costs the entry just stored. Returns the evicted keys.
 */
export async function evictSetup(root, { keep } = {}) {
  const cap = maxMb(root) * MB;
  return withLock(paths(root).lock, () => {
    const entries = storedEntries(root).sort((a, b) => (a.key === keep) - (b.key === keep));
    // `keep` last, otherwise by age as storedEntries already ordered.
    let total = entries.reduce((n, e) => n + (e.bytes || 0), 0);
    const evicted = [];
    for (const e of entries) {
      if (total <= cap) break;
      rmSync(join(setupDir(root), e.key), { recursive: true, force: true });
      total -= e.bytes || 0;
      evicted.push(e.key);
    }
    return evicted;
  });
}

/**
 * Run (or reuse) the declared step `name`. Throws a one-line, actionable Error for an undeclared name
 * or an unresolvable commit (b940: a refusal always says why). Otherwise returns
 * `{ name, command, commit, key, reused, exit, seconds, out, bytes, evicted, kept, warning? }`.
 */
export async function runSetup(root, name, { commit, spawn = spawnSync, json = false } = {}) {
  const steps = declaredSteps(root);
  const step = steps[name];
  if (!step) {
    throw new Error(`no setup step "${name}" declared — declare it with \`ac config set setup.steps.${name} '{"command":"…"}'\``
      + (Object.keys(steps).length ? ` (declared: ${Object.keys(steps).join(', ')})` : ''));
  }
  const ref = commit || step.commit;
  const rev = git(['rev-parse', '--verify', `${ref}^{commit}`], { cwd: root });
  if (rev.status !== 0) throw new Error(`cannot resolve setup commit "${ref}"`);
  const sha = rev.stdout.trim();
  const key = setupKey({ commit: sha, command: step.command });
  const dir = join(setupDir(root), key);
  const out = join(dir, 'out');
  const base = { name, command: step.command, commit: sha, key, out };

  const hit = readEntry(root, key);
  if (hit && hit.exit === 0 && hit.command === step.command && hit.commit === sha && existsSync(out)) {
    return { ...base, reused: true, exit: 0, seconds: hit.seconds, bytes: hit.bytes, evicted: [], kept: true };
  }

  const { ensureLocalDir } = await import('./verdict.mjs');
  ensureLocalDir(root);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const tmp = mkdtempSync(join(tmpdir(), 'ac-setup-'));
  const wt = join(tmp, 'wt');
  const add = git(['worktree', 'add', '--detach', wt, sha], { cwd: root });
  if (add.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`cannot check out ${sha.slice(0, 7)} for the setup step: ${add.stderr.trim().split('\n')[0]}`);
  }
  const started = Date.now();
  let res;
  try {
    res = spawn(step.command, {
      shell: true, cwd: wt,
      env: { ...process.env, AC_SETUP_COMMIT: sha, AC_SETUP_OUT: out, AC_PROJECT_ROOT: root },
      stdio: json ? ['inherit', 2, 'inherit'] : 'inherit',
    });
  } finally {
    git(['worktree', 'remove', '--force', wt], { cwd: root });
    git(['worktree', 'prune'], { cwd: root });
    rmSync(tmp, { recursive: true, force: true });
  }
  const exit = res?.status ?? 1;
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  if (exit !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return { ...base, reused: false, exit, seconds, bytes: 0, evicted: [], kept: false };
  }
  const bytes = dirBytes(out);
  const entry = { version: 1, key, name, command: step.command, commit: sha, exit: 0, at: new Date().toISOString(), seconds, bytes };
  if (bytes > maxMb(root) * MB) {
    rmSync(dir, { recursive: true, force: true });
    return { ...base, reused: false, exit: 0, seconds, bytes, evicted: [], kept: false,
      warning: `result is ${(bytes / MB).toFixed(1)} MB, over setup.max_mb (${maxMb(root)}) — ran, but not kept` };
  }
  atomicWriteJSON(join(dir, 'entry.json'), entry);
  const evicted = await evictSetup(root, { keep: key });
  return { ...base, reused: false, exit: 0, seconds, bytes, evicted, kept: true };
}
