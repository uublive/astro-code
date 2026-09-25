// The personal principle store (ADR-057, ADR-058): dir resolution, strict reads, and
// lock-guarded lifecycle mutations for `~/.astro/principles/*.md` — no git here (that
// is `lib/principlesync.mjs`).
//
// ## Why the home dir, and why this is an explicit ADR-048 exception
//
// ADR-048 says `lib/` never writes outside `.astrocode/`; `ac tune`/`ac install` already
// carve out their own exceptions for the same reason this one exists — the thing being
// written travels with the DEVELOPER, not the repo. A principle recorded inside a
// project's `.astrocode/` would land in a teammate's clone the next time they pulled;
// the personal store deliberately lives in the user's home so one developer's
// preferences never leak into a project's canon unless they are promoted there on
// purpose (D8, `recordPromotion` below).
//
// ## Why accept is the only way in, and why refresh only touches an untouched proposal
//
// ADR-058: the machine only ever PROPOSES; a principle starts governing agents only once
// a human accepts it. `proposePrinciple({ id })` exists so phases 23/26 can keep
// re-proposing the same observation without spawning duplicate entries — but the moment
// a human has accepted, rejected, or reworded a proposal (an `edited`/`amended` line in
// its `history`), that entry is THEIRS: refresh must stop touching it, or an automated
// re-propose could silently overwrite a human's own edit. `proposePrinciple` enforces
// this by returning `{ ok: false, reason }` and writing nothing rather than throwing —
// a re-propose racing a human review is an expected outcome, not an exceptional one.
// Rejections are kept, never deleted: a remembered rejection is what stops the same
// proposal from being re-surfaced later.
//
// ## Why an exact repeat records a sighting instead of minting a fresh entry (phase 24, D2)
//
// `proposePrinciple` WITHOUT `id` used to always mint a fresh `proposed` entry — dedupe
// was left for later. Phase 24 is that later: before creating anything, it runs
// `lib/principlematch.mjs`'s `findCandidates` (exact only — an overlap candidate is
// never acted on here, only surfaced, D1) against every entry regardless of status. An
// exact hit means someone (a capture, a human) already said this; the CORRECT response
// is evidence that it keeps mattering, not a second vote to queue. `pickExactTarget`
// resolves ties by status priority (accepted first), the match's `mergedInto` is
// followed to its survivor, and a sighting — `buildSource(...) ?? { at: now }`, never
// dropped even with no evidence — is appended. Text, status, scopes, kind, why and
// history are UNTOUCHED: ADR-058 still holds, because a sighting never governs
// anything by itself, it only records that the observation recurred.
//
// ## Why dated slugs that are never reissued
//
// Same id shape as `lib/fixes.mjs`'s `datedId` / `lib/backlog.mjs`'s `backlogId`
// (ADR-013): created offline, on any machine, with nothing to coordinate and no
// renumbering — ever. The #45 lesson (a reissued id silently re-points citations)
// applies here at least as hard as it does to fixes: `promotion:` records and
// phase-25 retrieval cite these ids by value, so an id a later `-2` collision reassigned
// would quietly break every citation written before the collision.
//
// ## Why every function takes `dir` explicitly
//
// `principlesDir` is the ONLY function here that reads `process.env` (mirroring
// `lib/stats.mjs`'s `configDir`) — everything below it takes an explicit `dir`
// argument, so a test can point at a `mkdtempSync` directory and never risk touching a
// developer's real `~/.astro/principles/`.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { datedId } from './fixes.mjs';
import { withLock, atomicWriteText } from './util.mjs';
import { redactSecrets } from './redact.mjs';
import { parsePrinciple, renderPrinciple, normaliseFields } from './principlemd.mjs';
import { findCandidates, pickExactTarget } from './principlematch.mjs';
import { parseForgeExport, planForgeImport } from './principleimport.mjs';

/** An excerpt is redacted first, then capped — see `lib/redact.mjs`'s module header. */
const EXCERPT_MAX_CHARS = 500;

/**
 * The store directory (D1). `ASTRO_PRINCIPLES_DIR` wins over the default
 * `$HOME/.astro/principles`, so tests never touch a developer's real home.
 */
export function principlesDir(env = process.env) {
  return env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles');
}

/**
 * A dated slug id for a principle statement (P5, ADR-013), ending in 4 RANDOM hex chars
 * drawn once per creation. Two separate creations on two machines — offline, even with
 * the same words — must never share an id: a shared id is a sync conflict, and resolving
 * it can keep only one of two entries (phase-22 verify, C6/C10). A hash of the statement
 * was tried first and failed exactly there: identical statements still differ in
 * `created`, so they conflicted instead of converging. Recognising the same principle
 * captured twice is dedupe — phase 24 — not the id's job. The slug is built from the
 * REDACTED statement, so a secret typed into a statement never reaches a filename.
 */
export function principleId(statement, now = new Date()) {
  return `${datedId(redactSecrets(statement), now, 40, 'principle')}-${randomBytes(2).toString('hex')}`;
}

/** `<dir>/<id>.md` for a given id — the only place this module builds that path. */
function entryFile(dir, id) {
  return join(dir, `${id}.md`);
}

// The one place an entry reaches disk, so the one place its free text is redacted: a
// secret typed into a statement or why (or carried in a history record of one) is masked
// here exactly like a source excerpt is (C9) — never stored as typed.
function writeEntry(dir, entry) {
  const masked = {
    ...entry,
    statement: redactSecrets(entry.statement),
    why: entry.why ? redactSecrets(entry.why) : entry.why,
    history: (entry.history || []).map((h) => ({
      ...h,
      ...(h.statement != null ? { statement: redactSecrets(h.statement) } : {}),
      ...(h.why != null ? { why: redactSecrets(h.why) } : {}),
    })),
  };
  // Defence in depth (C5): `buildSource` already redacts and caps every excerpt before
  // it reaches an entry object, but this is the one place ANY entry reaches disk, so a
  // sighting's excerpt is masked again here too.
  if (entry.sightings) {
    masked.sightings = entry.sightings.map((s) => (
      s.excerpt != null ? { ...s, excerpt: redactSecrets(s.excerpt) } : s
    ));
  }
  atomicWriteText(entryFile(dir, entry.id), renderPrinciple(masked));
}

/**
 * On an existing file with this id (damaged or not — `existsSync`, never parse) append
 * `-2`, `-3`, … exactly as `addBacklog` does (P5).
 */
function uniqueId(dir, id) {
  let candidate = id;
  let n = 2;
  while (existsSync(entryFile(dir, candidate))) {
    candidate = `${id}-${n}`;
    n += 1;
  }
  return candidate;
}

/**
 * Read the store, distinguishing "nobody has written a principle yet" from "one file is
 * damaged" — the strict-reader shape from `lib/backlog.mjs`/`lib/debt.mjs`, transplanted
 * here so a corrupt entry is never silently dropped from the list. An ABSENT dir is a
 * true empty store and creates nothing (P2); reads only top-level `*.md` files, never
 * `conflicts/` (that is `lib/principlesync.mjs`'s territory, P9).
 */
export function loadPrinciples(dir) {
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    if (e?.code === 'ENOENT') return { entries: [], damaged: [] };
    throw new Error(`cannot read the principle store ${dir}: ${e?.message || e}`);
  }

  const entries = [];
  const damaged = [];
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.endsWith('.md')) continue;
    const id = dirent.name.slice(0, -3);
    const file = join(dir, dirent.name);
    const text = readFileSync(file, 'utf8');
    try {
      entries.push(parsePrinciple(text, { file, id }));
    } catch (e) {
      damaged.push({ id, file, error: e.message });
    }
  }
  entries.sort((a, b) => a.id.localeCompare(b.id));
  damaged.sort((a, b) => a.id.localeCompare(b.id));
  return { entries, damaged };
}

/** Re-read one entry by its EXACT id, strictly (damaged → throw naming file + problem). */
function readEntryStrict(dir, id) {
  const file = entryFile(dir, id);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') throw new Error(`no such principle: ${id}`);
    throw new Error(`cannot read principle ${id}: ${e?.message || e}`);
  }
  return parsePrinciple(text, { file, id });
}

/**
 * Resolve a reference the way a human types it (P5): an exact id wins; otherwise the
 * unique id starting with the ref; several candidates → error naming them all; none →
 * error. Damaged files' ids are included in the candidate set, so `show <damaged-id>`
 * reports the damage instead of claiming "not found".
 */
export function resolvePrinciple(dir, ref) {
  const clean = String(ref || '').trim();
  if (!clean) throw new Error('a principle reference is required');

  const { entries, damaged } = loadPrinciples(dir);

  const exact = entries.find((e) => e.id === clean);
  if (exact) return exact;
  const exactDamaged = damaged.find((d) => d.id === clean);
  if (exactDamaged) throw new Error(exactDamaged.error);

  const candidates = [
    ...entries.map((e) => ({ id: e.id, entry: e })),
    ...damaged.map((d) => ({ id: d.id, damaged: d })),
  ].filter((c) => c.id.startsWith(clean));

  if (candidates.length === 0) throw new Error(`no principle found matching "${clean}"`);
  if (candidates.length > 1) {
    throw new Error(`ambiguous principle reference "${clean}" matches: ${candidates.map((c) => c.id).join(', ')}`);
  }
  const [only] = candidates;
  if (only.damaged) throw new Error(only.damaged.error);
  return only.entry;
}

/** `cannot <verb> principle "<id>" — it is <status> (legal move: <legal>)`, P4's rule. */
function illegalMove(entry, verb, legal) {
  return new Error(`cannot ${verb} principle "${entry.id}" — it is ${entry.status} (legal move: ${legal})`);
}

/**
 * Build the `source` header value (P7): redact-then-truncate the excerpt (never the
 * reverse — see `lib/redact.mjs`'s module header, a truncate-first order could cut a
 * matched secret into an unmatched, unmasked fragment), `at` defaults to now whenever
 * any field is given. Returns `undefined` when nothing was passed, so the `source:`
 * header line is omitted rather than written empty.
 */
function buildSource(source, now) {
  if (!source) return undefined;
  const { session, project, ref, excerpt, at } = source;
  if (!session && !project && !ref && !excerpt) return undefined;

  const out = {};
  if (session) out.session = session;
  if (project) out.project = project;
  out.at = at || now.toISOString();
  if (ref) out.ref = ref;
  if (excerpt) {
    const masked = redactSecrets(excerpt);
    out.excerpt = masked.length > EXCERPT_MAX_CHARS ? masked.slice(0, EXCERPT_MAX_CHARS) : masked;
  }
  return out;
}

/**
 * Append a sighting to the entry `startId` names, following `mergedInto` to its
 * survivor first (a visited set guards against a cycle; a missing merge target stops at
 * the merged entry itself). Called only while the lock is held — the one place an
 * already-read entry is written back with one more sighting appended. Returns the final
 * entry and, when the append landed somewhere other than `startId`, `redirectedFrom`.
 */
function appendSighting(dir, startId, sighting) {
  let current = readEntryStrict(dir, startId);
  const visited = new Set([current.id]);
  while (current.status === 'merged' && current.mergedInto && !visited.has(current.mergedInto)) {
    let next;
    try {
      next = readEntryStrict(dir, current.mergedInto);
    } catch {
      break;
    }
    visited.add(next.id);
    current = next;
  }
  const next = { ...current, sightings: [...(current.sightings || []), sighting] };
  writeEntry(dir, next);
  return { entry: next, redirectedFrom: current.id !== startId ? startId : undefined };
}

/**
 * Add a principle. `propose: true` delegates to `proposePrinciple` (D7: manual add is
 * accepted directly; `--propose` queues it instead — the review queue exists for what
 * the MACHINE proposes, not what a human typed). Validates and normalises fields BEFORE
 * touching the filesystem, so an invalid kind/strength/work throws with the store
 * untouched (C2) — `mkdirSync` only runs once validation has already passed (P2).
 */
export async function addPrinciple(dir, {
  statement, kind, strength = 'default', why = '',
  stack = [], files = [], work = [], source, propose = false, now = new Date(),
} = {}) {
  const fields = normaliseFields({ kind, strength, stack, files, work, statement, why });

  if (propose) {
    const result = await proposePrinciple(dir, {
      statement: fields.statement, kind: fields.kind, strength: fields.strength, why: fields.why,
      stack: fields.scopes.stack, files: fields.scopes.files, work: fields.scopes.work,
      source, now,
    });
    return result.entry;
  }

  const built = buildSource(source, now);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const id = uniqueId(dir, principleId(fields.statement, now));
    const entry = {
      id, kind: fields.kind, strength: fields.strength, status: 'accepted',
      created: now.toISOString(), scopes: fields.scopes,
      statement: fields.statement, why: fields.why,
      promotions: [], history: [{ action: 'accepted', at: now.toISOString() }],
    };
    if (built) entry.source = built;
    writeEntry(dir, entry);
    return entry;
  });
}

/**
 * Queue a machine proposal (P6, ADR-058, D2). Without `id`, an EXACT repeat of any
 * existing entry's statement (any status) records a sighting on it instead of minting a
 * fresh proposal — see the module header's "why an exact repeat records a sighting"
 * paragraph; an overlap-only candidate is never acted on here, only surfaced via
 * `matchPrinciple` (D1). With no exact hit it creates the proposal exactly as before.
 * With `id`, it rewrites that entry ONLY if it is still `proposed` and its history
 * holds no `edited`/`amended` action — otherwise it returns `{ ok: false, reason }` and
 * writes nothing. No propose path can ever yield `accepted`.
 */
export async function proposePrinciple(dir, {
  id, statement, kind, strength = 'default', why = '',
  stack = [], files = [], work = [], source, now = new Date(),
} = {}) {
  const fields = normaliseFields({ kind, strength, stack, files, work, statement, why });
  const built = buildSource(source, now);

  if (id) {
    // A refresh keeps re-stating the SAME still-open observation (D3/phase 26), so an
    // omitted why here means "unchanged", not "none" — the create-only check below
    // would otherwise force every refresh call site to repeat a why it already gave.
    mkdirSync(dir, { recursive: true });
    return withLock(join(dir, '.lock'), () => {
      let entry;
      try {
        entry = readEntryStrict(dir, id);
      } catch (e) {
        return { ok: false, reason: e.message };
      }
      if (entry.status !== 'proposed') {
        return { ok: false, reason: `principle "${id}" is ${entry.status}, not proposed` };
      }
      const touched = entry.history.some((h) => h.action === 'edited' || h.action === 'amended');
      if (touched) {
        return { ok: false, reason: `principle "${id}" was edited by a human and will not be refreshed` };
      }
      const next = {
        ...entry,
        kind: fields.kind, strength: fields.strength, statement: fields.statement, why: fields.why,
        scopes: fields.scopes,
        source: built !== undefined ? built : entry.source,
        history: [...entry.history, { action: 'refreshed', at: now.toISOString() }],
      };
      writeEntry(dir, next);
      return { ok: true, entry: next, refreshed: true };
    });
  }

  // Propose-time dedupe (D2, C1): the read that decides "exact match or fresh entry"
  // must happen INSIDE the same locked section as the write it feeds, or two proposals
  // racing on the identical statement both read "no match yet" and both mint a fresh
  // entry (phase-24 remediation: `git log` for the "race rule" duplicate-entry bug this
  // closes). The lone exception is a genuinely absent store with no why: `loadPrinciples`
  // already tolerates that without creating it, so a fresh statement that needs no dedupe
  // and fails the why check below still leaves the store untouched (C2) — checked here,
  // before any `mkdirSync`, precisely because an absent dir can hold no exact match.
  if (!existsSync(dir) && !fields.why) {
    throw new Error('a principle proposal requires a why (D4)');
  }

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    // `findCandidates` is run against the REDACTED statement, matching what is already
    // on disk (also redacted).
    const { entries } = loadPrinciples(dir);
    const { exact } = findCandidates(entries, redactSecrets(fields.statement));
    if (exact.length) {
      const target = pickExactTarget(exact);
      const sighting = built ?? { at: now.toISOString() };
      const { entry } = appendSighting(dir, target.id, sighting);
      return {
        ok: true, entry, created: false, sighted: true, refreshed: false,
        matched: { id: entry.id, status: entry.status },
      };
    }

    // D4b (CRITERIA C5): a fresh proposal without a why carries nothing for a human
    // reviewer to judge it by, so it is refused. Scoped to a FRESH proposal only: a
    // plain `add` (propose:false, D7) is a human typing directly and is not subject to
    // the review rules, and a refresh (id present, above) is re-stating an observation
    // that already carried one.
    if (!fields.why) throw new Error('a principle proposal requires a why (D4)');

    const newId = uniqueId(dir, principleId(fields.statement, now));
    const entry = {
      id: newId, kind: fields.kind, strength: fields.strength, status: 'proposed',
      created: now.toISOString(), scopes: fields.scopes,
      statement: fields.statement, why: fields.why,
      promotions: [], history: [],
    };
    if (built) entry.source = built;
    writeEntry(dir, entry);
    return { ok: true, entry, created: true, sighted: false, refreshed: false };
  });
}

/**
 * Record an explicit sighting on a named entry (P5, D1/C13) — for when an agent judged
 * an OVERLAP-only candidate (surfaced by `matchPrinciple`, never acted on automatically)
 * to be the same principle after all. Resolves the ref, then appends under the lock,
 * following `mergedInto` exactly like the exact-dedupe path does. Any status is
 * allowed, and it only ever appends evidence — text, status and history are untouched.
 */
export async function recordSighting(dir, ref, { source, now = new Date() } = {}) {
  const target = resolvePrinciple(dir, ref);
  const built = buildSource(source, now);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const sighting = built ?? { at: now.toISOString() };
    return appendSighting(dir, target.id, sighting);
  });
}

/**
 * Read-only: every exact and overlap candidate a statement has against the current
 * store (P5, P1). Never writes, never takes the lock.
 */
export function matchPrinciple(dir, statement) {
  const { entries } = loadPrinciples(dir);
  return findCandidates(entries, redactSecrets(String(statement ?? '')));
}

/**
 * `proposed → accepted`. A reworded statement/why records an `edited` history line
 * carrying the PRIOR text (P4/P8), followed by an `accepted` line — the edit and the
 * acceptance both happened, and dropping the `accepted` line hid WHEN it was accepted
 * (D7, closes debt 2026-09-24-accept-statement-edit-records-only-an). A plain
 * acceptance still records only `accepted`.
 */
export async function acceptPrinciple(dir, ref, { statement, why, now = new Date() } = {}) {
  const hasStatement = statement !== undefined;
  const hasWhy = why !== undefined;
  const newStatement = hasStatement ? String(statement).trim() : undefined;
  if (hasStatement && (!newStatement || newStatement.includes('\n'))) {
    throw new Error('statement must be a single non-empty line');
  }
  const newWhy = hasWhy ? String(why).trim() : undefined;

  const target = resolvePrinciple(dir, ref);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'proposed') throw illegalMove(entry, 'accept', 'proposed → accepted');

    const reworded = hasStatement || hasWhy;
    const prior = { statement: entry.statement, why: entry.why };
    const next = {
      ...entry,
      statement: hasStatement ? newStatement : entry.statement,
      why: hasWhy ? newWhy : entry.why,
      status: 'accepted',
      history: reworded
        ? [...entry.history,
            { action: 'edited', at: now.toISOString(), statement: prior.statement, why: prior.why },
            { action: 'accepted', at: now.toISOString() }]
        : [...entry.history, { action: 'accepted', at: now.toISOString() }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/** `proposed → rejected`, reason required. Rejections are KEPT (see module header). */
export async function rejectPrinciple(dir, ref, { reason, now = new Date() } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('rejecting a principle needs a reason');

  const target = resolvePrinciple(dir, ref);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'proposed') throw illegalMove(entry, 'reject', 'proposed → rejected');

    const next = {
      ...entry, status: 'rejected', reason: clean,
      history: [...entry.history, { action: 'rejected', at: now.toISOString(), reason: clean }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/** `accepted → retired`, reason required. */
export async function retirePrinciple(dir, ref, { reason, now = new Date() } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('retiring a principle needs a reason');

  const target = resolvePrinciple(dir, ref);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'accepted') throw illegalMove(entry, 'retire', 'accepted → retired');

    const next = {
      ...entry, status: 'retired', reason: clean,
      history: [...entry.history, { action: 'retired', at: now.toISOString(), reason: clean }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/** `accepted → superseded` by an existing, DIFFERENT, accepted entry. */
export async function supersedePrinciple(dir, ref, { by, now = new Date() } = {}) {
  const byClean = String(by || '').trim();
  if (!byClean) throw new Error('supersede needs --by <id>');

  const target = resolvePrinciple(dir, ref);
  const other = resolvePrinciple(dir, byClean);
  if (other.id === target.id) throw new Error(`a principle cannot supersede itself (${target.id})`);
  if (other.status !== 'accepted') {
    throw new Error(`cannot supersede by "${other.id}" — it is ${other.status}, not accepted`);
  }

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'accepted') throw illegalMove(entry, 'supersede', 'accepted → superseded');

    const otherEntry = readEntryStrict(dir, other.id);
    if (otherEntry.status !== 'accepted') {
      throw new Error(`cannot supersede by "${otherEntry.id}" — it is ${otherEntry.status}, not accepted`);
    }

    const next = {
      ...entry, status: 'superseded', supersededBy: other.id,
      history: [...entry.history, { action: 'superseded', at: now.toISOString(), by: other.id }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/**
 * `accepted → accepted`: reword or rescope an accepted entry without changing its id.
 * Reason required; must change at least one field; records an `amended` history line
 * carrying the PRIOR statement/why (P4).
 */
export async function amendPrinciple(dir, ref, {
  reason, statement, why, kind, strength, stack, files, work, now = new Date(),
} = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('amending a principle needs a reason');

  const target = resolvePrinciple(dir, ref);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'accepted') throw illegalMove(entry, 'amend', 'accepted → accepted');

    const fields = normaliseFields({
      kind: kind ?? entry.kind,
      strength: strength ?? entry.strength,
      stack: stack ?? entry.scopes.stack,
      files: files ?? entry.scopes.files,
      work: work ?? entry.scopes.work,
      statement: statement ?? entry.statement,
      why: why ?? entry.why,
    });

    const changed = fields.kind !== entry.kind
      || fields.strength !== entry.strength
      || fields.statement !== entry.statement
      || fields.why !== entry.why
      || JSON.stringify(fields.scopes) !== JSON.stringify(entry.scopes);
    if (!changed) throw new Error(`amend must change at least one field on principle "${entry.id}"`);

    const prior = { statement: entry.statement, why: entry.why };
    const next = {
      ...entry,
      kind: fields.kind, strength: fields.strength, statement: fields.statement, why: fields.why,
      scopes: fields.scopes,
      history: [...entry.history, {
        action: 'amended', at: now.toISOString(), reason: clean,
        statement: prior.statement, why: prior.why,
      }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/**
 * Record a promotion into a project's canon (D8, P13). Requires `accepted`; appends a
 * `promotion:` line AND one `promoted` history line — an identical `project`+`as`+`ref`
 * record already present is not duplicated (and nothing is written on a repeat). The
 * entry itself stays `accepted` — it still applies in every other project.
 */
export async function recordPromotion(dir, ref, { project, path, as, ref: target, now = new Date() } = {}) {
  if (!String(project || '').trim()) throw new Error('recordPromotion needs a project');
  if (!String(path || '').trim()) throw new Error('recordPromotion needs a path');
  if (!String(as || '').trim()) throw new Error('recordPromotion needs "as" (decision|convention)');
  if (!String(target || '').trim()) throw new Error('recordPromotion needs a ref (ADR id or "convention")');

  const found = resolvePrinciple(dir, ref);
  if (found.status !== 'accepted') {
    throw new Error(`principle "${found.id}" is ${found.status} — only an accepted principle can be promoted`);
  }

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, found.id);
    if (entry.status !== 'accepted') {
      throw new Error(`principle "${entry.id}" is ${entry.status} — only an accepted principle can be promoted`);
    }

    const already = entry.promotions.some((p) => p.project === project && p.as === as && p.ref === target);
    if (already) return entry;

    const at = now.toISOString();
    const next = {
      ...entry,
      promotions: [...entry.promotions, { project, path, as, ref: target, at }],
      history: [...entry.history, { action: 'promoted', at, project, as, ref: target }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/**
 * `rejected → proposed` (P5, D5, C6) — the only way back from rejected. A reason is
 * required, exactly like reject/retire/amend: reopening a rejected principle is itself
 * a judgement call a human makes, not something a re-observation should do silently.
 * Deletes `reason` (the status invariant every other status already enforces), keeps
 * the earlier `rejected` history line, appends a `reopened` one carrying the reason,
 * and keeps every sighting and the same id — a reopened entry is the SAME entry,
 * re-entering the queue, not a fresh proposal.
 */
export async function reopenPrinciple(dir, ref, { reason, now = new Date() } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) throw new Error('reopening a principle needs a reason');

  const target = resolvePrinciple(dir, ref);
  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const entry = readEntryStrict(dir, target.id);
    if (entry.status !== 'rejected') throw illegalMove(entry, 'reopen', 'rejected → proposed');

    const { reason: _drop, ...rest } = entry;
    const next = {
      ...rest, status: 'proposed',
      history: [...entry.history, { action: 'reopened', at: now.toISOString(), reason: clean }],
    };
    writeEntry(dir, next);
    return next;
  });
}

/**
 * Fold a proposed duplicate into a survivor (P5, D6, C7). The duplicate must be
 * `proposed`; the survivor must be `proposed` or `accepted`. Under ONE lock, both
 * statuses are re-checked, then the SURVIVOR is written FIRST — carrying the
 * duplicate's own source (or its `created` time, when it had none) plus every sighting
 * it already had, each tagged `mergedFrom: <duplicate id>` — and only then is the
 * duplicate itself written as `merged`. Writing the survivor first means a crash
 * between the two writes can only DUPLICATE evidence on a retry, never lose it. Nothing
 * is deleted: both ids stay citable, and a later exact re-proposal of the duplicate's
 * wording redirects to the survivor via its `mergedInto` (see `appendSighting`), never
 * treated as a rejection.
 */
export async function mergePrinciple(dir, ref, { into, now = new Date() } = {}) {
  const intoClean = String(into || '').trim();
  if (!intoClean) throw new Error('merge needs --into <id>');

  const dup = resolvePrinciple(dir, ref);
  const survivor = resolvePrinciple(dir, intoClean);
  if (survivor.id === dup.id) throw new Error('a principle cannot be merged into itself');

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const dupEntry = readEntryStrict(dir, dup.id);
    if (dupEntry.status !== 'proposed') throw illegalMove(dupEntry, 'merge', 'proposed → merged');

    const survivorEntry = readEntryStrict(dir, survivor.id);
    if (survivorEntry.status !== 'proposed' && survivorEntry.status !== 'accepted') {
      throw new Error(`cannot merge into "${survivorEntry.id}" — it is ${survivorEntry.status} (a survivor must be proposed or accepted)`);
    }

    const at = now.toISOString();
    const folded = [
      { ...(dupEntry.source ?? { at: dupEntry.created }), mergedFrom: dupEntry.id },
      ...(dupEntry.sightings ?? []).map((s) => ({ ...s, mergedFrom: dupEntry.id })),
    ];
    const nextSurvivor = { ...survivorEntry, sightings: [...(survivorEntry.sightings ?? []), ...folded] };
    writeEntry(dir, nextSurvivor);

    const nextDup = {
      ...dupEntry, status: 'merged', mergedInto: survivorEntry.id,
      history: [...dupEntry.history, { action: 'merged', at, into: survivorEntry.id }],
    };
    writeEntry(dir, nextDup);

    return { survivor: nextSurvivor, merged: nextDup };
  });
}

/**
 * Bulk-import a forge export (phase 27, P5, D3/D4, ADR-058). Parses+validates `text`
 * BEFORE touching the filesystem at all (`lib/principleimport.mjs`'s `parseForgeExport`
 * throws on anything wrong — no `mkdirSync`, no lock, nothing written), so a bad file
 * never leaves the store half-imported. Inside the ONE lock this holds, the store is
 * re-read strictly: any damaged entry refuses the WHOLE import (a damaged file might be
 * the one carrying a slug's key, and importing past it risks minting a twin the next
 * damaged-file fix would then have to untangle). `planForgeImport` (pure) decides what to
 * create/sight/leave unchanged; this function is the only place that decision is written
 * — creations first, then sighted entries — through the same `writeEntry` (and its
 * redaction) every other writer in this module uses. This is the one BULK writer here:
 * every other function changes one entry, this one may change many, and it is
 * all-or-nothing at the parse boundary but NOT transactional across writes — a crash
 * mid-import can leave a partial set of files, exactly like a crash mid-sync could; the
 * idempotent re-run (P4) is what recovers it, not a rollback. It never refreshes a KNOWN
 * entry's own fields — see `lib/principleimport.mjs`'s module header.
 *
 * @param {string} dir
 * @param {string} text — the forge export document, unparsed
 * @param {{ now?: Date }} [opts]
 * @returns {{ created: object[], sighted: object[], unchanged: string[], counts: object }}
 */
export async function importForgeExport(dir, text, { now = new Date() } = {}) {
  // Parse+validate happens BEFORE any fs call — a malformed export must never create the
  // store directory or take the lock (C6: a store dir that did not exist stays absent).
  const doc = parseForgeExport(text);

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const { entries, damaged } = loadPrinciples(dir);
    if (damaged.length) {
      const names = damaged.map((d) => d.file).join(', ');
      throw new Error(`cannot import — ${damaged.length} damaged principle file(s) must be fixed first: ${names}`);
    }

    // Two creations in one run must never draw the same id: `uniqueId` alone only checks
    // the FILESYSTEM, and neither creation has been written yet when `planForgeImport`
    // mints them (it plans everything before this function writes anything), so a shared
    // dated-slug prefix could otherwise collide silently. `usedIds` closes that gap.
    const usedIds = new Set();
    const idFor = (statement) => {
      let candidate = uniqueId(dir, principleId(statement, now));
      while (usedIds.has(candidate)) candidate = uniqueId(dir, `${candidate}-x`);
      usedIds.add(candidate);
      return candidate;
    };

    const plan = planForgeImport(entries, doc, { now, idFor });

    for (const c of plan.created) writeEntry(dir, c.entry);
    for (const s of plan.sighted) {
      const current = readEntryStrict(dir, s.id);
      // Route every sighting through `buildSource` — the same redact-then-cap shape
      // every native sighting gets (C2) — even though `lib/principleimport.mjs` already
      // redacted+capped once; this is the one place ANY entry reaches disk (see
      // `writeEntry`'s own comment), so doing it again here is defence in depth, not
      // redundant work skipped.
      const appended = s.sightings.map((sig) => buildSource(sig, now) ?? sig);
      writeEntry(dir, { ...current, sightings: [...(current.sightings ?? []), ...appended] });
    }

    return { created: plan.created, sighted: plan.sighted, unchanged: plan.unchanged, counts: plan.counts };
  });
}
