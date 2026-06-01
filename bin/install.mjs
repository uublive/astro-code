#!/usr/bin/env node
// Standalone installer for cloning the repo without a global `ac` yet.
// Equivalent to `ac install`: populates ~/.astro/code and symlinks commands +
// agents into ~/.claude.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installClaude } from '../lib/install.mjs';

const frameworkRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = installClaude(frameworkRoot);

console.log(`✓ home: ${res.home}  (${res.commands} commands, ${res.agents} agents, ${res.workflows} workflows)`);
console.log(`✓ linked ${res.linkedCommands} command(s) → ${res.commandsDir}`);
console.log(`✓ linked ${res.linkedAgents} agent(s)   → ${res.agentsDir}`);
console.log('');
console.log('Put `ac` on your PATH:  npm install -g .   (run inside the astro-code repo)');
