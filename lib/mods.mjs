// astro-mods: the optional, Claude-only enforcement layer (ADR-071) -- its feature registry,
// its per-user switches, and the `claude plugin` lifecycle that installs it. The plugin itself
// lives in mods/astro-mods/; this module is the ONLY writer of the switches and the only thing
// that talks to `claude plugin`, so `bin/ac.mjs` stays a thin renderer.
//
// Why the switches live in ~/.astro/config.json under `mods` (beside `agent_tools`, ADR-068)
// and not in the plugin's `userConfig`: userConfig is per Claude PROFILE and invisible to the
// settings hooks of phases 37/38, which also run on Cursor. One per-user file is the single
// source for the mod, the hooks and every host. A missing key, a missing file, or a value that
// is not a boolean all mean OFF -- a typo can never turn enforcement on.
//
// A read never writes (`readMods` does not even create ~/.astro). `--switches-only` exists
// for the hot path: the plugin's `session.start` and the settings hooks need the switches
// without paying for a `claude` spawn, so `ac mods status --json --switches-only` reads the
// file and nothing else.
//
// Why the DEFAULT config dir drops CLAUDE_CONFIG_DIR (`claudeEnvFor`): `claude` relocates
// `~/.claude.json` when the variable is set, even to the path it would have used anyway. The
// default profile keeps Claude's own default layout; every other dir gets the variable.
//
// Why `ac` compares the marketplace path itself: `claude plugin marketplace add <path>` under
// an existing name silently RE-POINTS it and exits 0 (observed on 2.1.292). Left to claude, a
// user's own marketplace called `astro-code` would be replaced by ours without a word. So a
// foreign `astro-code` is a `collision` with a fix line and is never touched.
//
// Why a failed install rolls back the marketplace add THIS call made: a dir with the
// marketplace but no plugin is a half-install that later reads as "installed from a stale
// marketplace". Either the whole pair lands in a dir or none of it does. One dir failing never
// aborts the others -- a profile fan-out is best-effort per dir and reports each.
//
// Why a hook's switch IS its registration (ADR-072): a `hook` feature is a settings-hook entry
// in each host's config, not something a plugin loads. `enableMod` writes the entry, `disableMod`
// removes it, and `syncHookFeatures` (also run by `ac install`/`ac update`) re-aligns every
// config dir to the switch, so a profile added later gets it and a stale entry goes. The hook
// script never reads the switch; being registered means being on, and a disabled guard costs
// nothing. `modsStatus` therefore reports `enforcement` from the registrations actually found,
// never from the switch alone.
//
// Why Claude dirs are never created here: a missing dir is `absent`. Creating a Claude config
// dir would make Cursor start importing hooks from it, and would invent a profile.
//
// Why no `claude plugin` command runs against a dir that does not exist (phase 39, observed on
// 2.1.292): `claude --version` leaves HOME untouched, but ANY `claude plugin …` creates ~/.claude
// and ~/.claude.json. On a Cursor-only machine that would make the next `ac install` see a Claude
// home and flip Cursor into Claude-import mode. So `pluginState`/`ensurePlugin`/`updatePlugin`/
// `removePlugin` check the dir first: a missing one is `noDir`/`skipped`, with zero spawns.
//
// Why Cursor is reached only when detected: its native hooks.json is written only if Cursor is
// there, and it follows the same native-versus-import branch as the always-on hooks (a native
// guard beside Claude's own would fire twice).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import claudeHost, { configTargets } from './hosts/claude.mjs';
import cursorHost from './hosts/cursor.mjs';
import { GUARD_HOOKS } from './hosts/guards.mjs';

/** The one Claude Code floor for the whole plugin: first release with `agentId` on tool.check (2.1.290) and workflow agents on agent.spawn (2.1.292). */
export const MOD_FLOOR = '2.1.292';

const MARKETPLACE = 'astro-code';
const PLUGIN_NAME = 'astro-mods';
const PLUGIN_ID = `${PLUGIN_NAME}@${MARKETPLACE}`;

/** The eight features. `built` is true for phases 37, 38, 39, 41, 42, 43 and 44; phase 40 is parked, and enabling an unbuilt one records the switch and says so. */
export const FEATURES = Object.freeze([
  { name: 'canon-guard', kind: 'hook', phase: 37, built: true, description: 'refuse hand edits to generated and registry-owned state' },
  { name: 'git-guard', kind: 'hook', phase: 38, built: true, description: 'refuse unscoped destructive git in the shared tree' },
  { name: 'blindfold', kind: 'mod', phase: 39, built: true, description: 'keep the verifier and criteria-author plan-blind' },
  // Parked, not pending: phase 40's probe found no isolation signal on agent.spawn (Claude Code 2.1.292).
  { name: 'spawn-policy', kind: 'mod', phase: 40, built: false, parked: 'no isolation signal on Claude Code 2.1.292 — re-probe on a newer version', description: 'refuse a parallel executor spawned without worktree isolation (ADR-008)' },
  { name: 'witness', kind: 'mod', phase: 41, built: true, description: "tell a human acceptance from an agent's" },
  { name: 'brief-section', kind: 'mod', phase: 42, built: true, description: 'principles brief as one cached system-prompt section' },
  { name: 'phase-band', kind: 'mod', phase: 43, built: true, description: 'phase band with next-command buttons and id autocomplete' },
  { name: 'live-capture', kind: 'mod', phase: 44, built: true, description: 'offer principle capture from human-typed prompts' },
].map((f) => Object.freeze(f)));

/** Cursor's config dirs, only when Cursor is on this machine (an empty Map otherwise). */
export const defaultCursorTargets = () => (cursorHost.detect() ? cursorHost.configTargets() : new Map());

const NAMES = FEATURES.map((f) => f.name);
const featureOf = (name) => FEATURES.find((f) => f.name === name);
const configFile = (home) => join(home, '.astro', 'config.json');

// ── claude ──────────────────────────────────────────────────────────────────

/** Run `claude`. Never throws: a missing binary is `missing: true`, so callers branch instead of crash. */
export function runClaude(args, { env } = {}) {
  const r = spawnSync('claude', args, { encoding: 'utf8', timeout: 60000, windowsHide: true, env });
  const missing = !!(r.error && r.error.code === 'ENOENT');
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', missing };
}

/** `process.env` aimed at one Claude config dir (the default dir keeps Claude's own layout, so the variable is removed). */
export function claudeEnvFor(dir, { home = homedir() } = {}) {
  const env = { ...process.env };
  if (resolve(dir) === resolve(join(home, '.claude'))) delete env.CLAUDE_CONFIG_DIR;
  else env.CLAUDE_CONFIG_DIR = dir;
  return env;
}

/** The leading `X.Y.Z` of `claude --version` output, or null. */
export function parseClaudeVersion(text) {
  const m = /^\s*(\d+\.\d+\.\d+)/.exec(String(text ?? ''));
  return m ? m[1] : null;
}

/** Numeric per segment, so 2.1.1000 > 2.1.9. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** `{ found, version }` -- found:false when no claude is on PATH, version:null when the output is unreadable. */
export function claudeVersion({ run = runClaude } = {}) {
  const r = run(['--version'], { env: process.env });
  if (r.missing) return { found: false, version: null };
  return { found: true, version: parseClaudeVersion(r.stdout) };
}

// ── switches ────────────────────────────────────────────────────────────────

// ADR-081 -- `mods.machinePrefixes`: strings a tool of the user's own types at the head of a prompt.
// A prompt that starts with one is the tool's, never the human's. The validity rule lives HERE and
// nowhere else: the empty string (or a blank one) matches EVERY prompt, which would make the whole
// session machine-typed -- the failure ADR-081 warns about -- and a leading space could never match
// a trimmed prompt. Any violation voids the WHOLE list (never half-applied) with one warning.
const PREFIX_MAX_ENTRIES = 50;
const PREFIX_MAX_LEN = 200;
const PREFIX_WARNING = 'mods.machinePrefixes in ~/.astro/config.json must be a list of non-empty strings — no machine-typed prefixes apply';

function validPrefixes(list) {
  return Array.isArray(list) && list.length <= PREFIX_MAX_ENTRIES && list.every((p) =>
    typeof p === 'string' && p.trim() !== '' && p === p.trimStart() && [...p].length <= PREFIX_MAX_LEN);
}

/** `{ switches, warnings, configured, machinePrefixes }`. Never throws, never writes; a missing file or key is all off. */
export function readMods({ home = homedir() } = {}) {
  const switches = Object.fromEntries(NAMES.map((n) => [n, false]));
  const warnings = [];
  let configured = false;
  const machinePrefixes = [];
  const out = () => ({ switches, warnings, configured, machinePrefixes });
  const file = configFile(home);
  if (!existsSync(file)) return out();
  let cfg;
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
    warnings.push('~/.astro/config.json is not valid JSON — every mod is off');
    return out();
  }
  const raw = cfg && typeof cfg === 'object' ? cfg.mods : undefined;
  if (raw === undefined) return out();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('mods in ~/.astro/config.json must be an object of feature → true/false — every mod is off');
    return out();
  }
  configured = true;
  for (const n of NAMES) switches[n] = raw[n] === true;
  if (raw.machinePrefixes !== undefined) {
    if (validPrefixes(raw.machinePrefixes)) machinePrefixes.push(...raw.machinePrefixes);
    else warnings.push(PREFIX_WARNING);
  }
  return out();
}

/**
 * Flip one switch in `<home>/.astro/config.json` -- the only writer of the `mods` key. Mirrors
 * `updateAgentTools`: the file is shared, so sibling keys and unknown `mods` keys are kept, the
 * write is atomic, and a file that is not valid JSON is REFUSED rather than overwritten. An
 * unknown name is refused before anything is read or written.
 *
 * @returns {{ ok: true, switches: object } | { ok: false, error: string }}
 */
export function setMod({ home = homedir(), feature, on }) {
  if (!featureOf(feature)) return { ok: false, error: `unknown feature "${feature}" — use one of: ${NAMES.join(', ')}` };
  const file = configFile(home);
  let cfg = {};
  if (existsSync(file)) {
    try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return { ok: false, error: `${file} is not valid JSON — fix it first; nothing was changed` };
    }
  }
  const current = cfg.mods && typeof cfg.mods === 'object' && !Array.isArray(cfg.mods) ? { ...cfg.mods } : {};
  current[feature] = !!on;
  cfg.mods = current;
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
  renameSync(tmp, file);
  return { ok: true, switches: readMods({ home }).switches };
}

// ── plugin lifecycle ────────────────────────────────────────────────────────

/** Where `ac install` ships the marketplace. The plugin is installed FROM here, never from the repo checkout. */
export function modsMarketplacePath({ home = homedir() } = {}) {
  return join(home, '.astro', 'code', 'mods');
}

const canon = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
const dirsOf = (targets) => [...targets].map(([dir, label]) => ({ dir, label }));

// Run a `claude plugin … --json` command and parse its stdout. Anything that is not a clean
// exit with JSON is an error STRING, never a throw.
function jsonRun(run, args, env) {
  const r = run(args, { env });
  if (r.missing) return { ok: false, error: 'claude not found' };
  let parsed;
  try { parsed = JSON.parse(r.stdout); } catch { parsed = undefined; }
  if (r.status !== 0) {
    const code = parsed && (parsed.failureCode || parsed.outcome);
    return { ok: false, error: `claude ${args.slice(0, 3).join(' ')} failed${code ? ` (${code})` : ''}: ${firstLine(r.stderr) || firstLine(r.stdout) || `exit ${r.status}`}` };
  }
  if (parsed === undefined) return { ok: false, error: `claude ${args.slice(0, 3).join(' ')} printed no JSON` };
  return { ok: true, value: parsed };
}

function listMarketplaces(run, env) {
  const r = jsonRun(run, ['plugin', 'marketplace', 'list', '--json'], env);
  if (!r.ok) return r;
  return { ok: true, entries: Array.isArray(r.value) ? r.value : [] };
}

function listPlugins(run, env) {
  const r = jsonRun(run, ['plugin', 'list', '--json'], env);
  if (!r.ok) return r;
  return { ok: true, installed: (Array.isArray(r.value) ? r.value : []).some((p) => p && p.id === PLUGIN_ID) };
}

const marketplaceVerdict = (entries, mine) => {
  const found = entries.find((e) => e && e.name === MARKETPLACE);
  if (!found) return { marketplace: 'absent', marketplacePath: null };
  const path = found.path || found.installLocation || null;
  return { marketplace: path && canon(path) === canon(mine) ? 'ours' : 'other', marketplacePath: path };
};

const fixFor = (dir, home) => {
  const prefix = resolve(dir) === resolve(join(home, '.claude')) ? '' : `CLAUDE_CONFIG_DIR=${dir} `;
  return `${prefix}claude plugin marketplace remove ${MARKETPLACE}`;
};
const collisionMessage = (path) => `a different "${MARKETPLACE}" marketplace is already registered here (${path || 'unknown path'}) — left untouched`;

// `ac install` is the one place the plugin is installed (ADR-075), so every "not there yet" names it.
const NO_DIR_MESSAGE = 'no Claude Code config dir here yet — start Claude Code once, then run `ac install`';

/** One entry per target: `{ dir, label, marketplace: ours|other|absent|unknown, marketplacePath, installed, enabled, noDir?, error? }`. A dir that does not exist is `noDir: true` and costs no `claude` call. */
export function pluginState({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  const mine = modsMarketplacePath({ home });
  return dirsOf(targets).map(({ dir, label }) => {
    const env = claudeEnvFor(dir, { home });
    const base = { dir, label, marketplace: 'unknown', marketplacePath: null, installed: false, enabled: false };
    if (!existsSync(dir)) return { ...base, marketplace: 'absent', noDir: true };
    const ml = listMarketplaces(run, env);
    if (!ml.ok) return { ...base, error: ml.error };
    const verdict = marketplaceVerdict(ml.entries, mine);
    const pl = jsonRun(run, ['plugin', 'list', '--json'], env);
    if (!pl.ok) return { ...base, ...verdict, error: pl.error };
    const mineEntry = (Array.isArray(pl.value) ? pl.value : []).find((p) => p && p.id === PLUGIN_ID);
    return { ...base, ...verdict, installed: !!mineEntry, enabled: !!(mineEntry && mineEntry.enabled !== false) };
  });
}

/**
 * Install astro-mods into every config dir that exists, marketplace first. A foreign `astro-code`
 * marketplace is a `collision` (touched not at all); a failed install undoes the marketplace
 * add this call made. Returns `[{ dir, label, outcome: installed|already|collision|skipped|failed, message, fix? }]`.
 */
export function ensurePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  const mine = modsMarketplacePath({ home });
  return dirsOf(targets).map(({ dir, label }) => {
    const env = claudeEnvFor(dir, { home });
    const done = (outcome, message, extra = {}) => ({ dir, label, outcome, message, ...extra });
    if (!existsSync(dir)) return done('skipped', NO_DIR_MESSAGE);
    try {
      const ml = listMarketplaces(run, env);
      if (!ml.ok) return done('failed', ml.error);
      const verdict = marketplaceVerdict(ml.entries, mine);
      if (verdict.marketplace === 'other') return done('collision', collisionMessage(verdict.marketplacePath), { fix: fixFor(dir, home) });
      let added = false;
      const rollback = () => { if (added) run(['plugin', 'marketplace', 'remove', MARKETPLACE, '--json'], { env }); };
      if (verdict.marketplace === 'absent') {
        const add = jsonRun(run, ['plugin', 'marketplace', 'add', mine, '--json'], env);
        if (!add.ok) return done('failed', add.error);
        added = true;
      }
      const pl = listPlugins(run, env);
      if (!pl.ok) { rollback(); return done('failed', pl.error); }
      if (pl.installed) return done('already', `${PLUGIN_ID} is already installed`);
      const inst = jsonRun(run, ['plugin', 'install', PLUGIN_ID, '--json'], env);
      if (!inst.ok) { rollback(); return done('failed', inst.error); }
      return done('installed', `${PLUGIN_ID} installed`);
    } catch (e) {
      return done('failed', String(e && e.message || e));
    }
  });
}

/**
 * Where astro-mods stands in each config dir, in `ensurePlugin`'s row shape, CHANGING NOTHING:
 * only `claude plugin … list` runs, which leaves settings.json alone. `already` where it is
 * installed, `missing` where `ac install` still has to put it, and `collision`/`failed`/`skipped`
 * as `ensurePlugin` would report them. This is what `ac mods enable` shows (ADR-075).
 */
export function checkPlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  return pluginState({ home, run, targets }).map((s) => {
    const done = (outcome, message, extra = {}) => ({ dir: s.dir, label: s.label, outcome, message, ...extra });
    if (s.noDir) return done('skipped', NO_DIR_MESSAGE);
    if (s.error) return done('failed', s.error);
    if (s.marketplace === 'other') return done('collision', collisionMessage(s.marketplacePath), { fix: fixFor(s.dir, home) });
    if (s.installed) return done('already', `${PLUGIN_ID} is already installed`);
    return done('missing', `${PLUGIN_ID} is not installed here — run \`ac install\` (it installs the plugin with every mod off)`);
  });
}

/** `claude plugin update` where the plugin is installed from OUR marketplace. `[{ dir, label, outcome: updated|skipped|failed, message }]`. */
export function updatePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  return pluginState({ home, run, targets }).map((s) => {
    const done = (outcome, message) => ({ dir: s.dir, label: s.label, outcome, message });
    if (s.noDir) return done('skipped', NO_DIR_MESSAGE);
    if (s.error) return done('failed', s.error);
    if (!s.installed || s.marketplace !== 'ours') return done('skipped', 'astro-mods is not installed from the astro-code marketplace here');
    const r = jsonRun(run, ['plugin', 'update', PLUGIN_ID, '-y', '--json'], claudeEnvFor(s.dir, { home }));
    return r.ok ? done('updated', `${PLUGIN_ID} refreshed`) : done('failed', r.error);
  });
}

/**
 * Uninstall the plugin, THEN drop the marketplace, only where the marketplace is ours -- a
 * foreign `astro-code` is never touched. `[{ dir, label, outcome: removed|skipped|failed, removed: [..], message }]`.
 */
export function removePlugin({ home = homedir(), run = runClaude, targets = configTargets() } = {}) {
  return pluginState({ home, run, targets }).map((s) => {
    const env = claudeEnvFor(s.dir, { home });
    const done = (outcome, message, removed = []) => ({ dir: s.dir, label: s.label, outcome, message, removed });
    if (s.noDir) return done('skipped', NO_DIR_MESSAGE);
    if (s.error) return done('failed', s.error);
    if (s.marketplace !== 'ours') return done('skipped', 'no astro-code marketplace of ours here');
    const removed = [];
    const problems = [];
    if (s.installed) {
      const u = jsonRun(run, ['plugin', 'uninstall', PLUGIN_ID, '-y', '--json'], env);
      if (u.ok) removed.push('plugin'); else problems.push(u.error);
    }
    const m = jsonRun(run, ['plugin', 'marketplace', 'remove', MARKETPLACE, '--json'], env);
    if (m.ok) removed.push('marketplace'); else problems.push(m.error);
    return problems.length ? done('failed', problems.join('; '), removed) : done('removed', `removed ${removed.join(' and ')}`, removed);
  });
}

// ── hook registration ───────────────────────────────────────────────────────

const guardFeatures = (only) => FEATURES.filter((f) => f.kind === 'hook' && f.built && GUARD_HOOKS[f.name] && (!only || only === f.name));
const msg = (e) => String((e && e.message) || e);

/**
 * Align every host config with every built hook feature's switch: on registers, off removes.
 * Returns `[{ feature, host: 'claude'|'cursor', dir, label, outcome, error? }]`; claude outcomes
 * are added|already|removed|absent|failed, cursor outcomes native|import|none|removed|absent.
 * Never throws, and one dir failing never stops the others.
 */
export function syncHookFeatures({
  home = homedir(), astroHome = join(home, '.astro', 'code'),
  targets = configTargets(), cursorTargets = defaultCursorTargets(), only,
} = {}) {
  const out = [];
  const { switches } = readMods({ home });
  for (const f of guardFeatures(only)) {
    const spec = GUARD_HOOKS[f.name];
    const on = switches[f.name];
    for (const { dir, label } of dirsOf(targets)) {
      const row = (outcome, extra = {}) => out.push({ feature: f.name, host: 'claude', dir, label, outcome, ...extra });
      try {
        if (!existsSync(dir)) { row('absent'); continue; }
        const r = on ? claudeHost.registerGuard(dir, astroHome, spec) : claudeHost.unregisterGuard(dir, astroHome, spec);
        if (r.skipped) row('absent');
        else if (!r.ok) row('failed', { error: r.error });
        else if (on) row(r.changed ? 'added' : 'already');
        else row(r.changed ? 'removed' : 'absent');
      } catch (e) { row('failed', { error: msg(e) }); }
    }
    for (const { dir, label } of dirsOf(cursorTargets)) {
      const row = (outcome, extra = {}) => out.push({ feature: f.name, host: 'cursor', dir, label, outcome, ...extra });
      try {
        if (on) {
          const r = cursorHost.registerGuard(dir, astroHome, spec);
          row(r.branch, r.reason ? { error: r.reason } : {});
        } else {
          const was = cursorHost.guardState(dir, astroHome, spec);
          cursorHost.unregisterGuard(dir, astroHome, spec);
          row(was === 'native' ? 'removed' : 'absent');
        }
      } catch (e) { row('failed', { error: msg(e) }); }
    }
  }
  return out;
}

// Where each built hook feature is actually registered (and what it answers, `verdict`, when it is): one row per Claude dir, plus one for
// Cursor when it is present. Cursor rides Claude's import only if Claude's base entry works.
function enforcementOf(spec, { astroHome, targets, cursorTargets }) {
  const rows = dirsOf(targets).map(({ dir, label }) => ({ host: 'claude', dir, label, state: claudeHost.guardState(dir, astroHome, spec) }))
    .map((r) => (r.state === 'enforced' ? { ...r, verdict: spec.claude.verdict } : r));
  const baseRow = rows.find((r) => r.label === 'base');
  for (const { dir, label } of dirsOf(cursorTargets)) {
    const st = cursorHost.guardState(dir, astroHome, spec);
    let state = 'not-enforced';
    if (st === 'native') state = 'enforced';
    else if (st === 'import' && baseRow && baseRow.state === 'enforced') state = 'via-claude-import';
    // The script answers in Cursor's shape either way, so the import row carries it too.
    rows.push({ host: 'cursor', dir, label, state, ...(state === 'not-enforced' ? {} : { verdict: spec.cursor.verdict }) });
  }
  return rows;
}

/**
 * Read-only: where every built hook feature stands against its switch, for `ac doctor` (phase 50).
 * One row per feature and config dir, `{ feature, on, host, dir, label, state, native? }`, built on
 * `enforcementOf` so the doctor and `ac mods status` cannot disagree. Cursor rows add `native`
 * (our entry is in its own hooks.json, not just riding Claude's import). Never runs `claude`.
 */
export function hookRegistrations({
  home = homedir(), astroHome = join(home, '.astro', 'code'),
  targets = configTargets(), cursorTargets = defaultCursorTargets(),
} = {}) {
  const { switches } = readMods({ home });
  const out = [];
  for (const f of guardFeatures()) {
    const spec = GUARD_HOOKS[f.name];
    for (const r of enforcementOf(spec, { astroHome, targets, cursorTargets })) {
      const { verdict, ...row } = r;
      void verdict;
      out.push({
        feature: f.name, on: switches[f.name] === true, ...row,
        ...(r.host === 'cursor' ? { native: cursorHost.guardState(r.dir, astroHome, spec) === 'native' } : {}),
      });
    }
  }
  return out;
}

/**
 * Read-only: the astro-mods version Claude Code recorded in one config dir, from
 * `plugins/installed_plugins.json` (never by running `claude`, ADR-071). `null` when the plugin
 * was never installed there, `{ unreadable: true }` when the record cannot be read, else
 * `{ version, installPath }`. Tolerates the flat pre-v2 shape and an object or array per id; falls
 * back to the cached plugin's own manifest when the record carries no version.
 */
export function installedPluginVersion(dir) {
  const file = join(dir, 'plugins', 'installed_plugins.json');
  if (!existsSync(file)) return null;
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch { return { unreadable: true }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { unreadable: true };
  const plugins = data.plugins && typeof data.plugins === 'object' ? data.plugins : data;
  if (!Object.hasOwn(plugins, PLUGIN_ID)) return null;
  const raw = plugins[PLUGIN_ID];
  const entry = Array.isArray(raw) ? raw[0] : raw;
  if (!entry || typeof entry !== 'object') return { unreadable: true };
  const installPath = typeof entry.installPath === 'string' ? entry.installPath : undefined;
  let version = typeof entry.version === 'string' && entry.version ? entry.version : undefined;
  if (!version && installPath) {
    try {
      const v = JSON.parse(readFileSync(join(installPath, '.claude-plugin', 'plugin.json'), 'utf8')).version;
      if (typeof v === 'string' && v) version = v;
    } catch { /* no manifest in the cache */ }
  }
  return version ? { version, installPath } : { unreadable: true };
}

// ── status / enable ─────────────────────────────────────────────────────────

/**
 * Everything `ac mods status` shows. It never runs a `plugin` command when Claude is missing
 * or below the floor -- there is nothing a plugin listing could change about the answer.
 */
export function modsStatus({
  home = homedir(), run = runClaude, targets = configTargets(),
  astroHome = join(home, '.astro', 'code'), cursorTargets = defaultCursorTargets(),
} = {}) {
  const { switches, warnings } = readMods({ home });
  const cv = claudeVersion({ run });
  const meetsFloor = !!(cv.found && cv.version && compareVersions(cv.version, MOD_FLOOR) >= 0);
  const dirs = meetsFloor ? pluginState({ home, run, targets }) : [];
  const installed = dirs.some((d) => d.installed);
  const base = dirs.find((d) => d.label === 'base') || dirs[0];
  const baseReady = !!(base && base.installed && base.marketplace === 'ours');
  const features = FEATURES.map((f) => {
    const on = switches[f.name];
    let why = '';
    const enforcement = f.kind === 'hook' && f.built && GUARD_HOOKS[f.name]
      ? enforcementOf(GUARD_HOOKS[f.name], { astroHome, targets, cursorTargets }) : undefined;
    if (!on) why = 'off';
    else if (!f.built) why = `not built yet (phase ${f.phase})`;
    else if (f.kind === 'mod') {
      if (!cv.found) why = 'no Claude Code found';
      else if (!meetsFloor) why = cv.version ? `Claude Code ${cv.version} < ${MOD_FLOOR}` : `Claude Code version unreadable (needs ≥ ${MOD_FLOOR})`;
      else if (base && base.noDir) why = `no Claude Code config dir (${base.dir})`;
      else if (!baseReady) why = 'astro-mods plugin not installed — run `ac install`';
    } else if (enforcement && !enforcement.some((r) => r.state === 'enforced')) {
      why = 'not registered in any config dir — run ac install';
    }
    return {
      name: f.name, kind: f.kind, phase: f.phase, built: f.built, description: f.description, on, canTakeEffect: why === '', why,
      ...(enforcement ? { enforcement } : {}),
    };
  });
  return {
    floor: MOD_FLOOR,
    claude: { found: cv.found, version: cv.version, meetsFloor },
    plugin: { installed, total: [...targets].length, dirs },
    features,
    warnings,
  };
}

/**
 * Turn a feature on. The switch is recorded FIRST and unconditionally (a refused name or an
 * unparseable file stops everything else); a `hook` never touches `claude`. A `mod` NEVER
 * installs the plugin (ADR-075): Claude Code records an install in settings.json, so only
 * `ac install`/`ac update` may do it, and enabling a mod must leave that file byte-identical
 * (phase 42 C6 -- a profile added after install used to get the plugin, and the edit, here).
 * At or above the floor, `plugin` carries `checkPlugin`'s read-only rows, so a dir still missing
 * the plugin is named with `ac install`; below the floor, or with no Claude, no `plugin` command
 * runs. Before `ac install` has shipped the marketplace the result carries `install: 'needed'`
 * and, again, no `plugin` command runs.
 */
export function enableMod({
  home = homedir(), run = runClaude, targets = configTargets(), feature,
  astroHome, cursorTargets = defaultCursorTargets(),
} = {}) {
  const set = setMod({ home, feature, on: true });
  if (!set.ok) return set;
  const f = featureOf(feature);
  const result = { ok: true, feature, kind: f.kind, phase: f.phase, built: f.built, parked: f.parked ?? null, claude: null, version: null, plugin: null };
  if (f.kind === 'hook') {
    if (f.built) result.hooks = syncHookFeatures({ home, astroHome, targets, cursorTargets, only: feature });
    return result;
  }
  const cv = claudeVersion({ run });
  result.version = cv.version;
  if (!cv.found) return { ...result, claude: 'absent' };
  if (!cv.version) return { ...result, claude: 'unknown' };
  if (compareVersions(cv.version, MOD_FLOOR) < 0) return { ...result, claude: 'old' };
  // `ac install` ships the marketplace and installs from it; before it has run there is nothing to
  // check, so say so in one line (the switch is already recorded).
  if (!existsSync(modsMarketplacePath({ home }))) return { ...result, claude: 'ok', plugin: null, install: 'needed' };
  return { ...result, claude: 'ok', plugin: checkPlugin({ home, run, targets }) };
}

/** Turn a feature off. Never spawns claude; the plugin stays installed and inert. A built hook is unregistered. */
export function disableMod({
  home = homedir(), feature, targets = configTargets(), astroHome, cursorTargets = defaultCursorTargets(),
} = {}) {
  const set = setMod({ home, feature, on: false });
  if (!set.ok) return set;
  const f = featureOf(feature);
  const result = { ok: true, feature, kind: f.kind };
  if (f.kind === 'hook' && f.built) result.hooks = syncHookFeatures({ home, astroHome, targets, cursorTargets, only: feature });
  return result;
}
