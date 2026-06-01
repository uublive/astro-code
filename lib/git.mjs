// Thin wrapper over the git CLI. Pure git — no GitHub/gh dependency — so the
// registry works against any remote (GitHub, GitLab, self-hosted, bare).
import { spawnSync } from 'node:child_process';

export function git(args, { cwd = process.cwd(), input, env } = {}) {
  const res = spawnSync('git', args, {
    cwd,
    input,
    encoding: 'utf8',
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
