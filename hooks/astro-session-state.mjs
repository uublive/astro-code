#!/usr/bin/env node
// Records turn boundaries so the statusline can show a busy/idle dot. Wired to two
// events and told which one it is via argv:
//   UserPromptSubmit → `prompt`  (a turn just started → busy)
//   Stop             → `stop`    (the turn ended → idle)
// State is keyed by session_id (from the hook's stdin blob) so parallel Claude
// sessions never clobber each other's dot. Best-effort and SILENT: it writes only
// to the state file and prints nothing (a UserPromptSubmit hook's stdout would be
// injected into the model's context), and swallows every error so it can never
// block or delay a turn.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DIR = join(homedir(), '.astro', 'code');
const FILE = join(DIR, 'session-state.json');

let input = '';
try { input = readFileSync(0, 'utf8'); } catch { /* no stdin */ }
let data = {};
try { data = JSON.parse(input) || {}; } catch { /* no/!json stdin */ }

const sid = data.session_id || 'default';
const kind = process.argv[2] || data.hook_event_name || '';
const now = Math.floor(Date.now() / 1000);

let map = {};
try { map = JSON.parse(readFileSync(FILE, 'utf8')) || {}; } catch { /* first write */ }
if (!map || typeof map !== 'object') map = {};

const rec = map[sid] && typeof map[sid] === 'object' ? map[sid] : {};
if (kind === 'stop' || kind === 'Stop' || kind === 'SubagentStop') rec.stop = now;
else rec.prompt = now;                 // UserPromptSubmit (or any keep-alive)
rec.at = now;
map[sid] = rec;

// Prune records untouched for a day so the file can't grow without bound.
for (const [k, v] of Object.entries(map)) {
  if (v && typeof v.at === 'number' && now - v.at > 86_400) delete map[k];
}

try {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(map));
} catch { /* best-effort */ }
