// astro-code phase/milestone numbering registry.
//
// THE INVIOLABLE PRINCIPLE: every milestone and phase number is allocated from a
// single shared registry that lives on an ORPHAN BRANCH on the project's origin
// remote. Two developers can never end up with the same number — if you try to
// claim the 8th phase while someone already took it, you get the 9th.
//
// Implementation is pure git, no server and no gh:
//   read   = git fetch <branch>  +  git show FETCH_HEAD:registry.json
//   write  = hash-object -> mktree -> commit-tree -> push commit:refs/heads/<branch>
// The push is a plain (non-force) fast-forward. If another developer claimed a
// number in the meantime, the remote tip moved, our commit's parent is stale, and
// the push is REJECTED. We re-read, recompute max+1, and retry. That rejection IS
// the atomic compare-and-swap that guarantees uniqueness.
import { git, isRepo, hasRemote, gitIdentity } from './git.mjs';
import { readJSON } from './util.mjs';
import { paths } from './paths.mjs';

const EMPTY = { version: 1, claims: [] };
const REGISTRY_FILE = 'registry.json';

export function registryBranch(root) {
  const cfg = readJSON(paths(root).config) || {};
  return cfg.registry_branch || 'astro-registry';
}

export function registryRemote(root) {
  const cfg = readJSON(paths(root).config) || {};
  return cfg.registry_remote || 'origin';
}

// max(active claims of this type [and milestone]) + 1, else 1.
function nextNumber(registry, type, milestone) {
  const nums = registry.claims
    .filter(
      (c) =>
        c.type === type &&
        c.status === 'active' &&
        (type !== 'phase' || c.milestone === milestone),
    )
    .map((c) => c.number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

// Fallback when there is no coordinated remote: number locally from the roadmap.
function localNext(root, type, milestone) {
  const rm = readJSON(paths(root).roadmap) || { milestone: 1, phases: [] };
  if (type === 'milestone') return (rm.milestone || 0) + 1;
  const nums = (rm.phases || []).map((p) => p.number);
  return nums.length ? Math.max(...nums) + 1 : 1;
}

function readRemoteRegistry(root, branch, remote) {
  const fetched = git(['fetch', '--quiet', remote, branch], { cwd: root });
  if (fetched.status !== 0) return { registry: structuredClone(EMPTY), tip: null };
  const tip = git(['rev-parse', 'FETCH_HEAD'], { cwd: root }).stdout.trim();
  const show = git(['show', `${tip}:${REGISTRY_FILE}`], { cwd: root });
  let registry = structuredClone(EMPTY);
  if (show.status === 0) {
    try {
      registry = JSON.parse(show.stdout);
    } catch { /* corrupt registry — treat as empty, will be overwritten */ }
  }
  if (!Array.isArray(registry.claims)) registry.claims = [];
  return { registry, tip };
}

// Build a commit containing only registry.json (no working-tree checkout) and
// push it. Returns { ok } or { rejected } (someone else won the race).
function writeRemoteRegistry(root, branch, remote, registry, tip, message, id) {
  const content = JSON.stringify(registry, null, 2) + '\n';
  const env = {
    GIT_AUTHOR_NAME: id.name,
    GIT_AUTHOR_EMAIL: id.email,
    GIT_COMMITTER_NAME: id.name,
    GIT_COMMITTER_EMAIL: id.email,
  };
  const blob = git(['hash-object', '-w', '--stdin'], { cwd: root, input: content }).stdout.trim();
  if (!blob) return { ok: false, reason: 'hash-object failed' };

  const tree = git(['mktree'], { cwd: root, input: `100644 blob ${blob}\t${REGISTRY_FILE}\n` }).stdout.trim();
  if (!tree) return { ok: false, reason: 'mktree failed' };

  const commitArgs = ['commit-tree', tree, '-m', message];
  if (tip) commitArgs.push('-p', tip);
  const commitRes = git(commitArgs, { cwd: root, env });
  const commit = commitRes.stdout.trim();
  if (commitRes.status !== 0 || !commit) {
    return { ok: false, reason: commitRes.stderr.trim() || 'commit-tree failed' };
  }

  const push = git(['push', remote, `${commit}:refs/heads/${branch}`], { cwd: root });
  if (push.status !== 0) {
    return { ok: false, rejected: true, reason: push.stderr.trim() || 'push rejected' };
  }
  return { ok: true, commit };
}

// Flip every active claim of a milestone (the milestone claim and all its phase
// claims) to status "complete", so finished numbers are visibly retired in the
// shared registry. Same compare-and-swap retry as claim().
export function markComplete({ root, milestone, remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };

  const id = gitIdentity(root);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { registry, tip } = readRemoteRegistry(root, branch, remote);
    let changed = 0;
    for (const c of registry.claims) {
      if (
        c.status === 'active' &&
        ((c.type === 'milestone' && c.number === milestone) ||
          (c.type === 'phase' && c.milestone === milestone))
      ) {
        c.status = 'complete';
        changed++;
      }
    }
    if (!changed) return { ok: true, changed: 0, source: 'remote' };
    const res = writeRemoteRegistry(root, branch, remote, registry, tip, `registry: complete milestone ${milestone} by ${id.owner}`, id);
    if (res.ok) return { ok: true, changed, source: 'remote' };
    if (!res.rejected) return { ok: false, error: res.reason };
  }
  return { ok: false, error: `registry contention: gave up after ${retries} attempts` };
}

export function readRegistry(root, { remote = registryRemote(root), branch = registryBranch(root) } = {}) {
  if (!isRepo(root) || !hasRemote(remote, root)) {
    return { available: false, registry: structuredClone(EMPTY) };
  }
  const { registry } = readRemoteRegistry(root, branch, remote);
  return { available: true, branch, remote, registry };
}

// Claim the next free number of `type`. For phases, `milestone` is required.
// Returns { number, source: 'remote'|'local'|'error', message }.
export function claim({ root, type, milestone, remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);

  if (type === 'phase' && !Number.isInteger(milestone)) {
    return { number: null, source: 'error', error: 'phase claims require a milestone number' };
  }

  if (!isRepo(root) || !hasRemote(remote, root)) {
    return {
      number: localNext(root, type, milestone),
      source: 'local',
      message: 'no coordinated remote — local numbering (not synced across the team)',
    };
  }

  const id = gitIdentity(root);
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { registry, tip } = readRemoteRegistry(root, branch, remote);
    const number = nextNumber(registry, type, milestone);
    const claimed_at = new Date().toISOString();

    if (type === 'milestone') {
      registry.claims.push({ type: 'milestone', number, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
      registry.claims.push({ type: 'phase', number: 1, milestone: number, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
    } else {
      registry.claims.push({ type: 'phase', number, milestone, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
    }

    const message =
      type === 'milestone'
        ? `registry: claim milestone ${number} (+ phase 1) by ${id.owner}`
        : `registry: claim phase ${number} of milestone ${milestone} by ${id.owner}`;

    const res = writeRemoteRegistry(root, branch, remote, registry, tip, message, id);
    if (res.ok) {
      return {
        number,
        source: 'remote',
        branch,
        attempt,
        owner: id.owner,
        message:
          type === 'milestone'
            ? `Claimed milestone ${number} (+ phase 1) on ${branch}`
            : `Claimed phase ${number} of milestone ${milestone} on ${branch}`,
      };
    }
    if (!res.rejected) {
      return { number: null, source: 'error', error: res.reason };
    }
    // Rejected: another developer claimed first. Loop re-reads the moved tip and
    // recomputes the next free number — this is the collision avoidance in action.
  }

  return { number: null, source: 'error', error: `registry contention: gave up after ${retries} attempts` };
}
