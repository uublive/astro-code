// Technical-debt register: an inbox the verifier FILLS, not a diary a human maintains.
//
// ## Why this exists
//
// astro-code's own `todo.md` was the argument for it. Its largest section was headed
// "GitFlow integration (ANALYSIS ONLY — not yet implemented)" while `lib/flow.mjs`
// carried 1299 lines of shipped GitFlow under ADR-007/009/010. Three of its four
// sections described work that was already done. The one live item — a silent
// data-loss bug in `ac canon pull` — sat on line 147, underneath all of it.
//
// A markdown list rots for one structural reason: CLOSING an entry requires a human
// to remember. Nothing in the system ever notices that the work landed, so the list
// only grows — and a list that only grows stops being read, at which point it is
// worse than nothing because it actively misinforms whoever opens it.
//
// This register attacks both ends of that:
//   - INFLOW is automatic. The phase verifier is the highest-context observer in the
//     loop (it has just driven the real code against real inputs), and until now
//     anything it noticed OUTSIDE its criteria had nowhere to go — VERIFY_SCHEMA is
//     `additionalProperties: false`, so such observations died in prose nobody
//     re-reads. They are now handed back structured and filed with zero human effort.
//   - OUTFLOW is automatic. An item closes because the fix or phase that PAYS it was
//     accepted — never because someone remembered to delete a line.
//
// ## Why it is not a second lifecycle
//
// Debt is an inbox, not a plan. It is never "worked" directly; it graduates into one
// of the two objects astro-code already has — a small, bug-shaped item becomes a FIX
// (`ac fix`, with its reproduce → diagnose → verify loop), a refactor-sized one
// becomes a PHASE on the roadmap (discuss → plan → execute → verify). `pay` opens the
// right one and links it. So the register never competes with the roadmap for meaning,
// and there is no third way of working to learn.
//
// The split matters for honesty, not taste: routing an architectural item through the
// fix loop would produce a "bugfix" with no reproduction case, which corrupts the one
// thing that makes `ac fix` trustworthy.
//
// ## Why `drop` matters as much as `pay`
//
// Most debt is never paid — it stops being TRUE. The code gets deleted, the approach
// changes, the assumption is withdrawn. Without a cheap and honest exit for "no longer
// applies", dead entries accumulate exactly the way todo.md's did. `drop` demands a
// reason, so leaving the list is a recorded decision rather than a silent omission.
//
// ## Storage: one file, no per-item directory
//
// Unlike a fix, a debt item has no artifacts — it is one sentence until it is paid,
// and the moment it IS paid the fix or phase paying it owns the directory. Creating
// `.astrocode/debt/<id>/` per finding would fill the tree with empty folders at the
// rate the verifier files them. Everything lives in `debt.json`.
//
// ## Identity: the dated slug, same as fixes (ADR-013)
//
// Debt is unplanned by definition, so it takes the fix scheme rather than a registry
// number: name-identified, instant, air-gap-safe, chronologically sortable. Numbers
// coordinate PLANNED scope; debt is not scope.
import { paths } from './paths.mjs';
import { datedId, slugify } from './fixes.mjs';
import { readJSONStrict, atomicWriteJSON, withLock } from './util.mjs';
// The scoring math lives in the hooks helper because the statusline needs it too
// and hooks are installed WITHOUT lib/ — one implementation, both consumers, no
// drift. See the long note above `debtPressure` for what the number means.
import { debtPressure, DEBT_PRINCIPAL, DEBT_BANDS } from '../hooks/_astro-ctx.mjs';

export { debtPressure, DEBT_PRINCIPAL, DEBT_BANDS };

/**
 * Debt lifecycle. Shorter than a fix's on purpose — the register does not carry work,
 * it hands work off:
 *
 *   open       filed, nobody has committed to it
 *   paying     a fix or phase has been opened for it and is in flight
 *   paid       that work was ACCEPTED (set automatically, never typed)
 *   dropped    it WAS true and stopped being true; the reason is recorded
 *   dismissed  it was NEVER true — the verifier was wrong
 *
 * `dropped` and `dismissed` both close an item and both keep the record, so the
 * split looks like hair-splitting until you ask what each one measures. A drop is
 * a fact about the CODE (it changed underneath the finding). A dismissal is a fact
 * about the FEED: the verifier filed something that was not debt. Collapsing them
 * would bury the only precision signal this design has — if dismissals climb, the
 * answer is to tighten the verifier, not to work harder on the register — and it
 * would pollute the drop reasons, which are supposed to be a readable history of
 * how the codebase actually moved.
 */
export const DEBT_STATUSES = ['open', 'paying', 'paid', 'dropped', 'dismissed'];

/** Rough size, which is really "which exit does this take" — see `payDebt`. */
export const DEBT_COSTS = ['small', 'medium', 'large'];

/** The two objects debt can graduate into. There is deliberately no third. */
export const DEBT_EXITS = ['fix', 'phase'];

/** An item nobody has touched for this long is surfaced for triage at milestone close. */
export const STALE_DAYS = 30;

export function debtId(title, now = new Date()) {
  return datedId(title, now, 40, 'debt');
}

/**
 * Read the register, distinguishing "nobody has filed anything yet" from "the file is
 * damaged" — the one distinction a register cannot afford to lose.
 *
 * `debt.json` is created lazily by the first `addDebt`, so an ABSENT file is a true
 * empty and must stay silent. A file that exists and does not parse is the opposite
 * claim, and reading it as empty is how the register becomes what it was built to
 * replace: a list that confidently misinforms whoever opens it. It happened here on
 * 2026-09-18 — six items, invisible, `ac debt list` reporting "no open debt".
 *
 * So this throws, and every WRITE path goes through it too. That second part is not
 * defensive symmetry: the writers hold the lock, re-read, mutate and serialize, so a
 * writer that accepted an empty fallback would persist it over the damaged file and
 * turn an unreadable register into a permanently empty one.
 */
function readRegister(path) {
  const db = readJSONStrict(path, null, 'the debt register') ?? { version: 1, debt: [] };
  // Right shape, wrong contents is the same lie by a different route: a bad merge or a
  // hand-edit that leaves valid JSON without a `debt` array would otherwise be read as
  // "no debt" by every consumer, since they all index straight into `.debt`.
  if (!Array.isArray(db.debt)) {
    throw new Error(
      `the debt register ${path} is valid JSON but is not a register (no "debt" array) — `
      + `it was NOT read as empty. Repair it, or restore it: git checkout -- ${path}`,
    );
  }
  return db;
}

export function loadDebt(root) {
  return readRegister(paths(root).debt);
}

export function validateDebtStatus(status) {
  if (!DEBT_STATUSES.includes(status)) {
    throw new Error(`unknown debt status "${status}" — choose one of: ${DEBT_STATUSES.join(', ')}`);
  }
  return status;
}

export function validateDebtCost(cost) {
  if (!DEBT_COSTS.includes(cost)) {
    throw new Error(`unknown debt cost "${cost}" — choose one of: ${DEBT_COSTS.join(', ')}`);
  }
  return cost;
}

/** Live debt = anything not yet resolved. `paid`/`dropped` are terminal and kept as history. */
export function openDebt(root, { phase = '', file = '' } = {}) {
  return loadDebt(root).debt
    .filter((d) => d.status === 'open' || d.status === 'paying')
    .filter((d) => (phase ? String(d.phase) === String(phase) : true))
    // Substring match, not equality: the verifier records the path it saw
    // (`src/lib/method.sh`) while a human asks about `method.sh`.
    .filter((d) => (file ? String(d.file || '').includes(file) : true))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Resolve a reference the way a human types it.
 *
 * The title fallback is not present on `findFix` and is here for a specific reason:
 * debt titles are written by a VERIFIER, so they are long sentences, and the id keeps
 * only the first 40 characters of one. A user who reads `ac debt list` and types the
 * distinctive word they saw — which is very often past the truncation point — would
 * otherwise get "no such debt" while looking straight at the entry.
 */
export function findDebt(root, ref) {
  if (!ref) return null;
  const all = loadDebt(root).debt;
  const needle = slugify(ref);
  return all.find((d) => d.id === ref)
    || all.find((d) => d.id.endsWith(`-${ref}`))              // slug without the date
    || all.find((d) => d.id.includes(ref))                    // partial id
    || all.find((d) => slugify(d.title).includes(needle))     // a word from the title
    || null;
}

/** Whole days since it was filed — the only age signal the register needs. */
export function debtAgeDays(entry, now = new Date()) {
  const found = Date.parse(entry?.found_at || '');
  if (!Number.isFinite(found)) return 0;
  return Math.max(0, Math.floor((now.getTime() - found) / 86_400_000));
}

export function staleDebt(root, { days = STALE_DAYS, now = new Date() } = {}) {
  return openDebt(root).filter((d) => debtAgeDays(d, now) >= days);
}

/**
 * The dedupe key. Deliberately date-free and status-free: the same finding reported by
 * phase 23 today and phase 27 next month is ONE debt seen twice, not two debts. Keyed on
 * the normalized title plus the file, because the same sentence about two different files
 * is genuinely two items.
 */
const dedupeKey = (title, file) => `${slugify(title)}::${slugify(file || '')}`;

/**
 * File a debt item.
 *
 * NOTE THE CONTRAST WITH `addFix`, which throws on a same-day duplicate: there, two
 * humans colliding on one bug SHOULD fail loudly, because that is how they discover
 * each other. Here the caller is a machine running after every single phase, so a throw
 * would abort the workflow over a finding that is, by construction, non-blocking. A
 * duplicate is therefore recorded as another SIGHTING (`also_found_in`) and reported as
 * `created: false` — the register converges instead of crashing or fragmenting.
 *
 * The one thing that DOES throw here is a damaged register (see `readRegister`). Filing
 * onto a file that could not be read would write the empty fallback over whatever is in
 * it, so the non-blocking finding would cost the user every item already filed. A failed
 * `ac debt add` line in a phase report is cheap; that is not.
 */
export async function addDebt(root, { title, why = '', phase = '', file = '', cost = 'small', now = new Date() } = {}) {
  const p = paths(root);
  const clean = String(title || '').trim();
  if (!clean) throw new Error('a debt item needs a title');
  validateDebtCost(cost);

  return withLock(p.lock, () => {
    const db = readRegister(p.debt);
    const key = dedupeKey(clean, file);

    const seen = db.debt.find(
      (d) => (d.status === 'open' || d.status === 'paying') && dedupeKey(d.title, d.file) === key,
    );
    if (seen) {
      // Record that another phase hit the same thing — repeated sightings are the
      // strongest signal the register carries about what actually hurts.
      if (phase && String(seen.phase) !== String(phase) && !(seen.also_found_in || []).includes(String(phase))) {
        seen.also_found_in = [...(seen.also_found_in || []), String(phase)];
        atomicWriteJSON(p.debt, db);
      }
      return { entry: { ...seen }, created: false };
    }

    // Only disambiguate when the SAME title lands on a different file on the same day;
    // the dedupe above has already absorbed the true-duplicate case.
    let id = debtId(clean, now);
    if (db.debt.some((d) => d.id === id)) {
      let n = 2;
      while (db.debt.some((d) => d.id === `${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }

    const entry = {
      id,
      title: clean,
      status: 'open',
      cost,
      found_at: now.toISOString(),
      ...(why ? { why: String(why).trim() } : {}),
      ...(phase ? { phase: String(phase) } : {}),
      ...(file ? { file: String(file) } : {}),
    };
    db.debt.push(entry);
    db.debt.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    atomicWriteJSON(p.debt, db);
    return { entry: { ...entry }, created: true };
  });
}

/**
 * Commit to paying an item: link it to the fix or phase that will do the work.
 *
 * This does NOT close the item. Closing happens in `closeDebtFor` when that work is
 * ACCEPTED — which is the whole anti-rot mechanism. If `pay` closed the entry, the
 * register would once again be claiming things were done because someone said they
 * would do them, which is precisely how todo.md ended up describing a GitFlow
 * implementation that had already shipped.
 */
export async function payDebt(root, ref, { kind, workRef, now = new Date() } = {}) {
  if (!DEBT_EXITS.includes(kind)) {
    throw new Error(`unknown debt exit "${kind}" — choose one of: ${DEBT_EXITS.join(', ')}`);
  }
  if (!String(workRef || '').trim()) throw new Error(`paying a debt needs the ${kind} it was opened as`);
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.debt);
    const entry = db.debt.find((d) => d.id === ref);
    if (!entry) throw new Error(`no such debt: ${ref}`);
    // Anything not live is closed, however it got there — reopening by paying it
    // would silently resurrect an item a human deliberately closed.
    if (entry.status !== 'open' && entry.status !== 'paying') {
      throw new Error(`debt "${entry.id}" is already ${entry.status}`);
    }
    entry.status = 'paying';
    entry.paid_by = { kind, ref: String(workRef).trim() };
    entry.paying_since = now.toISOString();
    atomicWriteJSON(p.debt, db);
    return { ...entry };
  });
}

/**
 * Close every item being paid by a piece of work that was just accepted.
 *
 * Called from `ac fix accept` and `ac phase accept`, so the register drains as a side
 * effect of the gates that already exist. Returns what it closed so the CLI can say so
 * — a silent close would leave the user unsure whether the link ever worked.
 */
export async function closeDebtFor(root, { kind, workRef, now = new Date() } = {}) {
  const p = paths(root);
  if (!String(workRef || '').trim()) return [];
  return withLock(p.lock, () => {
    const db = readRegister(p.debt);
    const hit = db.debt.filter(
      (d) => d.status === 'paying' && d.paid_by?.kind === kind && String(d.paid_by?.ref) === String(workRef),
    );
    if (!hit.length) return [];
    for (const entry of hit) {
      entry.status = 'paid';
      entry.paid_at = now.toISOString();
    }
    atomicWriteJSON(p.debt, db);
    return hit.map((d) => ({ ...d }));
  });
}

/**
 * Leave the list without being fixed — the move todo.md never had.
 *
 * A reason is REQUIRED. "No longer applies" is a judgement, and an unexplained
 * disappearance is indistinguishable from an oversight six months later.
 */
export async function dropDebt(root, ref, { reason = '', now = new Date() } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('dropping a debt needs a reason — an unexplained removal is not a decision');
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.debt);
    const entry = db.debt.find((d) => d.id === ref);
    if (!entry) throw new Error(`no such debt: ${ref}`);
    if (entry.status === 'paid') throw new Error(`debt "${entry.id}" was already paid`);
    entry.status = 'dropped';
    entry.dropped_at = now.toISOString();
    entry.drop_reason = clean;
    atomicWriteJSON(p.debt, db);
    return { ...entry };
  });
}

/**
 * Close an item that was never debt in the first place — the verifier was wrong.
 *
 * Distinct from `drop` on purpose (see DEBT_STATUSES): a dismissal is feedback about
 * the FEED, and it is the only precision signal this design has. The record is kept,
 * so `ac debt score` can report a false-positive rate, and a rising one says to tighten
 * the verifier rather than to grind through the register.
 *
 * A reason is required for the same purpose it is required on `drop`: "this was not
 * real" is a judgement, and six months later an unexplained dismissal is
 * indistinguishable from someone quietly deleting inconvenient work.
 */
export async function dismissDebt(root, ref, { reason = '', now = new Date() } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('dismissing a debt needs a reason — say why it was never real');
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readRegister(p.debt);
    const entry = db.debt.find((d) => d.id === ref);
    if (!entry) throw new Error(`no such debt: ${ref}`);
    if (entry.status === 'paid') {
      throw new Error(`debt "${entry.id}" was already paid — it cannot also have been unreal`);
    }
    entry.status = 'dismissed';
    entry.dismissed_at = now.toISOString();
    entry.dismiss_reason = clean;
    atomicWriteJSON(p.debt, db);
    return { ...entry };
  });
}

/** The KPI, computed over this project's register. See `debtPressure` for the model. */
export function debtScore(root, { now = new Date() } = {}) {
  return debtPressure(loadDebt(root), now.getTime());
}

/**
 * Accept a verifier's non-blocking findings into the register.
 *
 * THE GATE LEAK THIS GUARDS (the reason the filter lives here and not only in the
 * agent prompt): `VERIFY_SCHEMA` currently forces a binary — a finding either fails a
 * criterion or does not exist. Adding a "non-blocking" channel hands the verifier a
 * third option for the first time, and an LLM unsure whether something breaks criterion
 * C4 now has an exit that avoids the confrontation of failing the phase. Ambiguity
 * drifts toward the low-conflict output, and the two-gate guarantee quietly acquires a
 * back door.
 *
 * So a finding is admissible ONLY if the verifier explicitly asserted `outsideCriteria`.
 * Anything else is dropped here — silently for the register, loudly in the return value
 * so the caller can surface it. Omission is not consent: a finding that simply forgot
 * the flag does not get filed.
 */
export async function fileFindings(root, findings = [], { phase = '', now = new Date() } = {}) {
  const filed = [];
  const merged = [];
  const rejected = [];
  for (const f of Array.isArray(findings) ? findings : []) {
    const title = String(f?.title || '').trim();
    if (!title) continue;
    if (f?.outsideCriteria !== true) {
      rejected.push(title);
      continue;
    }
    const cost = DEBT_COSTS.includes(f?.cost) ? f.cost : 'small';
    // eslint-disable-next-line no-await-in-loop -- withLock serializes writes anyway
    const res = await addDebt(root, { title, why: f?.why || '', phase, file: f?.file || '', cost, now });
    (res.created ? filed : merged).push(res.entry);
  }
  return { filed, merged, rejected };
}
