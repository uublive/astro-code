// Pure export parser + import planner for bringing an existing forge principle graph
// into the personal store (phase 27, P1–P5, D3/D4, ADR-053/058). No fs, no git, no MCP:
// `parseForgeExport` turns text into a validated document or throws; `planForgeImport`
// turns that document plus the store's current entries into a plan the store writer
// (`lib/principles.mjs`'s `importForgeExport`, t4) can apply under one lock. Neither
// function ever writes anything — the store is the only writer (ADR-057).
//
// ## Why a strict, versioned envelope — never a lenient "ignore what I don't recognise"
//
// A silent drop is data loss the human never sees: a forge maintainer who added a field
// this parser doesn't know about would watch their export "work" while astro-code quietly
// discarded part of it. Refusing outright on an unknown key, wrong type, or bad enum value
// turns that into a loud failure at import time instead, and an intentional field addition
// becomes a v2 of `templates/FORGE-EXPORT.md`, never a silent extension of v1.
//
// ## Why the whole file is validated before anything is planned (C6, all-or-nothing)
//
// `parseForgeExport` runs to completion (or throws) with no side effects at all; the store
// writer calls it BEFORE touching the filesystem. A half-imported forge export (some nodes
// landed, one blew up partway through) would leave the store in a state no human asked
// for and no re-run could cleanly recover from — refusing the whole file is strictly safer
// than guessing which half was trustworthy.
//
// ## Why re-import only ever appends evidence, never overrides a human decision (ADR-058)
//
// The human's decision inside astro-code — accept, reject, edit, amend — outranks
// whatever forge says on a LATER export of the same slug. `planForgeImport`'s "known slug"
// path (P4 step 1) therefore never touches status, statement, why, reason, scopes or
// history on an entry it already recognises: it only appends the signals it has not seen
// before, keyed by `forgeSignalKey` so a re-run of the identical file is a no-op.
//
// ## Why exact-only dedupe, never overlap (ADR-053 precedent)
//
// A similarity-driven auto-merge has already destroyed data once in this codebase
// (ADR-053's rationale). `planForgeImport` reuses `lib/principlematch.mjs`'s
// `sameStatement`/`findCandidates` — normalised string equality only — to decide whether
// an unknown slug is really a principle already captured (natively or via an earlier
// import); an overlap-only candidate is never acted on here, exactly like the review
// workflow's own propose-time dedupe.
//
// ## Why a signal's key hashes the RAW signal, not the redacted/capped excerpt
//
// The key exists so a re-run recognises "I already imported this exact signal" even
// before redaction/truncation happens at write time (which is the store's job, not this
// pure module's) — hashing the raw `[slug, text, source, at]` tuple means the key is
// stable across a re-run regardless of what the write path later does to the text.

import { createHash } from 'node:crypto';
import { KINDS } from './principlemd.mjs';
import { findCandidates, pickExactTarget, sameStatement } from './principlematch.mjs';
import { redactSecrets } from './redact.mjs';

/** The exact envelope format string this module accepts. */
export const FORGE_EXPORT_FORMAT = 'astro-forge-export';

/** The exact envelope version this module accepts (a change here is a v2 document). */
export const FORGE_EXPORT_VERSION = 1;

/** Forge node `type` → this store's `kind` (P2, 1:1 mapping). */
export const FORGE_TYPES = Object.freeze({
  Principle: 'principle',
  Pattern: 'pattern',
  AntiPattern: 'antipattern',
  Preference: 'preference',
});
// Never let the two kind vocabularies drift apart silently — a `lib/principlemd.mjs`
// rename would otherwise leave this map minting entries with a kind nothing recognises.
for (const kind of Object.values(FORGE_TYPES)) {
  if (!KINDS.includes(kind)) throw new Error(`principleimport: FORGE_TYPES maps to unknown kind ${JSON.stringify(kind)}`);
}

/** Forge node `status` values this module accepts. */
export const FORGE_STATUSES = Object.freeze(['approved', 'pending', 'rejected', 'superseded']);

/** Top-level keys the envelope may carry — anything else is refused. */
export const FORGE_ENVELOPE_KEYS = Object.freeze(['format', 'version', 'exported_at', 'nodes']);

/** Keys a node object may carry — anything else is refused. */
export const FORGE_NODE_KEYS = Object.freeze([
  'slug', 'type', 'name', 'statement', 'why', 'status', 'confidence',
  'created', 'reason', 'superseded_by', 'signals',
]);

/** Keys a signal object may carry — anything else is refused. */
export const FORGE_SIGNAL_KEYS = Object.freeze(['text', 'source', 'at']);

const SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CONFIDENCES = ['low', 'normal'];

// Redact-then-cap mirrors `lib/principles.mjs`'s `buildSource` exactly (C2: an imported
// sighting's excerpt must equal what the native capture path would have stored for the
// same text). Kept as its own small constant here rather than imported, because
// `lib/principles.mjs` imports THIS module (P5) — importing back would cycle.
const EXCERPT_MAX_CHARS = 500;

function problem(where, msg) {
  return new Error(`forge export ${where}: ${msg}`);
}

function assertNoUnknownKeys(obj, allowed, where) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) throw problem(where, `unknown key ${JSON.stringify(key)}`);
  }
}

function collapseWhitespace(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Parse+validate forge export text into `{ format, version, exported_at, nodes }` with
 * every node's `statement` whitespace-collapsed, or throw naming the exact problem (P1).
 * Pure — no I/O, no defaults invented for a missing required field.
 *
 * @param {string} text
 * @returns {{ format: string, version: number, exported_at: string, nodes: object[] }}
 */
export function parseForgeExport(text) {
  let doc;
  try {
    doc = JSON.parse(String(text ?? ''));
  } catch (e) {
    throw problem('<document>', `is not valid JSON: ${e.message}`);
  }

  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    throw problem('<document>', 'top-level document must be a JSON object, not an array or scalar');
  }
  assertNoUnknownKeys(doc, FORGE_ENVELOPE_KEYS, '<document>');

  if (doc.format !== FORGE_EXPORT_FORMAT) {
    throw problem('<document>', `format must be ${JSON.stringify(FORGE_EXPORT_FORMAT)}, got ${JSON.stringify(doc.format)}`);
  }
  if (doc.version !== FORGE_EXPORT_VERSION) {
    throw problem('<document>', `version must be ${FORGE_EXPORT_VERSION}, got ${JSON.stringify(doc.version)}`);
  }
  if (typeof doc.exported_at !== 'string' || !doc.exported_at.trim()) {
    throw problem('<document>', 'exported_at must be a non-empty ISO-8601 string');
  }
  if (!Array.isArray(doc.nodes)) throw problem('<document>', 'nodes must be an array');

  const seenSlugs = new Set();
  const nodes = doc.nodes.map((raw, i) => {
    const where = `nodes[${i}]`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw problem(where, 'must be a JSON object');
    }
    assertNoUnknownKeys(raw, FORGE_NODE_KEYS, where);

    const slug = raw.slug;
    if (typeof slug !== 'string' || !slug.trim()) throw problem(where, 'missing required field "slug"');
    if (!SLUG_RE.test(slug)) throw problem(where, `invalid slug ${JSON.stringify(slug)} (must match ${SLUG_RE})`);
    if (seenSlugs.has(slug)) throw problem(where, `duplicate slug ${JSON.stringify(slug)}`);
    seenSlugs.add(slug);

    const type = raw.type;
    if (!Object.prototype.hasOwnProperty.call(FORGE_TYPES, type)) {
      throw problem(`${where} (${slug})`, `unknown type ${JSON.stringify(type)} (expected one of ${Object.keys(FORGE_TYPES).join(', ')})`);
    }

    const rawStatement = raw.statement;
    if (typeof rawStatement !== 'string') throw problem(`${where} (${slug})`, 'missing required field "statement"');
    const statement = collapseWhitespace(rawStatement);
    if (!statement) throw problem(`${where} (${slug})`, 'statement must not be empty');

    const status = raw.status;
    if (!FORGE_STATUSES.includes(status)) {
      throw problem(`${where} (${slug})`, `unknown status ${JSON.stringify(status)} (expected one of ${FORGE_STATUSES.join(', ')})`);
    }

    if (raw.name !== undefined && typeof raw.name !== 'string') throw problem(`${where} (${slug})`, '"name" must be a string');
    if (raw.why !== undefined && typeof raw.why !== 'string') throw problem(`${where} (${slug})`, '"why" must be a string');
    if (raw.created !== undefined && typeof raw.created !== 'string') throw problem(`${where} (${slug})`, '"created" must be a string');

    if (raw.confidence !== undefined && !CONFIDENCES.includes(raw.confidence)) {
      throw problem(`${where} (${slug})`, `"confidence" must be one of ${CONFIDENCES.join(', ')}`);
    }

    if (raw.reason !== undefined) {
      if (typeof raw.reason !== 'string' || !raw.reason.trim()) throw problem(`${where} (${slug})`, '"reason" must be a non-empty string');
      if (status !== 'rejected') throw problem(`${where} (${slug})`, `"reason" is only valid with status "rejected" (got ${JSON.stringify(status)})`);
    }

    if (raw.superseded_by !== undefined) {
      if (typeof raw.superseded_by !== 'string' || !raw.superseded_by.trim()) {
        throw problem(`${where} (${slug})`, '"superseded_by" must be a non-empty string');
      }
      if (status !== 'superseded') {
        throw problem(`${where} (${slug})`, `"superseded_by" is only valid with status "superseded" (got ${JSON.stringify(status)})`);
      }
      if (raw.superseded_by === slug) throw problem(`${where} (${slug})`, 'a node cannot supersede itself');
    }

    let signals = [];
    if (raw.signals !== undefined) {
      if (!Array.isArray(raw.signals)) throw problem(`${where} (${slug})`, '"signals" must be an array');
      signals = raw.signals.map((rawSig, j) => {
        const sigWhere = `${where}.signals[${j}] (${slug})`;
        if (typeof rawSig !== 'object' || rawSig === null || Array.isArray(rawSig)) {
          throw problem(sigWhere, 'must be a JSON object');
        }
        assertNoUnknownKeys(rawSig, FORGE_SIGNAL_KEYS, sigWhere);
        if (typeof rawSig.text !== 'string' || !rawSig.text.trim()) {
          throw problem(sigWhere, 'missing required field "text"');
        }
        if (rawSig.source !== undefined && typeof rawSig.source !== 'string') throw problem(sigWhere, '"source" must be a string');
        if (rawSig.at !== undefined && typeof rawSig.at !== 'string') throw problem(sigWhere, '"at" must be a string');
        return { text: rawSig.text, source: rawSig.source, at: rawSig.at };
      });
    }

    return {
      slug, type, name: raw.name, statement, why: raw.why, status,
      confidence: raw.confidence, created: raw.created, reason: raw.reason,
      superseded_by: raw.superseded_by, signals,
    };
  });

  return { format: doc.format, version: doc.version, exported_at: doc.exported_at, nodes };
}

/**
 * A stable key for one forge signal, hashed over the RAW `[slug, text, source, at]`
 * tuple — see the module header's "why the raw signal" paragraph. First 10 hex chars of
 * a sha1 digest: short enough to read in a `ref:`, long enough that a collision within
 * one entry's signals is not a practical concern.
 *
 * @param {string} slug
 * @param {{ text: string, source?: string, at?: string }} signal
 * @returns {string}
 */
export function forgeSignalKey(slug, signal) {
  const { text, source, at } = signal;
  return createHash('sha1')
    .update(JSON.stringify([slug, text, source ?? '', at ?? '']))
    .digest('hex')
    .slice(0, 10);
}

/**
 * Every slug this store already knows, and which entry it landed on — P3's "a slug is
 * known when some entry's `source.ref` or a `sighting.ref` equals `forge:<slug>`" rule.
 * Callers pass already-loaded, non-damaged entries only.
 *
 * @param {object[]} entries
 * @returns {Map<string, object>} slug -> entry
 */
export function forgeSlugIndex(entries) {
  const index = new Map();
  const slugOf = (ref) => {
    if (typeof ref !== 'string' || !ref.startsWith('forge:')) return undefined;
    const rest = ref.slice('forge:'.length);
    const hashIdx = rest.indexOf('#');
    return hashIdx === -1 ? rest : undefined; // a signal ref (has "#key") never keys the slug itself
  };
  for (const e of entries) {
    const bySource = slugOf(e.source?.ref);
    if (bySource && !index.has(bySource)) index.set(bySource, e);
    for (const s of e.sightings ?? []) {
      const bySighting = slugOf(s.ref);
      if (bySighting && !index.has(bySighting)) index.set(bySighting, e);
    }
  }
  return index;
}

/**
 * Redact-then-cap a signal's text into a `source`/`sighting` excerpt shape (P3), the same
 * order `lib/principles.mjs`'s `buildSource` uses — capping first could cut a matched
 * secret in half and leave an unmasked fragment sitting in the stored excerpt.
 */
function signalToSighting(slug, signal, fallbackAt) {
  const key = forgeSignalKey(slug, signal);
  const masked = redactSecrets(signal.text);
  const excerpt = masked.length > EXCERPT_MAX_CHARS ? masked.slice(0, EXCERPT_MAX_CHARS) : masked;
  const out = { at: signal.at ?? fallbackAt, ref: `forge:${slug}#${key}`, excerpt };
  if (signal.source) out.session = signal.source;
  return out;
}

/** Follow `mergedInto` to its ultimate survivor, guarded against a cycle (P4 step 2). */
function resolveSurvivor(entries, entry) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const visited = new Set([entry.id]);
  let current = entry;
  while (current.status === 'merged' && current.mergedInto && !visited.has(current.mergedInto)) {
    const next = byId.get(current.mergedInto);
    if (!next) break;
    visited.add(next.id);
    current = next;
  }
  return current;
}

/** Map a forge node's status/reason onto this store's status/reason/history-extra (P2). */
function mapStatus(node, nowISO) {
  switch (node.status) {
    case 'approved':
      return { status: 'accepted', historyExtra: { action: 'accepted', at: nowISO } };
    case 'pending':
      return { status: 'proposed' };
    case 'rejected': {
      const reason = node.reason || 'rejected in forge';
      return { status: 'rejected', reason, historyExtra: { action: 'rejected', at: nowISO, reason } };
    }
    case 'superseded':
      // Resolved once every creation has an id — see the second pass in planForgeImport.
      return { status: 'superseded' };
    default:
      throw problem(`nodes[?] (${node.slug})`, `unknown status ${JSON.stringify(node.status)}`);
  }
}

/**
 * Plan a forge import against the store's current entries (P4). Pure — returns a plan,
 * writes nothing. `idFor(statement)` mints an id for a brand-new entry (the caller
 * supplies `uniqueId(dir, principleId(statement, now))`, t4); `now` is a fixed `Date`.
 *
 * @param {object[]} entries — already-loaded, non-damaged entries
 * @param {{ nodes: object[], exported_at: string }} doc — `parseForgeExport` output
 * @param {{ now: Date, idFor: (statement: string) => string }} opts
 * @returns {{
 *   created: { id: string, slug: string, status: string, entry: object }[],
 *   sighted: { id: string, slug: string, added: number, sightings: object[] }[],
 *   unchanged: string[],
 *   counts: { created: number, accepted: number, proposed: number, rejected: number,
 *             supersededRetired: number, matched: number, unchanged: number },
 * }}
 */
export function planForgeImport(entries, doc, { now, idFor }) {
  const nowISO = now.toISOString();
  const slugIndex = forgeSlugIndex(entries);
  const slugToId = new Map([...slugIndex].map(([slug, e]) => [slug, e.id]));

  const created = []; // { id, slug, entry, node }
  const sighted = []; // { id, slug, added, sightings }
  const unchanged = [];

  function findWithinRunMatch(statement) {
    return created.find((c) => sameStatement(c.entry.statement, statement));
  }

  function findExistingMatch(statement) {
    const { exact } = findCandidates(entries, statement);
    if (!exact.length) return undefined;
    const target = pickExactTarget(exact);
    const full = entries.find((e) => e.id === target.id);
    return full ? resolveSurvivor(entries, full) : undefined;
  }

  for (const node of doc.nodes) {
    const { slug } = node;
    const forgeRef = `forge:${slug}`;
    const known = slugIndex.get(slug);

    if (known) {
      const existingKeys = new Set((known.sightings ?? []).map((s) => s.ref));
      const newSignals = node.signals.filter((sig) => !existingKeys.has(`${forgeRef}#${forgeSignalKey(slug, sig)}`));
      if (newSignals.length) {
        sighted.push({
          id: known.id, slug, added: newSignals.length,
          sightings: newSignals.map((sig) => signalToSighting(slug, sig, node.created ?? doc.exported_at)),
        });
      } else {
        unchanged.push(slug);
      }
      slugToId.set(slug, known.id);
      continue;
    }

    const withinRun = findWithinRunMatch(node.statement);
    const existingMatch = withinRun ? undefined : findExistingMatch(node.statement);
    const matchId = withinRun ? withinRun.id : existingMatch?.id;

    if (matchId) {
      const createdAt = node.created ?? doc.exported_at;
      const sightings = [
        { at: createdAt, ref: forgeRef },
        ...node.signals.map((sig) => signalToSighting(slug, sig, createdAt)),
      ];
      sighted.push({ id: matchId, slug, added: sightings.length, sightings });
      slugToId.set(slug, matchId);
      continue;
    }

    const id = idFor(node.statement);
    const kind = FORGE_TYPES[node.type];
    const mapped = mapStatus(node, nowISO);
    const createdAt = node.created ?? doc.exported_at;
    const historyImport = { action: 'imported', at: nowISO, from: forgeRef, forgeStatus: node.status };
    if (node.name) historyImport.name = node.name;
    if (node.confidence) historyImport.confidence = node.confidence;
    const history = [historyImport];
    if (mapped.historyExtra) history.push(mapped.historyExtra);

    const entry = {
      id, kind, strength: 'default', status: mapped.status,
      created: createdAt, scopes: { stack: [], files: [], work: [] },
      statement: node.statement, why: node.why || '',
      promotions: [], history,
      source: { at: createdAt, ref: forgeRef },
      sightings: node.signals.map((sig) => signalToSighting(slug, sig, createdAt)),
    };
    if (mapped.reason !== undefined) entry.reason = mapped.reason;

    created.push({ id, slug, entry, node });
    slugToId.set(slug, id);
  }

  // Second pass (P4 step 3): resolve `superseded_by` once every id in the file is known,
  // so a target later in the file still resolves.
  for (const c of created) {
    if (c.node.status !== 'superseded') continue;
    const targetSlug = c.node.superseded_by;
    const resolvedId = targetSlug ? slugToId.get(targetSlug) : undefined;
    if (resolvedId) {
      c.entry.status = 'superseded';
      c.entry.supersededBy = resolvedId;
      c.entry.history.push({ action: 'superseded', at: nowISO, by: resolvedId });
    } else {
      c.entry.status = 'retired';
      c.entry.reason = targetSlug ? `superseded in forge by ${targetSlug}` : 'superseded in forge';
      c.entry.history.push({ action: 'retired', at: nowISO, reason: c.entry.reason });
    }
  }

  const counts = {
    created: created.length,
    accepted: created.filter((c) => c.entry.status === 'accepted').length,
    proposed: created.filter((c) => c.entry.status === 'proposed').length,
    rejected: created.filter((c) => c.entry.status === 'rejected').length,
    supersededRetired: created.filter((c) => c.entry.status === 'superseded' || c.entry.status === 'retired').length,
    matched: sighted.length,
    unchanged: unchanged.length,
  };

  return {
    created: created.map((c) => ({ id: c.id, slug: c.slug, status: c.entry.status, entry: c.entry })),
    sighted,
    unchanged,
    counts,
  };
}

