// ADR-094: the targeted test set of a phase, computed in CODE (never by the verifier's judgement, ADR-021).
// Fast mode runs these instead of the full suite, so the rule has to be deterministic and its limits stated.
//
// Why each rule exists:
// - "the phase" is its stamped commits (ADR-017, `phaseStampedPaths`), so an unstamped commit or another
//   phase's commit never widens the set.
// - Only files TRACKED at HEAD count: a deleted file has nothing to link to or run.
// - Selection is a plain `<` sort, never `localeCompare`: two runs on one tree must give one order (a
//   locale-dependent order would make the recorded set differ from the gate's recompute).
// - There is NO fallback to the full suite: an empty set runs nothing ("no linked tests", a docs-only phase).
// This module imports nothing from verdict.mjs or receipts.mjs, so no import cycle is possible.
import { readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { phaseStampedPaths } from './fixtures.mjs';
import { trackedFiles } from './impact.mjs';

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export const TARGETED_LIMITS = 'selection by stamped commits, by test-file name, by import specifiers and by quoted path or file-name literals, one hop only; it cannot see a test that reaches a changed file through another module, a spawned CLI or a computed path, and only *.test|spec.[cm]?[jt]sx? files are selected';

const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)(['"`])([^'"`\n]+)\1/g;
const LITERAL = /(['"`])([^'"`\n]+)\1/g;

const stem = (p) => posix.basename(p).replace(/\.[^.]+$/, '');
const testStem = (p) => stem(p).replace(/\.(test|spec)$/, '');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// Does test file `t` (with source `text`) link to non-test file `f`? Rules (a) import, (b) literal, (c) name.
function links(t, text, f) {
  const base = posix.basename(f);
  for (const m of text.matchAll(SPEC)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    if (posix.normalize(posix.join(posix.dirname(t), spec)) === f) return true;
  }
  for (const m of text.matchAll(LITERAL)) {
    const s = m[2];
    if (s === f || s.endsWith(`/${f}`) || s === base) return true;
  }
  return testStem(t) === stem(f) && testStem(t) !== '';
}

function read(root, rel) {
  try { return readFileSync(join(root, rel), 'utf8'); } catch { return ''; }
}

/** Pure: link `changed` non-test files to `testFiles`. `{ tests, unmapped }` (tests = linked only). */
export function linkedTests(root, changed, testFiles) {
  const hit = new Set();
  const unmapped = [];
  const texts = new Map(testFiles.map((t) => [t, read(root, t)]));
  for (const f of changed) {
    let any = false;
    for (const t of testFiles) if (links(t, texts.get(t), f)) { hit.add(t); any = true; }
    if (!any) unmapped.push(f);
  }
  return { tests: [...hit], unmapped };
}

/** `{ tests, changed, unmapped, reason, limits }` for phase `slug` (see header). */
export function targetedTests(root, slug) {
  const tracked = new Set(trackedFiles(root));
  const files = phaseStampedPaths(root, slug).files.filter((f) => tracked.has(f) && !f.startsWith('.astrocode/'));
  const changedTests = files.filter((f) => TEST_FILE.test(f));
  const changed = files.filter((f) => !TEST_FILE.test(f)).sort(cmp);
  const allTests = [...tracked].filter((f) => TEST_FILE.test(f));
  const linked = linkedTests(root, changed, allTests);
  const tests = [...new Set([...changedTests, ...linked.tests])].sort(cmp);
  return { tests, changed, unmapped: linked.unmapped.sort(cmp), reason: tests.length ? null : 'no linked tests', limits: TARGETED_LIMITS };
}

/** The tracked non-test files test `t` links to: the same rule read backwards (full-check attribution). */
export function subjectsOf(root, t, tracked = trackedFiles(root)) {
  const text = read(root, t);
  return tracked.filter((f) => !TEST_FILE.test(f) && !f.startsWith('.astrocode/') && links(t, text, f)).sort(cmp);
}

/** `{files}` -> the files, each single-quoted for the shell (`'` escaped as `'\''`), joined by spaces. */
export function targetedCommand(template, files) {
  return template.replace('{files}', () => files.map((f) => `'${String(f).replace(/'/g, `'\\''`)}'`).join(' '));
}
