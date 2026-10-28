// Which criteria can a diff affect? The mapping facts behind targeted verify (phase 52, amends ADR-079).
//
// Why this exists: a verify after a recorded full PASS used to re-check the whole phase even for a
// one-line follow-up. To check only what a change can affect, code must know which files each
// criterion rests on. This module holds that mapping and nothing else: no thresholds, no mode
// decision (those live in `lib/verdict.mjs`, 9173).
//
// The mapping fails WIDE (333f). A criterion's files are read only from facts: a `- **Files:**`
// line, or a backticked token in its block that is a tracked file or a directory prefix of one. Prose
// is never guessed at, because a wrong guess is a false carry. A criterion that resolves to no path
// is "unmapped", and verdict.mjs treats unmapped as always observed.
//
// Import limits: this module imports only git, fixtures and config. It must NOT import
// `lib/mutate.mjs` (mutate imports verdict, and verdict imports this, so that would be a cycle),
// nor `lib/verdict.mjs`. `mutateScopeFiles` is therefore a conservative superset of what
// `ac mutate` targets, built from the same two facts (stamped paths, `mutation.files`).
import { git } from './git.mjs';
import { phaseStampedPaths, pathMatches } from './fixtures.mjs';
import { loadConfig } from './config.mjs';

const CRITERION_HEADING = /^#{1,6}\s*(C\d+)\b/;

/** CRITERIA.md split per criterion: `[{ id, heading, body }]`, from each `C<n>` heading to the next. */
export function criterionBlocks(text) {
  const blocks = [];
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const m = CRITERION_HEADING.exec(line);
    if (m) { cur = { id: m[1], heading: line, body: '' }; blocks.push(cur); continue; }
    if (cur) cur.body += (cur.body ? '\n' : '') + line;
  }
  return blocks;
}

const backticked = (s) => [...String(s).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const stripDot = (t) => t.replace(/^(\.\/)+/, '');

// A token as written (`./lib/a.mjs:12`, `(x.mjs);`) down to a bare path candidate.
function cleanToken(tok) {
  let t = tok.replace(/^\(+/, '').replace(/[,.;:)]+$/, '');
  t = t.replace(/:\d+(-\d+)?$/, '').replace(/[,.;:)]+$/, '');
  return stripDot(t);
}

const FILES_LINE = /^[ \t]*(?:[-*][ \t]*)?\*\*Files:?\*\*:?(.*)$/im;

/**
 * `Map id -> paths[]` for every criterion (an empty array = unmapped). A path comes from the
 * `Files:` line verbatim (even untracked), or from a backticked token that equals a tracked file or
 * is a directory prefix of one. Globs never match. A command maps only through the files it names.
 */
export function criterionPaths(text, tracked) {
  const files = tracked ?? [];
  const out = new Map();
  for (const b of criterionBlocks(text)) {
    const found = out.get(b.id) ?? [];
    const add = (p) => { if (p && !found.includes(p)) found.push(p); };
    const fl = FILES_LINE.exec(b.body);
    if (fl) for (const span of backticked(fl[1])) add(stripDot(span.trim()));
    for (const span of backticked(`${b.heading}\n${b.body}`)) {
      for (const raw of span.split(/\s+/)) {
        const tok = cleanToken(raw);
        if (!tok || /[*?[]/.test(tok)) continue;
        const dir = tok.endsWith('/') ? tok : `${tok}/`;
        if (files.includes(tok) || files.some((f) => f.startsWith(dir))) add(tok);
      }
    }
    out.set(b.id, found);
  }
  return out;
}

/** Does any changed file equal one of `paths`, or sit under one as a directory? Never a partial name. */
export function touches(paths, files) {
  return (paths ?? []).some((p) => {
    const dir = p.endsWith('/') ? p : `${p}/`;
    return (files ?? []).some((f) => f === p || f.startsWith(dir));
  });
}

/** Every tracked file, repo-relative. Empty when git fails. */
export function trackedFiles(root) {
  const r = git(['ls-files'], { cwd: root });
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}

/**
 * Files changed from `commit` to HEAD, sorted, outside `.astrocode` (so the `chore(verdict)`
 * commits never count). `--no-renames` lists both sides of a rename. `null` when git fails.
 */
export function diffSince(root, commit) {
  const r = git(['diff', '--name-only', '--no-renames', commit, 'HEAD', '--', '.', ':(exclude).astrocode'], { cwd: root });
  if (r.status !== 0) return null;
  return r.stdout.split('\n').filter(Boolean).sort();
}

// Commands whose evidence IS the whole suite. A command with file arguments is not one.
export const SUITE_COMMANDS = [
  'npm test', 'npm run test', 'pnpm test', 'yarn test', 'bun test', 'node --test',
  'node scripts/test.mjs', 'pytest', 'go test ./...', 'cargo test',
];

const SUITE_TAG = /^#{1,6}[ \t]*(C\d+)[ \t]*\[suite\]/i;
const SUITE_PHRASE = /\b(?:full (?:test )?suite|whole suite|entire suite)\b/i;

/** Criterion ids whose evidence is the full suite: `[suite]` tag, an exact suite command span, or the phrase. */
export function suiteIds(text) {
  const ids = [];
  for (const b of criterionBlocks(text)) {
    const hit = SUITE_TAG.test(b.heading)
      || backticked(b.body).some((s) => SUITE_COMMANDS.includes(s.trim()))
      || SUITE_PHRASE.test(b.body);
    if (hit && !ids.includes(b.id)) ids.push(b.id);
  }
  return ids;
}

// The core/edge tag (phase 54, D2). It sits in the heading's run of `[word]` tags directly after the
// id, and is the LAST tag of that run: `### C7 [edge] — …`, `### C4 [mutation] [edge] — …`. Only
// spaces and tabs may separate the tags (never `\s`, which would cross a newline onto the next line),
// and the match is exact and case-sensitive.
//
// FAIL-CLOSED (D2): everything else is core, so it can never be deferred. Untagged, `[core]`,
// `[Edge]`, `[edge ]`, the word `edge` in the claim text, an `[edge]` after the dash, on the next
// line or in the body. A tag the reader cannot see is a criterion that cannot be bent after a FAIL.
const TAG_RUN = /^#{1,6}[ \t]*C\d+((?:[ \t]*\[[^\]\r\n]*\])*)/;

/** Criterion ids tagged `[edge]` in their heading's tag run. The one reader every deferral check uses (9173). */
export function edgeIds(text) {
  const ids = [];
  for (const b of criterionBlocks(text)) {
    const m = TAG_RUN.exec(b.heading);
    const tags = m ? [...m[1].matchAll(/\[([^\]\r\n]*)\]/g)].map((t) => t[1]) : [];
    if (tags.includes('edge') && !ids.includes(b.id)) ids.push(b.id);
  }
  return ids;
}

// A criterion's cheapest observation, declared (not guessed, 333f): `- **Cheap:** `<command>``. The
// command is the first backticked span on that line; its exit 0 means met. A line with no span is
// ignored, so that criterion is simply checked in the expensive stage.
const CHEAP_LINE = /^[ \t]*(?:[-*][ \t]*)?\*\*Cheap:?\*\*:?(.*)$/im;

/** `Map id -> command` for every criterion that declares a `Cheap:` command. */
export function cheapCommands(text) {
  const out = new Map();
  for (const b of criterionBlocks(text)) {
    const m = CHEAP_LINE.exec(b.body);
    const cmd = m ? backticked(m[1]).map((x) => x.trim()).find(Boolean) : null;
    if (cmd && !out.has(b.id)) out.set(b.id, cmd);
  }
  return out;
}

/**
 * The commands a suite receipt may stand on for criterion `id`: the commands its block names in
 * backticks (any, under a `[suite]` tag, which declares them the suite; else only the known suite
 * commands), and every known suite command when it names none. A receipt for any other command is
 * not evidence for the suite (D6: never reused on a different command).
 */
export function suiteCommandsFor(text, id) {
  const b = criterionBlocks(text).find((x) => x.id === id);
  if (!b) return [];
  const spans = backticked(b.body).map((s) => s.trim());
  const named = SUITE_TAG.test(b.heading) ? spans : spans.filter((s) => SUITE_COMMANDS.includes(s));
  return named.length ? [...new Set(named)] : SUITE_COMMANDS;
}

/**
 * Files in the phase's mutate scope: its stamped paths (tests included) plus every tracked file
 * matched by an entry of config `mutation.files`. A superset of what `ac mutate` targets.
 */
export function mutateScopeFiles(root, slug) {
  const set = new Set(phaseStampedPaths(root, slug).files);
  const entries = (loadConfig(root)?.mutation?.files ?? []).filter((e) => typeof e === 'string');
  if (entries.length) {
    for (const f of trackedFiles(root)) if (entries.some((e) => pathMatches(e, f))) set.add(f);
  }
  return [...set];
}
