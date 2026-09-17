// Bugfix model: fixes are peers of phases, not members of a milestone.
//
// ## Why a separate object at all
//
// A phase is three things bound together: a milestone-scoped number from the
// shared registry, an artifact directory, and a lifecycle. A bugfix wants the
// last two and explicitly NOT the first — filing a bug as a phase burns a
// milestone number on work that was never part of the milestone's scope, and
// the roadmap stops describing what was planned. (`/astro-fast` has the same
// problem today for a different reason; it is deliberately left alone.)
//
// ## Why a separate FILE and not roadmap.json
//
// `completeMilestone` archives roadmap.json wholesale into
// `.astrocode/milestones/<N>/`. A `fixes` array living there would be copied
// into every milestone archive forever — re-creating exactly the entanglement
// this object exists to remove. Fixes get `.astrocode/fixes.json`.
//
// ## Identity: a dated slug, never a number
//
// `2026-09-17-auth-token-refresh-401`. Sorts chronologically in `ls`, in the
// registry, and in the archive — one scheme in three places. This follows
// ADR-013, which already established that urgent out-of-band work (hotfix
// branches) is name-identified rather than numbered, so it stays instant and
// air-gap-safe. Numbers coordinate PLANNED scope; a bug is not scope.
import { mkdirSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/**
 * Fix lifecycle. Deliberately NOT the phase lifecycle:
 *
 *   diagnosing  the cause is unknown — the step a phase never has
 *   executing   cause found, fixing it
 *   verified    the reproduction test passes (AI-checked)
 *   accepted    human signed off; the fix is archived at this point
 *
 * `rejected` mirrors phases: UAT said no.
 *
 * Note `accepted`, not `complete`. Accepting a fix ARCHIVES it, so the terminal
 * state means "closed and filed away" rather than phases' "done but still on
 * the board".
 */
export const FIX_STATUSES = ['open', 'diagnosing', 'executing', 'verified', 'accepted', 'rejected'];

/** ISO date portion only — the sortable prefix every fix id carries. */
export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Build a fix id from a title. Truncated on a WORD boundary so a long bug
 * report does not produce a 200-character directory name, and never left with
 * a trailing hyphen.
 */
export function fixId(title, now = new Date(), maxSlug = 40) {
  const slug = slugify(title);
  let short = slug;
  if (slug.length > maxSlug) {
    const cut = slug.slice(0, maxSlug);
    const lastDash = cut.lastIndexOf('-');
    short = (lastDash > maxSlug / 2 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
  }
  return `${today(now)}-${short || 'fix'}`;
}

export function loadFixes(root) {
  return readJSON(paths(root).fixes) || { version: 1, fixes: [] };
}

/** Active (not yet accepted) fixes, newest first — ids sort chronologically. */
export function openFixes(root) {
  return loadFixes(root).fixes
    .filter((f) => f.status !== 'accepted')
    .sort((a, b) => String(b.id).localeCompare(String(a.id)));
}

export function findFix(root, ref) {
  if (!ref) return null;
  const all = loadFixes(root).fixes;
  return all.find((f) => f.id === ref)
    || all.find((f) => f.id.endsWith(`-${ref}`))       // slug without the date
    || all.find((f) => f.id.includes(ref))             // partial match
    || null;
}

export function validateFixStatus(status) {
  if (!FIX_STATUSES.includes(status)) {
    throw new Error(`unknown fix status "${status}" — choose one of: ${FIX_STATUSES.join(', ')}`);
  }
  return status;
}

/**
 * Open a fix. Creates `.astrocode/fixes/<id>/` and records it.
 *
 * Same-day duplicates are refused rather than silently merged: two people
 * reporting the same bug on the same day should collide loudly, which is how
 * they discover each other's work.
 */
export async function addFix(root, { title, report = '', now = new Date() }) {
  const p = paths(root);
  if (!String(title || '').trim()) throw new Error('a fix needs a title');
  const id = fixId(title, now);

  return withLock(p.lock, () => {
    const db = readJSON(p.fixes) || { version: 1, fixes: [] };
    if (db.fixes.some((f) => f.id === id)) {
      throw new Error(`fix "${id}" already exists — use \`ac fix show ${id}\``);
    }
    const fix = {
      id,
      title: String(title).trim(),
      status: 'open',
      opened_at: now.toISOString(),
    };
    db.fixes.push(fix);
    db.fixes.sort((a, b) => String(a.id).localeCompare(String(b.id)));
    atomicWriteJSON(p.fixes, db);
    mkdirSync(join(p.fixes_dir, id), { recursive: true });
    return { ...fix, report };
  });
}

/** Move a fix along its lifecycle. Additive `extra` fields are merged in. */
export async function setFixStatus(root, ref, status, extra = {}) {
  validateFixStatus(status);
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readJSON(p.fixes) || { version: 1, fixes: [] };
    const fix = db.fixes.find((f) => f.id === ref);
    if (!fix) throw new Error(`no such fix: ${ref}`);
    Object.assign(fix, extra, { status });
    atomicWriteJSON(p.fixes, db);
    return { ...fix };
  });
}

/**
 * Accept a fix: mark it accepted AND archive its directory.
 *
 * Accepting is the archive action — a fix has no milestone to be swept up by,
 * so if acceptance did not file it away, `.astrocode/fixes/` would grow without
 * bound. The dated id means the archive stays chronologically sorted with no
 * extra machinery.
 *
 * The record is KEPT (status `accepted`) rather than deleted: the history of
 * what broke and when is the most useful thing a bug tracker has.
 */
export async function acceptFix(root, ref, { now = new Date(), by = '', agent = '' } = {}) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const db = readJSON(p.fixes) || { version: 1, fixes: [] };
    const fix = db.fixes.find((f) => f.id === ref);
    if (!fix) throw new Error(`no such fix: ${ref}`);

    fix.status = 'accepted';
    fix.accepted_at = now.toISOString();
    // ADR-033 applies to fixes exactly as it does to phases: `verified` is the
    // machine's verdict, `accepted` is supposed to mean a human agreed. astro-code
    // cannot tell which happened — when the operator accepts, their assistant runs
    // this same command — so the record is only honest if the signer declares it.
    fix.accepted_kind = agent ? 'agent' : 'human';
    if (agent) fix.accepted_by = agent;
    else if (by) fix.accepted_by = by;
    atomicWriteJSON(p.fixes, db);

    const src = join(p.fixes_dir, fix.id);
    const destDir = join(p.fixes_dir, 'archive');
    let archived = false;
    if (existsSync(src)) {
      mkdirSync(destDir, { recursive: true });
      const dest = join(destDir, fix.id);
      if (!existsSync(dest)) {
        renameSync(src, dest);
        archived = true;
      }
    }
    return { ...fix, archived };
  });
}
