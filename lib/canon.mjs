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
import { isRepo, hasRemote, git } from './git.mjs';
import { registryBranch, registryRemote } from './registry.mjs';
import { snapshot, transact, probeBranch } from './shared.mjs';
import {
  parseDecisions, parseDecisionEntries, sameDecision, findDuplicates, collapseDuplicates,
  isOlderRevision, decisionStatus, statusLine, replaceEntry, inForceText, revisionMarkers,
} from './decisions.mjs';

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
// #36 — decisions no longer in force arrive as one-line stubs, not at full weight.
export function canonText(root) {
  const { conventions, decisions } = loadCanon(root);
  return [conventions, decisions ? inForceText(decisions).trim() : ''].filter(Boolean).join('\n\n');
}

// Every write of the local decision log goes through here, so the generated view agents
// read (DECISIONS.in-force.md, #36) can never lag behind the log it is derived from.
function writeDecisions(p, text) {
  atomicWriteText(p.decisions, text);
  atomicWriteText(p.decisionsInForce, inForceText(text));
}
function refreshInForce(p) {
  if (existsSync(p.decisions)) atomicWriteText(p.decisionsInForce, inForceText(readFileSync(p.decisions, 'utf8')));
}

// #35 — the commit a decision was recorded at: its link to the code it governs.
function headCommit(root) {
  if (!isRepo(root)) return null;
  const r = git(['rev-parse', '--short', 'HEAD'], { cwd: root });
  return r.status === 0 ? r.stdout.trim() || null : null;
}
const today = () => new Date().toISOString().slice(0, 10);

function nextAdrNumber(text) {
  const headers = text.match(/^##\s+ADR-(\d+)/gm) || [];
  return headers.reduce((m, h) => Math.max(m, Number(h.match(/(\d+)/)[1])), 0) + 1;
}

function buildDecision(existing, { title, why, rejected, date, commit }) {
  const id = `ADR-${String(nextAdrNumber(existing)).padStart(3, '0')}`;
  const when = date || new Date().toISOString().slice(0, 10);
  const entry =
    `\n## ${id} — ${title}\n_${when}${commit ? ` · at ${commit}` : ''}_\n\n` +
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
  const commit = headCommit(root);
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
      built = buildDecision(merged.text, { title, why, rejected, date, commit });
      return { updates: { [DECISIONS_FILE]: built.next }, result: built.id };
    });
    if (res.ok && built) {
      writeDecisions(p, built.next); // mirror shared → local (incl. others' entries)
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
        // NO baseline is not evidence of safety — it is the absence of evidence. Gating
        // this on `synced != null` left every copy that has never run `canon pull`/`canon
        // push` (including the one that ran `registry init`, and every fresh clone, since
        // `.conventions-synced` is local-only and never committed) in the UNGUARDED branch:
        // `registryMoved` read false, `editedLocally` read true, and the implicit publish
        // overwrote a teammate's published copy with no warning. The byte-identical case is
        // already handled below, so reaching here with a registry copy present and no
        // baseline means local differs from something this copy has never reconciled with —
        // which is exactly when publishing may destroy it. Refuse and let the author choose.
        const registryMoved = registryConventions != null && (synced == null || registryConventions !== synced);
        if (registryConventions != null && localConventions === registryConventions) {
          // Already byte-identical to the registry — there is nothing to publish, and
          // recording the baseline keeps a later add from reading "in sync" as "diverged".
          writeSyncedConventions(p, localConventions);
        } else if (editedLocally && registryMoved) {
          conventionsRefused = {
            file: CONVENTIONS_FILE,
            reason: readSyncedConventions(p) == null
              ? "this copy has never synced CONVENTIONS.md, so it cannot tell its edits from a teammate's — publishing yours could delete theirs"
              : "the registry's copy changed since this copy last synced, and publishing yours would delete that change",
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
    const { id, when, next } = buildDecision(existing, { title, why, rejected, date, commit });
    writeDecisions(p, next);
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
  // EVERY local entry, not one per id. The id-keyed view drops a second entry
  // sharing an id, and this loop then wrote a merged text without it — the
  // local copy destroyed, reported as a plain success. Refusing on a duplicate
  // id (below) is the same refuse-first posture D5 applies to collisions: this
  // function never resolves an ambiguity by discarding one side.
  const localEntries = parseDecisionEntries(localText);
  let text = remoteText || '';
  const preserved = [];
  const collisions = [];
  const seenLocalIds = new Set();
  for (const { id, text: entry } of localEntries) {
    if (seenLocalIds.has(id)) {
      collisions.push({
        id,
        kind: 'duplicate-id',
        localTitle: titleOf(entry),
        remoteTitle: titleOf(localEntries.find((e) => e.id === id)?.text || ''),
      });
      continue;
    }
    seenLocalIds.add(id);
    // #36/#35 — the registry holds a LATER revision of this very entry (a teammate's
    // supersede/retire/amend appended a marker ours lacks). That is not a collision: take
    // the registry's, which the merged text already starts from.
    const newer = remote.get(id);
    if (newer && isOlderRevision(entry, newer)) continue;
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
      refreshInForce(p); // a hand edit or an older astro-code may have left it stale
    } else {
      // A bare `writeFileSync` on this path could still leave a truncated canon behind on
      // a crash mid-write, so the one write DECISIONS.md gets goes through
      // `atomicWriteText` (lib/util.mjs) rather than repeating that mistake by a different route.
      writeDecisions(p, merged.text);
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
//
// #45 — …but collapsing ONLY the local copy could never stick: `ac canon pull` restores
// the duplicate from the registry, and the next `ac decision add` republishes it (its
// merge starts from the registry's text). The pull warning then recommended dedupe again,
// sending the user round the same loop. So the registry's copy is collapsed too — a
// TARGETED removal, not a bulk push: the same strict-equality collapse runs inside a
// compare-and-swap against the current tip, so an entry a teammate appended concurrently
// is re-read and kept, never overwritten. Registry first; if it cannot be written, the
// local copy is left alone too, because a local-only collapse is exactly the drift above.
export function canonDedupe(root) {
  const p = paths(root);
  const when = today(); // one date for both copies, so their stubs are byte-identical
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  let registryRemoved = [];
  let scope = 'local';
  // Probe first (ADR-043): a failed fetch inside transact reads exactly like "no branch
  // yet", which would let an unreachable registry through as a local-only collapse.
  const where = probeBranch(root, { remote, branch });
  if (where === 'unreachable') {
    return {
      ok: false,
      error:
        `cannot reach \`${remote}\` to update DECISIONS.md on ${branch}. Nothing was collapsed — a ` +
        `local-only dedupe would be undone by the next pull or decision add.`,
    };
  }
  if (where === 'present') {
    const res = transact(root, { remote, branch, message: 'canon: collapse duplicate decisions' }, (files) => {
      if (files[DECISIONS_FILE] == null) return { updates: {}, result: [] };
      const { text, removed } = collapseDuplicates(files[DECISIONS_FILE], { date: when });
      return removed.length ? { updates: { [DECISIONS_FILE]: text }, result: removed } : { updates: {}, result: [] };
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          `could not update DECISIONS.md on ${branch}: ${res.error || 'registry unavailable'}. Nothing was ` +
          `collapsed — a local-only dedupe would be undone by the next pull or decision add.`,
      };
    }
    registryRemoved = res.result || [];
    scope = 'registry';
  }
  const before = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
  const { text, removed } = collapseDuplicates(before, { date: when });
  if (removed.length) writeDecisions(p, text);
  return { ok: true, scope, branch, removed, registryRemoved };
}

// ── #36: supersede / retire — #35: amend ───────────────────────────────────────
//
// All three revise ONE existing entry by appending a marker (lib/decisions.mjs), through
// the same compare-and-swap path `decision add` uses: the registry first, then the local
// mirror. A revision is refused when the two copies of that entry already differ (other
// than the local one being an older revision) — it must never paper over an existing
// drift; `ac canon check` names it.
function reviseDecision(root, id, revise, message) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  const localText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
  const apply = (baseText) => {
    const entry = parseDecisions(baseText).get(id);
    if (!entry) return { error: `no such decision: ${id} — see \`ac decision list --all\`` };
    const out = revise(entry, baseText);
    if (out.error) return out;
    return { text: replaceEntry(baseText, id, out.entry), entry: out.entry };
  };

  const where = isRepo(root) && hasRemote(remote, root) ? probeBranch(root, { remote, branch }) : 'no-remote';
  if (where === 'unreachable') {
    return { ok: false, error: `cannot reach \`${remote}\` to update ${id} on ${branch} — nothing was changed` };
  }
  if (where === 'present') {
    let outcome = null;
    const tx = transact(root, { remote, branch, message }, (files) => {
      const regText = files[DECISIONS_FILE] || '';
      const regEntry = parseDecisions(regText).get(id);
      const locEntry = parseDecisions(localText).get(id);
      if (regEntry && locEntry && locEntry !== regEntry && !isOlderRevision(locEntry, regEntry)) {
        outcome = {
          error:
            `${id} differs between your local DECISIONS.md and ${branch} — nothing was changed. ` +
            '`ac canon check` shows the difference; reconcile it first.',
        };
        return { updates: {} };
      }
      outcome = apply(regText);
      return outcome.error ? { updates: {} } : { updates: { [DECISIONS_FILE]: outcome.text } };
    });
    if (!tx.ok) return { ok: false, error: tx.error || 'registry write failed — nothing was changed' };
    if (outcome.error) return { ok: false, error: outcome.error };
    // mirror: the registry's revised log, plus anything only this copy has
    const merged = mergeDecisions(outcome.text, localText);
    writeDecisions(p, merged.ok ? merged.text : replaceEntry(localText, id, outcome.entry));
    return { ok: true, source: 'remote', branch, id, entry: outcome.entry };
  }
  const r = apply(localText);
  if (r.error) return { ok: false, error: r.error };
  writeDecisions(p, r.text);
  return { ok: true, source: 'local', id, entry: r.entry };
}

const appendMarker = (entry, line) => `${entry.trimEnd()}\n\n${line}`;

export function supersedeDecision(root, id, { by, reason = '', date = today() } = {}) {
  if (!by) return { ok: false, error: 'supersede needs the decision that replaces it: --by ADR-NNN' };
  if (by === id) return { ok: false, error: `${id} cannot supersede itself` };
  return reviseDecision(root, id, (entry, text) => {
    const st = decisionStatus(entry);
    if (st.state !== 'live') return { error: `${id} is already ${st.state}${st.by ? ` (${st.by})` : ''}` };
    const successor = parseDecisions(text).get(by);
    if (!successor) return { error: `no such decision: ${by} — record the new decision first (\`ac decision add\`)` };
    if (decisionStatus(successor).state !== 'live') return { error: `${by} is not in force itself — supersede with a live decision` };
    return { entry: appendMarker(entry, statusLine({ kind: 'superseded', by, date, reason })) };
  }, `canon: ${id} superseded by ${by}`);
}

export function retireDecision(root, id, { reason = '', date = today() } = {}) {
  if (!reason) return { ok: false, error: 'retire needs a reason: --reason "why it no longer applies"' };
  return reviseDecision(root, id, (entry) => {
    const st = decisionStatus(entry);
    if (st.state !== 'live') return { error: `${id} is already ${st.state}` };
    return { entry: appendMarker(entry, statusLine({ kind: 'retired', date, reason })) };
  }, `canon: ${id} retired`);
}

// Replace a `**Label:** …` paragraph (up to the next blank line), or add it before the markers.
function setField(body, label, value) {
  const re = new RegExp(`^\\*\\*${label}:\\*\\*[\\s\\S]*?(?=\\n\\s*\\n|$(?![\\s\\S]))`, 'm');
  const line = `**${label}:** ${value}`;
  return re.test(body) ? body.replace(re, line) : `${body.trimEnd()}\n\n${line}`;
}

/**
 * #35 — correct a published decision's prose without changing the decision: same id,
 * same title, same date line; the body is replaced (whole, or its Why/Rejected fields)
 * and `_Amended <date>: <reason>_` is appended so the audit trail shows it happened.
 * A decision that CHANGED is a new decision plus `supersede`, not an amendment.
 */
export function amendDecision(root, id, { reason = '', body, why, rejected, date = today() } = {}) {
  if (!reason) return { ok: false, error: 'amend needs a reason: --reason "what was corrected and why"' };
  if (body == null && why == null && rejected == null) {
    return { ok: false, error: 'amend needs the new text: --why "…", --rejected "…", or --body-file <path>' };
  }
  return reviseDecision(root, id, (entry) => {
    const lines = entry.split('\n');
    const head = lines[0];
    const dateLine = /^_\d{4}-\d{2}-\d{2}.*_$/.test((lines[1] || '').trim()) ? lines[1] : null;
    const markers = revisionMarkers(entry);
    const rest = lines.slice(dateLine ? 2 : 1).filter((l) => !markers.includes(l.trim())).join('\n').trim();
    let next = body != null ? String(body).trim() : rest;
    if (why != null) next = setField(next, 'Why', why);
    if (rejected != null) next = setField(next, 'Rejected', rejected);
    if (next.trim() === rest) return { error: `nothing to amend — ${id}'s text would not change` };
    const rebuilt = [head, dateLine, '', next.trim(), '', ...markers.flatMap((m) => [m, '']), `_Amended ${date}: ${reason}_`]
      .filter((l) => l !== null)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
    return { entry: rebuilt };
  }, `canon: amend ${id}`);
}

// ── #35: ac canon check — is the local mirror the registry's copy? ────────────
//
// Per decision, byte-exact within each entry (no whitespace normalisation of a body);
// only the file-level trailing newline is ignored. CONVENTIONS.md is free-form, so it is
// compared as one file. Every difference names its id and kind — working out WHICH
// decision diverged is what used to take longer than fixing it.
export function canonDrift({ localDecisions = '', registryDecisions = '', localConventions = null, registryConventions = null }) {
  const drift = [];
  const loc = parseDecisions(localDecisions);
  const reg = parseDecisions(registryDecisions);
  for (const [id, entry] of loc) {
    if (!reg.has(id)) drift.push({ id, kind: 'missing from the registry' });
    else if (reg.get(id) !== entry) drift.push({ id, kind: isOlderRevision(entry, reg.get(id)) ? 'older revision locally (pull)' : 'changed body' });
  }
  for (const id of reg.keys()) if (!loc.has(id)) drift.push({ id, kind: 'missing locally' });
  const strip = (t) => (t == null ? null : t.replace(/\n+$/, ''));
  let conventions = 'same';
  // the untouched `ac init` template, never published, is not drift — an EDIT that was
  // never published is (the "edits not yet pushed" case this gate exists to catch)
  const unpublishedScaffold = registryConventions == null && localConventions != null && isUntouchedScaffold(localConventions);
  if (!unpublishedScaffold && strip(localConventions) !== strip(registryConventions)) {
    conventions = localConventions == null ? 'missing locally' : registryConventions == null ? 'missing from the registry' : 'differs';
  }
  return { drift, conventions, ok: drift.length === 0 && conventions === 'same' };
}

export function canonCheck(root) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  const where = isRepo(root) && hasRemote(remote, root) ? probeBranch(root, { remote, branch }) : 'no-remote';
  if (where === 'unreachable') return { ok: false, available: false, error: `cannot reach \`${remote}\` to read ${branch}` };
  if (where !== 'present') return { ok: true, available: false, reason: where };
  const { files, unreadable } = snapshot(root, { remote, branch });
  if (unreadable) return { ok: false, available: false, error: `${branch} could not be read` };
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : null);
  return {
    available: true,
    branch,
    ...canonDrift({
      localDecisions: read(p.decisions) || '',
      registryDecisions: files[DECISIONS_FILE] || '',
      localConventions: read(p.conventions),
      registryConventions: files[CONVENTIONS_FILE] ?? null,
    }),
  };
}

// ── phase 22 (P14): appendConvention — promote-as-convention primitive ─────────
//
// `ac principles promote <id> --as convention` needs to land a single bullet in the
// project's local CONVENTIONS.md, but D8 ("no implicit publish") and ADR-053's
// refuse-first posture mean it must NEVER auto-push — see `addDecision`'s D3 comment
// above for the incident that "recording something also silently publishes
// CONVENTIONS.md" caused elsewhere. So this is append-only, local-only: the existing
// bytes are kept as an untouched prefix (nothing here re-derives or reformats the
// file), it never runs a git command, and it deliberately never writes
// `.conventions-synced` — a promoted bullet must read to `canonPush`/`decision add`
// as an ordinary local edit, so the human still chooses if and when to publish it.
export async function appendConvention(root, bullet) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const existing = existsSync(p.conventions) ? readFileSync(p.conventions, 'utf8') : '';
    if (existing.split('\n').includes(bullet)) return { appended: false, file: p.conventions };
    const HEADING = '## Promoted from personal principles';
    const headings = existing.match(/^##\s.*$/gm) || [];
    const lastHeading = headings.length ? headings[headings.length - 1] : null;
    const next = existing + (lastHeading !== HEADING ? `\n${HEADING}\n\n` : '') + `${bullet}\n`;
    atomicWriteText(p.conventions, next);
    return { appended: true, file: p.conventions };
  });
}

// ── #36: ac canon stats — what every agent is handed ──────────────────────────
export function canonStats(root) {
  const { conventions, decisions } = loadCanon(root);
  const entries = parseDecisionEntries(decisions);
  const counts = { live: 0, superseded: 0, retired: 0, duplicate: 0 };
  for (const e of entries) counts[decisionStatus(e.text).state]++;
  const injected = canonText(root);
  const bytes = (s) => Buffer.byteLength(s || '', 'utf8');
  return {
    conventionsBytes: bytes(conventions),
    decisionsBytes: bytes(decisions),
    injectedBytes: bytes(injected),
    injectedTokens: Math.round(bytes(injected) / 4),
    fullBytes: bytes([conventions, decisions].filter(Boolean).join('\n\n')),
    counts,
  };
}
