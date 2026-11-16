**git-guard refuses any command whose first word is an expansion (`"$HOME/…"`) when an argument is the plain word `switch`, `stash`, `clean`, `reset`, `checkout` or `restore`** (checked on v0.52.0).

## Reproduction (clean, hook run directly)

`hooks/astro-git-guard.mjs` fed a PreToolUse payload (`tool_name: Bash`, any `cwd`):

| command | verdict |
|---|---|
| `"$HOME/bin/tool" --reason switch` | **deny** ("`--reason switch` might throw away uncommitted work (git-guard cannot tell what it touches)") |
| `$HOME/bin/tool --reason switch` | **deny** |
| `/home/x/bin/tool --reason switch` | allow |
| `tool --reason switch` | allow |
| `"$HOME/bin/tool" --reason other` | allow |
| `echo "$HOME" switch` | allow |

No `git` word appears anywhere in the denied commands.

## Cause

`judgeCommand`, `hooks/astro-git-guard.mjs` line 399:

```js
// `$GIT stash -u`, `"$(which git)" reset --hard`: the command word itself is an expansion.
if (dynamic(words[0])) return unsure(words.slice(1));
```

`unsure()` (line 358) refuses when any later word is in `DANGER`. The intent is to catch an expansion standing in for `git`, but `$HOME/…` is an ordinary path to a program, and `switch` is just a value of a flag.

## Impact

A launcher called by an expanded path with a reason or mode argument that happens to be one of those six words is blocked, with a message pointing at `git stash` that has nothing to do with the command. Seen in practice: a session-close script invoked as `"$HOME/…/close" --reason switch`. The workaround is a launcher on `PATH` (a plain first word); the only other way out is `ac mods disable git-guard`.

## Suggestion

Keep refusing an expansion that may *be* git (`$GIT`, `$(which git)`, `` `…` ``, `${…}` with no `/` path part), but treat a first word that expands only a path (`$HOME/…`, `${HOME}/…`, `~/…`, any word whose last path component is literal and not `git`) as an ordinary command: judge its basename, as is already done for `/home/x/bin/tool`. A test pair: `"$HOME/bin/tool" --reason switch` allowed, `"$HOME/bin/git" reset --hard` and `$GIT reset --hard` still refused.

---
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
🤖 Generated with [Claude Code](https://claude.com/claude-code)


(GitHub #169 by @luigi-lauro, verbatim above.)

## Diagnosis

- **Symptom:** `"$HOME/bin/tool" --reason switch` refused as "might throw away uncommitted work".
- **Cause:** `judgeSegment` sent the arguments of ANY command word containing an expansion to the
  destructive-word check (`unsure`), meant for an expansion standing in for git (`$GIT`).
- **Not loosened:** an expansion that may itself be git — `$GIT`, `$(command -v git)`, `${GIT:-/usr/bin/git}`,
  `$HOME/$TOOL` — is still refused; a path ending in `git` (`$HOME/bin/git`) was and is judged as git.

## Fix

`pathOnly(word)`: one plain variable (`$HOME`, `${HOME}`) or `~`, then only literal path parts. Such a word
is an ordinary program path and is judged by its name, like `/home/x/bin/tool`.

## Verification

- Repro `tests/fix_git_guard_expanded_path.test.mjs`: fails before, passes after; all git-guard suites: 36 pass.
- Full suite: 2,854 pass, 0 fail.
