// Who "me" is, for the phase band's mine-only view and the auto-tie (phase 58).
//
// "Me" is the repo's git identity (`git config user.email`, else `user.name`, exactly what
// `gitIdentity` stamps on a claim as its owner) PLUS personal aliases: other emails I have
// claimed work under (a work address, an old laptop). Aliases ADD to the git email, never
// replace it.
//
// ADR-068 / ADR-057: the aliases are personal state, so they live in `~/.astro/config.json`
// under `identity.aliases` and never under `.astrocode/` or in any tracked file. This module
// is their only writer. That file is shared with other settings, and it also holds
// `astrokit.token` — a secret. Nothing here ever prints or returns the file; every write
// preserves every other key; a file that is not a JSON object is REFUSED, not overwritten
// (the `setUserRoleDefaults` rule).
//
// Matching is exact equality after trim + lower-case. It never assumes an `@`: a claim owner
// can be a bare name when the clone had no `user.email`.
// hooks/_astro-team.mjs duplicates the key and the normalisation on purpose — hooks ship
// without lib/ — so change them together.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { git } from './git.mjs';

const userConfigFile = (home) => join(home, '.astro', 'config.json');
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

export function normalizeOwner(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

function readFileObject(file) {
  if (!existsSync(file)) return { cfg: {} };
  let cfg;
  try { cfg = JSON.parse(readFileSync(file, 'utf8')); } catch {
    return { error: `${file} is not valid JSON — fix it first; nothing was changed` };
  }
  if (!isObject(cfg)) return { error: `${file} is not a JSON object — fix it first; nothing was changed` };
  return { cfg };
}

function cleanAliases(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const a of raw) {
    const n = normalizeOwner(a);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** `identity.aliases`, normalised and deduped. Fails soft to `[]` on a missing file, bad JSON or bad shape. */
export function readUserAliases({ home = homedir() } = {}) {
  const { cfg } = readFileObject(userConfigFile(home));
  return cleanAliases(cfg && isObject(cfg.identity) ? cfg.identity.aliases : []);
}

function writeAliases(home, mutate) {
  const file = userConfigFile(home);
  const { cfg, error } = readFileObject(file);
  if (error) return { ok: false, error };
  const before = cleanAliases(isObject(cfg.identity) ? cfg.identity.aliases : []);
  const after = mutate(before);
  const changed = after.length !== before.length || after.some((a, i) => a !== before[i]);
  if (changed) {
    cfg.identity = { ...(isObject(cfg.identity) ? cfg.identity : {}), aliases: after };
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n');
    renameSync(tmp, file);
  }
  return { ok: true, changed, aliases: after };
}

export function addUserAlias({ home = homedir(), email } = {}) {
  const n = normalizeOwner(email);
  if (!n) return { ok: false, error: 'an alias must be a non-empty email' };
  return writeAliases(home, (list) => (list.includes(n) ? list : [...list, n]));
}

export function removeUserAlias({ home = homedir(), email } = {}) {
  const n = normalizeOwner(email);
  if (!n) return { ok: false, error: 'an alias must be a non-empty email' };
  return writeAliases(home, (list) => list.filter((a) => a !== n));
}

/** The repo's own identity, un-normalised, as `gitIdentity` would stamp it (`''` when neither is set). */
export function gitOwner(root) {
  const email = git(['config', 'user.email'], { cwd: root }).stdout.trim();
  return email || git(['config', 'user.name'], { cwd: root }).stdout.trim();
}

/** Everything that counts as me: git email (else name) plus aliases, as a normalised Set. */
export function myIdentities({ root, home = homedir() } = {}) {
  const set = new Set(readUserAliases({ home }));
  const own = normalizeOwner(gitOwner(root));
  if (own) set.add(own);
  return set;
}
