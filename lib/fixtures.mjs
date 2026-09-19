// Advisory fixture-currency check (ADR-050/052): did THIS phase's own commits change
// a declared data-model path without also changing the declared seed source?
//
// ## Why stamped commits, not branch-vs-base or the working tree
//
// The diff range is exactly the phase's own ADR-017-stamped commits
// (`(phase NN tK)` / `(phase N tK)`, searched in both padded and unpadded spellings —
// `workflows/execute-phase.mjs` explains why phases under 10 need both). Branch-vs-base
// would blame whichever phase runs last for an earlier phase's schema change; the
// working tree is always clean by the time this runs, since the workflow commits once
// per task (ADR-008/ADR-040).
//
// ## Why this can never fail a run
//
// `CONVENTIONS.md`/`CRITERIA.md` (layers 1+2, ADR-050) are where fixture currency is
// actually ENFORCED — a behavioural criterion the verifier runs against a real cold
// start. This is layer 3: an advisory net for the lanes a criterion never reaches
// (`/astro-fast`, or any run that skips the verifier). Advisory means exit 0 always,
// silent when clean, never a throw and never a stack trace — a project with a
// malformed or absent declaration reads as "not checked", never as failed.
//
// ## Why the debt title is phase-invariant
//
// `addDebt`'s dedupeKey is `slugify(title)::slugify(file)` (see lib/debt.mjs). A title
// naming the phase, a date or a SHA would make the same underlying staleness file as a
// fresh item on every re-run, inflating the register instead of accumulating repeat
// sightings (`also_found_in`) the way D6 wants.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, isRepo } from './git.mjs';
import { loadState } from './state.mjs';
import { addDebt } from './debt.mjs';

const MARKER = '<!-- astro-code: fixtures-declaration -->';

// "a, b/" -> ['a', 'b/'] — comma-separated, repo-relative, no globs (D5).
function splitPaths(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Read the project-root `RUN-CONTRACT.md`'s live-but-empty fixtures block (never
 * `.astrocode/`, never the project's `CONVENTIONS.md` — D4). Returns `{ ok: false, reason }`
 * for every shape that must read as "not checked": missing file, missing marker, or
 * either key empty.
 */
export function readFixtureDeclaration(root) {
  const file = join(root, 'RUN-CONTRACT.md');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, reason: 'no RUN-CONTRACT.md at the project root' };
  }
  const lines = text.split('\n');
  const markerIdx = lines.findIndex((l) => l.trim() === MARKER);
  if (markerIdx === -1) {
    return { ok: false, reason: 'RUN-CONTRACT.md has no fixtures-declaration marker' };
  }
  let dataModel = [];
  let seed = [];
  for (let i = markerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('data-model:')) dataModel = splitPaths(line.slice('data-model:'.length));
    else if (line.startsWith('seed:')) seed = splitPaths(line.slice('seed:'.length));
  }
  if (!dataModel.length && !seed.length) {
    return { ok: false, reason: 'fixtures declaration is empty (data-model and seed both unset)' };
  }
  if (!dataModel.length) return { ok: false, reason: 'fixtures declaration has no data-model paths' };
  if (!seed.length) return { ok: false, reason: 'fixtures declaration has no seed paths' };
  return { ok: true, dataModel, seed };
}

// `--phase` or `state.json`'s `active_phase` may arrive as a slug ("17-fixtures-…") or a
// bare number ("17" / "07") — take the leading digits either way.
function leadingNumber(value) {
  const m = String(value ?? '').match(/^(\d+)/);
  return m ? m[1] : '';
}

// Both stamp spellings so phases under 10 are not invisible (ADR-017,
// workflows/execute-phase.mjs:61-64 explains the zero-pad).
function stampPatterns(num) {
  const padded = num.padStart(2, '0');
  const unpadded = String(parseInt(num, 10));
  return [...new Set([padded, unpadded])].map((v) => `(phase ${v} t`);
}

/**
 * Every repo-relative path touched by this phase's own stamped commits, unioned across
 * both stamp spellings (D8 — never branch-vs-base, never working-tree-vs-HEAD).
 */
export function phaseStampedPaths(root, phase) {
  const num = leadingNumber(phase);
  if (!num) return { num: '', files: [] };
  const shas = new Set();
  for (const pattern of stampPatterns(num)) {
    const res = git(['log', '--format=%H', '--fixed-strings', '--grep', pattern], { cwd: root });
    if (res.status !== 0) continue;
    for (const sha of res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) shas.add(sha);
  }
  const files = new Set();
  for (const sha of shas) {
    const res = git(['show', '--pretty=format:', '--name-only', sha], { cwd: root });
    if (res.status !== 0) continue;
    for (const f of res.stdout.split('\n').map((s) => s.trim()).filter(Boolean)) files.add(f);
  }
  return { num, files: [...files] };
}

// Path semantics (pinned, no globs, no inference — D5): a trailing "/" means "this
// directory and everything under it"; anything else matches that exact path or that
// path as a directory prefix.
function pathMatches(declared, file) {
  if (declared.endsWith('/')) return file === declared.slice(0, -1) || file.startsWith(declared);
  return file === declared || file.startsWith(`${declared}/`);
}

/**
 * Pure decision: does this phase's own stamped work leave the declared fixtures stale?
 * No writes — `runFixturesCheck` is the one that files debt. Never throws: every
 * failure shape (not a repo, no declaration, no resolvable phase) comes back as
 * `status: 'not-checked'`.
 */
export function checkFixtures(root, { phase } = {}) {
  if (!isRepo(root)) {
    return { status: 'not-checked', reason: 'not a git repository', lines: ['⊡ fixtures not checked — not a git repository'] };
  }
  const decl = readFixtureDeclaration(root);
  if (!decl.ok) {
    return { status: 'not-checked', reason: decl.reason, lines: [`⊡ fixtures not checked — ${decl.reason}`] };
  }
  const resolvedPhase = phase != null && String(phase).trim() !== '' ? phase : loadState(root)?.active_phase;
  const num = leadingNumber(resolvedPhase);
  if (!num) {
    const reason = 'no phase given and no active phase in state.json';
    return { status: 'not-checked', reason, lines: [`⊡ fixtures not checked — ${reason}`] };
  }

  const { files } = phaseStampedPaths(root, num);
  const touched = decl.dataModel.filter((p) => files.some((f) => pathMatches(p, f)));
  const seedTouched = decl.seed.some((p) => files.some((f) => pathMatches(p, f)));

  if (!touched.length || seedTouched) {
    return { status: 'clean', phase: num, lines: [] };
  }
  const lines = touched.map(
    (p) => `⚠ stale fixtures — phase ${num} changed ${p} and no declared seed source changed`,
  );
  return { status: 'fired', phase: num, touched, lines };
}

/**
 * Decides (via `checkFixtures`), files debt for a fired result via `addDebt()` — never
 * its own dedupe logic, `addDebt`'s `dedupeKey`/`also_found_in` behaviour already is the
 * repeat-sighting semantics this wants — and returns the same result the caller relays
 * verbatim to stdout. Async only because filing debt is.
 */
export async function runFixturesCheck(root, { phase } = {}) {
  const result = checkFixtures(root, { phase });
  if (result.status === 'fired') {
    for (const path of result.touched) {
      // eslint-disable-next-line no-await-in-loop -- addDebt serializes writes anyway
      await addDebt(root, {
        title: `stale fixtures: ${path} changed without the declared seed source`,
        phase: result.phase,
        file: path,
        cost: 'small',
      });
    }
  }
  return result;
}
