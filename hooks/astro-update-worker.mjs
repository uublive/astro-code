#!/usr/bin/env node
// Background worker spawned (detached) by the astro-update SessionStart hook.
// Adapted from GSD's npm-based check for astro-code's git-clone model: there is no
// published package, so "newer" means "origin is ahead of the clone". We
// `git fetch` the clone, count how many commits HEAD is behind its upstream, and
// read the version from both sides' package.json. The result is cached so the next
// session's banner/statusline can render instantly without touching the network.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HOME = process.env.ASTRO_HOME || join(homedir(), '.astro', 'code');
const sourceFile = join(HOME, 'source');
const cacheFile = join(HOME, 'update-check.json');

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: (r.stdout || '').trim() };
}
function pkgVersion(text) {
  try { return JSON.parse(text).version || null; } catch { return null; }
}
function readSafe(p) {
  try { return readFileSync(p, 'utf8'); } catch { return ''; }
}

let clone = readSafe(sourceFile).trim();
if (!clone || !existsSync(clone)) process.exit(0);
if (git(['rev-parse', '--is-inside-work-tree'], clone).status !== 0) process.exit(0);

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], clone).out || 'HEAD';
// Best-effort fetch — stay silent and fail-open when offline.
git(['fetch', '--quiet'], clone);

// Prefer the configured upstream (@{u}); fall back to origin/<branch>.
const upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], clone);
const upref = upstream.status === 0 && upstream.out ? upstream.out : `origin/${branch}`;

const behindRes = git(['rev-list', '--count', `HEAD..${upref}`], clone);
const behind = behindRes.status === 0 ? Number(behindRes.out) || 0 : 0;

const installed = pkgVersion(readSafe(join(clone, 'package.json')));
const latest = pkgVersion(git(['show', `${upref}:package.json`], clone).out) || installed;

const result = {
  update_available: behind > 0,
  behind,
  installed: installed || 'unknown',
  latest: latest || 'unknown',
  branch,
  upstream: upref,
  checked: Math.floor(Date.now() / 1000),
};
try { writeFileSync(cacheFile, JSON.stringify(result)); } catch { /* best-effort */ }
