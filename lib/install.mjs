// Install/uninstall astro-code into the user path.
//
// Home is ~/.astro/code (the `.astro` namespace holds all astro tools; `code` is
// this one). The Claude-facing artifacts — commands, agents, workflows — live in
// the home. Commands and agents are then SYMLINKED into ~/.claude/{commands,agents}
// because that's the only place Claude Code discovers them; the symlinks keep the
// home as the single source of truth.
import { mkdirSync, readdirSync, copyFileSync, existsSync, rmSync, symlinkSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const ASTRO_HOME = join(homedir(), '.astro', 'code');
const CLAUDE = join(homedir(), '.claude');

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
  // 1. Populate the home with the Claude-facing framework.
  const commands = copyDir(join(frameworkRoot, 'commands'), join(ASTRO_HOME, 'commands'), '.md');
  const agents = copyDir(join(frameworkRoot, 'agents'), join(ASTRO_HOME, 'agents'), '.md');
  const workflows = copyDir(join(frameworkRoot, 'workflows'), join(ASTRO_HOME, 'workflows'), '.mjs');
  // 2. Symlink commands/agents from the home into ~/.claude for discovery.
  const linkedCommands = symlinkInto(join(ASTRO_HOME, 'commands'), join(CLAUDE, 'commands'));
  const linkedAgents = symlinkInto(join(ASTRO_HOME, 'agents'), join(CLAUDE, 'agents'));
  return {
    home: ASTRO_HOME,
    commands,
    agents,
    workflows,
    linkedCommands,
    linkedAgents,
    commandsDir: join(CLAUDE, 'commands'),
    agentsDir: join(CLAUDE, 'agents'),
  };
}

export function uninstallClaude() {
  let removed = 0;
  for (const sub of ['commands', 'agents']) {
    const homeSub = join(ASTRO_HOME, sub);
    const claudeSub = join(CLAUDE, sub);
    if (!existsSync(homeSub)) continue;
    for (const f of readdirSync(homeSub)) {
      if (!f.endsWith('.md')) continue;
      const link = join(claudeSub, f);
      if (!isSymlink(link)) continue;
      // only remove links that point back into our home. Use the raw link target
      // (not realpath) so macOS /var → /private/var canonicalization can't break
      // the prefix check.
      let target = '';
      try {
        target = readlinkSync(link);
      } catch { /* dangling symlink — safe to remove */ }
      if (!target || target.startsWith(ASTRO_HOME)) {
        rmSync(link, { force: true });
        removed++;
      }
    }
  }
  if (existsSync(ASTRO_HOME)) rmSync(ASTRO_HOME, { recursive: true, force: true });
  return { removed, home: ASTRO_HOME };
}
