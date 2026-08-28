// Shared store on the orphan branch — a tiny transactional layer over pure git.
//
// The orphan branch (default `astro-registry`) holds team-global coordination
// state: the numbering registry.json AND the shared canon (DECISIONS.md,
// CONVENTIONS.md). Reads/writes use git plumbing only (no checkout, no server).
//
// `transact` is a compare-and-swap over the whole branch: read the current tip,
// let the caller compute file updates, commit a new tree that PRESERVES every
// other file, and push as a fast-forward. If another developer pushed first the
// push is rejected and we retry against the new tip. This is the same mechanism
// that guarantees unique numbering, generalized to multiple files.
import { git, isRepo, hasRemote, gitIdentity } from './git.mjs';

function fetchTip(root, remote, branch) {
  const fetched = git(['fetch', '--quiet', remote, branch], { cwd: root });
  if (fetched.status !== 0) return null; // branch doesn't exist yet
  return git(['rev-parse', 'FETCH_HEAD'], { cwd: root }).stdout.trim() || null;
}

// ADR-042 — an UNREADABLE tree and an EMPTY tree are different states, and conflating them
// destroyed a live team registry twice.
//
// This returned an empty Map when `ls-tree` FAILED, which `transact` could not tell apart
// from "the branch has no files". It then built the next tree from that empty base, added
// only its own update, and committed it WITH the real tip as parent — so the push was a
// clean fast-forward and was accepted. registry.json (172 claims) and the whole of
// DECISIONS.md (109 ADRs) were deleted, and every step reported success.
//
// Returning null forces the caller to decide, and `transact` now refuses to write.
export function readTree(root, tip) {
  const entries = new Map(); // name -> { mode, sha }
  if (!tip) return entries;
  const res = git(['ls-tree', tip], { cwd: root });
  if (res.status !== 0) return null; // UNREADABLE — never "empty"
  for (const line of res.stdout.split('\n')) {
    if (!line.trim()) continue;
    const [meta, name] = line.split('\t');
    const [mode, type, sha] = meta.split(/\s+/);
    if (type === 'blob') entries.set(name, { mode, sha });
  }
  return entries;
}

const readBlob = (root, sha) => {
  const res = git(['cat-file', '-p', sha], { cwd: root });
  return res.status === 0 ? res.stdout : null;
};

// { tip, entries, files } — files maps every top-level filename to its content.
export function snapshot(root, { remote, branch }) {
  const tip = fetchTip(root, remote, branch);
  const entries = readTree(root, tip);
  // ADR-042: propagate unreadability instead of flattening it to "no files".
  if (entries === null) return { tip, entries: null, files: null, unreadable: true };
  const files = {};
  for (const [name, { sha }] of entries) {
    const blob = readBlob(root, sha);
    // A blob that will not read is the same hazard one level down: using it as a base
    // would silently truncate that file rather than delete it.
    if (blob == null) return { tip, entries: null, files: null, unreadable: true };
    files[name] = blob;
  }
  return { tip, entries, files };
}

export const sharedAvailable = (root, remote) => isRepo(root) && hasRemote(remote, root);

// The current tip of the orphan branch, or null if it doesn't exist yet. Lets
// callers distinguish "no registry initialized" from "registry exists but empty".
export function branchTip(root, { remote, branch }) {
  if (!sharedAvailable(root, remote)) return null;
  return fetchTip(root, remote, branch);
}

// ADR-043 — "I could not reach the remote" and "the remote has no such branch" are
// different states, and fetchTip() flattens both to null.
//
// claim() reported the pair as `registry not initialized — run \`ac registry init\``.
// On an unreachable remote that is not merely wrong, it is the single worst piece of
// advice available: `ac registry init` rebuilds the registry from whatever roadmaps
// happen to be on this disk, so following it on a laptop with an expired SSH key
// silently replaces a team's numbering history with one developer's local view.
//
// `ls-remote --exit-code` separates them cleanly: 0 = the ref is there, 2 = the
// remote answered and has no such ref, anything else = we never got an answer.
export function probeBranch(root, { remote, branch }) {
  if (!isRepo(root)) return 'no-repo';
  if (!hasRemote(remote, root)) return 'no-remote';
  const res = git(['ls-remote', '--exit-code', remote, `refs/heads/${branch}`], { cwd: root });
  if (res.status === 0) return 'present';
  if (res.status === 2) return 'absent';
  return 'unreachable';
}

// fn(files, identity) -> { updates: { name: content | null }, result }
//   content === null deletes the file; omitted files are preserved untouched.
export function transact(root, { remote, branch, retries = 6, message = 'update' }, fn) {
  if (!sharedAvailable(root, remote)) return { ok: false, source: 'local' };
  const id = gitIdentity(root);
  const env = {
    GIT_AUTHOR_NAME: id.name,
    GIT_AUTHOR_EMAIL: id.email,
    GIT_COMMITTER_NAME: id.name,
    GIT_COMMITTER_EMAIL: id.email,
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    const snap = snapshot(root, { remote, branch });
    const { tip, entries, files } = snap;

    // ADR-042 guard 1 — never write from a base we could not read.
    if (snap.unreadable) {
      return {
        ok: false,
        error:
          `refusing to write ${branch}: its current contents could not be read (git ls-tree/cat-file failed ` +
          `at tip ${tip || '?'}). Writing from an unreadable base would commit a tree containing ONLY this ` +
          `update — deleting every sibling file — and because the commit still carries the real tip as its ` +
          `parent, the push would fast-forward cleanly and report success. That is how this branch was ` +
          `destroyed twice. Retry when the remote is reachable.`,
      };
    }
    // ADR-042 guard 2 — a tip that exists but appears to hold nothing is not a real state
    // for this branch: the registry always carries at least one file once initialised.
    if (tip && entries.size === 0) {
      return {
        ok: false,
        error:
          `refusing to write ${branch}: tip ${tip} exists but its tree reads as empty. An initialised ` +
          `registry always holds at least one file, so this is far more likely a partial fetch than a ` +
          `genuinely empty branch. Re-run \`ac canon pull\` or check the remote before retrying.`,
      };
    }

    const { updates = {}, result } = fn(files, id) || {};

    const next = new Map(entries);
    for (const [name, content] of Object.entries(updates)) {
      if (content == null) {
        next.delete(name);
        continue;
      }
      const sha = git(['hash-object', '-w', '--stdin'], { cwd: root, input: content }).stdout.trim();
      if (!sha) return { ok: false, error: 'hash-object failed' };
      next.set(name, { mode: '100644', sha });
    }

    const treeInput =
      [...next.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([name, { mode, sha }]) => `${mode} blob ${sha}\t${name}`)
        .join('\n') + '\n';
    const tree = git(['mktree'], { cwd: root, input: treeInput }).stdout.trim();
    if (!tree) return { ok: false, error: 'mktree failed' };

    const cargs = ['commit-tree', tree, '-m', message];
    if (tip) cargs.push('-p', tip);
    const commit = git(cargs, { cwd: root, env }).stdout.trim();
    if (!commit) return { ok: false, error: 'commit-tree failed' };

    const push = git(['push', remote, `${commit}:refs/heads/${branch}`], { cwd: root });
    if (push.status === 0) return { ok: true, result, attempt, branch, owner: id.owner };
    // rejected → another writer won; loop re-reads the moved tip and recomputes
  }
  return { ok: false, error: `contention: gave up after ${retries} attempts` };
}
