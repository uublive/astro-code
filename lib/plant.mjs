// Exact planting into a blind, throwaway clone (phase 51, P5; ADR-076, ADR-087 context).
//
// Why this module exists: `ac verify calibrate` measures whether the verifier notices a REAL
// defect, so each trial needs a copy of the project that holds exactly one mutant and tells the
// verifier nothing about it. Three things make that hard, and each is code here, not prose (ce7b):
//  - exactness: the mutant is written as a direct edit (never `git apply`, whose context matching
//    can land a hunk on the wrong line), and `git diff --numstat` must show ONE file changed;
//  - invisibility: the plant and the scrub are folded INTO the tip commit (`--amend`), so
//    `git status` is clean and no commit, branch or tag names the plant. A separate "plant" commit
//    would point straight at the defect;
//  - isolation: the copy lives under `os.tmpdir()` (never inside the project), has no `origin` and
//    no tags, and carries `.git/astrocode-scratch` so git-guard lets the verifier reset in it.
// The SCRUB list is the one place that says what the verifier must not see: the committed
// SURVIVORS.json names the HARD defect's file and line, VERDICT.json can carry the replacement text,
// and the calibration log lists earlier runs. The project's own tool configuration stays: it is the
// project `/astro-verify` sees.
//
// Known limit: earlier commits in history still contain the old SURVIVORS.json. History is kept
// because the verifier checks that the phase's commits are present.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, realpathSync, symlinkSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, isAbsolute } from 'node:path';
import { git } from './git.mjs';

/** What the verifier must never see. `**` means "anywhere below the prefix". */
export const SCRUB = [
  '.astrocode/.local',
  '.astrocode/CALIBRATION.jsonl',
  '.astrocode/**/SURVIVORS.json',
  '.astrocode/**/VERDICT.json',
  'mutants',
  'reports/mutation',
  '.stryker-tmp',
  '.mutmut-cache',
];

/** The words C4 forbids anywhere the verifier can see. */
export const LEAK_RE = /calibrat|plant|mutant|mutat|defect|mutmut|stryker/i;

const LINKED = ['node_modules', '.venv', 'venv'];

// ---- Planting ----

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

/**
 * The file text with `defect`'s change applied and nothing else touched. A mutmut defect
 * (`replacement_line`) replaces one whole line keeping the file's own indentation; a Stryker defect
 * (`replacement` + `loc`) replaces the range, 1-based line and column, end exclusive. Throws when the
 * file no longer matches what the tool graded (a changed line, a location outside the file).
 */
export function plantChange(text, defect) {
  const src = String(text);
  if (typeof defect.replacement_line === 'string') {
    const lines = src.split('\n');
    const n = defect.line;
    if (!Number.isInteger(n) || n < 1 || n > lines.length) throw new Error(`line ${n} is outside the file`);
    const orig = lines[n - 1];
    const bare = orig.replace(/\r$/, '');
    if (bare.trim() !== String(defect.line_text ?? '').trim()) throw new Error(`line ${n} no longer matches the recorded original`);
    const indent = /^[ \t]*/.exec(bare)[0];
    lines[n - 1] = `${indent}${defect.replacement_line.trimStart().replace(/\r$/, '')}${orig.endsWith('\r') ? '\r' : ''}`;
    return lines.join('\n');
  }
  if (typeof defect.replacement === 'string' && defect.loc) {
    const starts = lineStarts(src);
    const off = (p) => {
      if (!p || !Number.isInteger(p.line) || !Number.isInteger(p.column) || p.line < 1 || p.line > starts.length || p.column < 1) throw new Error('location is outside the file');
      const at = starts[p.line - 1] + p.column - 1;
      const lineEnd = p.line < starts.length ? starts[p.line] - 1 : src.length;
      if (at > lineEnd) throw new Error('location is outside the file');
      return at;
    };
    const a = off(defect.loc.start);
    const b = off(defect.loc.end);
    if (b < a) throw new Error('location is outside the file');
    return src.slice(0, a) + defect.replacement + src.slice(b);
  }
  throw new Error('the defect carries no exact change');
}

// ---- Scrub ----

// Every existing path a SCRUB entry names, relative to `repo`.
function scrubPaths(repo) {
  const found = [];
  const walk = (dirRel, name) => {
    let entries;
    try { entries = readdirSync(join(repo, dirRel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const rel = join(dirRel, e.name);
      if (e.isDirectory()) walk(rel, name);
      else if (e.name === name) found.push(rel);
    }
  };
  for (const entry of SCRUB) {
    const at = entry.indexOf('/**/');
    if (at < 0) { if (existsSync(join(repo, entry))) found.push(entry); continue; }
    walk(entry.slice(0, at), entry.slice(at + 4));
  }
  return [...new Set(found.map((p) => p.split(sep).join('/')))].sort();
}

// ---- The copy ----

const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

function fail(dir, msg) {
  rmSync(dir, { recursive: true, force: true });
  throw new Error(msg);
}

/**
 * A fresh throwaway clone of `root`'s HEAD holding exactly `defect` and none of the SCRUB paths.
 * Returns `{ dir, repo, scrubbed }` (`repo` is the working directory the verifier runs in). Throws,
 * leaving nothing behind, when the copy cannot be made or the plant is not a single-file change.
 * `tmp` is for tests only: the directory the copy is made under.
 */
export function makeCopy(root, defect, { tmp = tmpdir() } = {}) {
  const realRoot = realpathSync(root);
  const dir = realpathSync(mkdtempSync(join(tmp, 'ac-v-')));
  if (inside(dir, realRoot)) fail(dir, `refusing to copy into ${dir}: it is inside the project`);
  if (!defect?.file || isAbsolute(defect.file) || defect.file.split(/[\\/]/).includes('..')) fail(dir, 'the defect names no file inside the project');
  const repo = join(dir, 'repo');
  const must = (r, what) => { if (r.status !== 0) fail(dir, `${what} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); return r; };
  const tip = must(git(['log', '-1', '--format=%cn%n%ce%n%cI'], { cwd: root }), 'reading the tip commit').stdout.split('\n');
  must(git(['clone', '--no-hardlinks', '--no-tags', '--single-branch', '--quiet', realRoot, repo]), 'git clone');
  must(git(['remote', 'remove', 'origin'], { cwd: repo }), 'git remote remove');
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repo }).stdout.trim();
  if (branch && LEAK_RE.test(branch)) must(git(['branch', '-m', 'main'], { cwd: repo }), 'renaming the branch');

  try {
    const target = join(repo, defect.file);
    writeFileSync(target, plantChange(readFileSync(target, 'utf8'), defect));
  } catch (e) { fail(dir, `could not plant: ${e.message}`); }
  const stat = must(git(['diff', '--numstat'], { cwd: repo }), 'git diff').stdout.trim().split('\n').filter(Boolean);
  if (stat.length !== 1) fail(dir, `the plant changed ${stat.length} files, expected exactly 1`);

  const scrubbed = scrubPaths(repo);
  for (const p of scrubbed) rmSync(join(repo, p), { recursive: true, force: true });
  // The scrub can leave an empty directory behind; git does not track it, the verifier would see it.
  for (const p of scrubbed) {
    let d = join(repo, p, '..');
    while (inside(d, repo) && d !== repo) {
      try { if (readdirSync(d).length) break; rmSync(d, { recursive: true }); } catch { break; }
      d = join(d, '..');
    }
  }
  must(git(['add', '-A'], { cwd: repo }), 'git add');
  const env = { GIT_COMMITTER_NAME: tip[0], GIT_COMMITTER_EMAIL: tip[1], GIT_COMMITTER_DATE: tip[2] };
  must(git(['-c', 'commit.gpgsign=false', 'commit', '--amend', '--no-edit', '--allow-empty', '--no-verify', '--quiet'], { cwd: repo, env }), 'git commit --amend');
  git(['reflog', 'expire', '--expire=now', '--all'], { cwd: repo });
  writeFileSync(join(repo, '.git', 'astrocode-scratch'), '');

  // The suite needs its dependencies. A symlink is only taken when the copy already ignores the name,
  // and `.git/info/exclude` covers a `node_modules/` pattern (a link is not a directory to git).
  for (const name of LINKED) {
    if (!existsSync(join(root, name))) continue;
    if (git(['check-ignore', '-q', `${name}/.probe`], { cwd: repo }).status !== 0) continue;
    symlinkSync(join(realRoot, name), join(repo, name));
    mkdirSync(join(repo, '.git', 'info'), { recursive: true });
    appendFileSync(join(repo, '.git', 'info', 'exclude'), `/${name}\n`);
  }
  return { dir, repo, scrubbed };
}

/** Remove the copy. Safe twice, and never follows a symlinked dependency directory. */
export function removeCopy(copy) {
  if (copy?.dir) rmSync(copy.dir, { recursive: true, force: true });
}

// ---- Blindness ----

/** `env` without the variables that would tell the verifier (by NAME) and the test runner's marker. */
export function trialEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!LEAK_RE.test(k) && k !== 'NODE_TEST_CONTEXT') out[k] = v;
  return out;
}

/**
 * Is this copy blind, checked in code before every spawn (ce7b). `ok: false` with `reasons` when a
 * SCRUB path remains, an env variable NAME leaks, or the calibrate-authored `frame` text leaks.
 * Project-sourced text (the goal and slug in `prompt`, history subjects, ref names, env VALUES)
 * belongs to the project and `/astro-verify` passes it too, so it is only `reported`.
 */
export function blindnessCheck(repo, { prompt = '', frame = '', env = {} } = {}) {
  const reasons = [];
  const reported = [];
  for (const p of scrubPaths(repo)) reasons.push(`${p} is still present`);
  for (const k of Object.keys(env)) if (LEAK_RE.test(k)) reasons.push(`environment variable ${k} names the plant`);
  if (LEAK_RE.test(frame)) reasons.push('the prompt framing names the plant');
  if (LEAK_RE.test(prompt)) reported.push('prompt (project-sourced text)');
  const log = git(['log', '--all', '--format=%s'], { cwd: repo }).stdout;
  if (LEAK_RE.test(log)) reported.push('commit subjects');
  const refs = git(['for-each-ref', '--format=%(refname)'], { cwd: repo }).stdout;
  if (LEAK_RE.test(refs)) reported.push('ref names');
  for (const [k, v] of Object.entries(env)) if (!LEAK_RE.test(k) && LEAK_RE.test(String(v))) reported.push(`environment value of ${k}`);
  return { ok: reasons.length === 0, reasons, reported };
}

