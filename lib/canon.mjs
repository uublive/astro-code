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
    const res = transact(root, { remote, branch, message: `canon: decision "${title}"` }, (files) => {
      const base = files[DECISIONS_FILE] || (existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '# Decisions\n');
      built = buildDecision(base, { title, why, rejected, date });
      return { updates: { [DECISIONS_FILE]: built.next }, result: built.id };
    });
    if (res.ok) {
      writeFileSync(p.decisions, built.next); // mirror shared → local (incl. others' entries)
      return { id: built.id, title, date: built.when, source: 'remote', branch };
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

// Refresh local canon mirrors from the shared branch (team-global view).
export function canonPull(root) {
  const p = paths(root);
  const remote = registryRemote(root);
  const branch = registryBranch(root);
  if (!isRepo(root) || !hasRemote(remote, root)) return { ok: false, source: 'local' };
  const { files } = snapshot(root, { remote, branch });
  const pulled = [];
  const preserved = [];
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
    const idsOf = (t) => new Set([...String(t).matchAll(/^##\s+(ADR-\d+)/gm)].map((m) => m[1]));
    const localText = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
    const remoteIds = idsOf(files[DECISIONS_FILE]);
    const localOnly = [...idsOf(localText)].filter((id) => !remoteIds.has(id));
    let next = files[DECISIONS_FILE];
    if (localOnly.length) {
      // Carry each local-only entry across verbatim: from its `## ADR-n` heading to just
      // before the next heading (or EOF). Appending preserves the append-only shape.
      for (const id of localOnly) {
        // The alternative below anchors to TRUE end-of-input, not end-of-line. Under the `m`
        // flag a bare end-of-line anchor matches at every line break, and the lazy
        // `[\s\S]*?` then stops at the FIRST one — so the rescue kept only the `## ADR-n`
        // heading and silently dropped the date, Why: and Rejected: beneath it, while still
        // printing a successful-rescue message. It happened to work when another `## ADR-`
        // heading followed, and ALWAYS failed for an ADR at EOF — the common case, since
        // DECISIONS.md is append-only. ADR-034 therefore turned total loss into partial loss
        // that looked like a full rescue, and a verifier grepping for the ADR id (the obvious
        // check) passed either way.
        const m = localText.match(new RegExp(`^##\\s+${id}\\b[\\s\\S]*?(?=\\n##\\s+ADR-|$(?![\\s\\S]))`, 'm'));
        if (m) next = next.trimEnd() + '\n\n' + m[0].trim() + '\n';
      }
      preserved.push(...localOnly);
    }
    writeFileSync(p.decisions, next);
    pulled.push(DECISIONS_FILE);
  }
  if (files[CONVENTIONS_FILE] != null) {
    writeFileSync(p.conventions, files[CONVENTIONS_FILE]);
    pulled.push(CONVENTIONS_FILE);
  }
  return { ok: true, pulled, branch, preserved };
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
