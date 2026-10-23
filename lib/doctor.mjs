// `ac doctor` (phase 50): one read-only report on whether the install and its hooks are
// consistent. It names every known drift, one row per check and config dir, each failing row
// with the exact command that fixes it. The causes were answered one at a time, each after
// someone hit it (#15 additionalDirectories, #40 stale update cache, #126 dead node path).
//
// READ-ONLY CONTRACT. This module reads files and writes nothing: no mkdirSync, no withLock, no
// registerHooks / writeVersion / ensurePlugin / republishHost, and it never spawns a package
// manager. It never spawns `claude` either (ADR-071): the plugin version comes from the record
// Claude Code left on disk (`installedPluginVersion`). Report only, never repair (D2).
//
// ONE RULE, ONE PLACE (9173). Nothing here re-states what another module knows: hook commands
// are parsed by `nodebin.hookCommandParts`, registrations judged by `mods.hookRegistrations`,
// the grant by `claude.grantState`, registry drift by `canon.canonCheck`, placement and rendering
// by the host adapters, the plugin record by `mods.installedPluginVersion`.
//
// TWO INSTALL BEHAVIOURS THE DOCTOR RELIES ON (phase 50 P1, P2; flagged at plan review):
//   - `ac install` writes the additionalDirectories grant (claude.registerHooks), so a fresh
//     install is clean and a missing grant is real drift.
//   - `ac install` records every config dir it published into (`<home>/published.json`), the
//     only way to find stale entries in a dir install no longer targets. Installs made before
//     the ledger recorded nothing, so the doctor cannot see those dirs.
//
// A skipped check is not a third state: it is an `ok:true` row whose detail starts `skipped —`.
// A check that throws becomes one failing row; the report always finishes (b940).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { CONFIG_ENV, grantPath, grantState } from './hosts/claude.mjs';
import { detectHosts } from './hosts/index.mjs';
import { readPublished } from './install.mjs';
import { GUARD_HOOKS } from './hosts/guards.mjs';
import { hookRegistrations, installedPluginVersion } from './mods.mjs';
import { hookCommandParts, isAstroScript, nodeBin } from './nodebin.mjs';
import { canonCheck } from './canon.mjs';
import { findRoot } from './paths.mjs';

/** The fixed row ids, in report order. */
export const DOCTOR_CHECKS = Object.freeze([
  'version', 'update-cache', 'settings', 'hook-interpreter', 'hook-registration', 'hook-script',
  'links', 'grant', 'registry', 'plugin',
]);

/** An update-check cache older than this many days is stale (#40). */
export const UPDATE_CACHE_MAX_AGE_DAYS = 30;

const DAY_MS = 86_400_000;
const BUG_FIX = 'ac doctor --json  # and attach it to a bug report';
const SKIP = 'skipped —';

const readText = (file) => { try { return readFileSync(file, 'utf8'); } catch { return null; } };
const readJson = (file) => { const t = readText(file); if (t == null) return undefined; try { return JSON.parse(t); } catch { return null; } };
const oneLine = (s) => String(s).replace(/\s*\n\s*/g, ' ').trim();
const msg = (e) => String((e && e.message) || e);

/**
 * Every config dir to examine, as `{ host, dir, label, current }`. Only hosts that are
 * installed (D3). `current` is true for the dirs the next install would target; ledger dirs
 * (published into earlier, no longer targeted) are `current: false`. Existing dirs only.
 */
function examinedDirs(astroHome) {
  const ledger = readPublished(astroHome);
  const out = [];
  for (const host of detectHosts()) {
    const seen = new Set();
    for (const [dir, label] of host.configTargets()) {
      seen.add(dir);
      if (existsSync(dir)) out.push({ host: host.id, dir, label, current: true });
    }
    for (const dir of ledger[host.id] || []) {
      if (seen.has(dir) || !existsSync(dir)) continue;
      seen.add(dir);
      out.push({ host: host.id, dir, label: 'earlier install', current: false });
    }
  }
  return out;
}

// A fix run in a Claude dir the install no longer targets must target it for that one command.
const fixIn = (entry, cmd) => (entry && entry.host === 'claude' && entry.current === false ? `${CONFIG_ENV}="${entry.dir}" ${cmd}` : cmd);

function versionOf(file) {
  const j = readJson(file);
  return j && typeof j.version === 'string' ? j.version : null;
}

function checkVersion(ctx, emit) {
  const clone = ctx.clone ?? (readText(join(ctx.astroHome, 'source')) || '').trim();
  if (!clone) return emit(true, `${SKIP} no clone recorded`);
  if (!existsSync(clone)) return emit(true, `${SKIP} clone ${clone} not found`);
  const cloneV = versionOf(join(clone, 'package.json'));
  if (!cloneV) return emit(true, `${SKIP} clone has no readable version`);
  const installed = (readText(join(ctx.astroHome, 'version')) || '').trim();
  if (!installed) return emit(false, 'astro home records no version', 'ac install');
  if (installed !== cloneV) return emit(false, `installed v${installed}, clone v${cloneV}`, 'ac update');
  emit(true, `installed v${installed} matches the clone`);
}

function checkUpdateCache(ctx, emit) {
  const file = join(ctx.astroHome, 'update-check.json');
  if (!existsSync(file)) return emit(true, 'no update-check cache (normal right after ac update)');
  const data = readJson(file);
  if (data === null || typeof data !== 'object') return emit(false, 'update-check.json is not valid JSON', 'ac update');
  const stamps = [];
  if (Number.isFinite(data.checked)) stamps.push(data.checked * 1000);
  try { stamps.push(statSync(file).mtimeMs); } catch { /* gone between the two reads */ }
  const past = stamps.filter((t) => t <= ctx.now);
  if (!past.length) return emit(true, 'update-check cache is dated in the future, not stale');
  const days = Math.floor((ctx.now - Math.min(...past)) / DAY_MS);
  if (days > UPDATE_CACHE_MAX_AGE_DAYS) return emit(false, `update check last ran ${days} days ago`, 'ac update');
  emit(true, `update check ran ${days} day(s) ago`);
}

function checkGrant(ctx, entry, emit) {
  const st = grantState(entry.dir, ctx.astroHome);
  if (st === 'unreadable' || st === 'no-dir') return; // `settings` names an unreadable file
  const want = grantPath(ctx.astroHome);
  if (st === 'granted') return emit(true, `additionalDirectories grants ${want}`);
  emit(false, `additionalDirectories does not grant ${want}`, `${fixIn(entry, 'ac install')}  # grants ${want}`);
}

function checkPlugin(ctx, entry, emit) {
  if (entry.host !== 'claude') return;
  const rec = installedPluginVersion(entry.dir);
  if (rec === null) return; // never installed: Claude was absent or below the floor
  if (rec.unreadable) return emit(true, `${SKIP} plugin record unreadable`);
  const expected = versionOf(join(ctx.astroHome, 'mods', 'astro-mods', '.claude-plugin', 'plugin.json'))
    ?? ((readText(join(ctx.astroHome, 'version')) || '').trim() || null);
  if (!expected) return emit(true, `${SKIP} no shipped astro-mods version to compare`);
  if (rec.version !== expected) return emit(false, `astro-mods v${rec.version} installed, astro-code v${expected}`, fixIn(entry, 'ac update'));
  emit(true, `astro-mods v${rec.version} matches astro-code`);
}

function checkRegistry(ctx, emit) {
  const root = findRoot(ctx.cwd);
  if (!root) return emit(true, `${SKIP} not in an astro-code project`);
  const r = canonCheck(root);
  if (r.error) return emit(true, `${SKIP} registry unreachable, not checked`);
  if (!r.available) return emit(true, `${SKIP} no shared registry in use`);
  if (r.ok) return emit(true, `local canon matches ${r.branch}`);
  const parts = [];
  if (r.drift.length) parts.push(`${r.drift.length} decision(s)`);
  if (r.conventions !== 'same') parts.push('CONVENTIONS.md');
  emit(false, `local canon differs from ${r.branch} (${parts.join(', ')})`, 'ac canon pull');
}

// ── hook checks: settings, hook-interpreter, hook-registration, hook-script ──────────────────

// The files that carry hook commands in a config dir. Claude Code: settings.json. Cursor: its own
// hooks.json and cli-config.json, read only where they exist.
const hookFiles = (entry) => (entry.host === 'claude' ? [join(entry.dir, 'settings.json')]
  : entry.host === 'cursor' ? [join(entry.dir, 'hooks.json'), join(entry.dir, 'cli-config.json')] : []);

// Every `command` string anywhere in a parsed hooks/settings object (all events plus statusLine).
function commandsOf(data) {
  const out = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (k === 'command' && typeof x === 'string') out.push(x); else walk(x);
    }
  };
  walk(data);
  return out;
}

// astro-owned hook commands of one dir, parsed through the one parser: `[{ file, interp, script }]`.
// Files that do not exist or do not parse yield nothing (`settings` names the unparseable ones).
function astroCommands(entry) {
  const out = [];
  for (const file of hookFiles(entry)) {
    const data = readJson(file);
    if (!data || typeof data !== 'object') continue;
    for (const c of commandsOf(data)) {
      const parts = hookCommandParts(c);
      if (parts && isAstroScript(parts.script)) out.push({ file, interp: parts.interp, script: parts.script });
    }
  }
  return out;
}

function checkSettings(entry, emit) {
  for (const file of hookFiles(entry)) {
    if (!existsSync(file)) continue;
    const data = readJson(file);
    if (data === null || typeof data !== 'object') {
      emit(false, `${file} is not valid JSON, so hooks were not checked`, `edit ${file} by hand (not valid JSON)`);
    } else emit(true, `${file} parses`);
  }
}

// "Runs" means the interpreter answers `--version` with a node version, not merely that a file
// exists (#126). One spawn per distinct interpreter, memoised for the run; never a package manager.
function interpreterProblem(ctx, interp) {
  if (ctx.interps.has(interp)) return ctx.interps.get(interp);
  let problem = null;
  const pathLike = /[\\/]/.test(interp);
  if (pathLike && !existsSync(interp)) problem = 'missing';
  else {
    const r = spawnSync(interp, ['--version'], { timeout: 5000, encoding: 'utf8', windowsHide: true });
    if (r.error && r.error.code === 'ENOENT') problem = 'missing';
    else if (r.error || r.status !== 0 || !/^v\d+\./.test(String(r.stdout || '').trim())) problem = 'does not run';
  }
  ctx.interps.set(interp, problem);
  return problem;
}

function checkInterpreters(ctx, entry, emit) {
  const cmds = astroCommands(entry);
  if (!cmds.length) return;
  const seen = new Set();
  let bad = 0;
  for (const { file, interp } of cmds) {
    if (seen.has(interp)) continue;
    seen.add(interp);
    const problem = interpreterProblem(ctx, interp);
    if (!problem) continue;
    bad++;
    // install re-points a node-named interpreter (repairNodeCommands); any other name it leaves alone
    const fix = /^node(\.exe)?$/i.test(basename(interp))
      ? fixIn(entry, 'ac install') : `replace "${interp}" with "${nodeBin()}" in ${file}`;
    emit(false, `hook interpreter ${interp} ${problem}`, fix);
  }
  if (!bad) emit(true, `${seen.size} hook interpreter(s) run`);
}

function checkRegistrations(ctx, entry, emit) {
  if (!ctx.regs) {
    const pick = (host) => new Map(ctx.dirs.filter((d) => d.host === host).map((d) => [d.dir, d.label]));
    ctx.regs = hookRegistrations({
      home: ctx.home, astroHome: ctx.astroHome, targets: pick('claude'), cursorTargets: pick('cursor'),
    });
  }
  let bad = 0;
  let n = 0;
  for (const r of ctx.regs.filter((x) => x.host === entry.host && x.dir === entry.dir)) {
    if (r.state === 'unreadable' || r.state === 'no-dir') continue;
    n++;
    const scriptHere = existsSync(join(ctx.astroHome, 'hooks', GUARD_HOOKS[r.feature].script));
    const registered = r.host === 'cursor' ? r.native : (r.state === 'enforced' || r.state === 'broken');
    const missing = r.host === 'cursor' ? r.state === 'not-enforced' : (r.state === 'missing' || (r.state === 'broken' && scriptHere));
    if (r.on && missing) {
      bad++;
      emit(false, `${r.feature} on but not registered`, fixIn(entry, `ac mods enable ${r.feature}`));
    } else if (!r.on && registered) {
      bad++;
      emit(false, `${r.feature} registered while off`, fixIn(entry, `ac mods disable ${r.feature}`));
    }
  }
  if (!bad) emit(true, `${n} guard switch(es) agree with their registrations`);
}

function checkScripts(ctx, entry, emit) {
  if (!astroCommands(entry).length) return;
  const seen = new Set();
  let bad = 0;
  for (const { script } of astroCommands(entry)) {
    const path = script === '~' || script.startsWith('~/') ? join(ctx.home, script.slice(1)) : script;
    if (!isAbsolute(path) || seen.has(path)) continue;
    seen.add(path);
    if (existsSync(path)) continue;
    bad++;
    emit(false, `registered hook script missing: ${path}`, fixIn(entry, 'ac install'));
  }
  if (!bad) emit(true, `${seen.size} registered hook script(s) exist`);
}

/**
 * Run every check and return the rows `{ id, host, dir, ok, detail, fix }` (`host`/`dir` null for
 * a global check, `fix` a string on every failing row, null otherwise). `clone` overrides the
 * clone recorded in `<astroHome>/source` (`ac update` passes the one it just pulled).
 */
export function runDoctor({
  home = homedir(), astroHome = join(home, '.astro', 'code'), clone, cwd = process.cwd(), now = Date.now(),
} = {}) {
  const rows = [];
  const ctx = { home, astroHome, clone, cwd, now, interps: new Map() };
  // `entry` is the (host, dir) a row concerns, or null for a global check. A throw becomes one
  // failing row, so a bug in one check never hides the others.
  const run = (id, entry, fn) => {
    const emit = (ok, detail, fix = null) => rows.push({
      id, host: entry ? entry.host : null, dir: entry ? entry.dir : null,
      ok, detail: oneLine(detail), fix: ok ? null : fix,
    });
    try { fn(emit); } catch (e) { emit(false, `check could not run: ${msg(e)}`, BUG_FIX); }
  };

  if (!existsSync(astroHome)) {
    run('version', null, (emit) => emit(false, 'astro-code is not installed', 'ac install'));
    return rows;
  }
  run('version', null, (emit) => checkVersion(ctx, emit));
  run('update-cache', null, (emit) => checkUpdateCache(ctx, emit));

  let dirs = [];
  run('links', null, () => { dirs = examinedDirs(astroHome); });
  ctx.dirs = dirs;
  for (const entry of dirs) {
    if (!hookFiles(entry).length) continue; // Codex and OpenCode carry no astro hooks
    run('settings', entry, (emit) => checkSettings(entry, emit));
    run('hook-interpreter', entry, (emit) => checkInterpreters(ctx, entry, emit));
    run('hook-registration', entry, (emit) => checkRegistrations(ctx, entry, emit));
    run('hook-script', entry, (emit) => checkScripts(ctx, entry, emit));
    if (entry.host !== 'claude') continue;
    run('grant', entry, (emit) => checkGrant(ctx, entry, emit));
    run('plugin', entry, (emit) => checkPlugin(ctx, entry, emit));
  }
  run('registry', null, (emit) => checkRegistry(ctx, emit));
  return rows;
}

/**
 * The report as lines. Each failing row is exactly one line ending with its fix; a clean report
 * is exactly one `✓` line. `failuresOnly` drops that line (the `ac update` tail prints nothing
 * when clean), so `ac update` and `ac doctor` print identical problem lines.
 */
export function renderDoctor(rows, { failuresOnly = false } = {}) {
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    return bad.map((r) => `⚠ ${r.host ? `${r.host} ${r.dir}: ` : ''}${oneLine(r.detail)} → ${oneLine(r.fix)}`);
  }
  if (failuresOnly) return [];
  const dirs = new Set(rows.filter((r) => r.dir).map((r) => r.dir));
  return [`✓ install consistent — ${rows.length} checks across ${dirs.size} config dir(s)`];
}
