// Install/uninstall astro-code's slash commands and agents into Claude Code (~/.claude).
import { mkdirSync, readdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE = join(homedir(), '.claude');

function copyMarkdown(src, dest) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.md')) continue;
    copyFileSync(join(src, f), join(dest, f));
    n++;
  }
  return n;
}

export function installClaude(frameworkRoot) {
  const commandsDir = join(CLAUDE, 'commands');
  const agentsDir = join(CLAUDE, 'agents');
  return {
    commands: copyMarkdown(join(frameworkRoot, 'commands'), commandsDir),
    agents: copyMarkdown(join(frameworkRoot, 'agents'), agentsDir),
    commandsDir,
    agentsDir,
  };
}

export function uninstallClaude(frameworkRoot) {
  let removed = 0;
  for (const [name, dest] of [
    ['commands', join(CLAUDE, 'commands')],
    ['agents', join(CLAUDE, 'agents')],
  ]) {
    const src = join(frameworkRoot, name);
    if (!existsSync(src)) continue;
    for (const f of readdirSync(src)) {
      if (!f.endsWith('.md')) continue;
      const target = join(dest, f);
      if (existsSync(target)) {
        rmSync(target);
        removed++;
      }
    }
  }
  return { removed };
}
