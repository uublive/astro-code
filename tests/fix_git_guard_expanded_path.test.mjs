// Fix 2026-11-09-git-guard-refuses-a-command-run-by-an (GitHub #169): a program run by an expanded path
// (`"$HOME/bin/tool" --reason switch`) was refused as a possible hidden git, because any expansion in the
// command word sent its arguments to the destructive-word check. One plain variable (or ~) before a
// literal path is an ordinary program path; an expansion that may itself be git is still refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'astro-git-guard.mjs');
const PATHS = '/usr/bin:/bin';

function repo() {
  const S = realpathSync(mkdtempSync(join(tmpdir(), 'ac-gg169-')));
  const HOME = join(S, 'home');
  mkdirSync(join(HOME, '.astro'), { recursive: true });
  mkdirSync(join(HOME, 'tmp'));
  const R = join(S, 'r');
  mkdirSync(R);
  const env = { PATH: PATHS, HOME: R, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: R, env, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(R, 'a.js'), 'x\n');
  git('add', '-A'); git('commit', '-q', '-m', 'init');
  writeFileSync(join(R, 'a.js'), 'changed\n'); // work at stake
  return { HOME, R };
}

const verdict = (command, { HOME, R }) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd: R, tool_name: 'Bash', tool_input: { command } }),
    env: { PATH: PATHS, HOME, TMPDIR: join(HOME, 'tmp') }, encoding: 'utf8', timeout: 20000,
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision : 'allow';
};

test('#169: a program run by an expanded path is judged by its name, so a plain `switch` argument is allowed', () => {
  const s = repo();
  for (const c of ['"$HOME/bin/tool" --reason switch', '$HOME/bin/tool --reason switch', '${HOME}/bin/tool reset',
    '~/bin/close --mode stash', '"$HOME/x/y/tool" checkout restore clean']) {
    assert.equal(verdict(c, s), 'allow', c);
  }
});

test('#169: an expansion that may itself be git is still refused', () => {
  const s = repo();
  for (const c of ['$GIT reset --hard', '"$(command -v git)" reset --hard', '${GIT:-/usr/bin/git} reset --hard',
    '"$HOME/bin/git" reset --hard', '$HOME/$TOOL stash -u']) {
    assert.ok(['ask', 'deny'].includes(verdict(c, s)), c);
  }
});
