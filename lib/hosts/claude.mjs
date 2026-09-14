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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const id = 'claude';
export const label = 'Claude Code';

/** Commands and agents are markdown, symlinked into each config dir. */
export const placement = { commands: 'commands', agents: 'agents', ext: '.md', mode: 'symlink' };

// The base Claude config dir: jean-claude's recorded path if present, else an
// explicit CLAUDE_CONFIG_DIR, else ~/.claude.
export function baseConfigDir() {
  const def = join(homedir(), '.claude');
  try {
    const meta = JSON.parse(readFileSync(join(def, '.jean-claude', 'meta.json'), 'utf8'));
    if (meta.claudeConfigPath) return meta.claudeConfigPath;
  } catch { /* no jean-claude */ }
  return process.env.CLAUDE_CONFIG_DIR || def;
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
  const env = process.env.CLAUDE_CONFIG_DIR;
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
// astro-code surfaces "an update is available" inside Claude the way GSD does:
// a SessionStart hook prints a banner, and a statusline segment shows the same.
// Both read the cache written by hooks/astro-update-worker.mjs. We mutate each
// config dir's settings.json additively and reversibly.
const UPDATE_HOOK = 'astro-update.mjs';
const STATUSLINE_HOOK = 'astro-statusline.mjs';
const PRECOMPACT_HOOK = 'astro-precompact.mjs';
const SESSION_STATE_HOOK = 'astro-session-state.mjs';
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
  const node = process.execPath;
  data.hooks ??= {};
  data.hooks.SessionStart ??= [];
  if (!hasCommand(data.hooks.SessionStart, UPDATE_HOOK)) {
    data.hooks.SessionStart.push({
      hooks: [{ type: 'command', command: `"${node}" "${join(home, 'hooks', UPDATE_HOOK)}"` }],
    });
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
      (e) => !(e.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes(UPDATE_HOOK)),
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
  if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
  if (data.statusLine && typeof data.statusLine.command === 'string' && data.statusLine.command.includes(STATUSLINE_HOOK)) {
    const map = readJsonSafe(chainFile(home)) || {};
    if (map[dir]) data.statusLine = map[dir];
    else delete data.statusLine;
  }
  writeJson(file, data);
}

export const claudeHost = {
  id, label, placement, detect, baseConfigDir, configTargets, registerHooks, unregisterHooks,
};
export default claudeHost;
