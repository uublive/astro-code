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
    let rescued = { preserved: [], renumbered: [] };
    const res = transact(root, { remote, branch, message: `canon: decision "${title}"` }, (files) => {
      // ADR-039 — the base is the UNION of the shared copy and anything only we have.
      // Seeding from `files[DECISIONS_FILE]` alone discarded every local-only ADR (the local
      // file was not even consulted) and then restarted numbering from the shared count,
      // reissuing ids that already existed locally. Unioning preserves the entries AND makes
      // numbering run over the full set, so a reissue is impossible.
      const localNow = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
      const merged = files[DECISIONS_FILE]
        ? unionLocalOnly(files[DECISIONS_FILE], localNow)
        : { text: localNow || '# Decisions\n', preserved: [], renumbered: [] };
      rescued = merged;
      const base = merged.text;
      built = buildDecision(base, { title, why, rejected, date });
      return { updates: { [DECISIONS_FILE]: built.next }, result: built.id };
    });
    if (res.ok) {
      writeFileSync(p.decisions, built.next); // mirror shared → local (incl. others' entries)
      return { id: built.id, title, date: built.when, source: 'remote', branch, preserved: rescued.preserved, renumbered: rescued.renumbered };
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
 * Union a remote DECISIONS.md with any entries that exist ONLY locally.
 *
 * ADR-039 — used by BOTH canonPull and addDecision, because both had the same clobber and
 * only the pull path was fixed. `ac decision add` seeds its base from the SHARED copy when
 * one exists and ignores the local file entirely, then writes the result over it: a project
 * whose local log held 101 ADRs and whose registry copy held 3 lost 98 of them on the next
 * add, silently, while printing a success line. Worse, numbering then restarted from the
 * registry's count and REISSUED ids that already existed locally, so the survivors collided.
 *
 * `canonPush` deliberately never publishes DECISIONS.md (it is append-only and bulk-pushing
 * loses concurrent entries), so anything written outside `ac decision add` — by hand, by an
 * executor task, or before the registry existed — lives only locally and was exactly what got
 * destroyed. Unioning here also repairs that: the local-only entries reach the registry on the
 * next add instead of needing a manual re-add.
 *
 * Entries are carried verbatim, heading through body, and appended — preserving the
 * append-only shape. Numbering downstream then runs over the union, so ids cannot collide.
 *
 * @param {string} remoteText  the shared branch's copy (may be empty)
 * @param {string} localText   the working-tree copy (may be empty)
 * @returns {{ text: string, preserved: string[] }}
 */
function unionLocalOnly(remoteText, localText) {
  const EOI = '(?=\\n##\\s+ADR-|$(?![\\s\\S]))'
  const entriesOf = (t) => {
    const out = new Map()
    for (const m of String(t || '').matchAll(/^##\s+(ADR-\d+)/gm)) {
      const e = String(t).match(new RegExp(`^##\\s+${m[1]}\\b[\\s\\S]*?` + EOI, 'm'))
      if (e) out.set(m[1], e[0].trim())
    }
    return out
  }
  // Compare on substance, not formatting: an id present on both sides with the same body is
  // the same decision and must not be duplicated.
  const norm = (e) => String(e).replace(/^##\s+ADR-\d+\s*—?\s*/, '').replace(/\s+/g, ' ').trim()
  const remote = entriesOf(remoteText)
  const local = entriesOf(localText)
  let text = remoteText || ''
  const preserved = [], renumbered = []
  let nextNum = Math.max(0, ...[...remote.keys(), ...local.keys()].map((id) => Number(id.slice(4)))) 
  for (const [id, entry] of local) {
    const r = remote.get(id)
    if (r && norm(r) === norm(entry)) continue // same decision, already present
    if (!r) {
      text = text.trimEnd() + '\n\n' + entry + '\n'
      preserved.push(id)
      continue
    }
    // SAME id, DIFFERENT decision. Both are real; keying on id alone silently discarded the
    // local one. Re-head it with the next free number and append, so nothing is lost and the
    // renumbering is reportable rather than silent.
    nextNum += 1
    const fresh = `ADR-${String(nextNum).padStart(3, '0')}`
    text = text.trimEnd() + '\n\n' + entry.replace(/^##\s+ADR-\d+/, `## ${fresh}`) + '\n'
    renumbered.push({ from: id, to: fresh })
  }
  return { text, preserved, renumbered }
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
  const renumbered = [];
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
    const merged = unionLocalOnly(files[DECISIONS_FILE], localText);
    const next = merged.text;
    preserved.push(...merged.preserved);
    renumbered.push(...merged.renumbered);
    writeFileSync(p.decisions, next);
    pulled.push(DECISIONS_FILE);
  }
  if (files[CONVENTIONS_FILE] != null) {
    writeFileSync(p.conventions, files[CONVENTIONS_FILE]);
    pulled.push(CONVENTIONS_FILE);
  }
  return { ok: true, pulled, branch, preserved, renumbered };
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
