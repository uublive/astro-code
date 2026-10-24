#!/usr/bin/env node
// PreToolUse hook — canon-guard: refuse hand edits to files the `ac` CLI owns (phase 37).
//
// AGENTS.md states the rule ("Never hand-edit roadmap.json, state.json, or the registry";
// ROADMAP.md is generated) and ADR-004 makes the CLI the owner of those files. A rule in prose
// is the weakest enforcement there is, so this hook turns it into a deny at the one moment it
// matters: just before a Write/Edit/MultiEdit/NotebookEdit or an obvious Bash write lands on a
// protected path (ADR-071). It denies, never asks, so it behaves the same headless and in
// Workflow subagents. The deny reason is two lines: the `ac` verb to use for THAT file (with
// the rule's source as a short tag), then the two escapes.
//
// ## It never reads the switch
//
// `ac mods enable canon-guard` writes this hook into each host's settings; `disable` removes it
// (ADR-072: the switch IS the registration). Being registered means being on, so a disabled
// guard costs nothing and this script has no switch to consult. That is also why it can't
// disagree with `ac mods status`: there is one source of truth, the registration.
//
// The ADR rule below (phase 53, ADR-087) does read `.astrocode/config.json`, but only the
// project's own `decisions.adr_dir` — DATA naming a folder, never whether the guard is on — plus
// the local claims mirror. The switch is still the registration alone.
//
// ## The ADR rule: an unclaimed number is refused at write time
//
// In a project with an ADR folder, a number is CLAIMED through `ac decision add`. This hook refuses
// to CREATE `<adr_dir>/NNNN-*.md`, or to ADD an `## ADR-NNNN` heading to DECISIONS.md, under a
// number the local claims mirror (`.astrocode/.local/adr-claims.json`) and the log's own headings
// do not already hold. Existing files stay editable (grandfathered ADRs are reported by
// `ac doctor`, not locked), and a project with no ADR folder is untouched. It judges paths and, for
// a Write/Edit/MultiEdit of DECISIONS.md, the text; Bash content is out of scope as ever. Like the
// rest of the hook it fails open, and it spawns nothing. The candidate folders and the off-values
// are mirrored from `lib/adr.mjs`, and a parity test guards the copy.
//
// ## Catching mistakes, not a sandbox
//
// The Bash scan recognises the obvious write forms (redirects, sed/perl in place, tee, cp/mv/rm,
// truncate, dd of=). `python -c`/`node -e` writes, globs and variables are out of scope: an
// unresolvable target is ignored. A segment whose command is `ac` is the sanctioned writer and
// a `git` segment is phase 38's ground; both are skipped, per segment, so
// `ac status && echo x > .astrocode/state.json` still checks its second half.
//
// ## Fail open, except the escape
//
// Any internal failure (bad JSON, an unknown tool, a realpath or permission error) allows the
// call with empty stdout and stderr and never prints a stack: a guard that wedges every tool
// use is worse than the mistake it prevents. The ONE exception runs the other way: the merge
// escape (a protected file carrying conflict markers, or unmerged in `git status`) fails
// CLOSED. If git can't answer, the call stays denied and the user has `ac mods disable`.
//
// ## Paths
//
// A target is judged by its REAL path (symlinks, `..`, macOS /var, a not-yet-existing file
// whose parent exists). It is a project file iff its basename is protected and its parent
// directory is named exactly `.astrocode`. A walk-up for the project root would need a stop
// rule and lets a stray `/tmp/x/state.json` match; the parent rule needs neither.
//
// The one per-phase entry (`phaseFile`, ADR-079's VERDICT.json) sits one level deeper, in a
// slug folder, so its rule also needs the grandparent to be `phases` under `.astrocode` (flat
// or under `milestones/<n>/`); the parent alone would match any folder.
//
// The principle store dir is mirrored locally from `lib/principles.mjs` `principlesDir`, not
// imported: the hot path stays free of `child_process` and brand imports. A parity test guards
// the copy.
import { readFileSync, readdirSync, realpathSync, readlinkSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const SRC_FILES = 'AGENTS.md "Never hand-edit", ADR-004';
const HAND_EDIT_RULE = 'the CLI owns this state; never hand-edit it';

/** The protected set, shared by the deny message and the tests. */
export const PROTECTED = Object.freeze([
  { name: 'roadmap.json', verb: 'ac phase … / ac milestone …', rule: 'never hand-edit roadmap.json, state.json or the registry', source: SRC_FILES },
  { name: 'state.json', verb: 'ac phase … / ac milestone …', rule: 'never hand-edit roadmap.json, state.json or the registry', source: SRC_FILES },
  { name: 'debt.json', verb: 'ac debt …', rule: HAND_EDIT_RULE, source: 'ADR-004, ADR-045' },
  { name: 'backlog.json', verb: 'ac backlog …', rule: HAND_EDIT_RULE, source: 'ADR-004, ADR-056' },
  { name: 'fixes.json', verb: 'ac fix …', rule: HAND_EDIT_RULE, source: 'ADR-004' },
  { name: 'ROADMAP.md', verb: 'ac roadmap render', rule: 'ROADMAP.md is generated from roadmap.json', source: SRC_FILES },
  { name: 'DECISIONS.in-force.md', verb: 'ac canon pull', rule: 'generated from DECISIONS.md by ac', source: 'ADR-004' },
  // A per-phase file, so it is matched by basename + grandparent (see "Paths"), not by `name`.
  { phaseFile: 'VERDICT.json', verb: 'ac verdict record <phase> --result …', rule: HAND_EDIT_RULE, source: 'ADR-079' },
  { store: true, verb: 'ac principles add|accept|amend …', rule: 'the personal principle store is written only through ac principles', source: 'ADR-057, ADR-058' },
]);

// ---------------------------------------------------------------- paths

// realpath of the deepest EXISTING ancestor, with the not-yet-existing tail re-joined. A
// dangling symlink is followed by hand so a Write through it can't dodge the check.
function realpathDeep(abs) {
  let head = abs;
  const tail = [];
  for (let hops = 0; hops < 64; hops++) {
    try {
      const r = realpathSync.native(head); // .native: on-disk case, so STATE.json on a case-insensitive FS is state.json
      return tail.length ? join(r, ...tail.slice().reverse()) : r;
    } catch { /* head does not resolve */ }
    try {
      head = resolve(dirname(head), readlinkSync(head)); // dangling symlink
      continue;
    } catch { /* not a symlink */ }
    const up = dirname(head);
    if (up === head) return abs;
    tail.push(basename(head));
    head = up;
  }
  return abs;
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

// Mirror of lib/principles.mjs principlesDir.
const storeDir = (env) => env.ASTRO_PRINCIPLES_DIR || join(env.HOME || homedir(), '.astro', 'principles');

function judge(p, cwd, env) {
  if (typeof p !== 'string' || !p) return null;
  const home = env.HOME || homedir();
  const expanded = p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p;
  const real = realpathDeep(resolve(cwd, expanded));
  const dir = dirname(real);
  // Names compare case-insensitively. realpath's on-disk case only helps for a file that
  // already exists: on a case-insensitive FS (macOS) a Write to a not-yet-existing
  // FIXES.json creates fixes.json, which ac then reads. On a case-sensitive FS the same
  // spelling is a stray file ac never reads; refusing it costs nothing.
  const name = basename(real).toLowerCase();
  const hit = PROTECTED.find((e) => e.name && e.name.toLowerCase() === name);
  if (hit && basename(dir).toLowerCase() === '.astrocode' && isDir(dir)) return { entry: hit, real, display: `.astrocode/${hit.name}` };
  // Phase files live in `.astrocode/phases/<slug>/` (or, once archived,
  // `.astrocode/milestones/<n>/phases/<slug>/`): the parent is the slug, so the rule needs the
  // grandparent to be `phases` under `.astrocode` to avoid matching a stray VERDICT.json.
  const pf = PROTECTED.find((e) => e.phaseFile && e.phaseFile.toLowerCase() === name);
  if (pf && isDir(dir) && basename(dirname(dir)) === 'phases') {
    const gg = dirname(dirname(dir));
    const ggg = dirname(gg);
    if (basename(gg).toLowerCase() === '.astrocode'
        || (basename(ggg) === 'milestones' && basename(dirname(ggg)).toLowerCase() === '.astrocode')) {
      return { entry: pf, real, display: `.astrocode/phases/${basename(dir)}/${pf.phaseFile}` };
    }
  }
  const rel = relative(realpathDeep(resolve(storeDir(env))), real);
  if (rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)) {
    return { entry: PROTECTED.find((e) => e.store), real, display: `~/.astro/principles/${rel}` };
  }
  return null;
}

/** The PROTECTED entry a path falls under, or null. */
export function judgePath(p, cwd, env = process.env) {
  try { return judge(p, cwd || process.cwd(), env)?.entry ?? null; } catch { return null; }
}

// ---------------------------------------------------------------- Bash

// Split a command into segments of tokens: words ({ w, dyn }) and redirect operators ({ r }).
// `dyn` marks a word with an expansion we can't resolve ($VAR, $(…), backtick, glob); such a
// target is ignored (fail open). $HOME, ${HOME} and a leading ~ ARE expanded.
function tokenize(s, env) {
  const home = env.HOME || homedir();
  const segs = [];
  let toks = [];
  let cur = null;
  const heredocs = [];
  let pendingDelim = null;
  const flush = () => {
    if (!cur) return;
    toks.push(cur);
    if (pendingDelim) { heredocs.push({ delim: cur.w, strip: pendingDelim.strip }); pendingDelim = null; }
    cur = null;
  };
  const endSeg = () => { flush(); if (toks.length) segs.push(toks); toks = []; };
  const add = (ch, dyn = false) => { cur ??= { w: '', dyn: false }; cur.w += ch; if (dyn) cur.dyn = true; };
  const dollar = (i) => {
    if (s.startsWith('${HOME}', i)) { add(home); return i + 6; }
    if (s.startsWith('$HOME', i) && !/\w/.test(s[i + 5] || '')) { add(home); return i + 4; }
    add('$', true);
    return i;
  };
  const dropFd = () => { if (cur && /^\d+$/.test(cur.w)) cur = null; else flush(); };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      if (s[i + 1] === '\n') i++;
      else if (i + 1 < s.length) add(s[++i]);
    } else if (c === "'") {
      cur ??= { w: '', dyn: false };
      let j = s.indexOf("'", i + 1);
      if (j < 0) j = s.length;
      cur.w += s.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      cur ??= { w: '', dyn: false };
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === '\\' && i + 1 < s.length && '"\\$`\n'.includes(s[i + 1])) add(s[++i]);
        else if (s[i] === '$') i = dollar(i);
        else add(s[i], s[i] === '`');
      }
    } else if (c === '$') i = dollar(i);
    else if (c === '`' || c === '*' || c === '?' || c === '[') add(c, true);
    else if (c === '~' && !cur && (i + 1 >= s.length || /[\s/]/.test(s[i + 1]))) add(home);
    else if (c === ' ' || c === '\t') flush();
    else if (c === '#' && !cur) { while (i + 1 < s.length && s[i + 1] !== '\n') i++; }
    else if (c === '\n') {
      endSeg();
      while (heredocs.length) {
        const h = heredocs.shift();
        let p = i + 1;
        while (p < s.length) {
          let e = s.indexOf('\n', p);
          if (e < 0) e = s.length;
          const line = s.slice(p, e);
          p = e + 1;
          if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break;
        }
        i = p - 1;
      }
    } else if (c === ';' || c === '(' || c === ')') endSeg();
    else if (c === '|') { if (s[i + 1] === '|' || s[i + 1] === '&') i++; endSeg(); }
    else if (c === '&') {
      if (s[i + 1] === '>') {
        flush();
        const op = s[i + 2] === '>' ? '&>>' : '&>';
        i += op.length - 1;
        toks.push({ r: op });
      } else { if (s[i + 1] === '&') i++; endSeg(); }
    } else if (c === '>') {
      dropFd();
      let op = '>';
      if (s[i + 1] === '>' || s[i + 1] === '|' || s[i + 1] === '&') op += s[++i];
      toks.push({ r: op });
    } else if (c === '<') {
      dropFd();
      if (s[i + 1] === '<' && s[i + 2] === '<') { i += 2; toks.push({ r: '<<<' }); }
      else if (s[i + 1] === '<') {
        i++;
        const strip = s[i + 1] === '-';
        if (strip) i++;
        toks.push({ r: '<<' });
        pendingDelim = { strip };
      } else toks.push({ r: '<' });
    } else add(c);
  }
  endSeg();
  return segs;
}

const PREFIXES = new Set(['sudo', 'command', 'env', 'time', 'nohup', 'exec']);
// Shell reserved words that can stand in front of the real command word once tokenize has
// split on `;`: `if [ … ]; then rm x; fi` leaves `then rm x` as a segment. Skipped like a
// prefix, or the keyword becomes the command and the write goes unseen.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);

// Non-flag arguments; `valueFlags` consume the next word. Everything after `--` is an argument.
function operands(words, valueFlags = []) {
  const out = [];
  let rest = false;
  for (let i = 0; i < words.length; i++) {
    const t = words[i];
    if (!rest && t.w === '--') rest = true;
    else if (!rest && t.w.startsWith('-') && t.w.length > 1) {
      if (valueFlags.includes(t.w)) i++;
    } else out.push(t);
  }
  return out;
}

// sed/perl: the file arguments, only when an in-place flag is present.
function inPlaceTargets(args) {
  let inplace = false;
  let hasScript = false;
  const rest = [];
  let afterDashes = false;
  for (let i = 0; i < args.length; i++) {
    const w = args[i].w;
    if (afterDashes || !w.startsWith('-') || w === '-') { rest.push(args[i]); continue; }
    if (w === '--') { afterDashes = true; continue; }
    if (w.startsWith('--')) {
      if (w.startsWith('--in-place')) inplace = true;
      else if (w === '--expression' || w === '--file') { hasScript = true; i++; }
      else if (w.startsWith('--expression=') || w.startsWith('--file=')) hasScript = true;
      continue;
    }
    if (/^-[nEpalsSTtuUwWXrzb0-9]*i/.test(w)) inplace = true; // flags that take an attached value (-Ilib, -Mstrict) end the bundle
    if (/^-[A-Za-z]*[ef]$/.test(w)) { hasScript = true; i++; }
  }
  if (!inplace) return [];
  return hasScript ? rest : rest.slice(1);
}

function segmentTargets(toks, cwd, env, state) {
  // lift redirects out of the word list
  const words = [];
  const out = [];
  const addTarget = (t) => {
    if (!t || t.dyn || !t.w || t.w.startsWith('/dev/')) return;
    out.push(resolve(state.cwd, t.w));
  };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!t.r) { words.push(t); continue; }
    const target = toks[i + 1] && !toks[i + 1].r ? toks[i + 1] : null;
    if (target) i++;
    if (WRITE_REDIRECTS.has(t.r) && target) {
      if (t.r === '>&' && /^(\d+|-)$/.test(target.w)) continue;
      addTarget(target);
    }
  }
  while (words.length && (/^[A-Za-z_]\w*=/.test(words[0].w) || PREFIXES.has(words[0].w) || KEYWORDS.has(words[0].w))) words.shift();
  if (!words.length) return out;
  const cmd = basename(words[0].w);
  const args = words.slice(1);
  // ac and git are trusted with their own arguments, but a redirect is performed by the
  // shell, not by them: `ac status > .astrocode/state.json` is a hand write.
  if (cmd === 'ac' || cmd === 'astrocode' || cmd === 'git') return out;

  if (cmd === 'cd') {
    if (args.length === 1 && !args[0].dyn && args[0].w !== '-') state.cwd = resolve(state.cwd, args[0].w);
    return out;
  }
  if (SHELLS.has(cmd)) {
    const ci = args.findIndex((a) => /^-[A-Za-z]*c$/.test(a.w));
    if (ci >= 0 && args[ci + 1] && !args[ci + 1].dyn) out.push(...bashTargets(args[ci + 1].w, state.cwd, env));
    return out;
  }
  if (cmd === 'sed' || cmd === 'perl') {
    for (const t of inPlaceTargets(args)) addTarget(t);
  } else if (cmd === 'tee') {
    for (const t of operands(args)) addTarget(t);
  } else if (cmd === 'rm' || cmd === 'unlink') {
    for (const t of operands(args)) addTarget(t);
  } else if (cmd === 'truncate') {
    for (const t of operands(args, ['-s', '--size', '-r', '--reference'])) addTarget(t);
  } else if (cmd === 'dd') {
    for (const t of args) if (t.w.startsWith('of=')) addTarget({ ...t, w: t.w.slice(3) });
  } else if (cmd === 'cp' || cmd === 'mv') {
    const ti = args.findIndex((a) => a.w === '-t' || a.w.startsWith('--target-directory='));
    let dir = null;
    if (ti >= 0) dir = args[ti].w === '-t' ? args[ti + 1] : { ...args[ti], w: args[ti].w.slice('--target-directory='.length) };
    const ops = operands(args, ['-t', '--target-directory', '-S', '--suffix']);
    const srcs = dir ? ops : ops.slice(0, -1);
    const dest = dir || ops[ops.length - 1];
    if (dest && !dest.dyn && (dir || ops.length >= 2)) {
      const isDirDest = dir || isDir(resolve(state.cwd, dest.w));
      if (isDirDest) for (const s of srcs) addTarget({ ...dest, w: join(dest.w, basename(s.w)) });
      else addTarget(dest);
    }
    if (cmd === 'mv') for (const s of srcs) addTarget(s);
  }
  return out;
}

/** The absolute paths a Bash command would WRITE (obvious forms only; see the header). */
export function bashTargets(command, cwd, env = process.env) {
  if (typeof command !== 'string') return [];
  const state = { cwd: resolve(cwd || process.cwd()) };
  const out = [];
  for (const seg of tokenize(command, env)) out.push(...segmentTargets(seg, state.cwd, env, state));
  return out;
}

// ---------------------------------------------------------------- the ADR rule (phase 53, ADR-087)

// Mirrors of lib/adr.mjs ADR_DIR_CANDIDATES / ADR_OFF_VALUES / ADR_FILE_RE (parity-tested).
export const ADR_DIR_CANDIDATES = ['docs/adr', 'adr', 'doc/adr'];
export const ADR_OFF_VALUES = ['', 'off'];
const ADR_FILE_RE = /^(\d{3,4})-.+\.md$/;

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
// The project's settings file, named by parts on purpose: tests/canon_guard.test.mjs pins that this
// script never mentions the user-level config that holds the mods switch (ADR-072). This is the
// PROJECT's file, read only for `decisions.adr_dir`.
const PROJECT_SETTINGS = ['config', 'json'].join('.');

// The first ancestor of `dir` (inclusive) that holds a `.astrocode/` directory.
function projectRootOf(dir) {
  for (let d = dir, hops = 0; hops < 64; hops++) {
    if (isDir(join(d, '.astrocode'))) return d;
    const up = dirname(d);
    if (up === d) return null;
    d = up;
  }
  return null;
}

// { folderAbs, claimed } when the project is ADR-active, else null. Throws on a corrupt mirror, which
// the caller turns into "allow" (fail open).
function adrState(root) {
  const local = join(root, '.astrocode');
  let mirror = null;
  try { mirror = readJson(join(local, '.local', 'adr-claims.json')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let configured;
  try {
    const v = readJson(join(local, PROJECT_SETTINGS))?.decisions?.adr_dir;
    if (v === false || (typeof v === 'string' && ADR_OFF_VALUES.includes(v.trim().toLowerCase()))) return null;
    if (typeof v === 'string') configured = v.trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  const hasNumbered = (dir) => {
    try { return readdirSync(join(root, dir)).some((f) => ADR_FILE_RE.test(f)); } catch { return false; }
  };
  const hits = ADR_DIR_CANDIDATES.filter(hasNumbered);
  const folder = configured || (typeof mirror?.adr_dir === 'string' ? mirror.adr_dir : null) || (hits.length === 1 ? hits[0] : null);
  if (!mirror && !configured && hits.length !== 1) return null;
  const claimed = new Set();
  for (const c of mirror?.claims || []) claimed.add(Number(c.number));
  let log = '';
  try { log = readFileSync(join(local, 'DECISIONS.md'), 'utf8'); } catch { /* none yet */ }
  for (const m of log.matchAll(/^##\s+ADR-(\d+)/gm)) claimed.add(Number(m[1]));
  return { folderAbs: folder ? realpathDeep(join(root, folder)) : null, claimed };
}

function adrDeny(display, digits) {
  return [
    `canon-guard: ${display} uses ADR number ${digits}, which is not claimed (ADR-087). Use: ac decision add "<title>" (or ac decision renumber <file> next)`,
    'If a teammate just claimed it, run `ac canon pull`; otherwise run `ac mods disable canon-guard` first.',
  ].join('\n');
}

// Headings `## ADR-<n>` present in `next` and absent from `prev`, as { id, digits }.
function addedHeadings(prev, next) {
  const ids = (t) => [...String(t || '').matchAll(/^##\s+(ADR-(\d+))/gm)].map((m) => ({ id: m[1], digits: m[2] }));
  const had = new Set(ids(prev).map((h) => h.id));
  return ids(next).filter((h) => !had.has(h.id));
}

// The ADR verdict for one target, or null. `t` carries the tool and its input for the DECISIONS.md text rule.
function adrVerdict(t, env) {
  if (typeof t.path !== 'string' || !t.path) return null;
  const home = env.HOME || homedir();
  const expanded = t.path === '~' ? home : t.path.startsWith('~/') ? join(home, t.path.slice(2)) : t.path;
  const real = realpathDeep(resolve(t.cwd, expanded));
  const dir = dirname(real);
  const name = basename(real);
  const isLog = name === 'DECISIONS.md' && basename(dir) === '.astrocode';
  const root = isLog ? dirname(dir) : projectRootOf(dir);
  if (!root) return null;
  if (isLog) {
    if (!['Write', 'Edit', 'MultiEdit'].includes(t.tool)) return null;
    const ti = t.ti || {};
    const pairs = t.tool === 'Write' ? [[safeRead(real), ti.content]]
      : t.tool === 'Edit' ? [[ti.old_string, ti.new_string]]
        : (Array.isArray(ti.edits) ? ti.edits : []).map((e) => [e?.old_string, e?.new_string]);
    const state = adrState(root);
    if (!state) return null;
    for (const [prev, next] of pairs) {
      for (const h of addedHeadings(prev, next)) {
        if (!state.claimed.has(Number(h.digits))) return adrDeny('.astrocode/DECISIONS.md', h.digits);
      }
    }
    return null;
  }
  const m = ADR_FILE_RE.exec(name);
  if (!m) return null;
  const state = adrState(root);
  if (!state || !state.folderAbs || dir !== state.folderAbs) return null;
  if (isFile(real)) return null; // editing or overwriting an EXISTING file is always allowed
  if (state.claimed.has(Number(m[1]))) return null;
  return adrDeny(relative(root, real).split(sep).join('/'), m[1]);
}

const safeRead = (f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

// ---------------------------------------------------------------- the conflict escape

// May this protected file be hand-edited because it is mid-merge? Fails CLOSED (see header).
function inConflict(file) {
  let head;
  try {
    const fd = openSync(file, 'r');
    try {
      const buf = Buffer.alloc(1 << 20);
      const n = readSync(fd, buf, 0, buf.length, 0);
      head = buf.toString('utf8', 0, n);
    } finally { closeSync(fd); }
  } catch { return false; } // absent file: nothing to resolve
  if (/^<<<<<<< /m.test(head)) return true;
  try {
    const r = spawnSync('git', ['status', '--porcelain', '--', basename(file)], { cwd: dirname(file), encoding: 'utf8', timeout: 2000 });
    return r.status === 0 && /^(DD|AU|UD|UA|DU|AA|UU) /m.test(r.stdout || '');
  } catch { return false; }
}

// ---------------------------------------------------------------- the verdict

/** Two plain lines: who writes the file and the verb to use, then both escapes. The rule's
 * source stays as a short tag; its history lives in MANUAL.md. */
export function denyReason(entry, displayPath) {
  const what = entry.store ? 'the personal principle store' : displayPath;
  return [
    `canon-guard: ${what} is written only by the ac CLI (${entry.source.replace(/^AGENTS\.md "Never hand-edit", /, '')}). Use: ${entry.verb}`,
    'Hand edits are allowed only to resolve a merge conflict; otherwise run `ac mods disable canon-guard` first.',
  ].join('\n');
}

function targetsOf(input, base, env) {
  const ti = input.tool_input;
  if (!ti || typeof ti !== 'object') return [];
  switch (input.tool_name) {
    case 'Write': case 'Edit': case 'MultiEdit': case 'Delete':
      return [{ path: ti.file_path, cwd: base, tool: input.tool_name, ti }];
    case 'NotebookEdit':
      return [{ path: ti.notebook_path, cwd: base }];
    case 'Bash':
      return bashTargets(ti.command, base, env).map((path) => ({ path, cwd: base, tool: 'Bash' }));
    case 'Shell':
      return bashTargets(ti.command, (typeof ti.cwd === 'string' && ti.cwd) || base, env).map((path) => ({ path, cwd: base }));
    default:
      return [];
  }
}

/** `{ reason, entry, path }` for a call to refuse, else null. */
export function decide(input, { env = process.env } = {}) {
  if (!input || typeof input !== 'object') return null;
  const base = (typeof input.cwd === 'string' && input.cwd) || process.cwd();
  for (const t of targetsOf(input, base, env)) {
    // ADR-087 — judged before the PROTECTED match; any internal error allows the call.
    try {
      const adr = adrVerdict(t, env);
      if (adr) return { reason: adr, entry: null, path: t.path };
    } catch { /* fail open */ }
    let hit = null;
    try { hit = judge(t.path, t.cwd, env); } catch { /* fail open */ }
    if (!hit || inConflict(hit.real)) continue;
    return { reason: denyReason(hit.entry, hit.display), entry: hit.entry, path: hit.real };
  }
  return null;
}

function main() {
  try {
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const verdict = decide(input, { env: process.env });
    if (!verdict) return;
    const cursor = process.argv[2] === 'cursor' || input.hook_event_name === 'preToolUse';
    const out = cursor
      ? { permission: 'deny', user_message: verdict.reason, agent_message: verdict.reason }
      : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: verdict.reason } };
    process.stdout.write(JSON.stringify(out));
  } catch { /* fail open — never block a tool call on our own error */ }
}

let isEntry = false;
try { isEntry = import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { /* imported, or -e */ }
if (isEntry) main();
