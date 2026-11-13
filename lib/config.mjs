// Read and mutate .astrocode/config.json (project settings, including model tiers).
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export function loadConfig(root) {
  return readJSON(paths(root).config) || {};
}

export async function updateConfig(root, mutate) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const cfg = readJSON(p.config) || {};
    const next = mutate({ ...cfg }) || cfg;
    atomicWriteJSON(p.config, next);
    return next;
  });
}

// Per-role model tiers ("opus" | "sonnet" | "haiku": haiku is a per-role user choice since ADR-073, and
// the balanced and fast profiles put it on the integrator only, #125). An unset role means
// "inherit the session model" — workflows pass undefined and the agent inherits. A role the
// project leaves unset falls back to the user's default (#110, below).
export function resolveModels(root, home = homedir()) {
  return withUserRoleDefaults(loadConfig(root), home).cfg.models || {};
}

// ADR-026: sequential phases with >=2 executable tasks batch onto ONE warm
// executor by default. Default true (via `!== false`) so projects predating
// this key — whose config.json never set it — stay on the fast batched path
// instead of silently reverting to the slower per-task cold-start behavior.
export function leanExecutionEnabled(root) {
  return loadConfig(root).lean_execution !== false;
}

// ── User-level role defaults (#110) ─────────────────────────────────────────────
//
// `models` and `reasoning` per role can also be set once per USER, in
// `~/.astro/config.json` beside `agent_tools` and the statusline gauges. Resolution per
// role: the project's `.astrocode/config.json`, then the user default, then the built-in
// default (an unset role — the session model, DEFAULT_REASONING at the read site).
// The user file is shared with other settings, so only the two keys are read or written.

const ROLE_KEYS = ['models', 'reasoning'];
const userConfigFile = (home) => join(home, '.astro', 'config.json');

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

/** The user's per-role defaults — `{ models, reasoning }`, each `{}` when absent or invalid. */
export function userRoleDefaults(home = homedir()) {
  let cfg = null;
  try { cfg = JSON.parse(readFileSync(userConfigFile(home), 'utf8')); } catch { /* none / not JSON */ }
  const out = {};
  for (const k of ROLE_KEYS) {
    const raw = isObject(cfg) && isObject(cfg[k]) ? cfg[k] : {};
    out[k] = Object.fromEntries(Object.entries(raw).filter(([r, v]) => !r.startsWith('_') && typeof v === 'string' && v));
  }
  return out;
}

/**
 * The project config with the user's role defaults layered underneath it, plus where each
 * role's value came from (`project` | `user`; a role in neither is built-in).
 *
 * @param {object} cfg  the project's `.astrocode/config.json`
 * @param {string} [home]
 * @returns {{ cfg: object, sources: { models: Record<string,string>, reasoning: Record<string,string> } }}
 */
export function withUserRoleDefaults(cfg, home = homedir()) {
  const user = userRoleDefaults(home);
  const next = { ...cfg };
  const sources = {};
  for (const k of ROLE_KEYS) {
    const proj = isObject(cfg[k]) ? cfg[k] : {};
    const merged = { ...user[k], ...proj };
    sources[k] = Object.fromEntries(Object.keys(merged).filter((r) => !r.startsWith('_')).map((r) => [r, r in proj ? 'project' : 'user']));
    if (Object.keys(merged).length) next[k] = merged;
  }
  return { cfg: next, sources };
}

/**
 * Write the user's role defaults (`ac models <profile> --user`). Every other key in the
 * shared file is preserved, the write is atomic, and a file that is not a JSON object is
 * REFUSED rather than overwritten.
 *
 * @param {{ home?: string, models?: object, reasoning?: object }} a
 * @returns {{ ok: true, file: string } | { ok: false, error: string }}
 */
export function setUserRoleDefaults({ home = homedir(), ...roles }) {
  const file = userConfigFile(home);
  let cfg = {};
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
    if (!isObject(cfg)) return { ok: false, error: `${file} is not a JSON object — fix it first; nothing was changed` };
  }
  for (const k of ROLE_KEYS) if (roles[k]) cfg[k] = { ...roles[k] };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
  return { ok: true, file };
}

// ADR-093: a suite is "slow" past this many minutes (`verify.slow_suite_minutes`, default 10). A value
// that is not a finite number > 0 is ignored with a warning, so a typo never silently makes every
// suite fast (and a 50-minute suite run in the cheap pass). Converted to seconds by the caller once.
export const DEFAULT_SLOW_SUITE_MINUTES = 10;
export function slowSuiteMinutes(root, warnings = []) {
  const raw = loadConfig(root)?.verify?.slow_suite_minutes;
  if (raw === undefined) return DEFAULT_SLOW_SUITE_MINUTES;
  const n = typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0 && !(typeof raw === 'string' && !raw.trim())) return n;
  warnings.push(`verify.slow_suite_minutes "${raw}" is not a positive number — using ${DEFAULT_SLOW_SUITE_MINUTES}`);
  return DEFAULT_SLOW_SUITE_MINUTES;
}

// ADR-094: `verify.full_suite` picks what a phase PASS costs. `milestone` (the default, "fast mode") runs
// only the phase's targeted tests and carries the full suite to the milestone full check; `phase` is
// ADR-079/089/091/093's full suite on every phase PASS. Any other value falls back to `milestone` with a
// warning, never silently: a typo ("Phase", "fast") must not quietly pick a mode, and never aborts a verify.
export const DEFAULT_VERIFY_FULL_SUITE = 'milestone';
export function verifyFullSuite(root, warnings = []) {
  const raw = loadConfig(root)?.verify?.full_suite;
  if (raw === undefined) return DEFAULT_VERIFY_FULL_SUITE;
  if (raw === 'milestone' || raw === 'phase') return raw;
  warnings.push(`verify.full_suite "${raw}" is not milestone or phase — using ${DEFAULT_VERIFY_FULL_SUITE}`);
  return DEFAULT_VERIFY_FULL_SUITE;
}

// ADR-094: how many repair attempts one full-check fix gets (`verify.repair_attempts`, integer >= 1).
export const DEFAULT_REPAIR_ATTEMPTS = 2;
export function repairAttempts(root, warnings = []) {
  const raw = loadConfig(root)?.verify?.repair_attempts;
  if (raw === undefined) return DEFAULT_REPAIR_ATTEMPTS;
  if (Number.isInteger(raw) && raw >= 1) return raw;
  warnings.push(`verify.repair_attempts "${raw}" is not an integer >= 1 — using ${DEFAULT_REPAIR_ATTEMPTS}`);
  return DEFAULT_REPAIR_ATTEMPTS;
}

// ADR-094: the command that runs the targeted test files (`verify.targeted_command`). It must carry
// `{files}`; without it the files would never reach the runner and an empty run would read as green.
export const DEFAULT_TARGETED_COMMAND = 'node --test {files}';
export function targetedCommandTemplate(root, warnings = []) {
  const raw = loadConfig(root)?.verify?.targeted_command;
  if (raw === undefined) return DEFAULT_TARGETED_COMMAND;
  if (typeof raw === 'string' && raw.includes('{files}')) return raw;
  warnings.push(`verify.targeted_command "${raw}" has no {files} — using ${DEFAULT_TARGETED_COMMAND}`);
  return DEFAULT_TARGETED_COMMAND;
}

// ADR-094: the milestone full check's suite command (`verify.suite_command`); no default, null when unset.
export function suiteCommandSetting(root, warnings = []) {
  const raw = loadConfig(root)?.verify?.suite_command;
  if (raw === undefined) return null;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  warnings.push(`verify.suite_command "${raw}" is not a command string — ignored`);
  return null;
}
