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
// History is rewritten to drop the same paths from every commit (subjects, authors and dates are kept,
// so the phase's commits are still there); otherwise `git log -p` would show the old SURVIVORS.json.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync, realpathSync, symlinkSync, appendFileSync, cpSync, lstatSync, readlinkSync, unlinkSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, isAbsolute, basename, dirname } from 'node:path';
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

// Rebuild every commit without the SCRUB paths (git plumbing only: no shell, no filter-branch), and
// with the plant folded in wherever the file holds its HEAD content — so the defect sits inside the
// commit that last really changed that file, mixed with its authored change, never as a commit (or a
// tip) whose whole diff is the defect (phase 51 C4). Subjects, messages, authors, committers and dates
// are kept, so the phase's commits stay recognisable. `rm --cached -f`: a hidden record whose older
// version differs from both HEAD and the work tree must still be removed (phase 51 C3).
function scrubHistory(repo, must, plant) {
  const specs = SCRUB.map((e) => `${e.includes('/**/') ? ':(glob)' : ':(literal)'}${e}`);
  const idx = join(repo, '.git', 'scrub-index');
  const map = new Map();
  const out = (args, opts) => must(git(args, { cwd: repo, ...opts }), `git ${args[0]}`).stdout;
  for (const sha of out(['rev-list', '--reverse', '--topo-order', 'HEAD']).trim().split('\n').filter(Boolean)) {
    const [an, ae, ad, cn, ce, cd, parents] = out(['log', '-1', '--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%P', sha]).trim().split('\0');
    const msg = out(['log', '-1', '--format=%B', sha]);
    const env = { GIT_INDEX_FILE: idx };
    out(['read-tree', sha], { env });
    out(['rm', '-r', '-q', '--cached', '-f', '--ignore-unmatch', '--', ...specs], { env });
    if (plant) {
      const entry = out(['ls-files', '-s', '--', plant.file], { env }).trim();
      const [mode, blob] = entry.split(/\s+/);
      if (blob === plant.from) out(['update-index', '--cacheinfo', `${mode},${plant.to},${plant.file}`], { env });
    }
    const tree = out(['write-tree'], { env }).trim();
    const args = ['commit-tree', tree, ...parents.split(' ').filter(Boolean).flatMap((x) => ['-p', map.get(x) ?? x]), '-F', '-'];
    map.set(sha, out(args, { input: msg, env: { GIT_AUTHOR_NAME: an, GIT_AUTHOR_EMAIL: ae, GIT_AUTHOR_DATE: ad, GIT_COMMITTER_NAME: cn, GIT_COMMITTER_EMAIL: ce, GIT_COMMITTER_DATE: cd } }).trim());
  }
  rmSync(idx, { force: true });
  out(['reset', '-q', '--hard', map.get(out(['rev-parse', 'HEAD']).trim())]);
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
  // Built in `work`, then checked out afresh into `repo` (below), so every file of the copy is
  // created in one checkout pass: birth time, inode order and directory times single out nothing.
  const work = join(dir, 'work');
  let repo = work;
  const must = (r, what) => { if (r.status !== 0) fail(dir, `${what} failed: ${(r.stderr || r.stdout).trim().split('\n')[0]}`); return r; };
  must(git(['clone', '--no-hardlinks', '--no-tags', '--single-branch', '--quiet', realRoot, repo]), 'git clone');
  must(git(['remote', 'remove', 'origin'], { cwd: repo }), 'git remote remove');
  const branch = git(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: repo }).stdout.trim();
  if (branch && LEAK_RE.test(branch)) must(git(['branch', '-m', 'main'], { cwd: repo }), 'renaming the branch');

  const scrubbed = scrubPaths(repo);
  const origTip = must(git(['rev-parse', 'HEAD'], { cwd: repo }), 'git rev-parse').stdout.trim();
  let plant;
  try {
    const from = must(git(['rev-parse', `HEAD:${defect.file}`], { cwd: repo }), 'reading the defect file').stdout.trim();
    const content = plantChange(readFileSync(join(repo, defect.file), 'utf8'), defect);
    const to = must(git(['hash-object', '-w', '--stdin'], { cwd: repo, input: content }), 'git hash-object').stdout.trim();
    plant = { file: defect.file.split(sep).join('/'), from, to };
  } catch (e) { fail(dir, `could not plant: ${e.message}`); }
  scrubHistory(repo, must, plant);
  // Exactly one tracked file differs from the original tip, apart from the scrubbed records.
  const changed = must(git(['diff', '--name-only', origTip, 'HEAD'], { cwd: repo }), 'git diff').stdout.trim().split('\n').filter(Boolean)
    .filter((f) => !scrubbed.includes(f));
  if (changed.length !== 1 || changed[0] !== plant.file) fail(dir, `the plant changed ${changed.length} files, expected exactly 1`);

  for (const p of scrubPaths(repo)) rmSync(join(repo, p), { recursive: true, force: true });
  // The scrub can leave an empty directory behind; git does not track it, the verifier would see it.
  for (const p of scrubbed) {
    let d = join(repo, p, '..');
    while (inside(d, repo) && d !== repo) {
      try { if (readdirSync(d).length) break; rmSync(d, { recursive: true }); } catch { break; }
      d = join(d, '..');
    }
  }
  if (must(git(['status', '--porcelain'], { cwd: repo }), 'git status').stdout.trim()) fail(dir, 'the copy is not clean after planting');
  // The rewrite re-created only the planted file, so its birth time and inode stood out (phase 51 C4).
  // A fresh clone of the rewritten history checks every file out in one pass; it carries only
  // reachable objects, and the work copy is removed.
  const fresh = join(dir, 'repo');
  must(git(['clone', '--no-local', '--no-hardlinks', '--no-tags', '--quiet', work, fresh]), 'git clone (fresh checkout)');
  rmSync(work, { recursive: true, force: true });
  repo = fresh;
  must(git(['remote', 'remove', 'origin'], { cwd: repo }), 'git remote remove');
  // One timestamp for every tracked file: the file written last would otherwise be the newest (C4).
  const when = Number(must(git(['log', '-1', '--format=%ct'], { cwd: repo }), 'git log').stdout.trim()) || Math.floor(Date.now() / 1000);
  for (const f of must(git(['ls-files', '-z'], { cwd: repo }), 'git ls-files').stdout.split('\0').filter(Boolean)) {
    try { utimesSync(join(repo, f), when, when); } catch { /* a submodule or vanished path */ }
  }
  // Leave no way back to the unplanted tree (phase 51 C4): `reset --hard` and `commit --amend` set
  // ORIG_HEAD to the original tip, `remote remove` can leave a dangling refs/remotes/origin/HEAD, and
  // the rewritten-away commits and blobs stay recoverable until pruned.
  for (const f of ['ORIG_HEAD', 'FETCH_HEAD']) rmSync(join(repo, '.git', f), { force: true });
  rmSync(join(repo, '.git', 'refs', 'remotes'), { recursive: true, force: true });
  git(['reflog', 'expire', '--expire=now', '--all'], { cwd: repo });
  must(git(['gc', '--prune=now', '--quiet'], { cwd: repo }), 'git gc');
  writeFileSync(join(repo, '.git', 'astrocode-scratch'), '');

  // The suite needs its dependencies. A symlink is only taken when the copy already ignores the name,
  // and `.git/info/exclude` covers a `node_modules/` pattern (a link is not a directory to git).
  // COPIED, never linked: a symlink to <root>/node_modules lets `..` walk back into the real project
  // (its mutant lists, SURVIVORS.json, the unplanted tree) — phase 51 C4. Anything inside that still
  // names the project is repointed at the copy (repointDeps).
  for (const name of LINKED) {
    if (!existsSync(join(root, name))) continue;
    if (git(['check-ignore', '-q', `${name}/.probe`], { cwd: repo }).status !== 0) continue;
    try {
      cpSync(join(realRoot, name), join(repo, name), { recursive: true, verbatimSymlinks: true });
      repointDeps(join(repo, name), rootSpellings(root, realRoot, join(realRoot, name)), repo);
    } catch (e) { fail(dir, `could not copy ${name}: ${e.message}`); }
    mkdirSync(join(repo, '.git', 'info'), { recursive: true });
    appendFileSync(join(repo, '.git', 'info', 'exclude'), `/${name}\n`);
  }
  return { dir, repo, scrubbed };
}

// Nothing in a copied dependency dir may still name the real project (phase 51 C4): its path leads
// to the mutation records and the unplanted tree. Every file is checked, not a list of known ones
// (pyvenv.cfg, compiled .pyc and others each turned out to carry it):
// - __pycache__ is dropped (Python rebuilds it; a .pyc embeds absolute paths in a length-prefixed form
//   that cannot be rewritten safely);
// - an absolute symlink into the project is repointed at the copy;
// - a text file naming the project is rewritten to the copy's path;
// - a binary file naming it (e.g. a native module's rpath) cannot be rewritten: the copy is refused.
// Every way the project's path can be spelled in a dependency file: the root as given, its realpath,
// $PWD when it is the project, and the path a venv recorded about itself (pyvenv.cfg `command`,
// bin/activate VIRTUAL_ENV) when it resolves into the project — a venv built through a symlink or
// macOS's /tmp → /private/tmp alias records a spelling the realpath alone never matches.
export function rootSpellings(root, realRoot, depDir) {
  const out = new Set([realRoot, root]);
  const sameRoot = (p) => { try { return realpathSync(p) === realRoot; } catch { return false; } };
  if (process.env.PWD && sameRoot(process.env.PWD)) out.add(process.env.PWD);
  const recorded = [];
  try {
    const cfg = readFileSync(join(depDir, 'pyvenv.cfg'), 'utf8');
    const m = /^command\s*=.*\s(\/\S+)\s*$/m.exec(cfg);
    if (m) recorded.push(m[1]);
  } catch { /* not a venv */ }
  try {
    const act = readFileSync(join(depDir, 'bin', 'activate'), 'utf8');
    for (const m of act.matchAll(/VIRTUAL_ENV=["']?(\/[^"'\s]+)/g)) recorded.push(m[1]);
  } catch { /* not a venv */ }
  for (const venv of recorded) {
    const parent = venv.replace(/\/+$/, '').replace(/\/[^/]+$/, '');
    if (parent && sameRoot(parent)) out.add(parent);
  }
  // longest first, so a spelling that contains another is swapped whole
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

export function repointDeps(dir, spellings, repo) {
  const roots = Array.isArray(spellings) ? spellings : [spellings];
  let realRoot = null;
  for (const r of roots) { try { realRoot = realpathSync(r); break; } catch { /* next spelling */ } }
  if (!realRoot) realRoot = roots[roots.length - 1];
  const needles = roots.map((x) => Buffer.from(x));
  // A path names the project when its REAL path falls inside it, however it is spelled (a symlinked
  // checkout, /tmp vs /private/tmp, a link created through another path): the longest existing
  // ancestor is resolved and the rest appended. Cached: dependency trees repeat paths a lot.
  const cache = new Map();
  const realOf = (abs) => {
    if (cache.has(abs)) return cache.get(abs);
    let cur = abs;
    let rest = '';
    let out = null;
    for (let i = 0; i < 64 && cur && cur !== sep; i += 1) {
      try { out = rest ? join(realpathSync(cur), rest) : realpathSync(cur); break; } catch {
        rest = rest ? join(basename(cur), rest) : basename(cur);
        cur = dirname(cur);
      }
    }
    cache.set(abs, out);
    return out;
  };
  const inProject = (abs) => { const r = realOf(abs); return r && (r === realRoot || r.startsWith(realRoot + sep)) ? r : null; };
  const toCopy = (real) => repo + real.slice(realRoot.length);
  // An absolute path: a `/` not preceded by a character that could be part of a path (so `#!/x`,
  // `="/x`, `:/x` in PATH-like lists all count), then path characters.
  const PATH_RE = /(?<![A-Za-z0-9._@+~%-]|\/)\/[^\s"'`<>|*?()[\]{},;:]+/g;
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        const t = readlinkSync(p);
        const r = isAbsolute(t) ? inProject(t) : null;
        if (r) { unlinkSync(p); symlinkSync(toCopy(r), p); }
      } else if (st.isDirectory()) {
        if (e === '__pycache__') rmSync(p, { recursive: true, force: true });
        else walk(p);
      } else if (st.isFile()) {
        if (e.endsWith('.pyc')) { rmSync(p, { force: true }); continue; }
        const buf = readFileSync(p);
        if (buf.subarray(0, 8192).includes(0)) {
          // A binary cannot be rewritten safely: refused when it embeds a known spelling. A path
          // spelled some other way inside a binary is the stated limit (MANUAL, calibrate output).
          if (needles.some((n) => buf.indexOf(n) !== -1)) throw new Error(`${p.slice(dir.length + 1)} embeds the project path in a binary file`);
          continue;
        }
        const text = buf.toString('latin1');
        let changed = false;
        const next = text.replace(PATH_RE, (m) => {
          const r = inProject(m);
          if (!r) return m;
          changed = true;
          return toCopy(r);
        });
        if (changed) writeFileSync(p, next, 'latin1');
      }
    }
  };
  walk(dir);
}

/** Remove the copy. Safe twice, and never follows a symlinked dependency directory. */
export function removeCopy(copy) {
  if (copy?.dir) rmSync(copy.dir, { recursive: true, force: true });
}

// ---- Blindness ----

/** `env` without the variables that would tell the verifier (by NAME) and the test runner's marker. */
export function trialEnv(env = process.env, { root = null, cwd = null } = {}) {
  // A value naming the real project (PWD, OLDPWD, INIT_CWD, PATH with <root>/.venv/bin, VIRTUAL_ENV)
  // points the verifier back at the unplanted tree (phase 51 C4): the project path in it becomes the
  // copy's (so an activated venv still works, copied), and PWD is the copy the verifier runs in.
  let roots = [];
  if (root) {
    let real = root;
    try { real = realpathSync(root); } catch { /* as given */ }
    const all = new Set();
    for (const dep of LINKED) for (const x of rootSpellings(root, real, join(real, dep))) all.add(x);
    roots = [...all].sort((a, b) => b.length - a.length);
  }
  // Known spellings first, then any absolute path (each `:`-separated part) whose REAL path falls in
  // the project, however it is spelled.
  let realRoot = null;
  if (root) { try { realRoot = realpathSync(root); } catch { realRoot = root; } }
  const inProject = (part) => {
    if (!realRoot || !isAbsolute(part)) return null;
    let cur = part;
    let rest = '';
    for (let i = 0; i < 64 && cur && cur !== sep; i += 1) {
      try {
        const r = rest ? join(realpathSync(cur), rest) : realpathSync(cur);
        return r === realRoot || r.startsWith(realRoot + sep) ? r : null;
      } catch { rest = rest ? join(basename(cur), rest) : basename(cur); cur = dirname(cur); }
    }
    return null;
  };
  const known = (v) => roots.reduce((x, r) => x.split(r).join(cwd), v);
  const swap = (v) => {
    if (!cwd || typeof v !== 'string') return v;
    return known(v).split(':').map((part) => { const r = inProject(part); return r ? cwd + r.slice(realRoot.length) : part; }).join(':');
  };
  const names = (v) => typeof v === 'string' && (roots.some((r) => v.includes(r)) || v.split(':').some((part) => inProject(part)));
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (LEAK_RE.test(k) || k === 'NODE_TEST_CONTEXT') continue;
    if (!names(v)) out[k] = v;
    else if (cwd) out[k] = swap(v);
  }
  if (cwd) out.PWD = cwd;
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

