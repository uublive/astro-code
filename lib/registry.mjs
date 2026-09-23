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
import { snapshot, transact, branchTip, probeBranch } from './shared.mjs';

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
// `floor` is the highest number this working copy already knows about locally (see
// localHighWater). ADR-043 — allocation used to read the registry ALONE, so any drift
// between the registry and the local roadmaps handed out a number the roadmap was
// already using. That is not hypothetical: a registry.json deleted by an ADR-042-era
// write left SALESCRAFT's branch with no phase claims at all while its roadmaps ran to
// phase 46, and the next allocation was phase 1 — which `addPhase` did not even reject,
// because milestones 1-2 were archived elsewhere and nothing local held a 1 to collide
// with. Taking the max of both sources means a number is above everything either side
// has seen, so drift can no longer produce a duplicate.
function nextNumber(registry, type, floor = 0) {
  const nums = registry.claims
    .filter((c) => c.type === type)
    .map((c) => c.number);
  return Math.max(floor, ...(nums.length ? nums : [0])) + 1;
}

// Walk this working copy's roadmaps (the active one plus every archived milestone) and
// hand each {type, number, milestone, name, status} to `visit`. The one traversal that
// both localHighWater and backfillClaims read from, so the numbers the allocator floors
// against can never diverge from the numbers `ac registry init` backfills.
function eachLocalPhase(root, visit) {
  const ingest = (rm, status) => {
    if (!rm || !rm.milestone) return;
    visit({ type: 'milestone', number: rm.milestone, status });
    for (const ph of rm.phases || []) {
      visit({ type: 'phase', number: ph.number, milestone: rm.milestone, name: ph.name || '', status });
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
}

// Highest locally-known number per type, as an allocation floor for nextNumber.
function localHighWater(root) {
  const high = { phase: 0, milestone: 0 };
  eachLocalPhase(root, (c) => {
    if (Number.isInteger(c.number) && c.number > high[c.type]) high[c.type] = c.number;
  });
  return high;
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
// Exported for the backlog register (`lib/backlog.mjs`, ADR-056): its duplicate
// check is deliberately LOCAL-only (no registry claim, no remote snapshot), so it
// needs the plain Jaccard-over-tokens primitive without `findNameMatches`'s remote
// round-trip. `computeMatches` stays private — it is registry-claim-shaped and the
// backlog has no claims.
export function classifyMatch(existing, candidate) {
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

/**
 * Record a FIX in the shared registry.
 *
 * No number is allocated — ADR-013 already settled that urgent out-of-band work
 * is name-identified rather than numbered, so the emergency path stays instant
 * and works offline. The dated id (`2026-09-17-auth-401`) is the identity, and
 * it sorts chronologically here exactly as it does on disk.
 *
 * Duplicate-name detection still runs: `computeMatches` is what warns a second
 * developer that someone is already on this bug, which is the whole reason a
 * fix touches the registry at all.
 */
export function claimFix({ root, id, name = '', remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!id) return { ok: false, source: 'error', error: 'a fix claim requires an id' };
  if (!isRepo(root) || !hasRemote(remote, root)) {
    // Offline is NOT an error for a fix (ADR-013): the local record stands and
    // the push, when it happens, is the collision detector.
    return { ok: false, source: 'local', matches: [] };
  }

  // `transact` hands the git identity in as the second argument — same contract
  // the milestone/phase claim path uses.
  const res = transact(root, { remote, branch, retries, message: `registry: claim fix ${id}` }, (files, identity) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    const matches = computeMatches(registry.claims, 'fix', name);
    if (!registry.claims.some((c) => c.type === 'fix' && c.id === id)) {
      registry.claims.push({
        type: 'fix',
        id,
        name,
        owner: identity.owner,
        branch: identity.branch,
        claimed_at: new Date().toISOString(),
        status: 'active',
      });
    }
    return { updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' }, result: { matches } };
  });

  return res.ok
    ? { ok: true, source: 'registry', matches: res.result.matches }
    : { ok: false, source: 'local', matches: [], error: res.error };
}

/** Close a fix claim when it is accepted. Mirrors markComplete for milestones. */
export function markFixComplete({ root, id, remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };

  const res = transact(root, { remote, branch, retries, message: `registry: complete fix ${id}` }, (files) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    let changed = 0;
    for (const c of registry.claims) {
      if (c.type === 'fix' && c.id === id && c.status === 'active') {
        c.status = 'complete';
        changed++;
      }
    }
    return { updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' }, result: { changed } };
  });
  return res.ok ? { ok: true, changed: res.result.changed } : { ok: false, source: 'local' };
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
    // ADR-043 — do not say "not initialized" unless we actually heard that from the
    // remote. An unreachable remote sent us here too, and `ac registry init` would
    // then rebuild the team's registry from this one disk.
    if (probeBranch(root, { remote, branch }) === 'unreachable') {
      return {
        number: null, source: 'error', unreachable: true,
        error:
          `cannot reach \`${remote}\` to read ${branch} — check the network, your credentials, or the ` +
          `remote URL, then retry. Do NOT run \`ac registry init\` to clear this: the registry may be ` +
          `perfectly intact on the remote, and init would rebuild it from this working copy's roadmaps alone.`,
      };
    }
    return {
      number: null, source: 'error', needsInit: true,
      error: `registry not initialized on ${remote}/${branch} — run \`ac registry init\``,
    };
  }

  const floor = localHighWater(root);
  const message = type === 'milestone' ? 'registry: claim milestone' : `registry: claim phase (m${milestone})`;
  const res = transact(root, { remote, branch, retries, message }, (files, id) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    const matches = computeMatches(registry.claims, type, name); // before adding ours
    const number = nextNumber(registry, type, floor[type]);
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

// Move a phase's claim to another milestone (#32). `ac phase milestone` used to move the
// phase in roadmap.json only, leaving the claim on the old milestone — the two stores then
// disagreed silently, and the old milestone's `markComplete` would retire a claim for work
// that had moved on. The claim is repointed FIRST, as a compare-and-swap, so a caller can
// refuse the local move when this fails and never report a half-done move as done.
//
// { ok:true, source:'remote', found, from, changed }  — claim repointed (or already there)
// { ok:true, source:'local', reason }                  — no shared registry in use at all
// { ok:false, error }                                   — registry in use but not writable
export function repointPhaseClaim({ root, number, milestone, remote, branch, retries = 6 }) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  const where = probeBranch(root, { remote, branch });
  if (where === 'unreachable') {
    return {
      ok: false,
      error: `cannot reach \`${remote}\` to update the claim on ${branch} — check the network or credentials and retry`,
    };
  }
  if (where !== 'present') return { ok: true, source: 'local', reason: where };
  const res = transact(root, { remote, branch, retries, message: `registry: move phase ${number} to milestone ${milestone}` }, (files) => {
    const registry = parseRegistry(files[REGISTRY_FILE]);
    const mine = registry.claims.filter((c) => c.type === 'phase' && c.number === number);
    if (!mine.length) return { updates: {}, result: { found: false, from: null, changed: 0 } };
    const from = mine[0].milestone;
    const moving = mine.filter((c) => c.milestone !== milestone);
    if (!moving.length) return { updates: {}, result: { found: true, from, changed: 0 } };
    for (const c of moving) c.milestone = milestone;
    return {
      updates: { [REGISTRY_FILE]: JSON.stringify(registry, null, 2) + '\n' },
      result: { found: true, from, changed: moving.length },
    };
  });
  return res.ok ? { ok: true, source: 'remote', branch, ...res.result } : { ok: false, error: res.error };
}

// Phases whose milestone differs between the roadmap and their registry claim (#32) — the
// state `ac phase milestone` used to leave behind, and that nothing ever reported. Pure,
// so `ac status` can run it over the registry it already read.
export function claimDrift(roadmap, registry) {
  const drift = [];
  for (const ph of (roadmap && roadmap.phases) || []) {
    if (ph.milestone == null) continue;
    const c = ((registry && registry.claims) || []).find(
      (x) => x.type === 'phase' && x.number === ph.number && x.status === 'active',
    );
    if (c && c.milestone !== ph.milestone) {
      drift.push({ number: ph.number, name: ph.name, roadmap: ph.milestone, registry: c.milestone });
    }
  }
  return drift;
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
  eachLocalPhase(root, add);
  return claims;
}

// Create the orphan registry branch (if absent) and seed it from local roadmaps.
// Idempotent: refuses to clobber an already-populated registry unless `force`.
export function initRegistry({ root, remote, branch, force = false } = {}) {
  remote = remote || registryRemote(root);
  branch = branch || registryBranch(root);
  if (!isRepo(root)) return { ok: false, error: 'not a git repository' };
  if (!hasRemote(remote, root)) return { ok: false, error: `no \`${remote}\` remote — add an origin remote first` };

  // ADR-043 — the most destructive thing this command can do is run against a remote it
  // could not read: it would see "no claims", conclude the registry is empty, and rebuild
  // it from local roadmaps — over the top of an intact team registry. Refuse outright,
  // and refuse for --force too, since force is exactly how someone reacts to this state.
  if (probeBranch(root, { remote, branch }) === 'unreachable') {
    return {
      ok: false,
      error:
        `cannot reach \`${remote}\` to read ${branch} — refusing to initialize. If the registry already ` +
        `exists on the remote, rebuilding it from this working copy's roadmaps would discard every claim ` +
        `this copy has no roadmap for. Fix connectivity and re-run.`,
    };
  }

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

// ADR-043 — `available` means "this answer reflects the remote", not merely "a remote is
// configured". A read that could not reach the remote reports available:false with
// `unreachable`, so no caller mistakes silence for an empty registry.
export function readRegistry(root, { remote = registryRemote(root), branch = registryBranch(root) } = {}) {
  if (!isRepo(root) || !hasRemote(remote, root)) return { available: false, registry: structuredClone(EMPTY) };
  if (probeBranch(root, { remote, branch }) === 'unreachable') {
    return { available: false, unreachable: true, branch, remote, registry: structuredClone(EMPTY) };
  }
  const { files } = snapshot(root, { remote, branch });
  // `files` rides along so a caller that also needs the shared canon (`ac status`'s drift
  // line, #35) does not fetch the branch a second time.
  return { available: true, branch, remote, registry: parseRegistry(files[REGISTRY_FILE]), files };
}
