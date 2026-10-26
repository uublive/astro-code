// Host adapter: Claude Code.
//
// Everything astro-code knows about Claude Code specifically lives here —
// where its config dirs are, how commands/agents are discovered, and how its
// settings.json hooks + status line are wired. `lib/install.mjs` owns the
// host-agnostic plumbing (copying into ~/.astro/code, symlinking, pruning) and
// calls through this adapter for anything Claude-shaped.
//
// Deliberately STATELESS about the astro home: every function that needs it
// takes `home` as an argument rather than computing it at module load. The
// install tests re-import with a cache-busting query string to pick up a fake
// $HOME, and a module-level constant here would be captured once and quietly
// ignore that — the tests would pass against the real home.
import { nodeBin, repairNodeCommands } from '../nodebin.mjs';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { BRIEF_PARTS } from '../../hooks/_astro-ctx.mjs';
import { GUARD_SCRIPTS, guardCommand, ownsCommand } from './guards.mjs';

export const id = 'claude';
export const label = 'Claude Code';

/** Commands and agents are markdown, symlinked into each config dir. */
export const placement = { commands: 'commands', agents: 'agents', ext: '.md', mode: 'symlink' };

/** The env var that points Claude Code at a config dir; named once so `ac doctor` never re-types it. */
export const CONFIG_ENV = 'CLAUDE_CONFIG_DIR';

// The base Claude config dir: jean-claude's recorded path if present, else an
// explicit CLAUDE_CONFIG_DIR, else ~/.claude.
export function baseConfigDir() {
  const def = join(homedir(), '.claude');
  try {
    const meta = JSON.parse(readFileSync(join(def, '.jean-claude', 'meta.json'), 'utf8'));
    if (meta.claudeConfigPath) return meta.claudeConfigPath;
  } catch { /* no jean-claude */ }
  return process.env[CONFIG_ENV] || def;
}

// Every config dir to populate: base + all jean-claude profiles (+ a manual
// CLAUDE_CONFIG_DIR if it isn't already covered). Map of dir -> label.
export function configTargets() {
  const base = baseConfigDir();
  const targets = new Map([[base, 'base']]);
  try {
    const reg = JSON.parse(readFileSync(join(base, '.jean-claude', 'profiles.json'), 'utf8'));
    for (const [name, p] of Object.entries(reg.profiles || {})) {
      if (p.configDir) targets.set(p.configDir, name);
    }
  } catch { /* no profiles registry */ }
  const env = process.env[CONFIG_ENV];
  if (env && !targets.has(env)) targets.set(env, 'env');
  return targets;
}

/**
 * Is Claude Code present on this machine? True when its base config dir
 * exists. `ac install` uses this to decide which hosts to wire; it must never
 * be the reason an install silently does nothing, so callers treat "no host
 * detected" as a reportable condition, not a success.
 */
export function detect() {
  return existsSync(baseConfigDir());
}

// --- settings.json hook wiring -------------------------------------------------
// astro-code surfaces "an update is available" inside Claude the usual way:
// a SessionStart hook prints a banner, and a statusline segment shows the same.
// Both read the cache written by hooks/astro-update-worker.mjs. We mutate each
// config dir's settings.json additively and reversibly.
const UPDATE_HOOK = 'astro-update.mjs';
const STATUSLINE_HOOK = 'astro-statusline.mjs';
const PRECOMPACT_HOOK = 'astro-precompact.mjs';
const SESSION_STATE_HOOK = 'astro-session-state.mjs';
// #116: the principles brief arrives in BRIEF_PARTS SessionStart outputs, each under Claude
// Code's 10,000-character additionalContext cap — part 1 from UPDATE_HOOK, the rest from
// one PRINCIPLES_HOOK entry per part.
const PRINCIPLES_HOOK = 'astro-principles.mjs';
export const principlePartArgs = () => Array.from({ length: BRIEF_PARTS - 1 }, (_, i) => `${i + 2}/${BRIEF_PARTS}`);
// #15, phase 50 P1: Claude Code will not read the shipped workflow `scriptPath` unless the astro
// home is in `permissions.additionalDirectories`, and it matches the RESOLVED path (`ac path`
// prints it; /var/home vs /home is the case that bit). Install used to ask the user to paste it
// (MANUAL "Letting Claude Code run the shipped workflows"); registerHooks now writes it, in the
// same write as the hooks, and unregisterHooks takes exactly that string back out.
/** The string to grant for the astro home: its realpath, or the path as is when it cannot resolve. */
export function grantPath(home) {
  try { return realpathSync(home); } catch { return home; }
}

/**
 * Does one config dir grant the astro home? 'granted' (an entry equal to, or a resolved ancestor
 * of, `grantPath(home)`; entries get only `~/` expanded and a trailing `/` stripped, never a
 * realpath, so the unresolved form of a symlinked home is NOT a grant), 'missing', 'unreadable'
 * (settings.json is not valid JSON) or 'no-dir'. Never writes.
 */
export function grantState(dir, home) {
  if (!existsSync(dir)) return 'no-dir';
  const file = join(dir, 'settings.json');
  if (!existsSync(file)) return 'missing';
  const data = readJsonSafe(file);
  if (data === null || typeof data !== 'object') return 'unreadable';
  const list = data.permissions?.additionalDirectories;
  if (!Array.isArray(list)) return 'missing';
  const want = grantPath(home);
  const norm = (e) => {
    let x = String(e);
    if (x === '~' || x.startsWith('~/')) x = join(homedir(), x.slice(1));
    return x.length > 1 ? x.replace(/\/+$/, '') : x;
  };
  const covers = (e) => {
    if (typeof e !== 'string' || !e) return false;
    const x = norm(e);
    if (x === want) return true;
    return resolve(x) === x && (x === sep || want.startsWith(x + sep));
  };
  return list.some(covers) ? 'granted' : 'missing';
}

const chainFile = (home) => join(home, 'statusline-chain.json');

function readJsonSafe(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function hasCommand(entries, needle) {
  return (entries || []).some((e) =>
    (e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(needle)));
}

// Register the SessionStart banner + composing statusline into one config dir.
// Idempotent (safe to re-run on every `ac update`) and skips an unparseable
// settings.json rather than risk clobbering it.
export function registerHooks(dir, home) {
  const file = join(dir, 'settings.json');
  let data = {};
  if (existsSync(file)) {
    data = readJsonSafe(file);
    if (data === null) return false; // don't overwrite settings we can't parse
  }
  const node = nodeBin();
  data.hooks ??= {};
  data.hooks.SessionStart ??= [];
  if (!hasCommand(data.hooks.SessionStart, UPDATE_HOOK)) {
    data.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: `"${node}" "${join(home, 'hooks', UPDATE_HOOK)}"` }],
    });
  }
  // One entry per extra part; an entry for a part count no longer in use is dropped.
  const partCmd = (arg) => `"${node}" "${join(home, 'hooks', PRINCIPLES_HOOK)}" ${arg}`;
  const wanted = principlePartArgs();
  const partOf = (e) => (e.hooks || []).map((h) => (typeof h.command === 'string' && h.command.includes(PRINCIPLES_HOOK)
    ? h.command.trim().split(/\s+/).pop() : null)).find(Boolean);
  data.hooks.SessionStart = data.hooks.SessionStart.filter((e) => { const p = partOf(e); return !p || wanted.includes(p); });
  for (const arg of wanted) {
    if (!data.hooks.SessionStart.some((e) => partOf(e) === arg)) {
      data.hooks.SessionStart.push({ hooks: [{ type: 'command', command: partCmd(arg) }] });
    }
  }
  // PreCompact: re-emit the astro position so it survives into the compacted summary.
  // No-op outside an astro-code project, so it's safe as a global hook.
  data.hooks.PreCompact ??= [];
  if (!hasCommand(data.hooks.PreCompact, PRECOMPACT_HOOK)) {
    data.hooks.PreCompact.push({
      hooks: [{ type: 'command', command: `"${node}" "${join(home, 'hooks', PRECOMPACT_HOOK)}"` }],
    });
  }
  // Busy/idle dot: stamp turn boundaries so the statusline can show whether a turn
  // is in flight. Two silent, best-effort hooks — one per boundary. No-ops outside
  // any astro concern (they only touch our own state file), so safe as globals.
  const stateCmd = (arg) => `"${node}" "${join(home, 'hooks', SESSION_STATE_HOOK)}" ${arg}`;
  data.hooks.UserPromptSubmit ??= [];
  if (!hasCommand(data.hooks.UserPromptSubmit, SESSION_STATE_HOOK)) {
    data.hooks.UserPromptSubmit.push({ hooks: [{ type: 'command', command: stateCmd('prompt') }] });
  }
  data.hooks.Stop ??= [];
  if (!hasCommand(data.hooks.Stop, SESSION_STATE_HOOK)) {
    data.hooks.Stop.push({ hooks: [{ type: 'command', command: stateCmd('stop') }] });
  }
  // Compose with any existing statusline instead of replacing it: stash the
  // original command keyed by dir, then point statusLine at our wrapper.
  const cur = data.statusLine;
  const alreadyOurs = cur && typeof cur.command === 'string' && cur.command.includes(STATUSLINE_HOOK);
  if (!alreadyOurs) {
    if (cur && cur.command) {
      const map = readJsonSafe(chainFile(home)) || {};
      map[dir] = cur;
      writeJson(chainFile(home), map);
    }
    data.statusLine = {
      type: 'command',
      command: `"${node}" "${join(home, 'hooks', STATUSLINE_HOOK)}" "${dir}"`,
    };
  }
  // #126 — an entry written before a `brew upgrade node` names a node that no longer exists;
  // matching by script name alone kept it forever. Every install/update re-points them.
  repairNodeCommands(data, node);
  const grant = grantPath(home);
  if (data.permissions == null) data.permissions = {};
  if (typeof data.permissions === 'object' && !Array.isArray(data.permissions)) {
    const dirs = data.permissions.additionalDirectories;
    if (dirs == null) data.permissions.additionalDirectories = [grant];
    else if (Array.isArray(dirs) && !dirs.includes(grant)) dirs.push(grant);
  }
  writeJson(file, data);
  return true;
}

// Reverse registerHooks for one config dir: drop our SessionStart entry and
// restore the original statusline (or remove ours if there was none).
export function unregisterHooks(dir, home) {
  const file = join(dir, 'settings.json');
  if (!existsSync(file)) return;
  const data = readJsonSafe(file);
  if (data === null) return;
  if (data.hooks?.SessionStart) {
    data.hooks.SessionStart = data.hooks.SessionStart.filter(
      (e) => !(e.hooks || []).some((h) => typeof h.command === 'string'
        && (h.command.includes(UPDATE_HOOK) || h.command.includes(PRINCIPLES_HOOK))),
    );
    if (data.hooks.SessionStart.length === 0) delete data.hooks.SessionStart;
  }
  if (data.hooks?.PreCompact) {
    data.hooks.PreCompact = data.hooks.PreCompact.filter(
      (e) => !(e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(PRECOMPACT_HOOK)),
    );
    if (data.hooks.PreCompact.length === 0) delete data.hooks.PreCompact;
  }
  for (const evt of ['UserPromptSubmit', 'Stop']) {
    if (!data.hooks?.[evt]) continue;
    data.hooks[evt] = data.hooks[evt].filter(
      (e) => !(e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(SESSION_STATE_HOOK)),
    );
    if (data.hooks[evt].length === 0) delete data.hooks[evt];
  }
  stripGuards(data, GUARD_SCRIPTS);
  if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
  const dirs = data.permissions?.additionalDirectories;
  if (Array.isArray(dirs)) {
    const kept = dirs.filter((d) => d !== grantPath(home));
    if (kept.length !== dirs.length) {
      if (kept.length) data.permissions.additionalDirectories = kept;
      else delete data.permissions.additionalDirectories;
      if (Object.keys(data.permissions).length === 0) delete data.permissions;
    }
  }
  if (data.statusLine && typeof data.statusLine.command === 'string' && data.statusLine.command.includes(STATUSLINE_HOOK)) {
    const map = readJsonSafe(chainFile(home)) || {};
    if (map[dir]) data.statusLine = map[dir];
    else delete data.statusLine;
  }
  writeJson(file, data);
}

// --- guard hooks (phase 37) ------------------------------------------------------
// A guard is a matcher entry under a PreToolUse-style event, added only while its switch is
// on (lib/mods.mjs drives that; ADR-072). Ownership is by script filename (guards.mjs
// ownsCommand), so an entry written under another home is still ours: strip every one of ours
// from every event, keep any user hook that shares an entry, and append the current entry.
// Modelled on lib/fleet.mjs registerFleetHooks/stripOurs.

// Remove every hook owned by one of `scripts` from data.hooks. Emptied entries, event arrays
// and the hooks key are dropped, so register then unregister is JSON-equal to the start.
function stripGuards(data, scripts) {
  if (!data.hooks || typeof data.hooks !== 'object' || Array.isArray(data.hooks)) return false;
  const isOurs = (h) => typeof h?.command === 'string' && scripts.some((sc) => ownsCommand(h.command, sc));
  let removed = false;
  for (const evt of Object.keys(data.hooks)) {
    if (!Array.isArray(data.hooks[evt])) continue;
    const kept = [];
    for (const e of data.hooks[evt]) {
      if (!Array.isArray(e?.hooks) || !e.hooks.some(isOurs)) { kept.push(e); continue; }
      removed = true;
      const rest = e.hooks.filter((h) => !isOurs(h));
      if (rest.length) kept.push({ ...e, hooks: rest });
    }
    if (kept.length) data.hooks[evt] = kept;
    else delete data.hooks[evt];
  }
  if (removed && Object.keys(data.hooks).length === 0) delete data.hooks;
  return removed;
}

// Every [event, entry] pair holding one of our hooks for `script`.
function guardEntries(data, script) {
  const out = [];
  if (!data.hooks || typeof data.hooks !== 'object') return out;
  for (const [evt, arr] of Object.entries(data.hooks)) {
    for (const e of Array.isArray(arr) ? arr : []) {
      if (Array.isArray(e?.hooks) && e.hooks.some((h) => ownsCommand(h?.command, script))) out.push([evt, e]);
    }
  }
  return out;
}

/**
 * Register one guard in a Claude config dir. A missing dir is skipped, never created: creating
 * a Claude config dir here would make Cursor start importing from it. Unparseable settings are
 * left untouched. Idempotent: an up-to-date entry means no write at all.
 */
export function registerGuard(dir, home, spec) {
  if (!existsSync(dir)) return { ok: false, skipped: true };
  const file = join(dir, 'settings.json');
  let data = {};
  if (existsSync(file)) {
    data = readJsonSafe(file);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: `${file} is not valid JSON — left untouched` };
  }
  if (data.hooks != null && (typeof data.hooks !== 'object' || Array.isArray(data.hooks))) {
    return { ok: false, error: `${file} has a "hooks" value that is not an object — left untouched` };
  }
  const { event, matcher, timeout } = spec.claude;
  const command = guardCommand(home, spec);
  const have = guardEntries(data, spec.script);
  if (have.length === 1) {
    const [evt, e] = have[0];
    if (evt === event && e.matcher === matcher && e.hooks.length === 1
        && e.hooks[0].type === 'command' && e.hooks[0].command === command && e.hooks[0].timeout === timeout) {
      return { ok: true, changed: false };
    }
  }
  stripGuards(data, [spec.script]);
  data.hooks ??= {};
  data.hooks[event] = [...(Array.isArray(data.hooks[event]) ? data.hooks[event] : []),
    { matcher, hooks: [{ type: 'command', command, timeout }] }];
  writeJson(file, data);
  return { ok: true, changed: true };
}

/** Remove the guard from one config dir; writes only when something was removed. */
export function unregisterGuard(dir, home, spec) {
  void home;
  const file = join(dir, 'settings.json');
  if (!existsSync(file)) return { ok: true, changed: false };
  const data = readJsonSafe(file);
  if (data === null) return { ok: false, error: `${file} is not valid JSON — left untouched` };
  if (!stripGuards(data, [spec.script])) return { ok: true, changed: false };
  writeJson(file, data);
  return { ok: true, changed: true };
}

/**
 * Where this guard stands in one config dir: 'enforced' (an entry whose matcher covers every
 * tool of the spec, and the script exists under `home`), 'broken' (entry present but the script
 * is gone or the matcher is short), 'missing', 'unreadable', or 'no-dir'.
 */
export function guardState(dir, home, spec) {
  if (!existsSync(dir)) return 'no-dir';
  const file = join(dir, 'settings.json');
  if (!existsSync(file)) return 'missing';
  const data = readJsonSafe(file);
  if (data === null || typeof data !== 'object') return 'unreadable';
  const ours = guardEntries(data, spec.script);
  if (!ours.length) return 'missing';
  const need = spec.claude.matcher.split('|');
  const covers = ([, e]) => {
    if (e.matcher == null || e.matcher === '' || e.matcher === '*') return true;
    const have = String(e.matcher).split('|');
    return need.every((t) => have.includes(t));
  };
  return ours.some(covers) && existsSync(join(home, 'hooks', spec.script)) ? 'enforced' : 'broken';
}

// Claude Code IS the authoring format, so both renderers are the identity.
// They return a file LIST because other hosts need more than one file per
// agent; keeping one shape everywhere means install.mjs never special-cases
// "the host we happen to have authored in".
export function renderCommand(name, source) {
  return [{ path: `${name}.md`, content: source }];
}
export function renderAgent(name, source) {
  return [{ path: `${name}.md`, content: source }];
}

/**
 * The one-shot headless invocation, as argv. Verified against `claude --help`.
 *
 * Claude Code has no --cd and no --output-schema: the working directory comes
 * from the spawn itself, and a response schema can only be asked for in the
 * prompt. That is a real capability gap next to `codex exec`, and the runner
 * reports it rather than pretending the constraint was enforced — a schema
 * that is requested but unenforced must never be reported as satisfied.
 *
 * Returns argv rather than spawning, so it stays pure and the caller keeps
 * concurrency, cwd and abort.
 */
export function execCommand({ prompt, model, systemPrompt, tools, permissionMode, json, reasoning, agent, maxBudgetUsd } = {}) {
  const args = ['--print'];
  // Claude Code has no CLI flag for reasoning depth — the Workflow tool takes
  // it as agent({ effort }). Carried on the invocation so the runner can report
  // that it was requested but not enforced, rather than implying it was applied.
  void reasoning;
  if (json) args.push('--output-format', 'json');
  if (model) args.push('--model', model);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);
  if (tools && tools.length) args.push('--allowedTools', ...tools);
  if (permissionMode) args.push('--permission-mode', permissionMode);
  // Phase 51: run as the installed role (so a headless run loads the same agent text a spawned one
  // does) and cap its spend. Both come after the variadic --allowedTools and before the prompt.
  if (agent) args.push('--agent', agent);
  if (maxBudgetUsd != null) args.push('--max-budget-usd', String(maxBudgetUsd));
  if (prompt) args.push(prompt);
  return { command: 'claude', args };
}

/** What this host can enforce itself, vs what the runner must arrange. */
// `reasoning: false` — Claude Code takes depth via the Workflow tool's
// agent({ effort }), not the CLI, so a headless `claude --print` cannot apply it.
export const capabilities = { worktree: false, outputSchema: false, reasoning: false };

export const claudeHost = {
  id, label, placement, detect, baseConfigDir, configTargets, registerHooks, unregisterHooks,
  grantPath, grantState, registerGuard, unregisterGuard, guardState,
  renderCommand, renderAgent, execCommand, capabilities,
};
export default claudeHost;
