// Project canon: durable rules (CONVENTIONS.md) + an append-only decision log
// (DECISIONS.md). Prescriptive and always-on — injected into every plan/execute
// agent so parallel agents and developers stay architecturally consistent.
//
// Canon is TEAM-GLOBAL, so it's shared on the orphan branch alongside the registry
// (lib/shared.mjs). DECISIONS.md is the natural fit: append-only, so `ac decision
// add` does a compare-and-swap append against the shared branch — ADR numbers never
// collide across developers, and new decisions are visible to everyone. The local
// .astrocode/ copies are fast-read mirrors, refreshed with `ac canon pull`.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { paths } from './paths.mjs';
import { atomicWriteText, withLock } from './util.mjs';
import { isRepo, hasRemote } from './git.mjs';
import { registryBranch, registryRemote } from './registry.mjs';
import { snapshot, transact } from './shared.mjs';
import { parseDecisions, sameDecision, findDuplicates } from './decisions.mjs';

const DECISIONS_FILE = 'DECISIONS.md';
const CONVENTIONS_FILE = 'CONVENTIONS.md';

export function loadCanon(root) {
  const p = paths(root);
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '');
  return { conventions: read(p.conventions), decisions: read(p.decisions) };
}

// Single string for injecting into an agent prompt.
export function canonText(root) {
  const { conventions, decisions } = loadCanon(root);
  return [conventions, decisions].filter(Boolean).join('\n\n');
}

function nextAdrNumber(text) {
  const headers = text.match(/^##\s+ADR-(\d+)/gm) || [];
  return headers.reduce((m, h) => Math.max(m, Number(h.match(/(\d+)/)[1])), 0) + 1;
}

function buildDecision(existing, { title, why, rejected, date }) {
  const id = `ADR-${String(nextAdrNumber(existing)).padStart(3, '0')}`;
  const when = date || new Date().toISOString().slice(0, 10);
  const entry =
    `\n## ${id} — ${title}\n_${when}_\n\n` +
    (why ? `**Why:** ${why}\n\n` : '') +
    (rejected ? `**Rejected:** ${rejected}\n\n` : '');
  return { id, when, next: (existing.trimEnd() + '\n' + entry).trimStart() };
}

// The heading's title, dash-variant tolerant, for naming a collision without
// re-deriving lib/decisions.mjs's normalization rules.
function titleOf(entry) {
  const first = String(entry || '').split('\n')[0];
  return first.replace(/^##\s+ADR-\d+\s*(?:[-‐‑‒–—―]\s*)?/, '').trim();
}

// Append a decision. With a coordinated remote, append to the SHARED DECISIONS.md
// via CAS (ADR number computed from shared state → no cross-dev collisions) and
// mirror the result locally. Otherwise append to the local file only.
export async function addDecision(root, { title, why = '', rejected = '', date } = {}) {
  if (!title) throw new Error('decision requires a title');
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);

  if (isRepo(root) && hasRemote(remote, root)) {
    let built = null;
    let rescued = { preserved: [], collisions: [], duplicates: [] };
    const res = transact(root, { remote, branch, message: `canon: decision "${title}"` }, (files) => {
      // ADR-039 — the base is the MERGE of the shared copy and anything only we have.
      // Seeding from `files[DECISIONS_FILE]` alone discarded every local-only ADR (the local
      // file was not even consulted) and then restarted numbering from the shared count,
      // reissuing ids that already existed locally. Merging preserves the entries AND makes
      // numbering run over the full set, so a reissue is impossible.
      const localNow = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
      const merged = files[DECISIONS_FILE]
        ? mergeDecisions(files[DECISIONS_FILE], localNow)
        : { ok: true, text: localNow || '# Decisions\n', preserved: [], collisions: [], duplicates: [] };
      rescued = merged;
      // ADR-053 (D5) — a genuine same-id collision REFUSES; it is never renumbered or moved.
      // Both entries are left exactly where they are (registry and local, respectively): the
      // callback publishes nothing and the add itself does not proceed.
      if (!merged.ok) {
        return { updates: {}, result: { refused: true, collisions: merged.collisions } };
      }
      built = buildDecision(merged.text, { title, why, rejected, date });
      return { updates: { [DECISIONS_FILE]: built.next }, result: built.id };
    });
    if (res.ok && built) {
      writeFileSync(p.decisions, built.next); // mirror shared → local (incl. others' entries)
      return {
        id: built.id,
        title,
        date: built.when,
        source: 'remote',
        branch,
        preserved: rescued.preserved,
        duplicates: rescued.duplicates,
      };
    }
    if (res.ok && !built) {
      // The transact callback refused before publishing anything — nothing was written to
      // the shared branch or the local mirror. Both colliding entries stay exactly as they were.
      return { ok: false, refused: 'decision-collision', collisions: rescued.collisions };
    }
    // fall through to local on contention/error
  }

  return withLock(p.lock, () => {
    const existing = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
    const { id, when, next } = buildDecision(existing, { title, why, rejected, date });
    atomicWriteText(p.decisions, next);
    return { id, title, date: when, source: 'local' };
  });
}

/**
 * Merge a remote DECISIONS.md with the local copy, deciding for every locally-known
 * id whether it converges with the registry's entry, is local-only and safe to carry
 * across, or is a genuine collision.
 *
 * ADR-053 replaces this module's old private `norm()` (which only stripped an em dash
 * and never excluded the `_date_` stamp `buildDecision` writes into every entry) with
 * `lib/decisions.mjs`'s single identity engine — `parseDecisions` / `sameDecision` —
 * so dash style and recording date no longer make the SAME decision look like two.
 *
 * ADR-039's history still applies: `canonPush` deliberately never publishes
 * DECISIONS.md (it is append-only and bulk-pushing loses concurrent entries), so
 * anything written outside `ac decision add` — by hand, by an executor task, or
 * before the registry existed — lives only locally. Merging carries those entries
 * across and reports them as `preserved`, exactly as before.
 *
 * ADR-053 (D5) changes what happens on a GENUINE collision (same id, content that does
 * NOT normalize the same): today's code silently renumbered and appended the local
 * entry under a fresh id, which can invalidate a reference to that number elsewhere.
 * This function instead reports the collision and sets `ok: false` — the caller must
 * leave DECISIONS.md byte-identical (nothing renumbered, nothing moved) and surface
 * the collision instead. `kind` is `'edited-published'` when the titles match (someone
 * edited an already-published decision's body) and `'independent'` otherwise (two
 * unrelated decisions landed under the same id) — both refuse, only the message differs.
 *
 * @param {string} remoteText  the shared branch's copy (may be empty)
 * @param {string} localText   the working-tree copy (may be empty)
 * @returns {{ ok: boolean, text: string, preserved: string[],
 *   collisions: { id: string, kind: 'edited-published'|'independent', localTitle: string, remoteTitle: string }[],
 *   duplicates: { ids: string[], title: string }[] }}
 */
function mergeDecisions(remoteText, localText) {
  const remote = parseDecisions(remoteText);
  const local = parseDecisions(localText);
  let text = remoteText || '';
  const preserved = [];
  const collisions = [];
  for (const [id, entry] of local) {
    const r = remote.get(id);
    if (!r) {
      text = text.trimEnd() + '\n\n' + entry + '\n';
      preserved.push(id);
      continue;
    }
    if (sameDecision(r, entry)) continue; // same decision, already present — converge, don't duplicate
    // SAME id, GENUINELY DIFFERENT decision. Refuse rather than renumber (D5) — nothing here
    // is moved, so a reference to this id elsewhere is never invalidated.
    const localTitle = titleOf(entry);
    const remoteTitle = titleOf(r);
    collisions.push({
      id,
      kind: localTitle === remoteTitle ? 'edited-published' : 'independent',
      localTitle,
      remoteTitle,
    });
  }
  const ok = collisions.length === 0;
  // Duplicate detection is always on (D6), regardless of whether this merge succeeds —
  // it reports on whatever text is about to be current, never mutates it.
  const duplicates = findDuplicates(ok ? text : localText || remoteText || '');
  return { ok, text: ok ? text : localText || remoteText || '', preserved, collisions, duplicates };
}

// Refresh local canon mirrors from the shared branch (team-global view).
export function canonPull(root) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };
  const { files } = snapshot(root, { remote, branch });
  const pulled = [];
  const preserved = [];
  const collisions = [];
  const duplicates = [];
  if (files[DECISIONS_FILE] != null) {
    // ADR-034 — never silently destroy a local-only ADR.
    //
    // DECISIONS.md is append-only and `ac decision add` is *supposed* to be its only
    // writer — but that invariant is unenforced, and astro-code's OWN planner has emitted
    // tasks telling an executor to write an ADR straight into the file. An unconditional
    // overwrite here then deleted it, printed "✓ pulled DECISIONS.md", and the next
    // `ac decision add` reissued the same id (numbering comes from the shared branch),
    // permanently clobbering the original in the working tree. Three steps, each reporting
    // success, ending in silent data loss. `canonPush` refuses to publish DECISIONS.md by
    // design, so there was no supported way to repair it either.
    //
    // A pull is a REFRESH, not a reset: entries the shared branch has never seen are
    // carried across and reported, so the loss is impossible and the divergence is visible.
    const localText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
    const merged = mergeDecisions(files[DECISIONS_FILE], localText);
    preserved.push(...merged.preserved);
    collisions.push(...merged.collisions);
    duplicates.push(...merged.duplicates);
    // ADR-053 (D5) — a genuine collision leaves DECISIONS.md byte-identical: nothing is
    // renumbered, nothing is moved, and the local file is not touched at all. A bare
    // `writeFileSync` on the success path could still leave a truncated canon behind on a
    // crash mid-write, so the one write this function does perform goes through
    // `atomicWriteText` (lib/util.mjs) rather than repeating that mistake by a different route.
    if (merged.ok) {
      atomicWriteText(p.decisions, merged.text);
      pulled.push(DECISIONS_FILE);
    }
  }
  if (files[CONVENTIONS_FILE] != null) {
    writeFileSync(p.conventions, files[CONVENTIONS_FILE]);
    pulled.push(CONVENTIONS_FILE);
  }
  return { ok: true, pulled, branch, preserved, collisions, duplicates };
}

// Publish local CONVENTIONS.md to the shared branch (last-writer-wins; conventions
// are edited rarely and by agreement). DECISIONS.md is NOT bulk-pushed here — it is
// only ever extended via addDecision so concurrent entries are never lost.
export function canonPush(root, { dryRun = false } = {}) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };
  if (!existsSync(p.conventions)) return { ok: false, error: 'no local CONVENTIONS.md to push' };
  const content = readFileSync(p.conventions, 'utf8');
  // dryRun answers "what would a real push do?" by READING the shared branch only —
  // snapshot(), never transact(). This is the flag a cautious operator reaches for
  // before publishing to a branch the whole team reads; until it existed, `ac canon
  // push --dry-run` parsed fine and published for real (the flag was discarded).
  if (dryRun) {
    const { files } = snapshot(root, { remote, branch });
    const published = files[CONVENTIONS_FILE];
    return {
      ok: true,
      dryRun: true,
      branch,
      pushed: [],
      remoteExists: published != null,
      wouldChange: published !== content,
    };
  }
  const res = transact(root, { remote, branch, message: 'canon: publish conventions' }, () => ({
    updates: { [CONVENTIONS_FILE]: content },
  }));
  return res.ok ? { ok: true, pushed: [CONVENTIONS_FILE], branch } : { ok: false, error: res.error };
}
