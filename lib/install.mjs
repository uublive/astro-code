// Install/uninstall astro-code into the user path.
//
// Files live in the home (~/.astro/code) — astro-code's own namespace. The
// Claude-facing commands/agents are SYMLINKED into every Claude config dir, because
// that's the only place Claude Code discovers them:
//   - the base config dir (~/.claude), and
//   - every jean-claude profile (read from ~/.claude/.jean-claude/profiles.json).
// This mirrors jean-claude's own model (shared files in base, symlinked per profile)
// so the commands show up in ALL profiles, not just the active one.
import { mkdirSync, readdirSync, copyFileSync, existsSync, rmSync, symlinkSync, lstatSync, readlinkSync, readFileSync } from 'node:fs';
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

export function installClaude(frameworkRoot) {
  const commands = copyDir(join(frameworkRoot, 'commands'), join(ASTRO_HOME, 'commands'), '.md');
  const agents = copyDir(join(frameworkRoot, 'agents'), join(ASTRO_HOME, 'agents'), '.md');
  const workflows = copyDir(join(frameworkRoot, 'workflows'), join(ASTRO_HOME, 'workflows'), '.mjs');

  const linked = [];
  for (const [dir, label] of configTargets()) {
    linked.push({
      label,
      dir,
      commands: symlinkInto(join(ASTRO_HOME, 'commands'), join(dir, 'commands')),
      agents: symlinkInto(join(ASTRO_HOME, 'agents'), join(dir, 'agents')),
    });
  }
  return { home: ASTRO_HOME, commands, agents, workflows, targets: linked };
}

export function uninstallClaude() {
  let removed = 0;
  for (const [dir] of configTargets()) {
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
