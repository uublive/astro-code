#!/usr/bin/env node
// Composing statusline wrapper. Invoked as:  node astro-statusline.mjs <configDir>
//
// astro-code must not clobber a statusline the user already runs (e.g. GSD's). At
// install time we save the original `statusLine.command` for each config dir into
// ~/.astro/code/statusline-chain.json; here we run it first (feeding it the same
// stdin Claude gave us), then append a short astro segment when the clone is behind
// origin. Uninstall restores the original command from that same map.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HOME = join(homedir(), '.astro', 'code');
const configDir = process.argv[2] || '';

// Claude pipes a JSON context blob on stdin — forward it verbatim to the wrapped line.
let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }

function readJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// (1) the original statusline, if any
let base = '';
const chain = readJson(join(HOME, 'statusline-chain.json')) || {};
const prev = chain[configDir];
if (prev && typeof prev.command === 'string' && prev.command) {
  const r = spawnSync(prev.command, { shell: true, input, encoding: 'utf8' });
  base = (r.stdout || '').replace(/\n+$/, '');
}

// (2) the astro update segment
let segment = '';
const cache = readJson(join(HOME, 'update-check.json'));
if (cache && cache.update_available) {
  segment = `⬆ astro-code ${cache.behind} behind — /astro-update`;
}

const parts = [base, segment].filter(Boolean);
process.stdout.write(parts.join('  ·  '));
