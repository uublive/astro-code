// Install/uninstall astro-code into the user path.
//
// Files live in the home (~/.astro/code) — astro-code's own namespace. The
// Claude-facing commands/agents are SYMLINKED into every Claude config dir, because
// that's the only place Claude Code discovers them:
//   - the base config dir (~/.claude), and
//   - every jean-claude profile (read from ~/.claude/.jean-claude/profiles.json).
// This mirrors jean-claude's own model (shared files in base, symlinked per profile)
// so the commands show up in ALL profiles, not just the active one.
import { mkdirSync, readdirSync, copyFileSync, existsSync, rmSync, symlinkSync, lstatSync, readlinkSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ASTRO_HOME = join(homedir(), '.astro', 'code');

// The base Claude config dir: jean-claude's recorded path if present, else an
// explicit CLAUDE_CONFIG_DIR, else ~/.claude.
function baseConfigDir() {
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

function copyDir(src, dest, ext) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith(ext)) continue;
    copyFileSync(join(src, f), join(dest, f));
    n++;
  }
  return n;
}

const isSymlink = (p) => {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};

function symlinkInto(srcDir, destDir) {
  if (!existsSync(srcDir)) return 0;
  mkdirSync(destDir, { recursive: true });
  let n = 0;
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.md')) continue;
    const link = join(destDir, f);
    if (existsSync(link) || isSymlink(link)) rmSync(link, { force: true });
    symlinkSync(join(srcDir, f), link);
    n++;
  }
  return n;
}

// --- settings.json hook wiring -------------------------------------------------
// astro-code surfaces "an update is available" inside Claude the way GSD does:
// a SessionStart hook prints a banner, and a statusline segment shows the same.
// Both read the cache written by hooks/astro-update-worker.mjs. We mutate each
// config dir's settings.json additively and reversibly.
const UPDATE_HOOK = 'astro-update.mjs';
const STATUSLINE_HOOK = 'astro-statusline.mjs';
const PRECOMPACT_HOOK = 'astro-precompact.mjs';
const chainFile = () => join(ASTRO_HOME, 'statusline-chain.json');

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
function registerHooks(dir) {
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
      hooks: [{ type: 'command', command: `"${node}" "${join(ASTRO_HOME, 'hooks', UPDATE_HOOK)}"` }],
    });
  }
  // PreCompact: re-emit the astro position so it survives into the compacted summary.
  // No-op outside an astro-code project, so it's safe as a global hook.
  data.hooks.PreCompact ??= [];
  if (!hasCommand(data.hooks.PreCompact, PRECOMPACT_HOOK)) {
    data.hooks.PreCompact.push({
      hooks: [{ type: 'command', command: `"${node}" "${join(ASTRO_HOME, 'hooks', PRECOMPACT_HOOK)}"` }],
    });
  }
  // Compose with any existing statusline instead of replacing it: stash the
  // original command keyed by dir, then point statusLine at our wrapper.
  const cur = data.statusLine;
  const alreadyOurs = cur && typeof cur.command === 'string' && cur.command.includes(STATUSLINE_HOOK);
  if (!alreadyOurs) {
    if (cur && cur.command) {
      const map = readJsonSafe(chainFile()) || {};
      map[dir] = cur;
      writeJson(chainFile(), map);
    }
    data.statusLine = {
      type: 'command',
      command: `"${node}" "${join(ASTRO_HOME, 'hooks', STATUSLINE_HOOK)}" "${dir}"`,
    };
  }
  writeJson(file, data);
  return true;
}

// Reverse registerHooks for one config dir: drop our SessionStart entry and
// restore the original statusline (or remove ours if there was none).
function unregisterHooks(dir) {
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
  if (data.hooks && Object.keys(data.hooks).length === 0) delete data.hooks;
  if (data.statusLine && typeof data.statusLine.command === 'string' && data.statusLine.command.includes(STATUSLINE_HOOK)) {
    const map = readJsonSafe(chainFile()) || {};
    if (map[dir]) data.statusLine = map[dir];
    else delete data.statusLine;
  }
  writeJson(file, data);
}

export function installClaude(frameworkRoot) {
  const commands = copyDir(join(frameworkRoot, 'commands'), join(ASTRO_HOME, 'commands'), '.md');
  const agents = copyDir(join(frameworkRoot, 'agents'), join(ASTRO_HOME, 'agents'), '.md');
  const workflows = copyDir(join(frameworkRoot, 'workflows'), join(ASTRO_HOME, 'workflows'), '.mjs');
  const hooks = copyDir(join(frameworkRoot, 'hooks'), join(ASTRO_HOME, 'hooks'), '.mjs');

  const linked = [];
  for (const [dir, label] of configTargets()) {
    linked.push({
      label,
      dir,
      commands: symlinkInto(join(ASTRO_HOME, 'commands'), join(dir, 'commands')),
      agents: symlinkInto(join(ASTRO_HOME, 'agents'), join(dir, 'agents')),
      hooks: registerHooks(dir),
    });
  }
  return { home: ASTRO_HOME, commands, agents, workflows, hooks, targets: linked };
}

export function uninstallClaude() {
  let removed = 0;
  for (const [dir] of configTargets()) {
    unregisterHooks(dir); // restore settings.json BEFORE we delete the home (chain map lives there)
    for (const sub of ['commands', 'agents']) {
      const homeSub = join(ASTRO_HOME, sub);
      const destSub = join(dir, sub);
      if (!existsSync(homeSub) || !existsSync(destSub)) continue;
      for (const f of readdirSync(homeSub)) {
        if (!f.endsWith('.md')) continue;
        const link = join(destSub, f);
        if (!isSymlink(link)) continue;
        let target = '';
        try {
          target = readlinkSync(link);
        } catch { /* dangling — safe to remove */ }
        if (!target || target.startsWith(ASTRO_HOME)) {
          rmSync(link, { force: true });
          removed++;
        }
      }
    }
  }
  if (existsSync(ASTRO_HOME)) rmSync(ASTRO_HOME, { recursive: true, force: true });
  return { removed, home: ASTRO_HOME };
}
