# Reproduction

`node --test tests/fix_git_guard_expanded_path.test.mjs` feeds the real hook a PreToolUse payload in a repo
with uncommitted work. Before the fix: `"$HOME/bin/tool" --reason switch` and four similar commands were
refused (test 1 fails). After: they are allowed, while `$GIT reset --hard`, `"$(command -v git)" reset --hard`,
`${GIT:-/usr/bin/git} reset --hard`, `"$HOME/bin/git" reset --hard` and `$HOME/$TOOL stash -u` stay refused.
