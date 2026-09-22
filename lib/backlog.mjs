// The backlog register (ADR-056): a place to write down an idea or task you are not
// ready to plan, which can later be promoted into a phase, folded into one being
// planned, or archived WITH ITS REASON INTACT — a peer of fixes and debt, never a
// debt status and never a milestone-less phase.
//
// ## Why a separate object, not a debt status
//
// `ac debt score` measures what debt CHARGES you — recurrence and concentration —
// against principal. A backlog item has no `file` and no recurrence, so every one
// added would read as pure principal and push the score down. Putting ideas in the
// debt register corrupts the one number in the system that currently carries
// signal. Secondary: `drop`/`dismiss` do not map to an idea (it was never "not
// true"), and debt's integrity claim is that the VERIFIER files it — a human wish
// would break that. So this register stays entirely unentangled from `lib/debt.mjs`:
// its own duplicate check, its own staleness constant, its own lifecycle. It only
// borrows the SHAPE — a strict reader that refuses to read a damaged file as empty
// (the 2026-09-18 incident, transplanted here before it can recur here too) and a
// lock-guarded write path that mirrors `debt.mjs` one-for-one.
//
// ## Why the outflow is automatic
//
// A capture surface with no automatic outflow is `todo.md` with extra steps — the
// exact rot this design exists to avoid. An item leaves the register the same way
// debt does: `linkBacklog` commits it to a phase in flight, and `closeBacklogFor`
// drains it to `absorbed` the moment that phase is ACCEPTED, never because someone
// remembered to delete a line. If that phase is instead REJECTED, `reopenBacklogFor`
// reverts it to `open` and keeps the record of the failed attempt.
import { paths } from './paths.mjs';
import { datedId, slugify } from './fixes.mjs';
import { classifyMatch } from './registry.mjs';
import { readJSONStrict, atomicWriteJSON, withLock } from './util.mjs';

/**
 * Backlog lifecycle. Deliberately short — the register never carries work, it hands
 * it off:
 *
 *   open       captured, nobody has committed to it
 *   linked     a phase has offered to fold it in and is in flight
 *   promoted   it became its own phase (`ac backlog promote`)
 *   absorbed   the phase it was linked to was ACCEPTED (set automatically, never typed)
 *   declined   a human decided against it, with a reason
 *   obsolete   the world moved on, with a reason
 *
 * `promoted` and `absorbed` are both "became real work", kept distinct because they
 * answer different questions later: "which phase did this become" vs. "which phase
 * folded this in as part of something else".
 */
export const BACKLOG_STATUSES = ['open', 'linked', 'promoted', 'absorbed', 'declined', 'obsolete'];

/** The only two kinds a human can type on `archiveBacklog` — `absorbed` never is. */
export const ARCHIVE_KINDS = ['declined', 'obsolete'];

/** An item nobody has touched for this long is worth a staleness flag on `list`. */
export const BACKLOG_STALE_DAYS = 30;

export function backlogId(title, now = new Date()) {
  return datedId(title, now, 40, 'idea');
}

/**
 * Read the register, distinguishing "nobody has captured anything yet" from "the
 * file is damaged" — transplanted verbatim from `lib/debt.mjs`'s `readRegister`
 * after the 2026-09-18 incident, so the backlog cannot repeat it.
 *
 * `backlog.json` is created lazily by the first `addBacklog`, so an ABSENT file is a
 * true empty and must stay silent. A file that exists and does not parse is the
 * opposite claim, and reading it as empty is how this register becomes what it was
 * built to replace: a list that confidently misinforms whoever opens it. So this
 * throws, and every WRITE path goes through it too — a writer that accepted an empty
 * fallback would persist it over the damaged file and turn an unreadable register
 * into a permanently empty one.
 */
function readRegister(path) {
  const db = readJSONStrict(path, null, 'the backlog') ?? { version: 1, backlog: [] };
  if (!Array.isArray(db.backlog)) {
    throw new Error(
      `the backlog ${path} is valid JSON but is not a register (no "backlog" array) — `
      + `it was NOT read as empty. Repair it, or restore it: git checkout -- ${path}`,
    );
  }
  return db;
}

export function loadBacklog(root) {
  return readRegister(paths(root).backlog);
}

/** Live = still waiting on a human decision. `linked` counts: it has not landed yet. */
export function openBacklog(root) {
  return loadBacklog(root).backlog
    .filter((b) => b.status === 'open' || b.status === 'linked')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Resolve a reference the way a human types it — mirrors `findDebt`: id, then id
 * without its date prefix, then a partial id, then a distinctive word from the
 * title (captures are short sentences, so the truncated 40-char id often drops the
 * word someone remembers).
 */
export function findBacklog(root, ref) {
  if (!ref) return null;
  const all = loadBacklog(root).backlog;
  const needle = slugify(ref);
  return all.find((b) => b.id === ref)
    || all.find((b) => b.id.endsWith(`-${ref}`))
    || all.find((b) => b.id.includes(ref))
    || all.find((b) => slugify(b.title).includes(needle))
    || null;
}

/** Whole days since it was captured — the only age signal the register needs. */
export function backlogAgeDays(entry, now = new Date()) {
  const found = Date.parse(entry?.captured_at || '');
  if (!Number.isFinite(found)) return 0;
  return Math.max(0, Math.floor((now.getTime() - found) / 86_400_000));
}

/**
 * Capture an idea.
 *
 * Never merges and never blocks — a resemblance to an already-open item is
 * surfaced back in `similar` so the caller can tell the human, but the new item is
 * always recorded. Collapsing two genuinely different ideas because their titles
 * overlap would silently drop whichever thought made the second one worth writing
 * down in the first place; that judgement belongs to a human, not to this function.
 */
export async function addBacklog(root, { title, note = '', now = new Date() } = {}) {
  const p = paths(root);
  const clean = String(title || '').trim();
  if (!clean) throw new Error('a backlog item needs a title');

  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);

    const similar = db.backlog
      .filter((b) => b.status === 'open')
      .map((b) => ({ id: b.id, title: b.title, match: classifyMatch(b.title, clean) }))
      .filter((b) => b.match);

    let id = backlogId(clean, now);
    if (db.backlog.some((b) => b.id === id)) {
      let n = 2;
      while (db.backlog.some((b) => b.id === `${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }

    const entry = {
      id,
      title: clean,
      ...(String(note || '').trim() ? { note: String(note).trim() } : {}),
      status: 'open',
      captured_at: now.toISOString(),
    };
    db.backlog.push(entry);
    db.backlog.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    atomicWriteJSON(p.backlog, db);
    return { entry: { ...entry }, similar };
  });
}

/**
 * Commit to folding an item into a piece of work in flight — the peer of
 * `payDebt`. Does NOT close the item; `closeBacklogFor` does that when the work is
 * accepted, which is the whole anti-rot mechanism (see the module header).
 */
export async function linkBacklog(root, ref, { kind, workRef, now = new Date() } = {}) {
  if (!String(workRef || '').trim()) throw new Error('linking a backlog item needs the phase it was offered to');
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const entry = db.backlog.find((b) => b.id === ref);
    if (!entry) throw new Error(`no such backlog item: ${ref}`);
    if (entry.status !== 'open') {
      throw new Error(`backlog item "${entry.id}" is already ${entry.status}`);
    }
    entry.status = 'linked';
    entry.linked_by = { kind, ref: String(workRef).trim() };
    entry.linked_at = now.toISOString();
    atomicWriteJSON(p.backlog, db);
    return { ...entry };
  });
}

/**
 * Close every item linked to a piece of work that was just accepted.
 *
 * Called from `ac phase accept`, so the register drains as a side effect of the
 * gate that already exists. Returns what it closed so the caller can say so — a
 * silent close would leave a user unsure whether the link ever worked.
 */
export async function closeBacklogFor(root, { kind, workRef, now = new Date() } = {}) {
  const p = paths(root);
  if (!String(workRef || '').trim()) return [];
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const hit = db.backlog.filter(
      (b) => b.status === 'linked' && b.linked_by?.kind === kind && String(b.linked_by?.ref) === String(workRef),
    );
    if (!hit.length) return [];
    for (const entry of hit) {
      entry.status = 'absorbed';
      entry.absorbed_at = now.toISOString();
    }
    atomicWriteJSON(p.backlog, db);
    return hit.map((b) => ({ ...b }));
  });
}

/**
 * Revert every item linked to a piece of work that was just REJECTED.
 *
 * Called from `ac phase reject`. The failed link is not erased — it moves to
 * `previously_linked_to` so a later "let's plan X" can see that this was already
 * tried and did not land, without the item being stranded as `linked` forever.
 */
export async function reopenBacklogFor(root, { kind, workRef, now = new Date() } = {}) {
  const p = paths(root);
  if (!String(workRef || '').trim()) return [];
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const hit = db.backlog.filter(
      (b) => b.status === 'linked' && b.linked_by?.kind === kind && String(b.linked_by?.ref) === String(workRef),
    );
    if (!hit.length) return [];
    for (const entry of hit) {
      entry.status = 'open';
      entry.reopened_at = now.toISOString();
      entry.previously_linked_to = entry.linked_by;
      delete entry.linked_by;
      delete entry.linked_at;
    }
    atomicWriteJSON(p.backlog, db);
    return hit.map((b) => ({ ...b }));
  });
}

/**
 * Mark an item promoted — it claimed a phase number and became its own phase
 * (`ac backlog promote`, D3). Never a fix: an idea has no reproduction case.
 */
export async function markPromoted(root, ref, { number, slug, now = new Date() } = {}) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const entry = db.backlog.find((b) => b.id === ref);
    if (!entry) throw new Error(`no such backlog item: ${ref}`);
    if (entry.status !== 'open') {
      throw new Error(`backlog item "${entry.id}" is already ${entry.status}`);
    }
    entry.status = 'promoted';
    entry.promoted_to = { number, slug };
    entry.promoted_at = now.toISOString();
    atomicWriteJSON(p.backlog, db);
    return { ...entry };
  });
}

/**
 * Archive an item without doing it — the move `todo.md` never had.
 *
 * `kind` and `reason` are validated BEFORE the lock is taken, so a bad call never
 * even opens the file. A REASON is required on both kinds: an archived item with no
 * reason answers "we didn't do it" but not "why", and the second is the entire
 * point of keeping the history (D4). `absorbed` is deliberately refused here — it
 * is the D1 drain's status, never a human-typed one.
 */
export async function archiveBacklog(root, ref, { kind, reason = '', now = new Date() } = {}) {
  if (!ARCHIVE_KINDS.includes(kind)) {
    throw new Error(`unknown backlog archive kind "${kind}" — choose one of: ${ARCHIVE_KINDS.join(', ')}`);
  }
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('archiving a backlog item needs a reason — an unexplained removal is not a decision');

  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const entry = db.backlog.find((b) => b.id === ref);
    if (!entry) throw new Error(`no such backlog item: ${ref}`);
    if (entry.status !== 'open' && entry.status !== 'linked') {
      throw new Error(`backlog item "${entry.id}" is already ${entry.status}`);
    }
    entry.status = kind;
    entry.archived_at = now.toISOString();
    entry.archive_kind = kind;
    entry.archive_reason = clean;
    atomicWriteJSON(p.backlog, db);
    return { ...entry };
  });
}

/**
 * Set (or clear, with an empty string) an item's note. Mirrors `setPhaseNote`:
 * additive field, same lock, every other byte of the register untouched.
 *
 * Notes are editable and reports are not, and the line between them is deliberate.
 * A fix keeps its report verbatim because the exact symptom is EVIDENCE — paraphrasing
 * it is how a bugfix stops being trustworthy. Debt is filed by the verifier, and editing
 * a finding would corrupt the feed that `drop` versus `dismiss` exists to measure. A
 * backlog note is neither: it is the author's own intent, and intent legitimately
 * changes as an idea is understood. "Actually the real problem is X" is the normal life
 * of an idea, not a corruption of the record.
 *
 * It also closes a rule nobody could follow. `addBacklog` warns when a note reads like a
 * plan and asks for a rewrite — with no way to rewrite, that warning named a fault and
 * offered no exit, which is the one shape this project treats as a defect regardless of
 * what caused it.
 *
 * Only OPEN or LINKED items: once an idea is archived or promoted its note is part of a
 * closed record, and the reason it was archived is `archive_reason`, which is separate
 * and stays immutable.
 */
export async function setBacklogNote(root, ref, note) {
  const text = String(note ?? '').trim();
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.backlog);
    const entry = db.backlog.find((b) => b.id === ref);
    if (!entry) throw new Error(`no such backlog item: ${ref}`);
    if (entry.status !== 'open' && entry.status !== 'linked') {
      throw new Error(
        `backlog item "${entry.id}" is ${entry.status} — its note is part of a closed record. ` +
        'Re-capture the idea if it is live again.',
      );
    }
    if (text) entry.note = text;
    else delete entry.note;
    atomicWriteJSON(p.backlog, db);
    return { ...entry };
  });
}

/**
 * Items archived `declined` that resemble `name` — the "you already decided
 * against that" answer `ac phase add` surfaces (D5). An `obsolete` item never
 * matches: "this stopped being relevant" is not an argument against a fresh idea.
 */
export function declinedMatches(root, name) {
  if (!String(name || '').trim()) return [];
  return loadBacklog(root).backlog
    .filter((b) => b.status === 'declined')
    .map((b) => ({ id: b.id, title: b.title, reason: b.archive_reason, match: classifyMatch(b.title, name) }))
    .filter((b) => b.match);
}

/**
 * Build the `CONTEXT.md` a promotion seeds (D2).
 *
 * Pure and deliberately WITHOUT the `<!-- astro-discuss: captured -->` marker, so
 * the thinking survives to the moment it is useful while `phaseContextStatus`
 * still reads the file as `stub` — `/astro-plan` keeps demanding a real discuss
 * round. HTML comments are stripped from the captured note before it is embedded,
 * so the file STRUCTURALLY cannot carry the marker even if a user pasted it into
 * their idea — "don't add it" is not enough, since a future template edit or a
 * careless paste would otherwise defeat that.
 */
export function promotionContext(item, { number } = {}) {
  const captured = String(item?.captured_at || '').slice(0, 10);
  const body = String(item?.note || item?.title || '').replace(/<!--[\s\S]*?-->/g, '');
  return `# Phase ${number} — ${item?.title || ''}\n\n`
    + `_Promoted from the backlog (\`${item?.id}\`, captured ${captured}). `
    + `This is a captured note, not a discussion — run \`/astro-discuss ${number}\` `
    + `before planning._\n\n`
    + `## The idea, as captured\n\n${body}\n`;
}
