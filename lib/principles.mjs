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
// proposal from being re-surfaced later (dedupe itself is phase 24's job).
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
import { join } from 'node:path';
import { datedId } from './fixes.mjs';
import { withLock, atomicWriteText } from './util.mjs';
import { redactSecrets } from './redact.mjs';
import { parsePrinciple, renderPrinciple, normaliseFields } from './principlemd.mjs';

/** An excerpt is redacted first, then capped — see `lib/redact.mjs`'s module header. */
const EXCERPT_MAX_CHARS = 500;

/**
 * The store directory (D1). `ASTRO_PRINCIPLES_DIR` wins over the default
 * `$HOME/.astro/principles`, so tests never touch a developer's real home.
 */
export function principlesDir(env = process.env) {
  return env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles');
}

/** A dated slug id for a principle statement (P5, ADR-013). */
export function principleId(statement, now = new Date()) {
  return datedId(statement, now, 40, 'principle');
}

/** `<dir>/<id>.md` for a given id — the only place this module builds that path. */
function entryFile(dir, id) {
  return join(dir, `${id}.md`);
}

function writeEntry(dir, entry) {
  atomicWriteText(entryFile(dir, entry.id), renderPrinciple(entry));
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
 * Queue a machine proposal (P6, ADR-058). Without `id` this always creates a fresh
 * `proposed` entry (dedupe is phase 24's job). With `id`, it rewrites that entry ONLY
 * if it is still `proposed` and its history holds no `edited`/`amended` action —
 * otherwise it returns `{ ok: false, reason }` and writes nothing. No propose path can
 * ever yield `accepted`.
 */
export async function proposePrinciple(dir, {
  id, statement, kind, strength = 'default', why = '',
  stack = [], files = [], work = [], source, now = new Date(),
} = {}) {
  const fields = normaliseFields({ kind, strength, stack, files, work, statement, why });
  const built = buildSource(source, now);

  if (id) {
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

  mkdirSync(dir, { recursive: true });
  return withLock(join(dir, '.lock'), () => {
    const newId = uniqueId(dir, principleId(fields.statement, now));
    const entry = {
      id: newId, kind: fields.kind, strength: fields.strength, status: 'proposed',
      created: now.toISOString(), scopes: fields.scopes,
      statement: fields.statement, why: fields.why,
      promotions: [], history: [],
    };
    if (built) entry.source = built;
    writeEntry(dir, entry);
    return { ok: true, entry, refreshed: false };
  });
}

/**
 * `proposed → accepted`. A reworded statement/why records an `edited` history line
 * carrying the PRIOR text (P4/P8) — plain acceptance records `accepted` instead.
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
      history: [...entry.history, reworded
        ? { action: 'edited', at: now.toISOString(), statement: prior.statement, why: prior.why }
        : { action: 'accepted', at: now.toISOString() }],
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
