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

function readTree(root, tip) {
  const entries = new Map(); // name -> { mode, sha }
  if (!tip) return entries;
  const res = git(['ls-tree', tip], { cwd: root });
  if (res.status !== 0) return entries;
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
  const files = {};
  for (const [name, { sha }] of entries) files[name] = readBlob(root, sha);
  return { tip, entries, files };
}

export const sharedAvailable = (root, remote) => isRepo(root) && hasRemote(remote, root);

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
    const { tip, entries, files } = snapshot(root, { remote, branch });
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
