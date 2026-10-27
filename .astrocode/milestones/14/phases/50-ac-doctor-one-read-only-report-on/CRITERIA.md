# Phase 50 — success criteria (pre-registered, plan-blind)

Shared sandbox used by the Observe steps (nothing below touches the real install):

```
S=$(mktemp -d); export HOME=$S/home; mkdir -p "$HOME"
unset CLAUDE_CONFIG_DIR CODEX_HOME CURSOR_CONFIG_DIR XDG_CONFIG_HOME
AC="node /Users/buu/Development/astro-code/bin/ac.mjs"
$AC install            # the "clean install" every criterion starts from unless it says otherwise
```

To make a host count as installed, do whatever `ac install` itself uses to detect it (its own
output lists the hosts/dirs it targeted); a second Claude profile is `CLAUDE_CONFIG_DIR=$S/claude2`
exported before the install. "Problem line" means a line of `ac doctor` human output that reports a
failing check. Run `ac doctor` from a scratch non-project directory unless a criterion says otherwise.

### C1 — On a clean install, `ac doctor` reports no problem and exits 0
- **Observe:** in the sandbox after a fresh `$AC install` (once with only Claude Code's default dir, once with a second Claude profile plus every other host install detects), run `cd $S && $AC doctor; echo $?` and `$AC doctor --json`. Exit is 0, there is no problem line and no warning glyph/line, and every JSON check object has `ok: true`. Hosts the sandbox does not have (e.g. no Codex dir) produce no lines at all. A clean install on a machine with no qualifying Claude Code (so the astro-mods plugin was never installed) is still exit 0 with no warning.
- **Fails if:** a clean install prints any warning or problem line, exits non-zero, reports a host that is not installed, flags the absent plugin when Claude Code was never able to install it, or flags registry drift merely because the cwd is not an astro-code project.

### C2 — Version drift and a stale update-check cache are each named with their fix
- **Observe:** in the sandbox, (a) change the version the install recorded in the astro home to an older one (e.g. `0.0.1`) so it no longer matches the clone it came from; run `$AC doctor; echo $?`. (b) restore it, then make the update-check cache in the astro home stale (dated a year ago, contents and/or mtime) and run again. Each case yields exactly one problem line naming that drift (installed vs clone version; cache age), ending with the exact command that fixes it (e.g. `ac update`), and a non-zero exit. With no update-check cache present at all, no problem is reported for it.
- **Fails if:** either drift goes unreported, exits 0, the line has no runnable fix command, or a missing cache (normal right after `ac update`, which deletes it) is reported as a problem.

### C3 — A hook command whose interpreter is missing or does not run is named per config dir (#126)
- **Observe:** with two Claude profiles installed, edit one profile's settings.json so an astro hook entry's command uses a non-existent interpreter path (e.g. `/opt/homebrew/Cellar/node/0.0.0/bin/node`); run `$AC doctor; echo $?`. Then instead point it at an existing file that is not a working interpreter (e.g. an executable script that exits 1, or a non-executable file). Each case gives a problem line naming that config dir and the bad interpreter, with a fix command, exit non-zero; the untouched profile reports no hook problem.
- **Fails if:** the dead interpreter is not detected, is attributed to the wrong or to every config dir, only "exists" is checked so a non-running interpreter passes, or the healthy profile gets a false warning.

### C4 — Hook registrations that disagree with the mods switches are named with the exact `ac mods` / install fix
- **Observe:** in the sandbox, `$AC mods enable git-guard` (or any hook-kind feature), then (a) remove that feature's settings-hook entry from one Claude profile's settings.json by hand → doctor names the feature and that dir as "on but not registered" with an exact fix command; (b) restore, then `$AC mods disable git-guard` and hand-add the entry back into a settings.json → doctor names it as "registered while off" with an exact fix. Both exit non-zero; with switch and registrations in agreement (on everywhere, or off everywhere) there is no such problem line.
- **Fails if:** either direction of mismatch is missed, the message does not name the feature and dir, the fix is not a concrete command, or a consistent on/off state is reported as drift.

### C5 — A settings.json hook registration naming a script missing from the home copy is reported
- **Observe:** after a clean install, delete from the astro home one hook script that some settings.json registration names (any host/profile that has hooks), run `$AC doctor; echo $?`. A problem line names the missing script path (and the registering config dir) with an exact fix command (e.g. `ac update`/`ac install`); exit non-zero. Running that fix command in the sandbox and re-running the doctor clears the problem.
- **Fails if:** the dangling registration is not reported, is only detected when the hook runs, or the printed fix does not actually restore the script.

### C6 — Missing, broken and stale command/agent links are named on every installed host
- **Observe:** with Claude Code (two profiles) and at least one other host (Codex, Cursor or OpenCode) installed in the sandbox, seed in one target each of: (a) a shipped command removed from a host's command dir; (b) a command or agent link whose target no longer exists (dangling); (c) a leftover `astro-*` command/agent link or copy that the shipped set no longer contains, including one in a Claude profile dir that the install no longer targets (e.g. created by an earlier install with a different `CLAUDE_CONFIG_DIR`, then the env var changed). `$AC doctor` names each one with its host and dir and a fix command, exits non-zero, and reports all of them in one run. A host that is not installed is never reported.
- **Fails if:** any of the three kinds is missed on any installed host, only Claude Code is checked, the run stops at the first problem, the stale link in a no-longer-targeted dir goes unnoticed, or a non-installed host shows up.

### C7 — A missing `additionalDirectories` grant for the astro home is named with the exact path to grant (#15)
- **Observe:** in a Claude profile where the grant is present (the resolved path `$AC path` prints listed under `permissions.additionalDirectories`), doctor reports no grant problem; remove it, or replace it with the unresolved form of a symlinked home (e.g. make `$HOME` reached through a symlink and grant the unresolved path), and run `$AC doctor; echo $?`. A problem line names the profile and gives the exact fix, which contains the resolved path `ac path` prints; exit non-zero.
- **Fails if:** a missing grant or a grant written in the unresolved (non-matching) form passes, or the fix names a path other than the resolved one.

### C8 — Registry drift is reported exactly when `ac canon check` reports it
- **Observe:** create a scratch astro-code project with a real bare remote and an initialised registry (`ac init`, `ac registry init`, `ac canon push`). From inside it, with canon in sync, `$AC canon check` is clean and `$AC doctor` has no registry problem. Then edit the local CONVENTIONS.md (or otherwise make `ac canon check` report drift) and run both again: `ac doctor` now shows a registry problem line with the fix command, exits non-zero, and its verdict matches `ac canon check`'s.
- **Fails if:** doctor and `ac canon check` disagree in either state, drift is not reported, or a registry problem is reported for an in-sync project or for a directory that is not a project.

### C9 — An astro-mods plugin whose installed version differs from astro-code's is reported
- **Observe:** in the sandbox with Claude Code at or above the mods floor, let `$AC install` install the plugin (or, without a usable `claude` CLI, write the Claude Code plugin records by hand in its documented layout at the current astro-code version). Doctor shows no plugin problem. Change the recorded/cached astro-mods version to `0.41.0`; run `$AC doctor; echo $?`. A problem line names the profile, the installed plugin version and astro-code's version, with an exact fix command; exit non-zero.
- **Fails if:** a stale plugin version (the 0.41.0 band case) passes, the matching version is flagged, or detecting it requires the doctor to change anything.

### C10 — The doctor is strictly read-only and spawns no package manager
- **Observe:** for the clean state and for each seeded drift state of C2–C9, record a content+mode+symlink-target listing of every file under `$HOME` (and of the scratch project's working tree, excluding `.git/`) before and after running `$AC doctor` and `$AC doctor --json`; with `PATH` prefixed by a directory of shims named `npm`, `npx`, `pnpm`, `yarn`, `bun`, `brew` that each append to a marker file. The listings are identical and the marker file is never created.
- **Fails if:** any file is created, modified, removed or relinked (e.g. the update cache refreshed, a link repaired, a settings.json rewritten), or any package-manager shim is invoked.

### C11 — Output is one short line per check, and `--json` is the same report in a stable shape
- **Observe:** in a state with several seeded drifts across two hosts, run `$AC doctor` and `$AC doctor --json` and compare. The JSON parses and contains one object per check with at least `id`, the host and/or dir it concerns, `ok`, `detail` and `fix` (fix set on every `ok:false` object). Every `ok:false` object corresponds to exactly one single-line problem in the human output that ends with that object's `fix`; the human output carries no multi-line explanations per check. Both modes exit with the same code.
- **Fails if:** the JSON is missing a field, has a failing check without a fix, the human and JSON reports disagree on which checks failed, a problem spans several lines or lacks its fix at the end, or the exit code differs between modes.

### C12 — `ac --version` prints astro-code's version and `ac help` shows both new surfaces
- **Observe:** `$AC --version; echo $?` from a non-project dir prints the version in the running astro-code's package.json (and nothing that is an error), exit 0, writes nothing under `$HOME`. `$AC help` output lists `doctor` (with `--json`) and `--version`.
- **Fails if:** `--version` errors, prints a different or placeholder version, or either surface is absent from `ac help`.

### C13 — `ac update` ends by running the doctor and prints only its failures
- **Observe:** `git clone /Users/buu/Development/astro-code $S/clone` and use `node $S/clone/bin/ac.mjs` for install and `update` (a local clone, so the pull needs no network and the global-CLI refresh is skipped). (a) From a clean install, run `update`: its output contains no doctor line at all (no passing checks, no "all ok" summary). (b) Seed a drift that the update does not itself repair (choose one, then confirm by running `ac doctor` after the update that it still reports it); run `update` again: the end of its output contains exactly the problem line(s) a following `ac doctor` prints, and no passing-check lines.
- **Fails if:** update does not run the doctor, prints passing checks or a clean-summary line when nothing is wrong, omits a surviving failure, or the failures it prints differ from what `ac doctor` reports.

### C14 — `/astro-doctor` reaches the same report on every installed host
- **Observe:** after the sandbox install, each installed host's command set offers `astro-doctor` like the other astro commands, and the doctor's own link check (C6) counts it as part of the shipped set (removing it is reported). Reading the installed command shows it obtains its findings by running `ac doctor` (optionally `--json`) rather than performing its own separate checks, and reports a clean result in at most one line.
- **Fails if:** the command is missing on an installed host, reimplements checks that can diverge from `ac doctor`, or the doctor does not notice it missing.

### C15 — The existing test suite stays green with the doctor in place
- **Observe:** `cd /Users/buu/Development/astro-code && node --test tests/` exits 0.
- **Fails if:** any test fails or the suite cannot load.
