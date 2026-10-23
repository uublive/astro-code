# Phase 50 — acceptance (human UAT)

Run these in a throwaway `HOME`, never against your real install:

```
S=$(mktemp -d); export HOME=$S/home; mkdir -p "$HOME"
AC="node /Users/buu/Development/astro-code/bin/ac.mjs"
```

Run each item from a non-project directory unless the item says otherwise.

- [ ] **The user can run `ac doctor` on a fresh install and get one `✓` line and exit 0.**
  - *Precondition:* a fresh `$AC install` into the empty sandbox `HOME`, with only Claude Code's
    default dir. There is no `update-check.json`, no astro-mods plugin record, no Codex, Cursor or
    OpenCode dir, and the cwd is outside any project.
  - Also try it with `~/.codex` and `~/.config/opencode` created before the install. You should
    still see one `✓` line, and no line for any host you did not create.

- [ ] **The user sees the install grant `ac path`'s resolved directory without pasting it by
  hand.**
  - *Precondition:* the fresh install above. `~/.claude/settings.json` contains
    `permissions.additionalDirectories` with exactly what `$AC path` prints.
  - **This is new installer behaviour (PLAN P1). Confirm it is acceptable.**
  - Then delete that entry. `ac doctor` names the dir, ends with
    `ac install  # grants <that path>`, and exits 1.

- [ ] **The user can read one line per problem, each ending with the command that fixes it, and
  running that command clears it.**
  - *Precondition:* the fresh install, then:
    1. delete `~/.astro/code/hooks/astro-precompact.mjs`;
    2. in `~/.claude/settings.json`, point one astro hook's interpreter at
       `/opt/homebrew/Cellar/node/0.0.0/bin/node`;
    3. add a link `~/.claude/commands/astro-gone.md` → `~/.astro/code/commands/astro-gone.md`
       (which does not exist).
  - Expect three `⚠` lines, exit 1. Run each printed fix, then `ac doctor` again: one `✓` line.

- [ ] **The user sees a stale astro-mods plugin named with both versions.**
  - *Precondition:* a sandbox where Claude Code at or above the mods floor installed the plugin
    during `ac install`. If not, write `~/.claude/plugins/installed_plugins.json` by hand as
    `{"version":2,"plugins":{"astro-mods@astro-code":[{"scope":"user","version":"<current>"}]}}`.
  - `ac doctor` is clean. Change the version to `0.41.0`: one `⚠` line names `0.41.0`, the current
    version and `ac update`.

- [ ] **The user can paste `ac doctor --json` into a bug report and it says the same thing as the
  human output.**
  - *Precondition:* the three-drift state from item 3, before fixing it.
  - The JSON is an array of `{id, host, dir, ok, detail, fix}`. Exactly the three `ok:false` rows
    match the three `⚠` lines, and both modes exit 1.

- [ ] **The user can run `ac --version` and get astro-code's version.**
  - *Precondition:* any state, including a `HOME` with no install.
  - It prints `astro-code <package.json version>`, exits 0 and creates nothing. `ac help` lists both
    `ac doctor [--json]` and `ac --version`.

- [ ] **The user runs `ac update` and sees nothing from the doctor when clean, and only the
  surviving problems when not.**
  - *Precondition:* `git clone /Users/buu/Development/astro-code $S/clone`, then
    `node $S/clone/bin/ac.mjs install`.
  - `update` shows no doctor line.
  - Then create a dir `$S/c2`, run `CLAUDE_CONFIG_DIR=$S/c2 node $S/clone/bin/ac.mjs install`,
    unset the variable, and add `$S/c2/commands/astro-gone.md`. A second `update` ends with exactly
    the `⚠` line that `ac doctor` prints for it.

- [ ] **The user can type `/astro-doctor` in Claude Code and get the same answer as `ac doctor`.**
  - *Precondition:* an installed Claude Code profile. This one runs on the real machine after
    `ac update`, since it needs a live Claude session.
  - When clean, it answers in one line.
  - With a drift it lists the same `⚠` lines, and offers nothing it did not get from `ac doctor`.
