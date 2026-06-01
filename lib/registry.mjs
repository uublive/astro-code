// astro-code phase/milestone numbering registry.
//
// THE INVIOLABLE PRINCIPLE: every milestone and phase number is allocated from a
// single shared registry that lives on an ORPHAN BRANCH on the project's origin
// remote. Two developers can never end up with the same number — claim the 8th
// phase while someone took it and you get the 9th.
//
// The registry.json now shares the orphan branch with the team canon (see
// lib/shared.mjs). Writes go through `transact`, which preserves every other file
// on the branch — so claiming a number never clobbers DECISIONS.md/CONVENTIONS.md.
import { isRepo, hasRemote } from './git.mjs';
import { readJSON } from './util.mjs';
import { paths } from './paths.mjs';
import { snapshot, transact } from './shared.mjs';

const EMPTY = { version: 1, claims: [] };
const REGISTRY_FILE = 'registry.json';

export function registryBranch(root) {
  return (readJSON(paths(root).config) || {}).registry_branch || 'astro-registry';
}
export function registryRemote(root) {
  return (readJSON(paths(root).config) || {}).registry_remote || 'origin';
}

function parseRegistry(content) {
  let registry = structuredClone(EMPTY);
  if (content) {
    try {
      registry = JSON.parse(content);
    } catch { /* corrupt — treat as empty, will be overwritten */ }
  }
  if (!Array.isArray(registry.claims)) registry.claims = [];
  return registry;
}

// max(active claims of this type [and milestone]) + 1, else 1.
function nextNumber(registry, type, milestone) {
  const nums = registry.claims
    .filter((c) => c.type === type && c.status === 'active' && (type !== 'phase' || c.milestone === milestone))
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

// --- Name-based duplicate-work detection -----------------------------------
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const tokensOf = (s) => new Set(normName(s).split(' ').filter(Boolean));
function similarity(a, b) {
  const A = tokensOf(a);
  const B = tokensOf(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter); // Jaccard over word tokens
}
function classifyMatch(existing, candidate) {
  if (!existing || !candidate) return null;
  if (normName(existing) === normName(candidate)) return 'exact';
  return similarity(existing, candidate) >= 0.5 ? 'similar' : null;
}
// Active claims of `type` whose recorded name matches/looks like `name`.
function computeMatches(claims, type, name) {
  if (!name) return [];
  return claims
    .filter((c) => c.type === type && c.status === 'active' && c.name)
    .map((c) => ({ ...c, match: classifyMatch(c.name, name) }))
    .filter((c) => c.match);
}

export function claim({ root, type, milestone, name = '', remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);

  if (type === 'phase' && !Number.isInteger(milestone)) {
    return { number: null, source: 'error', error: 'phase claims require a milestone number' };
  }
  if (!isRepo(root) || !hasRemote(remote, root)) {
    return {
      number: localNext(root, type, milestone),
      source: 'local',
      matches: [],
      message: 'no coordinated remote — local numbering (not synced across the team)',
    };
  }

  const message = type === 'milestone' ? 'registry: claim milestone' : `registry: claim phase (m${milestone})`;
  const res = transact(root, { remote, branch, retries, message }, (files, id) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    const matches = computeMatches(registry.claims, type, name); // before adding ours
    const number = nextNumber(registry, type, milestone);
    const claimed_at = new Date().toISOString();
    if (type === 'milestone') {
      registry.claims.push({ type: 'milestone', number, name, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
      registry.claims.push({ type: 'phase', number: 1, milestone: number, name: '', owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
    } else {
      registry.claims.push({ type: 'phase', number, milestone, name, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
    }
    return { updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' }, result: { number, matches } };
  });

  if (res.ok) {
    return {
      number: res.result.number,
      matches: res.result.matches,
      source: 'remote',
      branch,
      attempt: res.attempt,
      owner: res.owner,
      message:
        type === 'milestone'
          ? `Claimed milestone ${res.result.number} (+ phase 1) on ${branch}`
          : `Claimed phase ${res.result.number} of milestone ${milestone} on ${branch}`,
    };
  }
  return { number: null, source: 'error', error: res.error || 'claim failed' };
}

// Read-only pre-check: does an active claim of `type` already use this name?
// Returns { available, matches }. Use before claiming so a dev can rename first.
export function findNameMatches(root, { type, name, remote, branch } = {}) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { available: false, matches: [] };
  const { files } = snapshot(root, { remote, branch });
  return { available: true, matches: computeMatches(parseRegistry(files[REGISTRY_FILE]).claims, type, name) };
}

// Flip every active claim of a milestone (and its phases) to "complete".
export function markComplete({ root, milestone, remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };

  const res = transact(root, { remote, branch, retries, message: `registry: complete milestone ${milestone}` }, (files) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    let changed = 0;
    for (const c of registry.claims) {
      if (
        c.status === 'active' &&
        ((c.type === 'milestone' && c.number === milestone) || (c.type === 'phase' && c.milestone === milestone))
      ) {
        c.status = 'complete';
        changed++;
      }
    }
    return { updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' }, result: changed };
  });

  if (res.ok) return { ok: true, changed: res.result, source: 'remote' };
  return { ok: false, error: res.error };
}

export function readRegistry(root, { remote = registryRemote(root), branch = registryBranch(root) } = {}) {
  if (!isRepo(root) || !hasRemote(remote, root)) return { available: false, registry: structuredClone(EMPTY) };
  const { files } = snapshot(root, { remote, branch });
  return { available: true, branch, remote, registry: parseRegistry(files[REGISTRY_FILE]) };
}
