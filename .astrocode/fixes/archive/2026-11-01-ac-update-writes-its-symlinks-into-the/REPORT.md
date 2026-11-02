The ac update bug: he wants it FIXED, not just recorded. ac update writes its symlinks into the astro-code repo because /data/claude/accounts/ScaleUpLabs/agents and commands are links into the repo. Fix it properly with /astro-fix, ideally before the phase-55 edits so they land in the real source files. Make the installer detect that case and handle it safely, with a regression test, and fix this machine's setup as part of it.

(Owner, relayed by Comet, 2026-11-01.)

## Observed

- `git status` in /Users/buu/Development/astro-code showed every `agents/*.md` and `commands/*.md` as
  typechanged (` T`): each tracked file had been replaced by a symlink to
  `/Users/buu/.astroforge/astro-code/<agents|commands>/<name>.md`.
- `/data/claude/accounts/ScaleUpLabs/agents -> /Users/buu/Development/astro-code/agents` and
  `/data/claude/accounts/ScaleUpLabs/commands -> /Users/buu/Development/astro-code/commands` (links dated Jul 23).
- `ac update` installs into that config dir (`[env]` in its output), so its per-file links land in the
  source checkout.

## Diagnosis

- **Symptom:** tracked `agents/*.md` / `commands/*.md` in the dev checkout became symlinks into
  `~/.astroforge/astro-code` (git typechanges).
- **Cause (astro-code):** `installClaude` → `symlinkInto` removes any existing file of the same name in
  each config dir's `commands/`/`agents/` and links it to `~/.astro/code`. Its self-hosted guard only
  compared those subdirs with the checkout being installed (`frameworkRoot`, here the `ac update` clone
  `~/.astroforge/astro-code`). The ScaleUpLabs config dir's subdirs were symlinks into a *different*
  checkout (the dev repo), so the guard missed it and the dev repo's tracked files were deleted and
  replaced with links.
- **Why the links end up pointing at `~/.astroforge/astro-code`:** Forge's account provisioning
  (`astro-forge/server/internal/astrocode`, `LinkAccountCommands`) then repoints any *symlink* it finds to
  its own astro-code clone. It never touches real files, so it only finished what astro-code started. Not
  changed here (other repo; harmless once astro-code no longer deletes real files).
- **Ruled out:** `~/.astro` / `~/.astro/code` being symlinks (they are real dirs); the uninstall prune
  (only removes symlinks into `~/.astro/code`).

## Fix

- `lib/install.mjs`: `inSourceCheckout(dir)` — a config subdir whose real parent holds astro-code's own
  `package.json` (name `astro-code`) and `bin/ac.mjs` is treated like the existing self-hosted case:
  flagged `selfHosted`, nothing linked into it (hooks wiring stays).
- Machine setup: `/data/claude/accounts/ScaleUpLabs/agents` and `commands` were symlinks into
  `/Users/buu/Development/astro-code`; replaced with real directories, then `ac update` populated them with
  the normal links into `~/.astro/code`. That account now runs the installed (released) commands/agents
  instead of the live dev source. The dev repo stayed clean after the re-run.

## Verification

- Repro `node --test tests/fix_install_other_checkout.test.mjs`: failed before, passes now; with
  `tests/install.test.mjs` and `tests/install_ledger.test.mjs`: 17 pass, 0 fail.
- Full suite (`npm test`): 2,807 pass, 8 fail, 8 skipped. The 8 are pre-existing and unrelated:
  the same 3 failures in `doctor`, `plant` and `witness` reproduce identically with `lib/install.mjs`
  reverted to develop, and the other 5 (`doctor` ADR rows) pass when their file runs alone.
- Live: after replacing the ScaleUpLabs links and running a real `ac update`, the dev repo shows 0
  typechanges.
