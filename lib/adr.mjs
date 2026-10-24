// The one ADR-number engine for a project's OWN ADR folder (ADR-087). Phase 53.
//
// Astrobot's report: agents picked "highest on my branch + 1" for `docs/adr/NNNN-*.md`, so
// branches collided, and its DECISIONS.md `ADR-001…068` series overlapped the folder's
// `0001…0103` under the same numbers. This module is where "one number, one meaning" lives:
// detection of the folder and its digit width, the file scan, the allocator, the claims
// record, and the one relabel rule. lib/canon.mjs claims through it, lib/adrbackfill.mjs and
// lib/adrrenumber.mjs migrate and move through it, and `adrConsistency` (below) is the single
// finding producer `ac doctor` and `ac canon check` share (principle 9173: state each rule once).
//
// Heading ids are parsed only through `ENTRY_ID` and the lib/decisions.mjs helpers — there is
// no second heading regex here.
//
// Pure apart from fs reads and the local mirror write; no git, no registry.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { paths } from './paths.mjs';
import { loadConfig } from './config.mjs';
import { atomicWriteText } from './util.mjs';
import { slugify } from './roadmap.mjs';
import { ENTRY_ID, parseDecisionEntries, decisionTitle } from './decisions.mjs';

/** The claims record on the registry's orphan branch, beside DECISIONS.md. */
export const ADR_CLAIMS_FILE = 'adr-claims.json';
/** Folders probed, in order, when `decisions.adr_dir` is not set. */
export const ADR_DIR_CANDIDATES = ['docs/adr', 'adr', 'doc/adr'];
/** String values of `decisions.adr_dir` that switch the feature off (`false` does too). */
export const ADR_OFF_VALUES = ['', 'off'];
/** An ADR file name: a 3 or 4 digit number, a dash, anything, `.md`. */
export const ADR_FILE_RE = /^(\d{3,4})-.+\.md$/;

const ONE_REF = new RegExp(`^(ADR|D)-(\\d+)$`);

/**
 * Read one `ADR-NNN` / `D-NNN` reference. The number is numeric, so `ADR-103` and `ADR-0103`
 * are the same number at widths 3 and 4. A longer digit run is its own number — `ADR-01030`
 * is 1030, never 103.
 * @returns {{ series: 'ADR'|'D', number: number, width: number, digits: string } | null}
 */
export function parseAdrRef(ref) {
  const m = ONE_REF.exec(String(ref || '').trim());
  if (!m) return null;
  return { series: m[1], number: Number(m[2]), width: m[2].length, digits: m[2] };
}

/** `ADR-0011` for (11, 4). */
export const formatAdrId = (n, width) => `ADR-${String(n).padStart(width, '0')}`;

const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
/** Titles compare by exact equality after whitespace collapse — never by similarity (ADR-053). */
export const normTitle = squash;

function cfgAdrDir(root) {
  try {
    const cfg = loadConfig(root);
    return cfg.decisions ? cfg.decisions.adr_dir : undefined;
  } catch { return undefined; }
}

function listAdrFiles(abs) {
  try { return readdirSync(abs).filter((f) => ADR_FILE_RE.test(f)).sort(); } catch { return []; }
}

const maxWidth = (names) => {
  let best = null;
  for (const f of names) {
    const m = ADR_FILE_RE.exec(f);
    const n = Number(m[1]);
    if (!best || n > best.n) best = { n, w: m[1].length };
  }
  return best ? best.w : null;
};

/**
 * Find the project's ADR folder (D6, principle 1f10: detect from the project's own files, allow
 * an override, and report which was used).
 * @returns {{ active: boolean, dir: string|null, abs: string|null,
 *   source: 'configured'|'detected'|'ambiguous'|'off'|'none', width: number|null, candidates: string[] }}
 */
export function detectAdrDir(root) {
  const configured = cfgAdrDir(root);
  const hits = ADR_DIR_CANDIDATES.map((dir) => ({ dir, names: listAdrFiles(join(root, dir)) })).filter((c) => c.names.length);
  const off = configured === false
    || (typeof configured === 'string' && ADR_OFF_VALUES.includes(configured.trim().toLowerCase()));
  if (off) return { active: false, dir: null, abs: null, source: 'off', width: null, candidates: [] };
  if (typeof configured === 'string') {
    const dir = posix.normalize(configured.trim().replace(/\\/g, '/')).replace(/^\.\/+/, '').replace(/\/+$/, '');
    const own = listAdrFiles(join(root, dir));
    const width = maxWidth(own) ?? (hits.length ? maxWidth(hits[0].names) : null) ?? 4;
    return { active: true, dir, abs: join(root, dir), source: 'configured', width, candidates: [] };
  }
  if (hits.length === 1) {
    const [{ dir, names }] = hits;
    return { active: true, dir, abs: join(root, dir), source: 'detected', width: maxWidth(names), candidates: [dir] };
  }
  if (hits.length > 1) {
    return { active: false, dir: null, abs: null, source: 'ambiguous', width: null, candidates: hits.map((h) => h.dir) };
  }
  return { active: false, dir: null, abs: null, source: 'none', width: null, candidates: [] };
}

/** The title an ADR file states: its `# ` heading minus any `ADR-NNNN —` / `NNNN.` prefix, else its slug. */
function fileTitle(text, name) {
  const h = /^#\s+(.+?)\s*$/m.exec(text || '');
  if (h) {
    const t = h[1]
      .replace(new RegExp(`^${ENTRY_ID}\\s*[-‐‑‒–—―:.]?\\s*`), '')
      .replace(/^\d{1,4}\s*[-‐‑‒–—―:.]\s*/, '')
      .trim();
    if (t) return squash(t);
  }
  return squash(name.replace(/^\d{3,4}-/, '').replace(/\.md$/, '').replace(/-/g, ' '));
}

/**
 * Every numbered ADR file in a folder: number, digit width, name, repo-relative path and title.
 * README, template and any un-numbered file never match the name pattern; a `0000-` file is a template.
 * @param {string} abs the folder
 * @param {string} [rel] the folder's project-relative path, used to build each `rel`
 */
export function scanAdrFiles(abs, rel = '') {
  const out = [];
  for (const name of listAdrFiles(abs)) {
    const digits = ADR_FILE_RE.exec(name)[1];
    const number = Number(digits);
    if (number === 0) continue;
    let text = '';
    try { text = readFileSync(join(abs, name), 'utf8'); } catch { /* unreadable: titled by slug */ }
    out.push({ number, width: digits.length, name, rel: rel ? posix.join(rel, name) : name, title: fileTitle(text, name) });
  }
  return out;
}

/** `0011-some-title.md` — the slug is capped at 60 characters and falls back to `decision`. */
export function adrFileName(n, width, title) {
  const slug = slugify(String(title || '')).slice(0, 60).replace(/-+$/, '') || 'decision';
  return `${String(n).padStart(width, '0')}-${slug}.md`;
}

/** The body of a new ADR file: the same date line, Why and Rejected the DECISIONS.md entry carries. */
export function adrFileText(id, { title, when, commit, why = '', rejected = '' }) {
  return (
    `# ${id} — ${title}\n_${when}${commit ? ` · at ${commit}` : ''}_\n\n` +
    (why ? `**Why:** ${why}\n\n` : '') +
    (rejected ? `**Rejected:** ${rejected}\n\n` : '')
  );
}

/**
 * The next number: above every claim, every `ADR-`/`D-` heading and every file, so the D series
 * counts toward the floor (D4) and a number is never handed out twice.
 */
export function nextAdrClaim({ claims = null, decisionsText = '', files = [] } = {}) {
  let max = 0;
  for (const c of claims?.claims || []) max = Math.max(max, Number(c.number) || 0);
  for (const e of parseDecisionEntries(decisionsText)) max = Math.max(max, parseAdrRef(e.id).number);
  for (const f of files) max = Math.max(max, f.number);
  return max + 1;
}

const EMPTY_CLAIMS = () => ({ version: 1, claims: [], backfill: null });

/** Tolerant: a missing or corrupt record reads as empty with no backfill marker. */
export function parseClaims(text) {
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object' || !Array.isArray(o.claims)) return EMPTY_CLAIMS();
    return { ...o, version: 1, claims: o.claims.filter((c) => c && Number.isFinite(Number(c.number))), backfill: o.backfill || null };
  } catch { return EMPTY_CLAIMS(); }
}

export const claimsText = (obj) => JSON.stringify({ version: 1, claims: [], backfill: null, ...obj }, null, 2) + '\n';

const mirrorPath = (root) => join(paths(root).local, ADR_CLAIMS_FILE);

/** The local claims mirror, or null when absent or unreadable. */
export function readClaimsMirror(root) {
  try {
    const o = JSON.parse(readFileSync(mirrorPath(root), 'utf8'));
    return o && Array.isArray(o.claims) ? { ...o, backfill: o.backfill || null } : null;
  } catch { return null; }
}

/** `.astrocode/.local/adr-claims.json`: the shared record plus what detection found. `.local/` ignores itself. */
export function writeClaimsMirror(root, claims, detection = {}) {
  const dir = paths(root).local;
  if (!existsSync(join(dir, '.gitignore'))) atomicWriteText(join(dir, '.gitignore'), '*\n');
  atomicWriteText(mirrorPath(root), claimsText({ ...claims, adr_dir: detection.dir ?? null, width: detection.width ?? null, source: detection.source ?? null }));
}

/**
 * Relabel decision-log ids by `map` ({ 'ADR-001': 'D-001', … }). A HEADING is always relabelled; a
 * reference in running text only when its digit width differs from the folder's (C5: `ADR-0002`,
 * which names the folder file, is never touched). The digit string must equal a key EXACTLY, so
 * `ADR-01020` is not `ADR-0102` or `ADR-102`.
 */
export function applyRelabel(text, map, { folderWidth } = {}) {
  const re = new RegExp(`(?<![\\w-])(${ENTRY_ID})(?!\\d)`, 'g');
  const head = new RegExp(`^(##\\s+)(${ENTRY_ID})(?!\\d)`);
  const mapped = (id) => (Object.hasOwn(map, id) ? map[id] : id);
  return String(text || '').split('\n').map((line) => {
    let lead = '';
    let rest = line;
    const hm = head.exec(line);
    if (hm) { lead = hm[1] + mapped(hm[2]); rest = line.slice(hm[0].length); }
    return lead + rest.replace(re, (id) => (parseAdrRef(id).width === folderWidth ? id : mapped(id)));
  }).join('\n');
}

/** Digit width of the log's own series: the width of its ADR headings that are not at folder width (3 when none). */
export function logWidth(entries, folderWidth) {
  const w = entries.map((e) => parseAdrRef(e.id)).filter((r) => r && r.series === 'ADR' && r.width !== folderWidth).map((r) => r.width);
  return w.length ? w[0] : 3;
}

/**
 * Classify each decision-log entry for the D-series relabel (P8):
 *  1. a MIRROR of an ADR file (exact title) becomes that file's number at folder width;
 *  2. a folder-series entry (folder width, not the log's) is kept;
 *  3. an entry already `D-` is kept;
 *  4. anything else becomes `D-<its own digits>`.
 * @returns {{ relabel: Record<string,string>, logWidth: number }}
 */
export function buildRelabelMap({ entries, files, folderWidth }) {
  const lw = logWidth(entries, folderWidth);
  const relabel = {};
  const byTitle = new Map();
  for (const f of files) if (!byTitle.has(normTitle(f.title))) byTitle.set(normTitle(f.title), f);
  for (const e of entries) {
    const ref = parseAdrRef(e.id);
    if (!ref || ref.series === 'D') continue;
    const mirror = byTitle.get(normTitle(decisionTitle(e.text)));
    if (mirror) {
      const to = formatAdrId(mirror.number, folderWidth);
      if (to !== e.id) relabel[e.id] = to;
      continue;
    }
    if (ref.width === folderWidth && ref.width !== lw) continue;
    relabel[e.id] = `D-${ref.digits}`;
  }
  return { relabel, logWidth: lw };
}
