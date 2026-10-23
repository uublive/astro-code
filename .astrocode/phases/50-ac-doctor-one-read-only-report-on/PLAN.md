# Plan — phase 50: `ac doctor`, one read-only report on whether the install and its hooks are consistent

Obeys `.astrocode/CONVENTIONS.md`: Node ≥22 ESM `.mjs`, zero deps, `node:` builtins only, named
function exports only, `die()` for fatal CLI errors only, `✓`/`•`/`⚠` glyphs, `json()`, a
`node:test` test for every `lib/` change, real filesystem (`mkdtempSync`) in tests, the
load-bearing comment voice, and the §Voice reporting bounds. It also obeys
`.astrocode/DECISIONS.md`: there is no `DECISIONS.in-force.md`; the ADRs in force here are ADR-018,
ADR-029, ADR-030, ADR-071, ADR-072 and ADR-075. It follows this phase's `CONTEXT.md` (D1–D4) and
aims at every criterion in `CRITERIA.md` (C1–C15).

Principles applied, from `ac principles brief --stage plan`:
- e618: short and plain; data first.
- 9173: every rule in one place. No second hook-command parser, host map, plugin reader or grant
  rule.
- b940: an optional check fails soft with a visible reason.
- 2310: `/astro-doctor` ships beside `ac doctor`.
- 333f: checks are deterministic, with no judgement.
- 4823: the doctor's non-zero exit gates a personal install, never a shared project. That is why
  `ac update` keeps its own exit code (P3).

## Decisions this plan pins (CONTEXT "Open for the planner", plus two conflicts)

**P1. CONFLICT. `ac install`/`ac update` write the `additionalDirectories` grant. This is
deliberate and flagged for the human at plan review.**
- **Why it is needed:**
  - C1 says a fresh `ac install` reports no problem.
  - C7 says a missing grant IS a problem.
  - Today nothing writes the grant: MANUAL §"Letting Claude Code run the shipped workflows" asks
    the user to paste it by hand.
  - So C1 and C7 can only both hold if install writes it.
  - The grant is effectively required, because without it Claude Code will not read the shipped
    workflow `scriptPath`.
- **What it does:** `claude.mjs registerHooks(dir, home)` adds `realpathSync(home)` (the exact
  string `ac path` prints) to `permissions.additionalDirectories`, in the same write it already
  makes to each Claude config dir's `settings.json`.
  - It is additive and idempotent.
  - The user's other entries are kept.
  - An unparseable file is left alone, as today.
- **Reversal:** `unregisterHooks` removes only that exact string, and drops an array or object it
  emptied.
- **Conflict:** this contradicts CONTEXT "Out: new installer behaviour (doctor only reads)". The
  doctor itself still writes nothing.
- **If the human rejects P1:** drop t3's install half, and C1/C7 cannot both pass.
- **Recommendation:** record an ADR at accept.

**P2. CONFLICT. Install keeps a ledger of the config dirs it published into:
`~/.astro/code/published.json`, shaped `{ "<hostId>": ["<dir>", …] }`.**
- **Why it is needed:** C6(c) requires finding stale entries "in a Claude profile dir that the
  install no longer targets", for example after `CLAUDE_CONFIG_DIR` changed.
  - Nothing on disk records such a dir today. `statusline-chain.json` only holds dirs that had a
    prior status line.
  - A `$HOME` scan cannot find `$S/claude2`.
- **What it does:** `installClaude` merges every `(host, dir)` it published into, as a union that
  never shrinks.
  - `uninstallClaude` already deletes the whole home, and the ledger with it.
  - Installs before this phase recorded nothing. The doctor cannot see dirs from before the
    ledger, and says so in the MANUAL.
- **Conflict:** same as P1. It is flagged, and an ADR is recommended.

**P3. `ac update` runs the doctor after its last line and prints only `⚠` lines. When clean it
prints nothing. Its exit code stays the update's own.**
- D4 does not ask for a non-zero exit.
- `tests/hooks-update.test.mjs` and `tests/mods_lifecycle.test.mjs` run `ac update` against
  minimal fake clones that would trip the doctor, and they assert exit 0.
- The update did succeed. `ac doctor` is the verb whose exit code gates.
- The doctor call in update is wrapped in `try`/`catch`, so it can never fail an update (b940).
- It is passed `clone` explicitly, because `FRAMEWORK_ROOT` is the pre-pull code.

**P4. The plugin layout was verified on a real install, not recalled.**
- File: `<configDir>/plugins/installed_plugins.json`, shaped
  `{ "version": 2, "plugins": { "astro-mods@astro-code": [ { "scope", "installPath", "version", "installedAt", "lastUpdated" } ] } }`.
- The cache dir is `plugins/cache/astro-code/astro-mods/<version>/.claude-plugin/plugin.json`.
- **Observed on a real install:** the planning machine shows live drift, with the plugin at
  0.50.1, the clone at 0.50.2 and `~/.astro/code/version` at 0.50.1.
- **How the reader parses it:**
  - It tolerates the older flat shape (no `plugins` wrapper), as `hooks/_astro-ctx.mjs
    phaseBandDrawn` does, and an object or an array per id.
  - It falls back to `<installPath>/.claude-plugin/plugin.json` `.version`.
- **When there is nothing to compare:**
  - No file or no `astro-mods@astro-code` key: no row. The plugin was never installed, because
    Claude was absent or below the floor (C1).
  - A file that won't parse, or an entry with no version: an `ok:true` "skipped — plugin record
    unreadable" row, never a failure.
- **What it compares against:** the expected version is the shipped manifest
  `<astroHome>/mods/astro-mods/.claude-plugin/plugin.json` `.version`. That is what
  `claude plugin update` would install, and it equals `package.json` (pinned by
  `tests/mods_plugin_version.test.mjs`). If the manifest is absent, it falls back to
  `<astroHome>/version`.
- **Never spawns `claude`:** no `claudeVersion`, `pluginState` or `checkPlugin` (ADR-071 "Why").

**P5. Report shape, to satisfy C1 and C11.**
- `runDoctor()` returns rows `{ id, host, dir, ok, detail, fix }`:
  - `host`/`dir` are `null` for global checks.
  - `fix` is a string on every `ok:false` row and `null` on `ok:true`.
- **Ids are fixed:** `version`, `update-cache`, `settings`, `hook-interpreter`,
  `hook-registration`, `hook-script`, `links`, `grant`, `registry`, `plugin`.
- **Rows per check:** a clean check gives one `ok:true` row per (check, dir), or one row for a
  global check. Each problem gives its own `ok:false` row.
- **"Skipped" is not a third state:** it is an `ok:true` row whose `detail` starts with
  `skipped —` (no project, no registry, registry unreachable, no clone recorded, unreadable plugin
  record).
- **Human output (`renderDoctor`):**
  - Each `ok:false` row prints exactly one line: `⚠ <host> <dir>: <detail> → <fix>`, or
    `⚠ <detail> → <fix>` when there is no host. The line ends with the fix.
  - When there is no failure, it prints exactly one line:
    `✓ install consistent — <n> checks across <m> config dir(s)`.
  - With failures there is no summary line, so the update tail and `ac doctor` print identical
    problem lines (C13).
  - `--json` prints the array via `json()`.
  - Both modes set `process.exitCode = 1` on any `ok:false`, never `die()` (C11).
- **Fail-soft:** each check runs inside a wrapper. A throw becomes one
  `ok:false` "check could not run: <msg>" row with fix `ac doctor --json` and a bug report. The
  report never aborts.

**P6. Which dirs are examined (D3).**
- Only hosts in `detectHosts()`. An undetected host yields no rows.
- **Claude Code:** `claudeHost.configTargets()` ∪ the ledger's `claude` dirs (P2), existing dirs
  only.
  - Every per-dir check runs on both kinds.
  - In a dir that is not a current target, any `ac …` fix is prefixed
    `CLAUDE_CONFIG_DIR="<dir>" `, which makes it a target for that one command.
  - The env name comes from a `CONFIG_ENV` const exported by `claude.mjs` (t3), never a second
    literal.
- **Copy hosts (Codex, Cursor, OpenCode):** their `configTargets()` for the full link check. Ledger
  dirs that are no longer targets get only the stale-entry check.
- **Cursor hook files** (`hooks.json`, `cli-config.json`) are read only where they exist.
  `guardState === 'import'` (riding Claude's entry) is fine.
- **Self-hosted:** a config `commands/`/`agents/` that `sameDir` (device+inode) matches the clone's
  or the home's own subdir is skipped, never "missing".

**P7. Each check, its rule and its exact fix.** "→" gives the fix; `$P` is the P6 env prefix,
applied when the dir is not a current target.

1. `version`:
   - `<astroHome>` absent → one row "astro-code is not installed" → `ac install`, and every other
     check is skipped.
   - The clone is `opts.clone`, else `<astroHome>/source`. No clone, or a missing path → skipped.
   - `<astroHome>/version` differs from `<clone>/package.json` `.version` → "installed vX, clone
     vY" → `ac update`.
2. `update-cache`:
   - `<astroHome>/update-check.json` absent → OK (`ac update` deletes it on purpose).
   - Unparseable → `ac update`.
   - The age is `now − min(checked*1000, mtime)`, counting only timestamps that are not in the
     future. It is stale when the age exceeds `UPDATE_CACHE_MAX_AGE_DAYS = 30`, a single exported
     const → "update check last ran N days ago" → `ac update`.
   - `update_available` is NOT a failure.
3. `settings`: a Claude `settings.json` (or Cursor `hooks.json`/`cli-config.json`) that exists but
   won't parse → "not valid JSON, so hooks were not checked" → `edit <file> by hand (not valid
   JSON)`.
4. `hook-interpreter`:
   - **What is judged:** every `command` string anywhere in the file (all hook events plus
     `statusLine`), parsed with the exported `hookCommandParts` from `lib/nodebin.mjs` (t1). Only
     astro-owned scripts (`isAstroScript`) are judged; a user's own hooks never are.
   - **"Runs" means:** the interpreter exists, and `spawnSync(interp, ['--version'], { timeout:
     5000 })` exits 0 with stdout matching `/^v\d+\./`. A bare `node` resolves via PATH. There is
     one spawn per distinct interpreter (memoised), and no package manager is ever spawned.
   - **Rows:** one per (dir, interpreter) → "hook interpreter <interp> missing" or "does not run".
   - **Fix:** `$P ac install` when the basename is `node`, since `repairNodeCommands` re-points it.
     Otherwise `replace "<interp>" with "<nodeBin()>" in <file>`, because install only repairs
     node-named interpreters.
5. `hook-registration` (ADR-072): uses the new `hookRegistrations()` from `lib/mods.mjs` (t2),
   built on the existing private `enforcementOf` and `readMods`.
   - **Claude, switch on:** state `missing` (or `broken` while the script exists, meaning a short
     matcher) → "<feature> on but not registered" → `$P ac mods enable <feature>`.
   - **Claude, switch off:** state `enforced` or `broken` → "<feature> registered while off" →
     `$P ac mods disable <feature>`.
   - **Cursor:** on and `not-enforced`, or off and natively present, give the same two lines.
   - **Ignored states:** `unreadable` is reported by `settings`; `no-dir` is skipped.
6. `hook-script`: the script token from the same parse.
   - A leading `~/` expands to `home`, and only absolute paths are judged.
   - The check is `existsSync` of the registered path itself, never re-derived from `astroHome`.
   - There is one row per (dir, script path), so principles parts 2..N collapse.
   - → "registered hook script missing: <path>" → `$P ac install`.
7. `links`: the shipped set is the `.md` files in `<astroHome>/commands` and `<astroHome>/agents`,
   which include `astro-doctor` (C14).
   - **Claude (`placement.mode === 'symlink'`), per `.md` entry in `<dir>/commands` and
     `<dir>/agents`:**
     - A shipped name whose entry resolves → OK. A plain file is the Windows copy fallback and is
       also OK.
     - A shipped name whose symlink dangles → "dangling link <path>" → `$P ac install`.
     - An unshipped name starting `astro-`, or any dangling link whose `readlinkSync` target starts
       with `astroHome` → "stale entry <path>" → `rm "<path>"`.
     - A shipped name with no entry at all → "missing <kind> <name>" → `$P ac install`.
   - **Copy hosts:**
     - Expected top-level names come from rendering each home source through
       `host.renderCommand`/`renderAgent`, grouped by `placement[kind]` (Codex puts both kinds in
       `skills/`).
     - Present names are the `astro-*` entries in that dir.
     - Missing → `ac install`. Stale → `rm -r "<path>"`.
   - **Ledger dirs that are not current targets (P2):** only the stale rule applies. They are not
     judged "missing", so a live link into the shared home is never flagged. This keeps
     multi-account machines (one `CLAUDE_CONFIG_DIR` per shell) free of false warnings.
8. `grant` (#15): uses the new `grantState(dir, home)` from `claude.mjs` (t3).
   - **Passes when:** some `permissions.additionalDirectories` entry, with only a leading `~/`
     expanded and a trailing `/` stripped, equals `grantPath(astroHome)`
     (`realpathSync`-or-as-is) or is a resolved ancestor of it.
   - **Entries are NOT realpath'd,** so the unresolved form of a symlinked home fails, as C7
     requires.
   - → "additionalDirectories does not grant <resolved>" → `$P ac install  # grants <resolved>`.
     The fix contains the resolved path, as C7 requires.
9. `registry`:
   - `findRoot(cwd)` null → skipped, with no failure (C1).
   - Otherwise `canonCheck(root)` (reused, never re-implemented):
     - `available:false` with `reason` → skipped "no shared registry in use".
     - `error` (unreachable) → skipped "registry unreachable, not checked". Unreachable is never
       reported as in sync (b940).
     - `available && !ok` → "local canon differs from <branch> (<n> decision(s)[, CONVENTIONS.md])"
       → `ac canon pull`.
     - `ok` → OK.
   - This verdict matches `ac canon check`'s (C8).
10. `plugin`: implements P4, in every examined Claude dir → "astro-mods vX installed, astro-code vY"
    → `$P ac update`.

**P8. Test strategy (chosen explicitly).**
- **Test-first inside each engine task.** Each task writes its tests first, then the code, in the
  task's own declared files.
- **Every new export is reached by `const { fn } = await import(...)` inside async test bodies,**
  never a static import (ADR-018). An existing test file's static import lines are left as they
  are.
- **No cross-task RED task is left across a wave boundary,** so the healed-wave gate never sees a
  red suite.
- **t11 is test-after:** an end-to-end CLI suite, `depends_on` the CLI and the last engine task.
  It is chosen deliberately, because it drives real `ac install` sandboxes.
- **Fixtures:** each mutates the output of a real `installClaude`/`ac install` into a temp `HOME`,
  rather than hand-building a tree.
- **Isolation:** tests set `HOME` and `CLAUDE_CONFIG_DIR`, delete `CURSOR_CONFIG_DIR`/`CODEX_HOME`,
  and point `PATH` at an empty temp dir plus `dirname(process.execPath)`, following the `withEnv`
  pattern in `tests/install.test.mjs`. They re-import with a cache-busting `?d=` query.

**P9. Not in this phase.**
- A version bump: the release flow bumps `package.json` and the plugin manifest together.
  CHANGELOG goes under `## Unreleased`. Principle 82a4 is noted; the tester identifies the build
  with the new `ac --version`.
- `--fix`.
- Session-start checks.
- Any repair inside the doctor.

## Tasks

### t1 — Export the astro hook-command parser from `lib/nodebin.mjs`
- **id:** t1
- **file:** `lib/nodebin.mjs`, `tests/nodebin_parts.test.mjs` (new)
- **depends_on:** —
- **Tests first,** in new `tests/nodebin_parts.test.mjs`, reached via
  `await import('../lib/nodebin.mjs')`. A new file is used so `tests/nodebin.test.mjs` stays free
  for t3's fix-ups.
  `hookCommandParts(cmd)` returns `{ interp, script, rest }` for:
  - a quoted command;
  - an unquoted command;
  - a quoted path with spaces;
  - a leading-whitespace command.

  It returns `null` for a non-string or a one-token command. `isAstroScript('/x/_astro-ctx.mjs')`
  and `isAstroScript('/x/astro-update.mjs')` are true, and `isAstroScript('/x/mine.mjs')` is
  false.
- **Implementation:**
  - Export `hookCommandParts` (built on the existing `SHAPE`) and `isAstroScript(path)` (built on
    `ASTRO_SCRIPT` plus `basename`).
  - Rewrite `repairNodeCommand` to use `hookCommandParts`, with no behaviour change. The existing
    #126 tests stay green.
  - The comment says the doctor (phase 50) reads commands through this, the only parser (9173).

### t2 — Read-only hook-registration and plugin-version readers in `lib/mods.mjs`
- **id:** t2
- **file:** `lib/mods.mjs`, `tests/mods_doctor.test.mjs` (new)
- **depends_on:** —
- **Tests first,** in new `tests/mods_doctor.test.mjs`, via dynamic import, real temp dirs and no
  `run` stub needed. Named:
  - "hookRegistrations reports a switched-on guard with no entry as missing";
  - "hookRegistrations reports an entry for a switched-off guard";
  - "hookRegistrations agrees when on everywhere or off everywhere";
  - "installedPluginVersion reads the version-2 installed_plugins.json layout";
  - "installedPluginVersion falls back to installPath's plugin.json";
  - "installedPluginVersion returns null when the plugin was never installed";
  - "installedPluginVersion marks a malformed record unreadable, never throws".

  Plus a test asserting that neither function spawns: pass a `run` that throws if called, or none.
- **Implementation:**
  - `hookRegistrations({ home, astroHome, targets, cursorTargets })` returns
    `[{ feature, on, host, dir, label, state, native? }]` for every built hook feature. It uses
    `readMods` switches and the existing `enforcementOf`. Cursor rows add
    `native: cursorHost.guardState(...) === 'native'`.
  - `installedPluginVersion(dir)` returns `null` (no file or no key),
    `{ unreadable: true }`, or `{ version, installPath }`, per P4. It tolerates the flat shape and
    an object or array per id.
  - Both are read-only and never call `runClaude`.

### t3 — The `additionalDirectories` grant in the Claude adapter (P1)
- **id:** t3
- **file:** `lib/hosts/claude.mjs`, `tests/grant.test.mjs` (new). Fix-ups only if an existing
  exact-shape Claude `settings.json` assertion needs the new key: `tests/install.test.mjs`,
  `tests/nodebin.test.mjs`, `tests/guard_hooks.test.mjs`, `tests/hooks_principles.test.mjs`,
  `tests/mods.test.mjs`, `tests/mods_cli.test.mjs`, `tests/agent_tools.test.mjs`. No other task
  touches these files.
- **depends_on:** —
- **Tests first,** in new `tests/grant.test.mjs`, via dynamic import:
  - "registerHooks grants the resolved astro home in additionalDirectories";
  - "registerHooks keeps the user's own additionalDirectories entries and adds ours once";
  - "with a symlinked home the grant is the resolved path, not the unresolved one" (#15):
    `symlinkSync` a temp home and call `registerHooks(dir, <link>/.astro/code)`;
  - "unregisterHooks removes only our grant and drops an array it emptied";
  - "grantState is granted for the resolved path or a resolved ancestor";
  - "grantState is missing for no grant and for the unresolved form of a symlinked home";
  - "grantState is unreadable for invalid JSON and never writes".
- **Implementation:**
  - Export `CONFIG_ENV = 'CLAUDE_CONFIG_DIR'`, and use it inside `baseConfigDir`/`configTargets`.
  - Export `grantPath(home)` (realpath-or-as-is).
  - Export `grantState(dir, home)`, returning `'granted'|'missing'|'unreadable'|'no-dir'` per the
    P7.8 rule.
  - `registerHooks` adds `grantPath(home)` to `data.permissions.additionalDirectories` when absent
    by exact string, in the same `writeJson`. `unregisterHooks` reverses it.
  - The comment cites #15, phase 50 P1, and the MANUAL section it replaces.
- **Before committing:** run `node --test tests/` and fix only exact-shape assertions on Claude
  `settings.json` broken by the added key, and only in the declared fix-up files. If an undeclared
  test file breaks, STOP and report it rather than editing it.

### t4 — Install ledger and `sameDir` export in `lib/install.mjs` (P2)
- **id:** t4
- **file:** `lib/install.mjs`, `tests/install_ledger.test.mjs` (new)
- **depends_on:** —
- **Tests first,** in new `tests/install_ledger.test.mjs`, using the `withEnv` plus cache-busting
  import pattern copied from `tests/install.test.mjs`:
  - "installClaude records every config dir it published into in published.json";
  - "a second install with a different CLAUDE_CONFIG_DIR keeps the earlier dir in the ledger";
  - "readPublished returns an empty map for a missing or malformed ledger";
  - "sameDir is true for a symlink to the same dir and false for a missing path".
- **Implementation:**
  - Export `sameDir`, which is currently private.
  - Add `readPublished(astroHome)` → `{ [hostId]: string[] }`.
  - Add a private `recordPublished(astroHome, linked)`, which unions and writes with
    `writeFileSync`, the same as `writeVersion`.
  - `installClaude` calls it after the publish loop, with the `linked` targets.
  - The header comment says why: C6(c), with no other record of a dir install stopped targeting.
  - `uninstallClaude` needs no change, because it removes the home.

### t5 — `lib/doctor.mjs` core: runner, row shape, renderer, and the global and per-Claude-dir checks
- **id:** t5
- **file:** `lib/doctor.mjs` (new), `tests/doctor.test.mjs` (new)
- **depends_on:** t2, t3, t4
- **Tests first,** in `tests/doctor.test.mjs`, reached via
  `await import('../lib/doctor.mjs?d=…')` with a fake `HOME` and a real `installClaude(FRAMEWORK)`
  inside. Named exactly:
  - "a clean install reports no failing row" (C1 core);
  - "an installed version older than the clone is named with ac update";
  - "a year-old update cache is named with ac update, a missing one is not";
  - "a future-dated update cache is not stale";
  - "#15: a grant written in the unresolved form of a symlinked home is named with the resolved
    path";
  - "a missing grant is named per profile";
  - "a stale astro-mods plugin version (0.41.0) is named with both versions";
  - "no installed_plugins.json means no plugin row";
  - "outside a project the registry check is skipped, not failed";
  - "registry drift is reported exactly when canonCheck reports it". This one uses a real bare
    remote plus `initRegistry`/`canonPush`, as `tests/canon.test.mjs` does.
  - "a check that throws becomes one failing row and the report continues";
  - "renderDoctor prints one ✓ line when clean and only ⚠ lines ending with the fix otherwise";
  - "runDoctor writes nothing": snapshot every path's content, mode and link target under `HOME`
    before and after.
- **Implementation (per P5–P7):**
  - `export function runDoctor({ home = homedir(), astroHome = join(home, '.astro', 'code'), clone, cwd = process.cwd(), now = Date.now() } = {})`
    returns rows.
  - `export function renderDoctor(rows, { failuresOnly = false } = {})` returns `string[]`.
    `failuresOnly` drops the `✓` line.
  - Also export `DOCTOR_CHECKS` and `UPDATE_CACHE_MAX_AGE_DAYS`.
  - A private `examinedDirs()` implements P6, using `detectHosts`, `configTargets`, `readPublished`
    and `CONFIG_ENV`.
  - A private `fixIn(entry, cmd)` adds the `$P` prefix.
  - A private `check(id, fn)` provides the fail-soft wrapper.
  - The checks are `version`, `update-cache`, `grant` (`grantState`/`grantPath`), `registry`
    (`findRoot` + `canonCheck`) and `plugin` (`installedPluginVersion`).
  - Read-only APIs only: `readFileSync`, `existsSync`, `lstatSync`, `statSync`, `readlinkSync`,
    `realpathSync`, `readdirSync`. No `mkdirSync`, no `withLock`, and no `registerHooks`,
    `writeVersion`, `ensurePlugin` or `republishHost`.
  - The header comment states the read-only contract, why it never spawns `claude` (ADR-071), and
    the P1/P2 conflicts.

### t6 — Doctor hook checks: `settings`, `hook-interpreter`, `hook-registration`, `hook-script`
- **id:** t6
- **file:** `lib/doctor.mjs`, `tests/doctor_hooks.test.mjs` (new)
- **depends_on:** t1, t5
- **Tests first,** in new `tests/doctor_hooks.test.mjs`, which mutates a real install with two
  Claude profiles (base plus a jean-claude `profiles.json` profile). Named exactly:
  - "#126: a dead node interpreter is named for its config dir only";
  - "an existing interpreter that does not run is named", covering a `#!/bin/sh\nexit 1` script and
    a non-executable file;
  - "a registered hook script missing from the home copy is named with its path and dir";
  - "principles parts 2..N pointing at one missing script give one row";
  - "a guard switched on but not registered is named with ac mods enable";
  - "a guard registered while switched off is named with ac mods disable";
  - "consistent switches and registrations give no hook-registration failure";
  - "a user's own non-astro hook with a dead interpreter is not judged";
  - "an unparseable settings.json is named, not thrown";
  - "a Cursor dir riding Claude's import is not a problem". This one creates a `CURSOR_CONFIG_DIR`
    with Claude present.
- **Implementation:**
  - Add the four checks to `runDoctor` per P7.3–P7.6, using `hookCommandParts`/`isAstroScript`
    (t1), `hookRegistrations` (t2), `GUARD_HOOKS`/`ownsCommand` only through those helpers, and
    `nodeBin()` for the non-node fix text.
  - Spawns are memoised per interpreter.

### t7 — `ac doctor`, `ac --version`, help, and the `ac update` tail in `bin/ac.mjs`
- **id:** t7
- **file:** `bin/ac.mjs`. Fix-ups only if an existing assertion on `ac update` output breaks on the
  new tail: `tests/hooks-update.test.mjs`, `tests/mods_lifecycle.test.mjs`. No other task touches
  them. STOP rather than edit any other test file.
- **depends_on:** t5
- **`case 'doctor'`:**
  - `checkFlags('doctor', flags)`, with `doctor: ['json']` added to `ALLOWED_FLAGS`.
  - `const rows = runDoctor({ astroHome: ASTRO_HOME })`.
  - `flags.json ? json(rows) : renderDoctor(rows).forEach(l => console.log(l))`.
  - `process.exitCode = rows.some(r => !r.ok) ? 1 : 0`.
  - Never `die` for a failing report.
- **`case '--version'` / `case '-v'`:** placed beside the `help` cases, before `default`. Prints
  `FRAMEWORK_ROOT/package.json` `.version` as one line, `astro-code <version>`, and writes nothing.
- **`HELP`:** two lines near `ac update`/`ac path`:
  - `  ac doctor [--json]                  is the install consistent? one ⚠ line per problem, ending with its fix; exit 1 on any`
  - `  ac --version                        print astro-code's version`

  `verbHelp('doctor')` works with no other change.
- **`case 'path'`:** resolves through `grantPath(HOME_ROOT)` from `lib/hosts/claude.mjs`. This is
  one rule shared with the grant check (9173), and the output is unchanged
  (`tests/cli.test.mjs` #15 stays green).
- **`case 'update'`:** after the `✓ astro-code is now at v…` line:
  ```
  try {
    for (const l of renderDoctor(runDoctor({ astroHome: ASTRO_HOME, clone }), { failuresOnly: true })) console.log(l);
  } catch { /* the doctor never fails an update (P3) */ }
  ```
  The update's exit code is unchanged.
- Import `runDoctor`/`renderDoctor` statically, since they exist on the branch after t5.
- **Before committing:** run `node --test tests/flags.test.mjs tests/cli.test.mjs
  tests/hooks-update.test.mjs tests/mods_lifecycle.test.mjs`.

### t8 — Doctor link checks: `links` on every installed host, including stale entries in dirs install no longer targets
- **id:** t8
- **file:** `lib/doctor.mjs`, `tests/doctor_links.test.mjs` (new)
- **depends_on:** t6
- **Tests first,** in new `tests/doctor_links.test.mjs`, with a real install into a home that also
  has `~/.codex` and `~/.config/opencode` (detected). Named exactly:
  - "a shipped command removed from a host's command dir is named missing", for Claude and for
    Codex;
  - "a dangling command link is named";
  - "a stale astro-* link the shipped set no longer contains is named with rm";
  - "a stale link in a Claude dir install no longer targets is named". This one installs once with
    `CLAUDE_CONFIG_DIR=<d2>`, then unsets it, adds `astro-gone.md` in `<d2>/commands`, and runs the
    doctor.
  - "live links in a no-longer-targeted dir are not flagged";
  - "removing astro-doctor.md is reported" (C14);
  - "all seeded link problems are reported in one run";
  - "a self-hosted config dir whose commands/ is the clone's is not flagged";
  - "a Windows-style copy of a shipped command is accepted";
  - "a host that is not installed produces no rows".
- **Implementation:**
  - Add the `links` check per P7.7, using `HOSTS`/`detectHosts`, `host.placement`,
    `host.renderCommand`/`renderAgent`, `readPublished` and `sameDir` (t4).
  - No second copy of placement or render knowledge.

### t9 — `/astro-doctor` slash command and its listing
- **id:** t9
- **file:** `commands/astro-doctor.md` (new), `commands/astro-help.md`,
  `tests/doctor_command.test.mjs` (new)
- **depends_on:** —
- **Test first,** in new `tests/doctor_command.test.mjs`:
  - `commands/astro-doctor.md` exists, with frontmatter `description` and `allowed-tools: Bash`.
  - Its steps run `ac doctor` (optionally `--json`).
  - It contains no check logic of its own: no `settings.json`, `readlink` or `installed_plugins`
    steps.
  - It states its reporting bound.
  - `astro-help.md` lists `/astro-doctor`.
- **Command body:**
  1. Run `ac doctor`.
  2. If it printed one `✓` line, relay that line only. When clean, say nothing more.
  3. Otherwise list each `⚠` line as printed. Keep each to its own line with the fix it ends with,
     and add nothing else. Point to `ac doctor --json` for a bug report.
  4. Never run the fixes unasked: the doctor is report-only (D2).
- **`astro-help.md`:** add `/astro-doctor` to "Set up & navigate", beside `/astro-status`.

### t10 — Docs: MANUAL, CHANGELOG, README
- **id:** t10
- **file:** `MANUAL.md`, `CHANGELOG.md`, `README.md`
- **depends_on:** —
- **MANUAL:**
  - Add an `ac doctor` subsection after "Updating". It covers what each of the ten check ids looks
    at, in one line each; `--json` as the bug-report shape; exit codes; that `ac update` ends with
    it, printing only failures; and that dirs from installs before this version are not in the
    ledger.
  - Rewrite §"Letting Claude Code run the shipped workflows" to say `ac install`/`ac update` now
    add the resolved `ac path` grant to every Claude config dir, and `ac uninstall` removes it.
    The project-level `.claude/settings.local.json` option stays documented.
  - Mention `ac --version`.
- **CHANGELOG, under `## Unreleased`:** one bullet each for `ac doctor`/`/astro-doctor`, `ac
  --version`, the update tail, and the install grant plus ledger. Cite #159, #15, #40, #126 and
  fix `2026-10-12-hook-registrations-can-point-at-scripts`.
- **README:** line 39's manual grant instruction now says install does it.

### t11 — End-to-end CLI suite (test-after) and full-suite gate
- **id:** t11
- **file:** `tests/doctor_cli.test.mjs` (new)
- **depends_on:** t7, t8, t9
- **Harness:** spawns `node bin/ac.mjs` with `env: { HOME, PATH }`, where `PATH` holds shims named
  `npm npx pnpm yarn bun brew` that append to a marker file, `dirname(process.execPath)`, and
  `/usr/bin:/bin`. `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `CURSOR_CONFIG_DIR` and `XDG_CONFIG_HOME` are
  unset. It runs `ac install` first and `cwd` is a scratch non-project dir.
- **Named tests:**
  - "ac doctor on a fresh install exits 0 with one ✓ line and all-ok JSON", run with one Claude dir
    and again with codex and opencode dirs present (C1);
  - "ac doctor --json and the human output name the same failures and exit with the same code"
    (C11). It seeds a stale link plus a dead interpreter across two hosts.
  - "every failing JSON row has a fix and every ⚠ line ends with it";
  - "ac doctor writes nothing and spawns no package manager", for clean and seeded states (C10):
    a listing of content, mode and link target under `HOME` before and after, and no marker file;
  - "ac --version prints package.json's version and exits 0" (C12);
  - "ac help lists doctor --json and --version" (C12);
  - "ac doctor --nope is refused";
  - "ac update prints no doctor line when clean, and exactly ac doctor's ⚠ lines when a drift
    survives". Follow the `tests/hooks-update.test.mjs` fake-clone pattern: a bare upstream, a
    stubbed `npm`, and a stale link in a dir the install no longer targets as the surviving drift
    (C13).
- **Gate, in this task:** `node --test tests/` exits 0 before the commit (C15). The task commits the
  test file, so it does not need `commits: none`.

## Wave shape
- W1 (independent): t1, t2, t3, t4, t9, t10.
- W2: t5 (needs t2, t3, t4).
- W3: t6 (needs t1, t5) ∥ t7 (needs t5).
- W4: t8 (needs t6).
- W5: t11 (needs t7, t8, t9).

**Shared files across tasks:**
- `lib/doctor.mjs`: t5 → t6 → t8, serialized.
- `bin/ac.mjs`: t7 only.
- `lib/hosts/claude.mjs`: t3 only.
- `tests/install.test.mjs`, `tests/nodebin.test.mjs` and the other t3 fix-up files: t3 only. t1
  and t4 use new test files.

No task deletes or renames a symbol. `repairNodeCommand` keeps its signature, so every wave
boundary compiles.

## Criteria map
| Criterion | Tasks |
|---|---|
| C1 | t3, t5, t8, t11 |
| C2 | t5 |
| C3 | t1, t6 |
| C4 | t2, t6 |
| C5 | t6 |
| C6 | t4, t8 |
| C7 | t3, t5 |
| C8 | t5 |
| C9 | t2, t5 |
| C10 | t5, t11 |
| C11 | t5, t7, t11 |
| C12 | t7, t11 |
| C13 | t7, t11 |
| C14 | t8, t9 |
| C15 | t11 |
