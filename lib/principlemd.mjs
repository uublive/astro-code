// The personal-principle entry codec (ADR-057, D6): parse/render for
// `<dir>/<id>.md`, one file per entry — pure, no filesystem, no git.
//
// ## Why one file per entry, not one JSON/YAML index
//
// Two developers editing two DIFFERENT principles on two machines must never collide.
// A single index file turns every add/accept/amend into a write of the SAME file, so
// `lib/principlesync.mjs`'s git merge sees a conflict on almost every sync even when
// the entries themselves never overlapped. One file per id makes "different entries"
// and "conflict-free merge" the same fact, and the private store reads like a normal
// changelog on GitHub — a human can open one file and see exactly what changed.
//
// ## Why a hand-written parser, no YAML
//
// This is `lib/decisions.mjs`'s `parseDecisionEntries` style: anchor on fixed
// structural markers (the `<!-- astro-principle -->` line, `key: value` header lines,
// the `---` separator) and read forward — never a free-text scan, never a library that
// would have to be trusted to parse attacker- or corruption-shaped input the same way
// twice. CONVENTIONS' zero-deps rule rules a YAML parser out anyway; the header shape
// here does not need one.
//
// ## Why damaged throws instead of reading as absent
//
// The 2026-09-18 incident: an early strict-reader `readJSONStrict` shipped, and a
// module that predated it treated a corrupt file as an empty result — silently
// discarding data a human had written. A damaged principle file is exactly that kind
// of data: someone's accepted rule. `parsePrinciple` throws, naming the file and the
// exact problem, so a caller (`loadPrinciples`) can list it as `damaged` and refuse to
// touch it rather than quietly forgetting it exists.
//
// ## Why conflict markers are damage
//
// A git merge that leaves `<<<<<<<`/`=======`/`>>>>>>>` lines in a working file is not
// a valid entry under ANY reading of this format — and if it were accepted as valid,
// `resolvePrinciple`/`show` would happily render half of two different principles
// stitched together as one. `lib/principlesync.mjs` handles real conflicts itself
// (side files under `conflicts/`, never markers in the tracked entry), so a marker
// reaching this parser means something upstream already failed; treating it as damage
// makes that failure visible instead of silently unreadable.
//
// ## Why `history` doubles as the revision-marker list
//
// Same technique as `lib/decisions.mjs`'s `isOlderRevision` (decisions #35/#36): two
// copies of one entry are the SAME REVISION if their `history` arrays match exactly,
// one is an OLDER REVISION of the other if its `history` is a strict prefix of the
// other's, and anything else — divergent history, or equal history with different
// text — is a genuine conflict that must not be silently resolved either way.

/** Kinds a principle entry can be filed under. */
export const KINDS = ['principle', 'pattern', 'preference', 'antipattern'];

/** How binding an entry is. */
export const STRENGTHS = ['rule', 'default'];

/** The work contexts an entry's `work:` scope may name. */
export const WORK_SCOPES = ['plan', 'code', 'test', 'review', 'git', 'ui', 'data', 'docs', 'ops'];

/** The lifecycle statuses an entry may be in. */
export const PRINCIPLE_STATUSES = ['proposed', 'accepted', 'rejected', 'retired', 'superseded'];

/** The exact first line of every entry file. */
export const ENTRY_MARKER = '<!-- astro-principle -->';

// Header keys in their fixed render order. Repeatable keys may appear 0+ times;
// non-repeatable required keys must appear exactly once; the rest at most once.
const HEADER_KEYS = [
  'id', 'kind', 'strength', 'status', 'created', 'stack', 'work',
  'files', 'reason', 'superseded-by', 'source', 'promotion', 'history',
];
const REQUIRED_KEYS = ['id', 'kind', 'strength', 'status', 'created'];
const REPEATABLE_KEYS = new Set(['files', 'promotion', 'history']);
const SINGLE_KEYS = new Set(HEADER_KEYS.filter((k) => !REPEATABLE_KEYS.has(k)));

const CONFLICT_MARKER = /^(<{7}|={7}|>{7})/m;

/** `file:<problem>` — every damage report in this module is shaped like this. */
function damaged(file, problem) {
  return new Error(`${file || '<principle>'}: ${problem}`);
}

/**
 * Parse a `<id>.md`-shaped text into an entry, or throw naming the file and the exact
 * problem (never reads a damaged file as absent — see the module header).
 *
 * @param {string} text
 * @param {{ file?: string, id?: string }} [opts] `id` is the filename stem the header
 *   `id:` key must match; omit it to parse without that check.
 * @returns {object} entry
 */
export function parsePrinciple(text, { file, id: expectedId } = {}) {
  const src = String(text ?? '');
  const label = file || expectedId || '<principle>';

  if (CONFLICT_MARKER.test(src)) throw damaged(label, 'contains unresolved conflict markers');

  const lines = src.split('\n');
  if (lines[0] !== ENTRY_MARKER) throw damaged(label, `missing marker line ${JSON.stringify(ENTRY_MARKER)}`);

  const sepIdx = lines.indexOf('---', 1);
  if (sepIdx === -1) throw damaged(label, 'missing "---" header separator');

  const headerLines = lines.slice(1, sepIdx);
  const body = lines.slice(sepIdx + 1).join('\n');

  const single = new Map(); // key -> value
  const files = [];
  const promotionsRaw = [];
  const historyRaw = [];
  let sourceRaw;

  for (const line of headerLines) {
    if (!line.trim()) continue;
    const m = line.match(/^([a-z-]+): (.*)$/s) || line.match(/^([a-z-]+):$/);
    if (!m) throw damaged(label, `malformed header line ${JSON.stringify(line)}`);
    const key = m[1];
    const value = m[2] || '';
    if (!HEADER_KEYS.includes(key)) throw damaged(label, `unknown header key ${JSON.stringify(key)}`);
    if (key === 'files') { files.push(value); continue; }
    if (key === 'promotion') { promotionsRaw.push(value); continue; }
    if (key === 'history') { historyRaw.push(value); continue; }
    if (single.has(key)) throw damaged(label, `duplicate header key ${JSON.stringify(key)}`);
    single.set(key, value);
    if (key === 'source') sourceRaw = value;
  }

  for (const key of REQUIRED_KEYS) {
    if (!single.has(key)) throw damaged(label, `missing required header key ${JSON.stringify(key)}`);
  }

  const id = single.get('id');
  if (expectedId != null && id !== expectedId) {
    throw damaged(label, `id ${JSON.stringify(id)} does not match filename ${JSON.stringify(expectedId)}`);
  }

  const kind = single.get('kind');
  if (!KINDS.includes(kind)) throw damaged(label, `invalid kind ${JSON.stringify(kind)}`);

  const strength = single.get('strength');
  if (!STRENGTHS.includes(strength)) throw damaged(label, `invalid strength ${JSON.stringify(strength)}`);

  const status = single.get('status');
  if (!PRINCIPLE_STATUSES.includes(status)) throw damaged(label, `invalid status ${JSON.stringify(status)}`);

  const created = single.get('created');

  const stack = splitList(single.get('stack'));
  const work = splitList(single.get('work'));
  for (const w of work) {
    if (!WORK_SCOPES.includes(w)) throw damaged(label, `invalid work scope ${JSON.stringify(w)}`);
  }

  const reason = single.has('reason') ? single.get('reason') : undefined;
  const supersededBy = single.has('superseded-by') ? single.get('superseded-by') : undefined;

  const needsReason = status === 'rejected' || status === 'retired';
  if (needsReason && !reason) throw damaged(label, `status ${status} requires a reason`);
  if (!needsReason && reason !== undefined) throw damaged(label, `reason present but status is ${status}`);

  if (status === 'superseded' && !supersededBy) throw damaged(label, 'status superseded requires superseded-by');
  if (status !== 'superseded' && supersededBy !== undefined) {
    throw damaged(label, `superseded-by present but status is ${status}`);
  }

  const source = sourceRaw === undefined ? undefined : parseJSONObject(label, 'source', sourceRaw);
  const promotions = promotionsRaw.map((v) => parseJSONObject(label, 'promotion', v));
  const history = historyRaw.map((v) => parseJSONObject(label, 'history', v));

  const bodyLines = body.split('\n');
  let statementIdx = -1;
  for (let i = 0; i < bodyLines.length; i++) {
    if (bodyLines[i].trim() === '') continue;
    if (bodyLines[i].startsWith('# ')) { statementIdx = i; break; }
    throw damaged(label, 'body must start with a "# statement" line');
  }
  if (statementIdx === -1) throw damaged(label, 'missing "# statement" line');
  const statement = bodyLines[statementIdx].slice(2).trim();
  if (!statement) throw damaged(label, 'missing statement');
  const why = bodyLines.slice(statementIdx + 1).join('\n').trim();

  const entry = {
    id, kind, strength, status, created,
    scopes: { stack, files, work },
    statement, why,
    promotions, history,
  };
  if (reason !== undefined) entry.reason = reason;
  if (supersededBy !== undefined) entry.supersededBy = supersededBy;
  if (source !== undefined) entry.source = source;
  return entry;
}

/** Split a `stack`/`work` comma-list header value into trimmed, non-empty parts. */
function splitList(value) {
  if (!value) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseJSONObject(label, key, raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw damaged(label, `unparseable ${key} JSON: ${JSON.stringify(raw)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw damaged(label, `${key} must be a JSON object`);
  }
  return parsed;
}

/**
 * Render an entry to its canonical file text. `parsePrinciple(renderPrinciple(e))`
 * deep-equals `e`; `renderPrinciple(parsePrinciple(text))` is byte-identical to a
 * canonically-written `text`.
 *
 * @param {object} entry
 * @returns {string}
 */
export function renderPrinciple(entry) {
  const {
    id, kind, strength, status, created,
    scopes = {}, reason, supersededBy, source,
    promotions = [], history = [],
    statement, why,
  } = entry;
  const { stack = [], files = [], work = [] } = scopes;

  const lines = [ENTRY_MARKER];
  lines.push(`id: ${id}`);
  lines.push(`kind: ${kind}`);
  lines.push(`strength: ${strength}`);
  lines.push(`status: ${status}`);
  lines.push(`created: ${created}`);
  if (stack.length) lines.push(`stack: ${stack.join(', ')}`);
  if (work.length) lines.push(`work: ${work.join(', ')}`);
  for (const f of files) lines.push(`files: ${f}`);
  if (status === 'rejected' || status === 'retired') lines.push(`reason: ${reason}`);
  if (status === 'superseded') lines.push(`superseded-by: ${supersededBy}`);
  if (source !== undefined) lines.push(`source: ${JSON.stringify(source)}`);
  for (const p of promotions) lines.push(`promotion: ${JSON.stringify(p)}`);
  for (const h of history) lines.push(`history: ${JSON.stringify(h)}`);
  lines.push('---');
  lines.push('');
  lines.push(`# ${statement}`);
  const whyTrimmed = String(why || '').trim();
  if (whyTrimmed) {
    lines.push('');
    lines.push(whyTrimmed);
  }
  return lines.join('\n') + '\n';
}

/**
 * Validate and normalise the fields a caller wants to write into an entry
 * (`add`/`accept`/`amend`) into the shape `renderPrinciple`/the entry object expects.
 * Throws on anything out of the P3 contract; never touches the filesystem.
 *
 * @param {{ kind?: string, strength?: string, stack?: string[], files?: string[],
 *   work?: string[], statement?: string, why?: string }} fields
 * @returns {{ kind: string, strength: string, statement: string, why: string,
 *   scopes: { stack: string[], files: string[], work: string[] } }}
 */
export function normaliseFields({ kind, strength, stack = [], files = [], work = [], statement, why = '' } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`invalid kind: ${JSON.stringify(kind)}`);
  if (!STRENGTHS.includes(strength)) throw new Error(`invalid strength: ${JSON.stringify(strength)}`);

  const normStack = (Array.isArray(stack) ? stack : [stack])
    .flatMap((s) => String(s).split(','))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const normWork = (Array.isArray(work) ? work : [work])
    .flatMap((w) => String(w).split(','))
    .map((w) => w.trim())
    .filter(Boolean);
  for (const w of normWork) {
    if (!WORK_SCOPES.includes(w)) throw new Error(`invalid work scope: ${JSON.stringify(w)}`);
  }

  const normFiles = (Array.isArray(files) ? files : [files]).map((f) => String(f).trim()).filter(Boolean);

  const rawStatement = String(statement ?? '');
  if (!rawStatement.trim()) throw new Error('statement must not be empty');
  if (rawStatement.includes('\n')) throw new Error('statement must be a single line');

  return {
    kind, strength,
    statement: rawStatement.trim(),
    why: String(why || '').trim(),
    scopes: { stack: normStack, files: normFiles, work: normWork },
  };
}

/** One line summarising an entry — id, status, kind/strength, statement — for `list`. */
export function indexLine(entry) {
  const { id, status, kind, strength, statement } = entry;
  return `${id}  ${status}  ${kind}/${strength}  ${statement}`.replace(/\s+/g, ' ').trim();
}

/** Deep-equal two JSON-shaped history/promotion/source objects. */
function sameRecord(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compare two revisions of what claims to be the same entry, by their `history`
 * arrays (the revision-marker list — see the module header). `a` relative to `b`.
 *
 * @param {object} a
 * @param {object} b
 * @returns {'same'|'older'|'newer'|'conflict'}
 */
export function compareRevisions(a, b) {
  const ah = a.history || [];
  const bh = b.history || [];
  const isPrefix = (short, long) => short.every((h, i) => sameRecord(h, long[i]));

  if (ah.length < bh.length && isPrefix(ah, bh)) return 'older';
  if (bh.length < ah.length && isPrefix(bh, ah)) return 'newer';
  if (ah.length === bh.length && isPrefix(ah, bh)) {
    return renderPrinciple(a) === renderPrinciple(b) ? 'same' : 'conflict';
  }
  return 'conflict';
}
