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
import { readFileSync, existsSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const IDENTITY_TTL_SECONDS = 600;
const CLOSED = new Set(['complete', 'retired']);

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const readText = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** The repository's common git dir (a linked worktree keeps its refs there), or null. */
function commonGitDir(root) {
  const dotGit = join(root, '.git');
  let gitDir = dotGit;
  const asFile = readText(dotGit);
  if (asFile !== null) {
    const m = /^gitdir:\s*(.+)$/m.exec(asFile);
    if (!m) return null;
    gitDir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(root, m[1].trim());
  } else if (!existsSync(dotGit)) {
    return null;
  }
  const common = readText(join(gitDir, 'commondir'));
  return common ? resolve(gitDir, common.trim()) : gitDir;
}

/** The commit a remote-tracking ref points at, from the ref files alone, or null. */
export function refCommit(root, remote, branch) {
  const common = commonGitDir(root);
  if (!common) return null;
  const name = `refs/remotes/${remote}/${branch}`;
  const loose = readText(join(common, name));
  if (loose && /^[0-9a-f]{40,64}\s*$/.test(loose)) return loose.trim();
  const packed = readText(join(common, 'packed-refs')) || '';
  for (const line of packed.split('\n')) {
    const [sha, ref] = line.trim().split(' ');
    if (ref === name && /^[0-9a-f]{40,64}$/.test(sha)) return sha;
  }
  return null;
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

/**
 * `{ me, claims }` from the local registry ref, cached; null when there is no repo, no ref or
 * no registry file. `me` is the owner key `ac` records: git `user.email`, else `user.name`.
 */
export function teamClaims(root, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cfg = readJson(join(root, '.astrocode', 'config.json')) || {};
  const sha = refCommit(root, cfg.registry_remote || 'origin', cfg.registry_branch || 'astro-registry');
  if (!sha) return null;
  const cacheFile = join(root, '.astrocode', '.local', 'team-claims.json');
  const cache = readJson(cacheFile);
  if (cache && cache.sha === sha && typeof cache.me_at === 'number' && nowSeconds - cache.me_at < IDENTITY_TTL_SECONDS) {
    return { me: cache.me, claims: cache.claims };
  }
  let claims = cache && cache.sha === sha ? cache.claims : null;
  if (!claims) {
    const text = git(root, ['show', `${sha}:registry.json`]);
    let reg = null;
    try { reg = text ? JSON.parse(text) : null; } catch { reg = null; }
    if (!reg || !Array.isArray(reg.claims)) return null;
    claims = reg.claims
      .filter((c) => c && c.type === 'phase' && typeof c.number === 'number')
      .map((c) => ({ number: c.number, milestone: c.milestone ?? null, name: c.name ?? '', owner: c.owner ?? '', status: c.status ?? 'active' }));
  }
  const me = (git(root, ['config', 'user.email']) || '').trim() || (git(root, ['config', 'user.name']) || '').trim();
  writeCache(root, { sha, claims, me, me_at: nowSeconds });
  return { me, claims };
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
  const others = team.claims.filter((c) => c.milestone === milestone && c.owner && c.owner !== team.me);
  if (!others.length) return empty;
  const tags = ownerTags(others.map((c) => c.owner));
  const owners = Object.fromEntries(others.map((c) => [c.number, tags.get(c.owner)]));
  const extra = others
    .filter((c) => !localNumbers.has(c.number) && !CLOSED.has(c.status))
    .map((c) => ({ number: c.number, name: c.name, status: 'pending', owner: tags.get(c.owner), remote: true }));
  return { owners, extra };
}
