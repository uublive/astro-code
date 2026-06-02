#!/usr/bin/env node
// SessionStart hook — the astro-code banner + "there's an update" notice.
// Three responsibilities, all cheap and non-blocking:
//   (1) when launched inside an astro-code project, print the creature logo banner with
//       the current milestone/phase/status and the suggested next command;
//   (2) read the cached update check and, if the clone is behind origin, append
//       an update nudge to the same systemMessage;
//   (3) if the cache is missing or stale (>1h), spawn the detached worker to
//       refresh it for next time (a `git fetch` + behind-count in the background).
// The one-session lag between (3) writing and (2) reading mirrors GSD by design —
// the banner never blocks startup on the network.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { findAstroRoot, readContext, renderBanner } from './_astro-ctx.mjs';

const HOME = join(homedir(), '.astro', 'code');
const cacheFile = join(HOME, 'update-check.json');
const sourceFile = join(HOME, 'source');
const STALE_SECONDS = 60 * 60; // refresh at most hourly

let cache = null;
try { cache = JSON.parse(readFileSync(cacheFile, 'utf8')); } catch { /* no cache yet */ }

// Claude pipes a SessionStart context blob on stdin; we need its cwd + source.
let cwd = process.cwd();
let source = 'startup';
try {
  const data = JSON.parse(readFileSync(0, 'utf8'));
  cwd = data?.cwd || data?.workspace?.current_dir || cwd;
  source = data?.source || source;
} catch { /* no/!json stdin — fall back to defaults */ }

const lines = [];

// (1) the creature logo banner, when we're inside an astro-code project. astro-code leans
// on `/clear` between steps, so only print the full logo on a genuine startup/resume
// — not on every clear/compact (the statusline already carries the live state).
const projRoot = findAstroRoot(cwd);
if (projRoot && source !== 'clear' && source !== 'compact') {
  const banner = renderBanner(readContext(projRoot, Math.floor(Date.now() / 1000)));
  if (banner) lines.push(banner);
}

// (2) the update nudge from the last check
if (cache && cache.update_available) {
  const n = cache.behind || 0;
  const ver = cache.installed && cache.latest && cache.installed !== cache.latest
    ? ` (v${cache.installed} → v${cache.latest})` : '';
  lines.push(`astro-code update available: ${n} commit${n === 1 ? '' : 's'} behind${ver} — run /astro-update`);
}

if (lines.length) process.stdout.write(JSON.stringify({ systemMessage: lines.join('\n\n') }));

// (2) refresh in the background when missing/stale
const now = Math.floor(Date.now() / 1000);
const stale = !cache || !cache.checked || (now - cache.checked) > STALE_SECONDS;
if (stale && existsSync(sourceFile)) {
  try {
    const worker = join(dirname(fileURLToPath(import.meta.url)), 'astro-update-worker.mjs');
    const child = spawn(process.execPath, [worker], {
      stdio: 'ignore',
      detached: true,
      windowsHide: true,
      env: { ...process.env, ASTRO_HOME: HOME },
    });
    child.unref();
  } catch { /* best-effort */ }
}

process.exit(0);
