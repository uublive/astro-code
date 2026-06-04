// astro-code phase/milestone numbering registry.
//
// THE INVIOLABLE PRINCIPLE: every milestone and phase number is allocated from a
// single shared registry that lives on an ORPHAN BRANCH on the project's origin
// remote. Two developers can never end up with the same number — claim the 8th
// phase while someone took it and you get the 9th. Phase numbers are global across
// milestones (they never restart at 1), so a phase number is unique on its own.
//
// The registry.json now shares the orphan branch with the team canon (see
// lib/shared.mjs). Writes go through `transact`, which preserves every other file
// on the branch — so claiming a number never clobbers DECISIONS.md/CONVENTIONS.md.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRepo, hasRemote } from './git.mjs';
import { readJSON } from './util.mjs';
import { paths } from './paths.mjs';
import { snapshot, transact, branchTip } from './shared.mjs';

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

// max(EVERY claim of this type) + 1, else 1. Allocation is monotonic: completed
// claims still count, so a number is never reused after its milestone/phase is
// archived (the bug that reset the counter to 1 on completion).
//
// Phase numbers are PROJECT-GLOBAL — they do NOT restart at 1 per milestone. The
// max spans every phase claim regardless of milestone, so no two phases ever share
// a number across the whole project (milestone 2's first phase continues where
// milestone 1 left off). A phase number therefore identifies a phase on its own,
// without needing its milestone for disambiguation.
function nextNumber(registry, type) {
  const nums = registry.claims
    .filter((c) => c.type === type)
    .map((c) => c.number);
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
  // The registry is the single source of truth — no silent local fallback. Numbers
  // allocated locally before an origin existed never reach the registry, so a later
  // registry would re-allocate them (the milestone-1-twice drift). Require an
  // initialized orphan branch and point at `ac registry init`, which backfills it.
  if (!isRepo(root)) {
    return { number: null, source: 'error', error: 'not a git repository' };
  }
  if (!hasRemote(remote, root)) {
    return {
      number: null, source: 'error', needsInit: true,
      error: `no \`${remote}\` remote — add an origin remote, then run \`ac registry init\``,
    };
  }
  if (!branchTip(root, { remote, branch })) {
    return {
      number: null, source: 'error', needsInit: true,
      error: `registry not initialized on ${remote}/${branch} — run \`ac registry init\``,
    };
  }

  const message = type === 'milestone' ? 'registry: claim milestone' : `registry: claim phase (m${milestone})`;
  const res = transact(root, { remote, branch, retries, message }, (files, id) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    const matches = computeMatches(registry.claims, type, name); // before adding ours
    const number = nextNumber(registry, type);
    const claimed_at = new Date().toISOString();
    if (type === 'milestone') {
      // Claim the milestone number only. Phases are claimed on demand by `ac phase
      // add` and continue the project-global phase sequence — no phantom
      // auto-reserved phase 1 (which used to push the first real phase to 2 without
      // ever seeding the roadmap).
      registry.claims.push({ type: 'milestone', number, name, owner: id.owner, branch: id.branch, claimed_at, status: 'active' });
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
          ? `Claimed milestone ${res.result.number} on ${branch}`
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

// Reconstruct registry claims from on-disk roadmaps so numbering can continue
// monotonically. Archived milestones (.astrocode/milestones/<n>/roadmap.json) are
// recorded `complete`; the current active roadmap is recorded `active`. Archives
// are ingested first so a number already retired wins over a colliding live one.
function backfillClaims(root, id) {
  const claimed_at = new Date().toISOString();
  const claims = [];
  const seen = new Set();
  const key = (c) => (c.type === 'phase' ? `p:${c.milestone}:${c.number}` : `m:${c.number}`);
  const add = (c) => {
    if (seen.has(key(c))) return;
    seen.add(key(c));
    claims.push({ owner: id.owner, branch: id.branch, claimed_at, name: '', ...c });
  };
  const ingest = (rm, status) => {
    if (!rm || !rm.milestone) return;
    add({ type: 'milestone', number: rm.milestone, status });
    for (const ph of rm.phases || []) {
      add({ type: 'phase', number: ph.number, milestone: rm.milestone, name: ph.name || '', status });
    }
  };
  const p = paths(root);
  const msDir = join(p.dir, 'milestones');
  if (existsSync(msDir)) {
    for (const entry of readdirSync(msDir).sort()) {
      ingest(readJSON(join(msDir, entry, 'roadmap.json')), 'complete');
    }
  }
  ingest(readJSON(p.roadmap), 'active');
  return claims;
}

// Create the orphan registry branch (if absent) and seed it from local roadmaps.
// Idempotent: refuses to clobber an already-populated registry unless `force`.
export function initRegistry({ root, remote, branch, force = false } = {}) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root)) return { ok: false, error: 'not a git repository' };
  if (!hasRemote(remote, root)) return { ok: false, error: `no \`${remote}\` remote — add an origin remote first` };

  const existing = readRegistry(root, { remote, branch });
  if (existing.registry.claims.length && !force) {
    return { ok: true, created: false, branch, claims: existing.registry.claims.length };
  }

  const res = transact(root, { remote, branch, retries: 6, message: 'registry: init (backfill from roadmaps)' }, (files, id) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    registry.claims = backfillClaims(root, id);
    return { updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' }, result: registry.claims.length };
  });
  if (!res.ok) return { ok: false, error: res.error || 'init failed' };
  return { ok: true, created: true, branch, claims: res.result };
}

export function readRegistry(root, { remote = registryRemote(root), branch = registryBranch(root) } = {}) {
  if (!isRepo(root) || !hasRemote(remote, root)) return { available: false, registry: structuredClone(EMPTY) };
  const { files } = snapshot(root, { remote, branch });
  return { available: true, branch, remote, registry: parseRegistry(files[REGISTRY_FILE]) };
}
