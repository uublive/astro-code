// Teammates' phases for the bar: which phase someone else claimed, read from the LOCAL copy of
// the shared registry (`<registry_remote>/<registry_branch>`, as of the last fetch).
//
// ## Why the local ref, never a fetch
//
// The statusline renders on every prompt and must stay fast and offline. Every `ac` command that
// claims a number already fetches the registry branch, so the remote-tracking ref is as fresh as
// the last claim anyone made from this checkout. A teammate's phase shows up once that ref has
// moved; a `git fetch` makes it current.
//
// ## Why a cache keyed by the ref's commit
//
// Resolving the ref is two small file reads (loose ref, else packed-refs). `git show` runs only
// when that commit changes, and the result sits in `.astrocode/.local/team-claims.json` (local,
// never committed). The developer's own identity is re-read every 10 minutes.
//
// This file is imported by `_astro-ctx.mjs`, so like it, it must NOT import from ../lib (the
// hooks are installed without lib/). Every failure returns null: the bar then shows only the
// local roadmap, exactly as before.
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const IDENTITY_TTL_SECONDS = 600;
const CLOSED = new Set(['complete', 'retired']);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** This checkout's own git dir (a linked worktree has its own HEAD there), or null. */
function ownGitDir(root) {
  const dotGit = join(root, '.git');
  const asFile = readText(dotGit);
  if (asFile !== null) {
    const m = /^gitdir:\s*(.+)$/m.exec(asFile);
    if (!m) return null;
    return isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
  }
  return existsSync(dotGit) ? dotGit : null;
}

/** The repository's common git dir (a linked worktree keeps its refs there), or null. */
function commonGitDir(root) {
  const gitDir = ownGitDir(root);
  if (!gitDir) return null;
  const common = readText(join(gitDir, 'commondir'));
  return common ? resolve(gitDir, common.trim()) : gitDir;
}

/**
 * The full name of the branch HEAD is on, from `<this checkout's gitdir>/HEAD` (a worktree's own
 * HEAD, not the common dir's), or null when detached or unreadable. The name is never truncated or
 * split on `/`: `feature/v0-full-walk` is one name.
 */
export function headBranch(root) {
  const gitDir = ownGitDir(root);
  const text = gitDir && readText(join(gitDir, 'HEAD'));
  const m = text && /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(text);
  return m ? m[1] : null;
}

/** The commit a remote-tracking ref points at AND the file that held it, from the ref files alone, or null. */
function refAt(root, remote, branch) {
  const common = commonGitDir(root);
  if (!common) return null;
  const name = `refs/remotes/${remote}/${branch}`;
  const looseFile = join(common, name);
  const loose = readText(looseFile);
  if (loose && /^[0-9a-f]{40,64}\s*$/.test(loose)) return { sha: loose.trim(), file: looseFile };
  const packedFile = join(common, 'packed-refs');
  const packed = readText(packedFile) || '';
  for (const line of packed.split('\n')) {
    const [sha, ref] = line.trim().split(' ');
    if (ref === name && /^[0-9a-f]{40,64}$/.test(sha)) return { sha, file: packedFile };
  }
  return null;
}

/** The commit a remote-tracking ref points at, from the ref files alone, or null. */
export function refCommit(root, remote, branch) {
  const at = refAt(root, remote, branch);
  return at ? at.sha : null;
}

function git(root, args) {
  try {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 3000, windowsHide: true });
    return r.status === 0 ? r.stdout : null;
  } catch { return null; }
}

function writeCache(root, data) {
  try {
    const dir = join(root, '.astrocode', '.local');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(join(dir, '.gitignore'))) writeFileSync(join(dir, '.gitignore'), '*\n');
    const file = join(dir, 'team-claims.json');
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(data));
    renameSync(tmp, file);
  } catch { /* a read-only checkout just re-reads next time */ }
}

// Identity is the git email (else name) plus personal aliases. The alias key and the
// normalisation duplicate lib/identity.mjs on purpose — hooks ship without lib/ — so change
// them together. Aliases are one small file, re-read on every call; only the git identity (a
// process spawn) is cached.
const normalize = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
function readAliases(home) {
  const raw = (readJson(join(home, '.astro', 'config.json')) || {}).identity?.aliases;
  return Array.isArray(raw) ? raw.map(normalize).filter(Boolean) : [];
}

// A changed `user.email` must take effect on the next call, not after the 10-minute TTL: the
// cache is dropped when the mtime or size of any file git reads the identity from changes.
function configFingerprint(root, home) {
  const xdg = process.env.XDG_CONFIG_HOME || join(home, '.config');
  const common = commonGitDir(root);
  return [common && join(common, 'config'), join(home, '.gitconfig'), join(xdg, 'git', 'config')]
    .map((f) => {
      try { const st = f ? statSync(f) : null; return st ? `${st.mtimeMs}:${st.size}` : '-'; } catch { return '-'; }
    })
    .join('|');
}

/**
 * `{ me, claims, milestoneTies, refPath }` from the local registry ref, cached; null when there
 * is no repo, no ref or no registry file. `me` is an array of normalised owner keys: git
 * `user.email` (else `user.name`, as `ac` records) plus the personal aliases.
 *
 * Each phase claim keeps `number`, `milestone`, `name`, the raw `owner`, `status`, and `tie` —
 * present only when the claim has a `feature_branch` key (`null` = explicitly untied, a string =
 * tied); absent = inherits the milestone. `milestoneTies` maps a milestone number to its string
 * `feature_branch`. The historic claim `branch` is never read as a tie.
 */
export function teamClaims(root, nowSeconds = Math.floor(Date.now() / 1000), { home = process.env.HOME || homedir() } = {}) {
  const cfg = readJson(join(root, '.astrocode', 'config.json')) || {};
  const at = refAt(root, cfg.registry_remote || 'origin', cfg.registry_branch || 'astro-registry');
  if (!at) return null;
  const { sha, file: refPath } = at;
  const cacheFile = join(root, '.astrocode', '.local', 'team-claims.json');
  const raw = readJson(cacheFile);
  const cache = raw && raw.v === 2 ? raw : null; // an older cache shape is rebuilt
  const fp = configFingerprint(root, home);
  const idFresh = cache && cache.fp === fp && typeof cache.id_at === 'number' && nowSeconds - cache.id_at < IDENTITY_TTL_SECONDS;
  const withMe = (id, claims, milestoneTies) => {
    const me = [normalize(id), ...readAliases(home)].filter(Boolean);
    return { me: [...new Set(me)], claims, milestoneTies, refPath };
  };
  if (cache && cache.sha === sha && idFresh) return withMe(cache.id, cache.claims, cache.milestoneTies);
  let claims = cache && cache.sha === sha ? cache.claims : null;
  let milestoneTies = cache && cache.sha === sha ? cache.milestoneTies : null;
  if (!claims) {
    const text = git(root, ['show', `${sha}:registry.json`]);
    let reg = null;
    try { reg = text ? JSON.parse(text) : null; } catch { reg = null; }
    if (!reg || !Array.isArray(reg.claims)) return null;
    claims = reg.claims
      .filter((c) => c && c.type === 'phase' && typeof c.number === 'number')
      .map((c) => ({
        number: c.number, milestone: c.milestone ?? null, name: c.name ?? '', owner: c.owner ?? '', status: c.status ?? 'active',
        ...(Object.hasOwn(c, 'feature_branch') ? { tie: typeof c.feature_branch === 'string' ? c.feature_branch : null } : {}),
      }));
    milestoneTies = {};
    for (const c of reg.claims) {
      if (c && c.type === 'milestone' && typeof c.number === 'number' && typeof c.feature_branch === 'string') milestoneTies[c.number] = c.feature_branch;
    }
  }
  const id = (git(root, ['config', 'user.email']) || '').trim() || (git(root, ['config', 'user.name']) || '').trim();
  writeCache(root, { v: 2, sha, claims, milestoneTies, id, id_at: nowSeconds, fp });
  return withMe(id, claims, milestoneTies);
}

/** An empty owner is mine (never hide work that cannot be attributed); otherwise exact normalised equality. */
export function isMine(owner, me) {
  const o = normalize(owner);
  return !o || (me instanceof Set ? me.has(o) : (me || []).includes(o));
}

/**
 * Ownership for the band and `ac status --json`: `{ me:Set, claims, milestoneTies, refPath }`, or
 * null when there is no ref or no readable registry (the caller then shows the full view).
 */
export function ownership(root, nowSeconds, opts) {
  const t = teamClaims(root, nowSeconds, opts);
  return t ? { me: new Set(t.me), claims: t.claims, milestoneTies: t.milestoneTies, refPath: t.refPath } : null;
}

/**
 * Short, distinct tags for owners: the first letter of the email's local part (or the name),
 * lengthened only where two owners would share a tag. `alex@x` → `a`; `alex@x` + `anna@y` →
 * `al` + `an`.
 */
export function ownerTags(owners) {
  const base = (o) => (String(o).split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '') || 'x');
  const uniq = [...new Set(owners)];
  const tags = new Map();
  for (const o of uniq) {
    const b = base(o);
    let n = 1;
    while (n < b.length && uniq.some((p) => p !== o && base(p).slice(0, n) === b.slice(0, n))) n++;
    tags.set(o, b.slice(0, n));
  }
  return tags;
}

/**
 * Teammates' phases in this milestone: `owners` maps a phase number to its owner tag (only for
 * phases someone else claimed), and `extra` lists the open ones not yet in the local roadmap.
 */
export function teamPhases(root, milestone, localNumbers, nowSeconds) {
  const empty = { owners: {}, extra: [] };
  if (milestone == null) return empty;
  const team = teamClaims(root, nowSeconds);
  if (!team) return empty;
  const others = team.claims.filter((c) => c.milestone === milestone && c.owner && !isMine(c.owner, team.me));
  if (!others.length) return empty;
  const tags = ownerTags(others.map((c) => c.owner));
  const owners = Object.fromEntries(others.map((c) => [c.number, tags.get(c.owner)]));
  const extra = others
    .filter((c) => !localNumbers.has(c.number) && !CLOSED.has(c.status))
    .map((c) => ({ number: c.number, name: c.name, status: 'pending', owner: tags.get(c.owner), remote: true }));
  return { owners, extra };
}
