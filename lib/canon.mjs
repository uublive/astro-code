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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { paths } from './paths.mjs';
import { atomicWriteText, withLock } from './util.mjs';
import { isRepo, hasRemote } from './git.mjs';
import { registryBranch, registryRemote } from './registry.mjs';
import { snapshot, transact } from './shared.mjs';
import { parseDecisions, sameDecision, findDuplicates, collapseDuplicates } from './decisions.mjs';

const DECISIONS_FILE = 'DECISIONS.md';
const CONVENTIONS_FILE = 'CONVENTIONS.md';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates');

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
    // What the shared branch holds for CONVENTIONS.md right now, captured from the tree
    // this add actually commits on top of — the D3 side-effect publish below needs it to
    // tell "nobody else moved it" from "publishing mine would delete someone's edit", and
    // reading it here costs nothing extra (a second snapshot() would re-fetch the branch).
    let registryConventions = null;
    const res = transact(root, { remote, branch, message: `canon: decision "${title}"` }, (files) => {
      registryConventions = files[CONVENTIONS_FILE] != null ? files[CONVENTIONS_FILE] : null;
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
      // ADR-053 (D3) — recording a decision also publishes CONVENTIONS.md. Before this,
      // NOTHING ever pushed it outside an explicit `ac canon push` (which most people never
      // learn exists): a local convention edit sat unpublished, and the next unrelated
      // `decision add` elsewhere plus a `canon pull` silently reverted it — the exact root
      // cause of one of this phase's three incidents. Publish only when the local copy
      // differs from what the registry currently holds: quieter than an unconditional push
      // on every add, and a half-edited CONVENTIONS.md that hasn't changed since the last
      // publish is never re-sent as a side effect of an unrelated decision.
      let publishedConventions = false;
      let conventionsRefused = null;
      if (existsSync(p.conventions)) {
        const localConventions = readFileSync(p.conventions, 'utf8');
        // Compare against the last-known-SYNCED copy, not the live registry: a
        // teammate may have published a NEWER CONVENTIONS.md since this copy's last
        // sync without this copy ever being edited, and comparing against the live
        // registry there reads as "differs" too — publishing then republishes a
        // STALE local copy and discards the teammate's edit out from under them
        // (the exact C7 incident). No baseline yet (never synced) falls back to "is
        // this still the untouched scaffold?" so a fresh clone's unedited template
        // is never published as someone's deliberate convention.
        const synced = readSyncedConventions(p);
        const editedLocally = synced == null ? !isUntouchedScaffold(localConventions) : localConventions !== synced;
        // The registry moved on since this copy last synced: SOMEONE ELSE published a
        // CONVENTIONS.md this copy has never seen. "Not stale" was never enough on its
        // own — a copy that is BOTH behind the registry AND edited locally passes
        // `editedLocally`, and `canonPush` is last-writer-wins, so the implicit publish
        // sent a file that never contained the teammate's line straight over it. The
        // decision itself is unrelated to CONVENTIONS.md, so an add must never be the
        // thing that deletes a published convention; refusing here costs the author one
        // explicit `ac canon push` and cannot destroy anything (D1's refuse-first
        // posture, applied to the write side). Reported, never silent: a warning nobody
        // is forced to read is what made both production incidents invisible.
        const registryMoved = synced != null && registryConventions != null && registryConventions !== synced;
        if (registryConventions != null && localConventions === registryConventions) {
          // Already byte-identical to the registry — there is nothing to publish, and
          // recording the baseline keeps a later add from reading "in sync" as "diverged".
          writeSyncedConventions(p, localConventions);
        } else if (editedLocally && registryMoved) {
          conventionsRefused = {
            file: CONVENTIONS_FILE,
            reason: "the registry's copy changed since this copy last synced, and publishing yours would delete that change",
            fixes: ['ac canon pull --force', 'ac canon push'],
          };
        } else if (editedLocally) {
          const pushed = canonPush(root);
          publishedConventions = Boolean(pushed.ok && pushed.pushed && pushed.pushed.includes(CONVENTIONS_FILE));
        }
      }
      return {
        id: built.id,
        title,
        date: built.when,
        source: 'remote',
        branch,
        preserved: rescued.preserved,
        duplicates: rescued.duplicates,
        publishedConventions,
        conventionsRefused,
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
    // D2 — a decision is identified by its CONTENT, not its number: check every
    // remote entry, not just the one under the SAME id, before deciding this is
    // local-only. Without this, the same decision recorded independently under a
    // DIFFERENT id on each machine (the ordinary "we've never coordinated numbers"
    // case) was preserved as a second copy instead of converging — content-identical
    // to something the registry already has, but never recognized as such because
    // only same-id entries were ever compared.
    const contentMatch = [...remote.values()].some((r) => sameDecision(r, entry));
    if (contentMatch) continue; // same decision, already present under some id — converge, don't duplicate
    const r = remote.get(id);
    if (!r) {
      text = text.trimEnd() + '\n\n' + entry + '\n';
      preserved.push(id);
      continue;
    }
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

// The CONVENTIONS.md content this working copy last confirmed matched the registry
// (set after every successful pull that leaves local === registry, and after every
// push). `null` when this copy has never synced at all.
//
// Without this baseline, "local differs from the registry" was the ONLY signal both
// `canonPull`'s refusal and `addDecision`'s D3 side-effect push had — and staleness
// (the registry moved on since MY last sync, but I never touched my own copy) looks
// byte-identical to that signal as a genuine local edit. That collapsed two very
// different situations into one: a pull that should have fast-forwarded silently
// refused instead (C2), and recording an unrelated decision republished a STALE local
// copy over a teammate's already-published edit, discarding it (C7). Comparing
// against the last-known-synced copy — not the live registry — tells them apart.
function readSyncedConventions(p) {
  return existsSync(p.conventionsSynced) ? readFileSync(p.conventionsSynced, 'utf8') : null;
}

function writeSyncedConventions(p, content) {
  atomicWriteText(p.conventionsSynced, content);
}

// True when `content` is the untouched `templates/CONVENTIONS.md` scaffold — the file
// exactly as `initPlanning` wrote it, `{{NAME}}` substituted and never edited since.
//
// Without this, D1's refusal would fire on the FIRST pull of every freshly-scaffolded
// project (the scaffold "differs from the registry" just as genuinely as a real edit
// does), which would make the fix worse than the clobber bug it replaces. Tolerant of
// whichever name was substituted — matched against the template shape, not against
// `state.json`'s recorded name, so it works even if that record is itself stale.
function isUntouchedScaffold(content) {
  const template = readFileSync(join(TEMPLATES, CONVENTIONS_FILE), 'utf8').trim();
  const pattern = template
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{\\\{NAME\\\}\\\}/g, '.*');
  return new RegExp(`^${pattern}$`).test(content.trim());
}

// Refresh local canon mirrors from the shared branch (team-global view).
//
// ADR-053 (D1/D7) — a bare `writeFileSync(p.conventions, …)` used to run unconditionally
// here: no comparison, no notion of "local-only", the careful ADR-034 merge twelve lines
// above applying to DECISIONS.md but not to this file at all. A diverged CONVENTIONS.md
// edit was silently replaced by the registry's copy and reported as an ordinary
// successful pull — the exact same success line a genuine no-op prints. `force` is the
// only way past a refusal other than publishing first (`ac canon push`).
export function canonPull(root, { force = false } = {}) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };
  const { files } = snapshot(root, { remote, branch });
  const pulled = [];
  const unchanged = [];
  const refused = [];
  const preserved = [];
  const collisions = [];
  const duplicates = [];
  const fileStatus = {};

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
    if (!merged.ok) {
      // ADR-053 (D5) — a genuine collision leaves DECISIONS.md byte-identical: nothing is
      // renumbered, nothing is moved, and the local file is not touched at all. Per-file
      // (D7): a colliding DECISIONS.md must not stop CONVENTIONS.md from refreshing below.
      fileStatus[DECISIONS_FILE] = { status: 'refused' };
      refused.push({ file: DECISIONS_FILE, reason: 'a same-id decision collision was found', fixes: [] });
    } else if (merged.text === localText) {
      fileStatus[DECISIONS_FILE] = { status: 'unchanged' };
      unchanged.push(DECISIONS_FILE);
    } else {
      // A bare `writeFileSync` on this path could still leave a truncated canon behind on
      // a crash mid-write, so the one write DECISIONS.md gets goes through
      // `atomicWriteText` (lib/util.mjs) rather than repeating that mistake by a different route.
      atomicWriteText(p.decisions, merged.text);
      fileStatus[DECISIONS_FILE] = { status: 'updated' };
      pulled.push(DECISIONS_FILE);
    }
  } else if (existsSync(p.decisions)) {
    // ADR-053 (D6) — the registry has no DECISIONS.md yet (e.g. `ac decision add` was
    // never run against this remote), so there is nothing to merge against. That must
    // NOT exempt an already-corrupted local file from duplicate detection: D6 says every
    // sync reports content-identical pairs, and "sync" includes a pull that turns out to
    // be a local-only no-op on this file.
    const localText = readFileSync(p.decisions, 'utf8');
    duplicates.push(...findDuplicates(localText));
    fileStatus[DECISIONS_FILE] = { status: 'unchanged' };
    unchanged.push(DECISIONS_FILE);
  }

  if (files[CONVENTIONS_FILE] != null) {
    const registryText = files[CONVENTIONS_FILE];
    const localExists = existsSync(p.conventions);
    const localText = localExists ? readFileSync(p.conventions, 'utf8') : null;
    // "Staleness" (this copy is behind the registry but was never itself edited since
    // its last sync) must fast-forward like an ordinary pull, not refuse like a real
    // edit — see `readSyncedConventions` above.
    const synced = readSyncedConventions(p);
    const stale = localExists && synced != null && localText === synced;
    if (localText === registryText) {
      fileStatus[CONVENTIONS_FILE] = { status: 'unchanged' };
      unchanged.push(CONVENTIONS_FILE);
      writeSyncedConventions(p, registryText);
    } else if (!localExists || force || stale || isUntouchedScaffold(localText)) {
      writeFileSync(p.conventions, registryText);
      writeSyncedConventions(p, registryText);
      fileStatus[CONVENTIONS_FILE] = { status: 'updated' };
      pulled.push(CONVENTIONS_FILE);
    } else {
      fileStatus[CONVENTIONS_FILE] = { status: 'refused' };
      refused.push({
        file: CONVENTIONS_FILE,
        reason: 'your local copy differs from the registry and would be overwritten',
        fixes: ['ac canon push', 'ac canon pull --force'],
      });
    }
  }

  return { ok: true, branch, files: fileStatus, pulled, unchanged, refused, preserved, collisions, duplicates };
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
  if (res.ok) writeSyncedConventions(p, content); // local now matches what the registry holds
  return res.ok ? { ok: true, pushed: [CONVENTIONS_FILE], branch } : { ok: false, error: res.error };
}

// Collapse already-duplicated DECISIONS.md entries — the explicit repair D6 requires.
//
// ADR-053 (D6): duplicate detection runs on every sync (`canonPull`'s `duplicates`
// field, populated unconditionally by `mergeDecisions` above) but never mutates
// anything by itself — a destructive merge firing without being asked is exactly the
// pattern the automatic-similarity-merge precedent this ADR cites was removed for.
// This is the ONLY place DECISIONS.md is ever collapsed, and it only ever touches the
// LOCAL working copy: DECISIONS.md is append-only and never bulk-pushed (ADR-039), so
// collapsing here can't discard another developer's concurrent entry sight unseen.
// `lib/decisions.mjs`'s `collapseDuplicates` already enforces strict-equality-only —
// no near-duplicate from D6's own precedent is ever touched here.
export function canonDedupe(root) {
  const p = paths(root);
  const before = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
  const { text, removed } = collapseDuplicates(before);
  if (removed.length === 0) return { ok: true, removed: [] };
  atomicWriteText(p.decisions, text);
  return { ok: true, removed };
}
