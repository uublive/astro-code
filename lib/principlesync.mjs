// Offline-first git sync for the personal principle store (ADR-057, D1/D2, P9).
//
// ## Why a plain repo, not `shared.mjs`'s orphan-branch CAS
//
// `lib/shared.mjs`'s `transact()` exists because a TEAM registry has many writers who
// must never silently clobber each other's claim — the orphan branch's compare-and-swap
// push (reject on non-fast-forward, retry against the new tip) is what CONVENTIONS' "all
// numbering, decisions, and shared canon go through `transact`" rule is protecting. A
// personal principle store has exactly ONE human owner across however many of their own
// machines. There is nothing to arbitrate between writers, only entries to reconcile
// between copies of the same person's mind — so a normal branch with normal commits and
// normal merges is the right shape: readable history (`git log` on `~/.astro/principles`
// is a diary of the user's own taste changing over time), and a plain `git merge` is
// exactly the tool for "two machines each added different files", which is what D6's
// one-file-per-entry layout makes true by construction.
//
// ## Why a failed fetch stops everything (ADR-043)
//
// ADR-043 exists because an unreachable remote was once flattened into "the remote has
// nothing" and answered with instructions that would have rebuilt a team registry from
// one developer's disk. The same conflation is worse here: an unreadable `git fetch`
// tells us NOTHING about whether the remote is empty, ahead, behind, or simply offline
// right now (a laptop closed the lid mid-sync). Treating "can't reach it" as "nothing to
// merge" would let a later successful push silently overwrite entries the user accepted
// on another machine. So step 3 below is a hard stop: no merge, no push, no deletion —
// `{ state: 'unreachable' }` and the local store is untouched, exactly as D2 requires
// ("unreachable is never empty").
//
// ## Why a genuine conflict becomes a side file, never markers or a silent winner
//
// ADR-053 already settled this for canon: a prose three-way merge was rejected because
// conflict markers landing in a file every agent reads as ground truth would themselves
// be read as rules. The same failure mode applies here, worse — `parsePrinciple` treats
// `<<<<<<<` lines as DAMAGE (see `principlemd.mjs`'s header), so a marked-up entry would
// not even load. And picking a winner silently (newest-timestamp-wins, last-push-wins)
// would throw away a human's considered edit without them ever seeing it happen. So a
// genuine conflict (divergent history, not a strict prefix either way) keeps the current
// machine's version in `<id>.md` — nothing the user is looking at changes under them —
// and writes the other machine's version to `conflicts/<id>.<sha7>.md`, reported on every
// command until `resolveConflict` is called explicitly.
//
// ## Why `.git` presence, never `isRepo(dir)`
//
// `lib/git.mjs`'s `isRepo` answers "is this path inside SOME working tree", which is true
// for `~/.astro/principles` the moment `$HOME` itself is a dotfiles-managed git repo — a
// setup common enough among the people this store is FOR. Trusting that would silently
// start committing personal principles into the user's dotfiles repo the first time they
// ran any `ac principles` command, with no `remote` ever configured. D1's "no remote ⇒
// purely local, fully functional" promise only holds if "is a repo" means "has its OWN
// `.git`" (`existsSync(join(dir, '.git'))`) — a directory-local check that a PARENT
// repo can never satisfy. Every function below (including `isStoreRepo` itself) uses
// only this check; none of them call `isRepo`.
//
// ## Why never `--force`
//
// A force-push here would do to a private git history what ADR-053 refused to do to
// canon: pick a winner without the user seeing it. The whole point of D2 ("a genuine
// conflict is REPORTED, never overwritten") is that resolution is a decision the human
// makes with `resolveConflict(dir, id, { take })` — a plain, non-force push whose
// rejection on a race is the correct signal to retry (step 6), not a reason to overwrite.

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { git, gitOk } from './git.mjs';
import { withLock, atomicWriteText } from './util.mjs';
import { parsePrinciple, renderPrinciple, compareRevisions } from './principlemd.mjs';

const GITIGNORE = '.lock/\n*.tmp-*\n';

/** Is `dir` its OWN git repo — never true merely because a PARENT directory is one. */
export function isStoreRepo(dir) {
  return existsSync(join(dir, '.git'));
}

/** The configured `origin` url, or `null` if there is no store repo or no remote. */
export function getRemote(dir) {
  if (!isStoreRepo(dir)) return null;
  const res = git(['remote', 'get-url', 'origin'], { cwd: dir });
  return res.status === 0 ? res.stdout.trim() || null : null;
}

// `-c` overrides for every commit this module makes: never sign (a personal machine may
// have no configured key and must not be blocked by one), and only stamp an identity
// when the store repo has none of its own (never override a user's real git identity).
function commitCArgs(dir) {
  const args = ['-c', 'commit.gpgsign=false'];
  const email = git(['config', 'user.email'], { cwd: dir }).stdout.trim();
  if (!email) args.push('-c', 'user.name=astro-code', '-c', 'user.email=astro-code@localhost');
  return args;
}

/** `git add -A` + commit, but only if something is actually staged. Returns whether it committed. */
function commitIfStaged(dir, message) {
  git(['add', '-A'], { cwd: dir });
  const clean = gitOk(['diff', '--cached', '--quiet'], { cwd: dir });
  if (clean) return false;
  const res = git([...commitCArgs(dir), 'commit', '--no-verify', '-m', message], { cwd: dir });
  if (res.status !== 0) throw new Error(`principlesync: commit failed: ${res.stderr || res.stdout}`);
  return true;
}

function ensureGitignore(dir) {
  const p = join(dir, '.gitignore');
  if (existsSync(p) && readFileSync(p, 'utf8') === GITIGNORE) return;
  writeFileSync(p, GITIGNORE);
}

// One side of a conflicted path's merge — `git ls-files -u` stage 2 (ours) or 3 (theirs).
function stageBlob(dir, path, stage) {
  const res = git(['ls-files', '-u', '--', path], { cwd: dir });
  const line = res.stdout.split('\n').find((l) => l.split(/\s+/)[2] === String(stage));
  if (!line) return null;
  const sha = line.split(/\s+/)[1];
  const blob = git(['cat-file', '-p', sha], { cwd: dir });
  if (blob.status !== 0) return null;
  return { sha, content: blob.stdout };
}

// Resolve every conflicted top-level `<id>.md` path after a failed `git merge`, per P9
// step 5. Returns `{ ok: false }` (caller must `git merge --abort`) the moment ANY
// unmerged path is not a clean single-entry `UU` conflict on a top-level `.md` file —
// that is "any other unmerged path or type", reported upstream as `{ state: 'diverged' }`
// rather than guessed at.
function resolveMergeConflicts(dir) {
  const status = git(['status', '--porcelain'], { cwd: dir }).stdout.split('\n').filter(Boolean);
  const unmerged = status.filter((l) => /^(UU|AA|DD|AU|UA|UD|DU) /.test(l));
  if (unmerged.length === 0) return { ok: false, conflicts: [] };

  const conflicts = [];
  for (const line of unmerged) {
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (code !== 'UU' || !/^[^/]+\.md$/.test(path)) return { ok: false, conflicts: [] };

    const ours = stageBlob(dir, path, 2);
    const theirs = stageBlob(dir, path, 3);
    if (!ours || !theirs) return { ok: false, conflicts: [] };

    const id = path.slice(0, -'.md'.length);
    let oursEntry, theirsEntry;
    try {
      oursEntry = parsePrinciple(ours.content, { file: path, id });
      theirsEntry = parsePrinciple(theirs.content, { file: path, id });
    } catch {
      return { ok: false, conflicts: [] }; // a damaged side is not ours to guess at either
    }

    const cmp = compareRevisions(oursEntry, theirsEntry); // ours relative to theirs
    if (cmp === 'same' || cmp === 'newer') {
      atomicWriteText(join(dir, path), ours.content);
      git(['add', '--', path], { cwd: dir });
    } else if (cmp === 'older') {
      atomicWriteText(join(dir, path), theirs.content);
      git(['add', '--', path], { cwd: dir });
    } else {
      // genuine conflict — keep ours where the user is looking, file theirs aside.
      const conflictRel = `conflicts/${id}.${theirs.sha.slice(0, 7)}.md`;
      atomicWriteText(join(dir, path), ours.content);
      atomicWriteText(join(dir, conflictRel), theirs.content);
      git(['add', '--', path], { cwd: dir });
      git(['add', '--', conflictRel], { cwd: dir });
      conflicts.push({ id, file: conflictRel });
    }
  }
  return { ok: true, conflicts };
}

const EMPTY = () => ({ state: 'local', pulled: [], pushed: false, conflicts: [] });

// The actual P9 algorithm, run under the caller's already-held `.lock` (never acquires
// its own — `setRemote` needs to run this inside its own lock without deadlocking).
async function syncLocked(dir) {
  if (!isStoreRepo(dir)) return EMPTY();
  if (!getRemote(dir)) return EMPTY();

  // Step 2 — carry any write a lib helper made directly to the working tree, even one
  // made outside a call to this module (e.g. `node -e` in a test), before we touch git.
  commitIfStaged(dir, 'principles: local changes');

  let pulled = [];
  let conflicts = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Step 3
    const fetch = git(['fetch', 'origin'], { cwd: dir });
    if (fetch.status !== 0) return { state: 'unreachable', pulled, pushed: false, conflicts };

    // Step 4 — a fresh bare remote has no `main` yet: this machine seeds it.
    const hasOriginMain = gitOk(['rev-parse', '--verify', '--quiet', 'origin/main'], { cwd: dir });
    if (!hasOriginMain) {
      const push = git(['push', '-u', 'origin', 'main'], { cwd: dir });
      if (push.status === 0) return { state: 'synced', pulled, pushed: true, conflicts };
      continue; // someone beat us to it — retry from fetch
    }

    // Step 5
    const beforeHead = git(['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
    let merge = git([...commitCArgs(dir), 'merge', '--no-edit', 'origin/main'], { cwd: dir });
    if (merge.status !== 0 && /unrelated histories/.test(merge.stderr)) {
      merge = git(
        [...commitCArgs(dir), 'merge', '--no-edit', '--allow-unrelated-histories', 'origin/main'],
        { cwd: dir },
      );
    }
    if (merge.status !== 0) {
      const resolved = resolveMergeConflicts(dir);
      if (!resolved.ok) {
        git(['merge', '--abort'], { cwd: dir });
        return { state: 'diverged', pulled: [], pushed: false, conflicts: [] };
      }
      conflicts = resolved.conflicts;
      const commit = git([...commitCArgs(dir), 'commit', '--no-verify', '--no-edit'], { cwd: dir });
      if (commit.status !== 0) throw new Error(`principlesync: merge commit failed: ${commit.stderr}`);
    }

    const afterHead = git(['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
    if (afterHead !== beforeHead) {
      pulled = git(['diff', '--name-only', beforeHead, afterHead], { cwd: dir }).stdout
        .split('\n')
        .filter((f) => /^[^/]+\.md$/.test(f))
        .map((f) => f.slice(0, -'.md'.length));
    }

    // Step 6 — never `--force`; a rejection just means someone else pushed meanwhile.
    const push = git(['push', 'origin', 'main'], { cwd: dir });
    if (push.status === 0) return { state: 'synced', pulled, pushed: true, conflicts };
  }

  // Retried 3 times; local commits (including any resolved-conflict commit) stay —
  // "not pushed, will retry" is for the CLI layer (P12) to report from `pushed: false`.
  return { state: 'synced', pulled, pushed: false, conflicts };
}

/**
 * Reconcile the local store with `origin/main`, offline-first (D2). Writes and succeeds
 * locally regardless of remote reachability; the next command that CAN reach the remote
 * carries forward whatever this one could not push.
 *
 * @param {string} dir
 * @returns {Promise<{ state: 'local'|'synced'|'unreachable'|'diverged', pulled: string[],
 *   pushed: boolean, conflicts: { id: string, file: string }[] }>}
 */
export async function syncPrinciples(dir) {
  return withLock(join(dir, '.lock'), () => syncLocked(dir));
}

/**
 * Back the store with the user's own private remote (D1). Idempotent: turns a bare local
 * directory into a repo on first call, always ends by syncing. An unreachable url still
 * records the remote and returns normally with `state: 'unreachable'` — recording where
 * to sync is not the same claim as having synced.
 *
 * @param {string} dir
 * @param {string} url
 * @returns {Promise<ReturnType<typeof syncPrinciples>>}
 */
export async function setRemote(dir, url) {
  return withLock(join(dir, '.lock'), async () => {
    mkdirSync(dir, { recursive: true });
    if (!isStoreRepo(dir)) {
      const init = git(['init', '-b', 'main'], { cwd: dir });
      if (init.status !== 0) throw new Error(`principlesync: git init failed: ${init.stderr}`);
      ensureGitignore(dir);
      commitIfStaged(dir, 'principles: init store');
    }
    const hasOrigin = gitOk(['remote', 'get-url', 'origin'], { cwd: dir });
    const setUrl = git(['remote', hasOrigin ? 'set-url' : 'add', 'origin', url], { cwd: dir });
    if (setUrl.status !== 0) throw new Error(`principlesync: setting remote failed: ${setUrl.stderr}`);
    return syncLocked(dir);
  });
}

/** Every entry with an unresolved sync conflict — `id` + the path of the other side. */
export function openConflicts(dir) {
  const confDir = join(dir, 'conflicts');
  if (!existsSync(confDir)) return [];
  return readdirSync(confDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const stem = f.slice(0, -'.md'.length);
      const dot = stem.lastIndexOf('.');
      return { id: dot === -1 ? stem : stem.slice(0, dot), file: join('conflicts', f) };
    })
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Resolve one open conflict by id. `mine` (default) just discards the other side's
 * copies. `theirs` replaces `<id>.md` with the (validated) conflict copy and records one
 * `amended` history line naming the statement/why it replaced, so the overwrite is never
 * silent in the entry's own history. Either way the copies for `id` are removed. Does
 * NOT commit or push — the next `syncPrinciples` carries the write, same as any other
 * helper (step 2).
 *
 * @param {string} dir
 * @param {string} id
 * @param {{ take?: 'mine'|'theirs' }} [opts]
 * @returns {Promise<void>}
 */
export async function resolveConflict(dir, id, { take = 'mine' } = {}) {
  if (take !== 'mine' && take !== 'theirs') throw new Error(`invalid take: ${JSON.stringify(take)}`);
  return withLock(join(dir, '.lock'), async () => {
    const mine = openConflicts(dir).filter((c) => c.id === id);
    if (mine.length === 0) throw new Error(`no open conflict for ${id}`);

    if (take === 'theirs') {
      const entryPath = join(dir, `${id}.md`);
      const prior = parsePrinciple(readFileSync(entryPath, 'utf8'), { file: `${id}.md`, id });
      const conflictPath = join(dir, mine[0].file);
      const theirs = parsePrinciple(readFileSync(conflictPath, 'utf8'), { file: mine[0].file, id });
      const next = {
        ...theirs,
        history: [
          ...(theirs.history || []),
          {
            at: new Date().toISOString(),
            action: 'amended',
            reason: 'resolved sync conflict',
            statement: prior.statement,
            why: prior.why,
          },
        ],
      };
      atomicWriteText(entryPath, renderPrinciple(next));
    }

    for (const c of mine) rmSync(join(dir, c.file), { force: true });
  });
}
