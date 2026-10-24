// Thin wrapper over the git CLI. Pure git — no GitHub/gh dependency — so the
// registry works against any remote (GitHub, GitLab, self-hosted, bare).
import { spawnSync } from 'node:child_process';

export function git(args, { cwd = process.cwd(), input, env } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
    // Windows: without this, every git call can flash a console window. The
    // status line shells out per render, so "a lot of empty terminals" is the
    // symptom users actually report.
    windowsHide: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    error: res.error,
  };
}

export const gitOk = (args, opts) => git(args, opts).status === 0;

export const isRepo = (cwd) =>
  gitOk(['rev-parse', '--is-inside-work-tree'], { cwd });

export const hasRemote = (remote, cwd) =>
  gitOk(['remote', 'get-url', remote], { cwd });

// Identity used to stamp registry claims. Email is the stable owner key;
// branch records where the claim was made (mirrors the team workflow).
export function gitIdentity(cwd) {
  const email = git(['config', 'user.email'], { cwd }).stdout.trim();
  const name = git(['config', 'user.name'], { cwd }).stdout.trim();
  const branch =
    git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).stdout.trim() || 'HEAD';
  return {
    owner: email || name || 'unknown',
    name: name || 'astro-code',
    email: email || 'astro-code@localhost',
    branch,
  };
}

// ── Attribution for `ac decision renumber` (phase 53, ADR-087 D5) ──────────────────────────────
//
// "Which side of a branch added this line?" is answered from git history alone — no gh, no
// similarity scoring. Anything git cannot answer with certainty is `unattributable`, and the caller
// LISTS it for a human instead of guessing (principle 333f).

/** The repo's default branch: origin/HEAD, else the first local main/master/develop, else null. */
export function defaultBranch(cwd) {
  const sym = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd });
  if (sym.status === 0 && sym.stdout.trim()) return sym.stdout.trim().replace(/^origin\//, '');
  for (const b of ['main', 'master', 'develop']) {
    if (gitOk(['show-ref', '--verify', '--quiet', `refs/heads/${b}`], { cwd })) return b;
  }
  return null;
}

/** The oldest commit that ADDED `rel`, or null when git has never seen it. */
export function addingCommit(cwd, rel) {
  const r = git(['log', '--diff-filter=A', '--format=%H', '--', rel], { cwd });
  if (r.status !== 0) return null;
  const shas = r.stdout.split('\n').map((x) => x.trim()).filter(Boolean);
  return shas.length ? shas[shas.length - 1] : null;
}

const isAncestor = (cwd, a, b) => gitOk(['merge-base', '--is-ancestor', a, b], { cwd });
const revList = (cwd, range) => {
  const r = git(['rev-list', range], { cwd });
  return r.status === 0 ? new Set(r.stdout.split('\n').map((x) => x.trim()).filter(Boolean)) : null;
};

/**
 * The branch side `commit` belongs to, as seen from HEAD:
 *  - `{ kind: 'merged', merge, commits }`: the OLDEST first-parent merge M with `commit` an ancestor of
 *    M^2 and not of M^1; `commits` is every commit that merge brought in (M^1..M^2).
 *  - `{ kind: 'unmerged', commits }`: HEAD is a feature branch and `commit` is not on the default
 *    branch; `commits` is default..HEAD.
 *  - `{ kind: 'unattributable', reason }`: squash or fast-forward onto the default branch, a missing
 *    merge base, a shallow clone, a git failure. Nothing is guessed.
 */
export function branchSideOf(cwd, commit) {
  const no = (reason) => ({ kind: 'unattributable', reason });
  if (!commit) return no('no commit');
  if (git(['rev-parse', '--is-shallow-repository'], { cwd }).stdout.trim() === 'true') return no('shallow clone');
  if (git(['cat-file', '-e', `${commit}^{commit}`], { cwd }).status !== 0) return no('unknown commit');
  const merges = git(['rev-list', '--first-parent', '--merges', 'HEAD'], { cwd });
  if (merges.status !== 0) return no('git could not list merges');
  for (const m of merges.stdout.split('\n').map((x) => x.trim()).filter(Boolean).reverse()) {
    if (!isAncestor(cwd, commit, `${m}^2`) || isAncestor(cwd, commit, `${m}^1`)) continue;
    const commits = revList(cwd, `${m}^1..${m}^2`);
    return commits ? { kind: 'merged', merge: m, commits } : no('git could not list the merged commits');
  }
  const def = defaultBranch(cwd);
  const head = git(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).stdout.trim();
  if (!def) return no('no default branch found');
  if (head === def || head === 'HEAD') return no('on the default branch, outside any merge (squash or fast-forward)');
  if (isAncestor(cwd, commit, def)) return no(`already on ${def} without a merge commit (squash or fast-forward)`);
  const commits = revList(cwd, `${def}..HEAD`);
  return commits ? { kind: 'unmerged', commits } : no('no merge base with the default branch');
}

/** Per-line commit SHA of `rel` as it is now (40 zeros for uncommitted lines), or null on failure. */
export function blameCommits(cwd, rel) {
  const r = git(['blame', '--porcelain', '-w', '-M', '-C', '--', rel], { cwd });
  if (r.status !== 0) return null;
  const out = [];
  for (const line of r.stdout.split('\n')) {
    const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (m) out[Number(m[2]) - 1] = m[1];
  }
  return out;
}
