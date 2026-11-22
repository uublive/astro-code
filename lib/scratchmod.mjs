// A scratch git repo of a Go module that lives BELOW the repo root, so Gremlins' `--diff` can run on
// it (phase 59, ADR-096 / CONTEXT D4).
//
// Why: Gremlins maps `git diff` paths to the module's files and cannot do it when go.mod is in a
// subfolder, so `ac mutate` fell back to whole-file mode, mutating every line of the changed files
// (716 mutants for a phase that changed a few lines) and filtering to the phase's lines afterwards.
// Here the module is copied out as its OWN repo: commit 1 = the module at the phase's base, commit 2
// = the module at HEAD. Inside it, `--diff <commit 1>` sees module-relative paths and tests only the
// changed lines.
//
// Soundness is checked, never assumed. A module that reaches outside itself would build differently
// in a copy (a `go.work`, a `replace` to `../x`, a `//go:embed ../x`), so any of those returns
// `ok: false` with the reason and the caller keeps the whole-file mode. And the scratch repo's diff
// (file list and `@@` hunk headers) must equal the real repo's diff for the module, path-mapped; any
// difference, or an empty diff, is `ok: false`. A mutant is never reported from a scope this
// module could not prove equal to the phase's own lines.
//
// git CLI and `tar` only, no global git config (GIT_CONFIG_GLOBAL=/dev/null), nothing written outside `into`.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Per call, never at load: the caller's environment (a restricted PATH in a test, a changed HOME) is the one that counts.
const gitEnv = () => ({ ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' });
const COMMIT_ARGS = ['-c', 'user.name=ac', '-c', 'user.email=ac@local', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null'];

const git = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, env: gitEnv(), maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

// Extract `git archive <tree>` of the repo at `root` into `dest` (created). Throws when git or tar fails.
function extract(root, tree, dest) {
  const tarball = git(root, ['archive', '--format=tar', tree]);
  // `tar` is a system tool: /usr/bin and /bin are appended so a minimal PATH (a sandbox, a test) still finds it.
  const env = { ...process.env, PATH: [process.env.PATH, '/usr/bin', '/bin'].filter(Boolean).join(':') };
  const r = spawnSync('tar', ['-x', '-C', dest], { input: tarball, env, stdio: ['pipe', 'ignore', 'pipe'] });
  if (r.status !== 0) throw new Error(`tar failed: ${r.error ? r.error.message : String(r.stderr).trim()}`);
}

// Hunk headers per file of `git diff --unified=0`, as comparable lines (`file` then its `@@` ranges).
function hunks(text, strip = '') {
  const out = [];
  for (const line of text.split('\n')) {
    const f = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (f) out.push(`file ${strip && f[2].startsWith(strip) ? f[2].slice(strip.length) : f[2]}`);
    const h = /^(@@ -\S+ \+\S+ @@)/.exec(line);
    if (h) out.push(h[1]);
  }
  return out;
}

function gate(root, modDir) {
  if (existsSync(join(root, 'go.work')) || existsSync(join(modDir ? join(root, modDir) : root, 'go.work'))) return 'a go.work file is present, so the module would build differently in a copy';
  const modAbs = join(root, modDir);
  let gomod = '';
  try { gomod = readFileSync(join(modAbs, 'go.mod'), 'utf8'); } catch { /* a module new at HEAD always has one; none is caught by the diff check */ }
  if (/^\s*(?:replace\s+)?\S+(?:\s+\S+)?\s*=>\s*\.\.\//m.test(gomod)) return 'go.mod has a replace to a path outside the module (../)';
  const files = String(git(root, ['ls-files', '--', modDir])).split('\n').filter((f) => f.endsWith('.go'));
  for (const f of files) {
    let text = '';
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    if (/^\s*\/\/go:embed\b[^\n]*\.\./m.test(text)) return `${f} has a //go:embed pattern that reaches outside the module (..)`;
  }
  return null;
}

export function scratchModule(root, { modDir, base, into }) {
  try {
    const why = gate(root, modDir);
    if (why) return { ok: false, reason: why };
    const dir = join(into, 'mod');
    mkdirSync(dir, { recursive: true });
    git(dir, ['init', '-q']);
    const existed = (() => { try { git(root, ['cat-file', '-e', `${base}:${modDir}`]); return true; } catch { return false; } })();
    if (existed) extract(root, `${base}:${modDir}`, dir);
    git(dir, ['add', '-A']);
    git(dir, [...COMMIT_ARGS, 'commit', '-q', '--allow-empty', '-m', 'base']);
    const scratchBase = String(git(dir, ['rev-parse', 'HEAD'])).trim();
    for (const n of readdirSync(dir)) if (n !== '.git') rmSync(join(dir, n), { recursive: true, force: true });
    extract(root, `HEAD:${modDir}`, dir);
    git(dir, ['add', '-A']);
    git(dir, [...COMMIT_ARGS, 'commit', '-q', '--allow-empty', '-m', 'head']);
    const theirs = hunks(String(git(dir, ['diff', '--unified=0', '--no-color', '--no-renames', scratchBase, 'HEAD'])));
    const ours = hunks(String(git(root, ['-c', 'core.quotepath=off', 'diff', '--unified=0', '--no-color', '--no-renames', base, 'HEAD', '--', modDir])), `${modDir}/`);
    if (!theirs.length) return { ok: false, reason: 'scratch diff is empty — nothing to run on' };
    if (theirs.length !== ours.length || theirs.some((l, i) => l !== ours[i])) return { ok: false, reason: 'scratch diff differs from the repo diff' };
    return { ok: true, dir, base: scratchBase };
  } catch (e) {
    return { ok: false, reason: `scratch module failed: ${String(e.stderr || e.message).trim().split('\n')[0]}` };
  }
}
