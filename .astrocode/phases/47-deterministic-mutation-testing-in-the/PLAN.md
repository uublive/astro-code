# Plan — phase 47: deterministic mutation testing in the verifier (ADR-083)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - zero deps, `node:` builtins only (`child_process.spawn`, `fs`, `os`, `path`);
  - named exports only, lowercase one-word `lib/` modules, `die()`/`json()`, `✓ • ⚠ ⊡` glyphs;
  - `node:test` + `node:assert/strict`, real `mkdtempSync` dirs and real git, no mocks;
  - dense comments that say why;
  - workflow style is no semicolons.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-083 is the decision this phase builds.
  - ADR-001: zero deps. The mutation tool is the project's own; astro-code never installs one.
  - ADR-004: state goes through lock-guarded `lib/` writes.
  - ADR-006: the verifier reaches `verified` at most.
  - ADR-017: phase scope comes from `(phase NN tK)` stamps.
  - ADR-018: new symbols are reached with `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-021: the verifier stays plan-blind.
  - ADR-029: every new flag goes in `ALLOWED_FLAGS`.
  - ADR-048: lib never writes outside `.astrocode/`, so `setup`'s write sits in `bin/`.
  - ADR-055: every reporting slot states its bound.
  - ADR-079: `VERDICT.json` stays `version: 1`, and `passed` is derived in code.
- This phase's `CONTEXT.md`, D1–D4. Matteo's 3a addition ("not every time, not annoying, not
  repetitive") is recorded in D3. The plan aims at `CRITERIA.md` C1–C12.

Principles brief (`--stage plan --by planner`), applied:
- **333f:** `ac mutate` is mechanical. It detects, scopes, runs, caps, parses and classifies.
  The verifier only judges survivors.
- **ce7b:** the C9 pass bar is a code gate in `recordVerdict`, not prose.
- **9173:** each rule lives in one module:
  - the marker regex, the evidence contract and the gate: `lib/verdict.mjs`;
  - the tool table: `lib/mutate.mjs`;
  - the status maps: `lib/mutparse.mjs`;
  - the notice rule: `lib/mutnotice.mjs`.
  Docs and agents cite them; they never restate a second list.
- **1f10:** detection uses manifests through `projectStack`. `mutation.tool` overrides it, and
  every result says which applied and why.
- **5116:** there is no prompt anywhere, and stdin is never read.
- **b940 / 6105:** a missing tool, a corrupt notice file, an unparseable report or an unknown
  version each give a visible reason and exit 0. None crashes.
- **2310:** `/astro-mutate`.
- **e618:** after the first time, the reminder is one line.

## Design decisions made here (the CONTEXT open questions)

- **P1 — The test-strength marker.** It is the literal tag `[mutation]` in the criterion
  heading: `### C4 [mutation] — <claim>`.
  - `parseCriteriaIds` (`^#{1,6}\s*(C\d+)\b`) already accepts it.
  - The tag is visible in the heading and greppable.
  - One function, `testStrengthIds(text)` in `lib/verdict.mjs`, matches it: heading line only,
    case-insensitive. `ac mutate` (its `required` field), the C9 gate and the guard tests all
    call that function.
- **P2 — Where the "shown / dismissed" memory lives.** It is a LOCAL, never-committed file,
  `.astrocode/.local/mutate-notices.json`, shaped `{ "<tool>": { "shown_at": iso, "dismissed": bool } }`.
  - The directory carries its own `.gitignore` containing `*`, which ac writes beside the file.
    So it is ignored in every project without touching the project's root `.gitignore`, which
    lib may not write (ADR-048).
  - Why local: "has this developer been told" is per machine. A committed file would silence the
    hint for a teammate who never saw it, and would add merge churn on a shared file. A fresh
    clone or worktree shows the hint once more, which is accepted.
  - It is not written through `transact`; it is not shared state.
  - Reads are total: missing or corrupt reads as `{}` (6105). Writes are `atomicWriteJSON`
    under `withLock`.
- **P3 — The notice rule (D3), applied the same way in human and `--json` modes:**
  - On a verify-path run (`ac mutate <phase>`) with no tool:
    - The first time per project per tool, it prints the full suggestion: tool, exact install
      command, "never installed automatically", and how to dismiss. Then it records `shown_at`.
    - Every later time, and after a dismissal, it prints one line:
      `⊡ mutation tool not installed — AI mutants used`.
  - JSON carries `notice: "full" | "reminder"`, and `suggestion: { install }` ONLY when `full`.
    `fallback.reason` is always the one-liner.
  - `ac mutate --check` is the user asking, so it always prints the full suggestion. It never
    writes the memory.
  - Dismissal is `ac mutate dismiss [<tool>]`. The tool defaults to the one detected for this
    project, and the command sets `dismissed: true`. There is one mechanism and no second config
    switch (9173).
- **P4 — Scoping (D1, C2).** The scope is `phaseStampedPaths(root, phase)`, imported from
  `lib/fixtures.mjs` and never forked. Only the phase's own stamped commits count; never the
  working tree, never branch-vs-base. It is then filtered to:
  - files that still exist;
  - the tool row's extensions;
  - non-test paths, per the row's test patterns plus the shared exclusions `.astrocode/`,
    `node_modules/`, `vendor/`.
  How each tool receives the files:
  - **Stryker:** `--mutate a,b`.
  - **mutmut 2.x:** `--paths-to-mutate a,b`.
  - **mutmut 3.x:** reads paths from config only. It gets positional mutant-name globs derived
    from the files' dotted module paths (`pkg.mod.*`).
  - **Gremlins:** has no per-file flag. It gets `unleash` at the module root with one
    `--exclude-files` regex for every tracked `.go` file outside the scope (from
    `git ls-files '*.go'`), so only scoped files are mutated.
  Every tool's parsed mutants are then filtered to the scope, because a filter we pass to a tool
  is not trusted. An empty scope gives outcome `no-scope`: nothing runs and it is never a pass.
- **P5 — Tool table (D4).** `MUTATION_TOOLS` in `lib/mutate.mjs` holds one row per tool:
  `{ id, label, tags, extensions, testPatterns, install, configFiles, find(root, env),
  versionArgs, parseVersion, build(ctx), collect?(ctx), parse(text, ctx), artifacts, setup(scope) }`.
  Adding cargo-mutants or PIT later means adding a row.
  - **Install strings**, exactly:
    - `npm i -D @stryker-mutator/core`
    - `go install github.com/go-gremlins/gremlins/cmd/gremlins@latest`
    - `pip install mutmut`
  - **Lookup never runs a package manager.** Nothing ever runs `npm`, `npx`, `yarn`, `pnpm`,
    `pip`, `pip3`, `go` or `python -m`. Each tool is looked up as follows:
    - **Stryker:** `node_modules/.bin/stryker`, then `PATH`.
    - **Gremlins:** `PATH`, then `$GOBIN`, `$GOPATH/bin`, `~/go/bin`, from env vars only and
      never `go env`.
    - **mutmut:** `PATH`, then `.venv/bin`, `venv/bin`.
  - **Present** means `<bin> --version` exited 0 within 10 s.
  - **Picking a tool:**
    1. `mutation.tool` in config wins: `why: "config mutation.tool"`.
    2. Otherwise, take the detected rows in table order (`node`/`typescript` → stryker,
       `go` → gremlins, `python` → mutmut) and pick the first with a non-empty scope. If none has
       one, pick the first detected. `why` is, for example, `"package.json → stryker"`.
    The other detected rows are listed as `skipped_tools`.
- **P6 — Statuses and outcome.**
  - `MUTANT_STATUSES = killed | survived | timeout | no-coverage | error`, held in
    `lib/verdict.mjs` as part of the evidence contract.
  - Every report mutant lands in exactly one list:
    - `mutants[]`: the five statuses above;
    - `not_run[]`: Stryker `Pending`, Gremlins `RUNNABLE`, mutmut "not checked" / untested;
    - `ignored[]`: Stryker `Ignored`, Gremlins `SKIPPED`, mutmut skipped.
  - Survivors to triage are `survived` plus `no-coverage`: no test even runs that code.
  - Timeouts count as killed (D4).
  - `outcome` is one of:
    - `clean`
    - `survivors`
    - `incomplete`: capped, or not every mutant ran
    - `no-scope`
    - `tool-missing`: language known, no binary
    - `no-tool`: no supported language
    - `error`: tool crash, unparseable report, unsupported version, or a dirty scope
  - `clean` requires `complete && !capped && total > 0 && survivors == 0`.
  - **Pure `classifyRun`:** a capped run is never `clean` (C4).
  - Sorting is by file, line, mutator, then the tool's id, so two runs over one report give
    byte-identical lists apart from `started_at` / `duration_ms` (C1).
- **P7 — Cap (D4, C4).**
  - The cap is `mutation.cap_seconds` in config, default `600`. `DEFAULT_CAP_SECONDS` is defined
    once, in `lib/mutate.mjs`. A missing or non-positive value uses the default and adds a
    warning.
  - **Enforcement, in `lib/caprun.mjs`:**
    - `spawn` with an argv array, `shell: false`, `detached: true` and `stdio` ignore/pipe.
    - At the cap, `process.kill(-pid, 'SIGTERM')`, then `SIGKILL` to the group after 2 s, so
      grandchildren (test runners) die too.
    - On Windows it falls back to `child.kill()`.
  - **Partial results:** on a cap, ac parses whatever partial report exists.
    - Unfinished mutants go to `not_run`.
    - Scope files with no report entry go to `not_run_files`.
    - With no report at all, `not_run_files` is the whole scope, plus
      `not_run_note: "no partial report — mutants not generated are unknown"`. It never guesses.
- **P8 — Hygiene.**
  - Refuse to run (outcome `error`) when `git status --porcelain -- <scope>` is non-empty: the
    result would grade code that is not HEAD.
  - The row's `artifacts` paths are Stryker `reports/mutation/mutation.json` and `.stryker-tmp`,
    mutmut `.mutmut-cache` and `mutants`. Any that did NOT exist before the run are removed after
    parsing. Pre-existing ones are left alone, so the tree ends as it began (C7).
  - The Gremlins report goes to `--output <os.tmpdir() run dir>`.
  - A scoped file left modified by an in-place tool is reported as a warning and never restored
    automatically (git-guard posture).
  - Tool stderr goes to `<run dir>/tool.log`, and its path is in the result.
- **P9 — Verdict evidence (C8, C9).**
  - `result.criteria[].mutation` is optional:
    `{ outcome, tool, version, command, reproduce, head, scope, cap_seconds, capped, complete,
    counts{killed,survived,timeout,no-coverage,error}, survivors[{file,line,mutator,status,triage,justification?}], fallback{reason}|null }`.
  - `ac mutate --json` emits every field except `triage`/`justification`, so the verifier
    copies them across and adds triage.
  - `recordVerdict` keeps it verbatim on the saved criterion and copies a carried criterion's
    prior `mutation`. It stays `version: 1`, since the change is additive.
  - Structural junk (not an object, a non-integer count, an unknown triage) is refused with an
    error. A breach of the semantic bar is SAVED with that criterion `failed` plus
    `refused: "<reason naming the survivor or the capped run>"`, and is listed in the output's
    `refused[]`.
  - **The gate, `mutationGate`, pure.** It applies to criteria that are `[mutation]`-marked or
    that carry evidence, and that are reported passed:
    - **Refused when:**
      - the criterion is marked but has no evidence;
      - `fallback` is set but the outcome is not `tool-missing`/`no-tool`/`no-scope`, or the
        reason is empty or multi-line;
      - otherwise, any of these holds:
        - the run is `capped`;
        - the run is not `complete`;
        - the outcome is not `clean`/`survivors`;
        - zero mutants;
        - `survivors.length !== counts.survived + counts['no-coverage']`;
        - any survivor is `test-gap`;
        - any survivor is `equivalent` with an empty or multi-line justification.
    - Otherwise passed, with the justifications kept.
- **P10 — Who calls `ac mutate`.** Only the verifier, by hand, through `ac mutate <phase> --json`.
  The workflow script never runs it (ADR-005/008). It only lets the evidence through its schema
  into `ac verdict record`, and encodes `'` as `'` so a justification cannot break the
  single-quoted `--result '<json>'`. `Bash(ac *)` is already in `lib/tune.mjs`, so no allowlist
  change is needed.
- **P11 — `ac mutate setup` (C7).** The pure `setupFor(root, tool)` in lib returns
  `{ file, content, exists }`, and `bin/` writes it. It never overwrites a file and never touches
  a manifest. The files:
  - **Stryker:** `stryker.config.json` with the built-in `command` test runner (`npm test`), so
    no extra plugin is needed. It also sets `reporters ["json","clear-text"]` and `mutate`
    globs over the detected source dirs, excluding tests.
  - **Gremlins:** `.gremlins.yaml`, with plain `key: value` lines only.
  - **mutmut:** `setup.cfg [mutmut]` with `paths_to_mutate` and `tests_dir`, but only when
    `setup.cfg` is absent. Otherwise it prints the snippet to add and writes nothing.
  - When a config file exists, the run passes it explicitly where the tool has a flag for it.
- **Exit codes.** `ac mutate` exits 0 for every reported outcome. Only usage errors (unknown
  phase, unknown flag) exit non-zero.

**Executor note (no network was used here):** the tools' exact flags and report schemas must be
checked against their current docs while building fixtures:
- Stryker: `mutation-testing-report-schema`, `--mutate`, `--reporters`, `Pending`.
- Gremlins: `--output` JSON `files[].mutations[]`, `--exclude-files`.
- mutmut: `junitxml` (2.x), `results` lines (3.x).

Record any deviation in a code comment beside the row. Do not let it change the result shape.

## Test strategy (ADR-018)

- **Test-first within each task.** The task writes its tests first, sees them fail, then
  implements, all in one commit. A RED commit never lands at a wave boundary (ADR-020).
- Every test that touches a module new to this phase reaches it with
  `const { fn } = await import('../lib/x.mjs')` inside async test bodies, never a static import.
- **Test-after, chosen explicitly:**
  - t10 depends on the CLI from t9.
  - t11's docs-consistency test depends on t9.
- No real Stryker, Gremlins or mutmut. Stand-ins:
  - fixture reports under `tests/fixtures/mutate/`;
  - one stub executable, `tests/fixtures/mutate/stub.mjs`, that is copied into a temp `bin/` or
    `node_modules/.bin/` under the tool's name.
- CLI tests run with
  `PATH = <stub bin> + dirname(process.execPath) + the dir holding git`, `HOME` set to a temp
  dir, and `GOBIN`/`GOPATH` unset. A real tool on the dev machine can therefore never be found
  (C11).

## Tasks

### t1 — `lib/verdict.mjs`: marker, evidence contract, C9 gate, evidence kept by `ac verdict record`
- **id:** t1
- **file:** `lib/verdict.mjs`, `tests/verdict.test.mjs`, `tests/verdict_cli.test.mjs`
- **depends_on:** []
- **Tests first.**
  - **Pure, in `tests/verdict.test.mjs`, reaching the new exports with `await import`:**
    - **`testStrengthIds`:** finds `### C4 [mutation] — x` and `## C2 [Mutation]`. It ignores
      `[mutation]` in a body line and a heading without the tag. Results come in file order.
    - **`mutationGate`:** one test per refusal in P9, plus the passing control (every survivor
      `equivalent` with a one-line justification, not capped, complete). Also covered:
      - fallback allowed only for `tool-missing` / `no-tool` / `no-scope`;
      - an unmarked, failed criterion is never touched.
  - **CLI, in `tests/verdict_cli.test.mjs`, using the existing `project()` helper:**
    - The CRITERIA has one `[mutation]` criterion.
    - **C8:** a full evidence block round-trips into `VERDICT.json` field for field. A fallback
      evidence block keeps `fallback.reason`.
    - **C9, variants (a)–(e):** (a) a `test-gap` survivor, (b) an empty justification,
      (c) fewer survivors than the count, (e) a capped run. Each is saved with the criterion
      `failed` and `refused` naming the survivor (`file:line mutator`) or the capped run. The
      output has `passed:false` and `refused[]`.
    - **(d):** saved `passed`, with the justifications present.
    - A marked criterion reported passed without evidence is failed.
    - A structurally bad block (`counts.killed: "x"`) exits non-zero.
    - `readVerdict` still reads the file.
- **Implement:**
  - Export `MUTANT_STATUSES`, `SURVIVOR_STATUSES`, `MUTATION_OUTCOMES`, `FALLBACK_OUTCOMES`,
    `TRIAGES`, `testStrengthIds`, `validateMutation` and `mutationGate`.
  - In `recordVerdict`, gather `marked = testStrengthIds(text)` and apply the gate when building
    `criteria`. Keep `mutation` (and `refused`) on the saved entry, carry a prior `mutation` onto
    a carried entry, and add `refused` to `out`. `version` stays 1.
  - The `verdict record` CLI arm prints one stderr line per refused criterion
    (`⚠ C4 refused: …`). That is a two-line edit in `bin/ac.mjs`, NOT done here; t9 owns
    `bin/ac.mjs`. Here, `refused` goes in the JSON only.
  - Extend the module header comment with why the gate lives here (ce7b, 9173).

### t2 — `lib/mutnotice.mjs`: the once-per-project-per-tool suggestion memory
- **id:** t2
- **file:** `lib/mutnotice.mjs` (new), `lib/paths.mjs`, `tests/mutnotice.test.mjs` (new)
- **depends_on:** []
- **Tests first** (`await import`, real tmp `.astrocode/`):
  - A fresh project shows `full`, then `reminder` after `markShown`.
  - Per tool: stryker shown does not suppress gremlins.
  - Per project: two tmp roots are independent.
  - `dismiss(root, tool)` gives `reminder` without ever having shown it.
  - A corrupt or garbage JSON file reads as `{}` and does not throw.
  - A wrong-shape entry is ignored.
  - The memory survives a fresh `import` (a separate process: spawn
    `node -e` that marks the tool, then read it).
  - `.astrocode/.local/.gitignore` holds `*`, and `git check-ignore` exits 0 for the notice file.
- **Implement:**
  - `paths()` gains `local: .astrocode/.local` and `mutateNotices: .astrocode/.local/mutate-notices.json`,
    with a comment on why it is local (P2).
  - `mutnotice.mjs` exports:
    - `readNotices(root)`, total;
    - `noticeFor(notices, tool)` → `'full' | 'reminder'`, pure;
    - `markShown(root, tool)` and `dismiss(root, tool)`, both async, `withLock` +
      `atomicWriteJSON`, ensuring the dir and its `.gitignore`;
    - `REMINDER = 'mutation tool not installed — AI mutants used'`, the one place the reminder
      text lives.

### t3 — `lib/caprun.mjs`: spawn under a wall-clock cap, killing the whole process group
- **id:** t3
- **file:** `lib/caprun.mjs` (new), `tests/caprun.test.mjs` (new)
- **depends_on:** []
- **Tests first** (`await import`, a tiny node script written into a tmp dir):
  - A fast command returns `{ status: 0, capped: false, stdout, stderr, durationMs }`.
  - A 60 s sleeper that spawns a sleeping child, with a 1 s cap, returns `capped: true` in under
    5 s. Afterwards neither pid is alive: `process.kill(pid, 0)` throws ESRCH, polled briefly.
  - A missing binary returns `{ status: null, error }` and does not throw.
  - No shell: an argv element `"; touch x"` is passed literally.
  - stderr is appended to the given `logFile`.
- **Implement:** `runCapped(argv, { cwd, env, capMs, logFile, graceMs = 2000 })` → Promise, per
  P7. The comment explains the process-group kill: the test runners that Stryker and Gremlins
  spawn otherwise outlive the cap.

### t4 — Workflow: let mutation evidence through VERIFY_SCHEMA into `ac verdict record`
- **id:** t4
- **file:** `workflows/execute-phase.mjs`, `tests/workflows.test.mjs`
- **depends_on:** []
- **Tests first** (string and shape guards, in the file's existing style):
  - `VERIFY_SCHEMA.criteria.items.properties.mutation` exists, is an object, and allows extra
    properties.
  - The record call maps `mutation` through for checked criteria.
  - The `--result` JSON has every `'` encoded as `'`.
- **Implement:**
  - Add `mutation: { type: 'object', additionalProperties: true, properties: {…P9 field names…} }`
    to the criterion item. A comment says the code gate in `lib/verdict.mjs` is the validator,
    and this schema only lets the evidence through.
  - The verdict-record payload adds `...(c.mutation ? { mutation: c.mutation } : {})`, and
    `JSON.stringify(...).replace(/'/g, '\\u0027')`.
  - When any checked criterion has `mutation.fallback`, `log()` that line ONCE
    (`• <REMINDER text>`); nothing otherwise. The workflow cannot import lib, so it copies the
    reason from the evidence and does not restate it.
  - No semicolons.

### t5 — Commands: `/astro-mutate`, and the verify/execute/help surfaces
- **id:** t5
- **file:** `commands/astro-mutate.md` (new), `commands/astro-verify.md`, `commands/astro-execute.md`, `commands/astro-help.md`, `tests/commands.test.mjs`
- **depends_on:** []
- **Tests first, in `tests/commands.test.mjs`:**
  - `astro-mutate.md` has a `description` and `argument-hint`, and names `ac mutate <phase>`,
    `--check`, `setup` and `dismiss`.
  - Each of its reporting slots states a bound.
  - It never tells the agent to install anything.
  - `astro-verify.md`'s verdict JSON mentions the optional per-criterion `mutation` and the
    `'` encoding.
  - `astro-help.md` lists `/astro-mutate`.
  - Existing slot markers (`3. Clear the live status first`, `3b. **On PASS only`) are unchanged.
- **Implement `astro-mutate.md`** (`allowed-tools: Bash`). It routes by argument:
  - `<phase>` → `ac mutate <phase>`;
  - `check` → `ac mutate --check`;
  - `setup` → `ac mutate setup`;
  - `dismiss` → `ac mutate dismiss`.
  Reporting bounds:
  - Relay the counts line plus one line per survivor, capped at 10, then a pointer to
    `--json`.
  - On a missing tool, relay ac's output verbatim (full or one line, as ac chose).
  - Say nothing beyond that.
  - Never run an install command; suggest it.
- **`astro-verify.md` step 2's JSON block:** add `"mutation": {…}` as optional per criterion, as
  the verifier returns it. Add one sentence saying a `'` inside it is written `'`.
- **`astro-verify.md` step 3:** on PASS or FAIL, when a criterion's evidence has `fallback`, add
  at most one line with its reason. Say nothing otherwise.
- **`astro-execute.md` line ~123:** the fallback tiers pass the verifier's `mutation` blocks
  through unchanged.
- **`astro-help.md`:** one line for `/astro-mutate`.

### t6 — `lib/mutparse.mjs`: the three report parsers and status maps, over committed fixtures
- **id:** t6
- **file:** `lib/mutparse.mjs` (new), `tests/mutparse.test.mjs` (new), `tests/fixtures/mutate/stryker-mutation.json`, `tests/fixtures/mutate/stryker-partial.json`, `tests/fixtures/mutate/gremlins.json`, `tests/fixtures/mutate/mutmut2-junit.xml`, `tests/fixtures/mutate/mutmut3-results.txt` (all new)
- **depends_on:** [t1]
- **Fixtures (real formats).** Every fixture covers at least one mutant of each status:
  - **Stryker** (`files{path:{mutants[{id,mutatorName,location.start.line,status}]}}`):
    `Killed`, `Survived`, `Timeout`, `NoCoverage`, `RuntimeError`, `CompileError`, `Ignored`.
    The partial report adds `Pending`.
  - **Gremlins** (`files[{file_name,mutations[{line,column,type,status}]}]`): `KILLED`, `LIVED`,
    `TIMED OUT`, `NOT COVERED`, `NOT VIABLE`, `SKIPPED`.
  - **mutmut 2:** `junitxml` testcases with killed, survived (`bad_survived`), timeout,
    suspicious and skipped.
  - **mutmut 3:** `results` lines `name: status`.
  - Each fixture also includes an out-of-scope file's mutant.
- **Tests first** (`await import`):
  - Each parser returns every mutant exactly once across `mutants`/`not_run`/`ignored`, with
    `{file, line, mutator, status}` and the status mapped per P6.
  - Per-status counts equal hand counts.
  - Output is sorted and deterministic (parse twice, `deepEqual`).
  - Garbage input returns `{ error }` and does not throw.
  - A scope filter drops the out-of-scope file.
  - For tools whose report names no operator (mutmut), `mutator` is the tool's mutant name and is
    never empty.
- **Implement:**
  - `parseStryker`, `parseGremlins`, `parseMutmutJunit`, `parseMutmutResults`;
  - `normalize(list, scope)` → `{ mutants, not_run, ignored }`, sorted;
  - `countStatuses(mutants)`.
  Status names come from `MUTANT_STATUSES` in `lib/verdict.mjs` (9173). Plain string parsing for
  the XML: no deps, and the junit shape is flat.

### t7 — Agents: verifier triages survivors via `ac mutate`; criteria author writes `[mutation]`
- **id:** t7
- **file:** `agents/astro-verifier.md`, `agents/astro-criteria-author.md`, `tests/mutate_agents.test.mjs` (new)
- **depends_on:** [t1]
- **Tests first:**
  - The criteria author's fenced example heading containing `[mutation]` is extracted and written
    into a CRITERIA.md word for word. `testStrengthIds` (via `await import('../lib/verdict.mjs')`)
    returns that id (C10).
  - The verifier text names each of these:
    - `ac mutate <phase> --json`;
    - triaging only survivors;
    - test-gap fails the criterion;
    - equivalent needs a one-line justification;
    - timeouts are killed;
    - capped is never all killed;
    - `ac verdict record`;
    - AI mutants only for `tool-missing`/`no-tool`/`no-scope`, with the reason;
    - never for criteria without the tag.
  - The verifier's "Shell commands" section is unchanged (`tests/agent_shell.test.mjs` keeps it
    identical across agents).
- **Implement:**
  - **Verifier:** a new `## Test-strength criteria ([mutation])` section. One run per phase
    serves every marked criterion.
    - Copy the result's fields into `criteria[].mutation` and add `triage` (plus a
      `justification` for `equivalent`) per survivor.
    - Never judge killed mutants.
    - `incomplete`/`error` fails the criterion and names the cap key `mutation.cap_seconds`.
      Raising the cap is the user's call; the verifier stays read-only.
    - `ac mutate` writes only astro-code's own `.astrocode/.local` bookkeeping, and never needs a
      permission prompt.
    - Add `mutation` to the "Structured return" description.
  - **Criteria author:** a short rule. When the goal asks for test strength, write
    `### C<n> [mutation] — <claim>`, with an `Observe:` of "`ac mutate <phase> --json`; every
    survivor is a justified equivalent" and a `Fails if:` of "a survivor is a test gap, or the
    run is capped". Never tag criteria that do not ask for test strength (D2).

### t8 — `lib/mutate.mjs`: tool table, detection, scope, run under the cap, classify, check, setup content
- **id:** t8
- **file:** `lib/mutate.mjs` (new), `tests/mutate.test.mjs` (new), `tests/fixtures/mutate/stub.mjs` (new)
- **depends_on:** [t1, t2, t3, t6]
- **Stub first.** `stub.mjs` (`#!/usr/bin/env node`, executable) picks its behaviour by its own
  basename (`stryker` / `gremlins` / `mutmut`) and by env:
  - `MUTATE_STUB_REPORT`: fixture to emit. It writes where the real tool would: Stryker
    `reports/mutation/mutation.json`, Gremlins `--output`, mutmut `junitxml`/`results` to stdout.
  - `MUTATE_STUB_LOG`: append `{argv, cwd}` JSON lines.
  - `MUTATE_STUB_SLEEP`: sleep N seconds after writing.
  - `MUTATE_STUB_CHILD=1`: spawn a sleeping child.
  - `MUTATE_STUB_VERSION`: the version string to report.
  It answers `--version`. Tests copy it into a tmp `bin/` under the tool name.
- **Tests first** (`await import`, real tmp git projects with `ac` phases and stamped commits):
  - `classifyRun`, pure, covering every outcome in P6; capped is never `clean`; zero mutants is
    never `clean`.
  - **Scope (C2):** two phases change `src/a.mjs` and `src/b.mjs`, and `src/c.mjs` is
    untouched. Phase 1's scope is `['src/a.mjs']`. Tests, `.astrocode/` and deleted files are
    excluded. The same holds for `.go` and `.py` rows.
  - **Detection (C3):** package.json → stryker, go.mod → gremlins, pyproject.toml → mutmut,
    each with `why`. The `mutation.tool` override replaces detection (`why` names config). No
    manifest gives `no-tool`.
  - **`runMutate` with the stub (C1, C2, C4):**
    - every fixture mutant is present;
    - the stub's logged argv carries exactly the scope (`--mutate src/a.mjs`;
      `--paths-to-mutate`; Gremlins excludes every other tracked `.go` file);
    - a 2 s cap with the sleeping stub returns `capped:true`, `outcome:'incomplete'`, and
      `not_run`/`not_run_files` populated;
    - the default cap is 600.
  - **Hygiene:** `reports/mutation/mutation.json` created by the run is removed afterwards, and
    one that pre-existed is kept. A dirty scoped file gives `outcome:'error'` and spawns nothing.
  - **Missing tool:**
    - `outcome:'tool-missing'` with `fallback.reason`;
    - `notice:'full'` with `suggestion.install`, then `reminder` on the next call;
    - an install-command stub dir proves nothing was spawned besides the lookup.
  - `required` lists the `[mutation]` ids.
  - An unknown mutmut major version gives `outcome:'error'` with the version named.
  - `setupFor` returns parseable content per tool and `exists:true` when a config is present.
- **Implement:**
  - `MUTATION_TOOLS` and `DEFAULT_CAP_SECONDS`;
  - `pickTool(root)`, `phaseScope(root, phase, row)` and `classifyRun(r)`;
  - `runMutate(root, phaseSlug, { notice: true })`;
  - `checkMutate(root, phaseSlug?)`, read-only, which always fills `suggestion` when the tool is
    missing;
  - `setupFor(root, toolId?)`;
  - `dismissTool(root, toolId?)`, which delegates to `mutnotice`.
  The result carries:
  - `tool{id,label,version,source,why}`, `command` (exact argv string), `reproduce`
    (`ac mutate <n> --json`) and `head`;
  - `scope`, `cap_seconds`, `capped`, `complete` and `outcome`;
  - `counts`, `mutants`, `survivors`, `not_run`, `not_run_files`, `ignored` and
    `skipped_tools`;
  - `fallback`, `notice`, `suggestion?`, `required`, `warnings` and `log`;
  - `started_at` and `duration_ms`.
  The header comment explains P2–P8 and the trust note: the tool runs the project's own tests,
  the same trust level as `npm test`.

### t9 — CLI: `ac mutate <phase> | --check | setup | dismiss`, flags, help
- **id:** t9
- **file:** `bin/ac.mjs`, `tests/mutate_cli.test.mjs` (new)
- **depends_on:** [t8]
- **Tests first** (real CLI, `spawnSync(process.execPath, [AC, …])`, the stub from t8, the
  restricted PATH from the test strategy):
  - **C1:** a JS project, run `--json` twice. The fixture mutants are complete and correctly
    mapped. The two runs are equal after dropping `started_at`/`duration_ms`. The human output
    shows the same counts and survivors, and names the tool and `package.json → stryker`.
  - **C2:** the two-phase project. The stub log shows only `src/a.mjs`, and the human output
    names the scope. The same holds for Go and Python projects.
  - **C3:** Go → gremlins and Python → mutmut, each fixture complete. After
    `ac config set mutation.tool …`, the source is config.
  - **C4:** with no config, `cap_seconds` is 600. With `mutation.cap_seconds 2` and the
    sleeping-plus-child stub, the run returns in under 8 s, is capped and has `not_run` listed.
    `ps`/`kill -0` shows the stub and its child are gone. With all-`Timeout`, the counts are
    killed-equivalent and the outcome is `clean`.
  - `ac mutate --bogus` exits non-zero.
  - `ac help` lists all four forms.
- **Implement:**
  - `ALLOWED_FLAGS`: `'mutate': ['check','json']`, `'mutate setup': ['json']`,
    `'mutate dismiss': ['json']`.
  - **The `case 'mutate'` arm.** It is a thin dispatcher; `sub = pos[0]`:
    - `setup`: writes `setupFor`'s file only when absent, prints `✓ wrote <file>` or
      `• <file> exists — left alone` (or the mutmut snippet), and installs nothing.
    - `dismiss`: prints `✓ install suggestion dismissed for <tool> in this project`.
    - `--check` with an optional phase.
    - Otherwise `findPhase` → `runMutate`.
    - **Human output:**
      - Line 1: `✓|⚠|⊡ <tool> (<why>) · <total> mutants: k killed · t timeout · s survived · n no-coverage · e error`.
      - `scope: …`
      - One `⚠ file:line mutator status` line per survivor.
      - A `⚠ capped at Ns — not run: …` line when capped.
      - A no-tool full block of up to 4 lines, or the one-line reminder.
    - `--json` → `json(result)`.
  - **The `verdict record` arm:** one `⚠ <id> refused: <reason>` stderr line per `out.refused`
    entry (the t1 hand-off).
  - Four `HELP` lines next to the `verdict` lines:
    - `ac mutate <phase> [--json]`
    - `ac mutate --check [<phase>] [--json]`
    - `ac mutate setup`
    - `ac mutate dismiss [<tool>]`

### t10 — CLI tests (test-after): no tool installs nothing, suggestion once, setup is the only writer
- **id:** t10
- **file:** `tests/mutate_cli_quiet.test.mjs` (new)
- **depends_on:** [t9]
- **Test-after by choice:** this exercises t9's CLI end to end.
- **C5:** JS, Go and Python projects with no tool. Logging stubs for `npm npx yarn pnpm pip pip3
  go` are on PATH, each exiting 1. Snapshot the manifests, lockfiles, `node_modules` and
  `git status --porcelain --untracked-files=all`. Run `ac mutate --check` and `ac mutate 1` with
  `input: ''`, `timeout: 60000`. Then check:
  - each prints its exact install string;
  - the JSON has `outcome:'tool-missing'` and `fallback.reason`;
  - no stub log exists;
  - the snapshots are byte-identical.
- **C6:**
  - Three separate runs, human and `--json`: the full suggestion only on the first, then exactly
    one reminder line, with no install string.
  - A second project runs `ac mutate dismiss` and then gets the reminder only.
  - A Go project gets its own first full suggestion.
  - Copying the project without `.astrocode/.local` gives the full suggestion again.
  - `--check` always prints in full.
- **C7:**
  - Hash every file outside `.astrocode/` and record `git status`. Run `--check` and
    `ac mutate 1` with a fake tool. Nothing has changed, and no tool config appeared.
  - `ac mutate setup` writes a config that parses: `JSON.parse` for Stryker, a line-wise
    `key: value` check for `.gremlins.yaml`, an INI section check for `setup.cfg`.
  - The next run's stub log shows the config passed or read from cwd.
  - Manifest dependency sections are unchanged.
  - A second `setup` leaves the file alone.

### t11 — Docs: MANUAL section, command reference, CHANGELOG, and the final suite check
- **id:** t11
- **file:** `MANUAL.md`, `CHANGELOG.md`, `tests/mutate_docs.test.mjs` (new)
- **depends_on:** [t9, t10]
- **Tests first (test-after on t9):** reach `MUTATION_TOOLS` via `await import` and check:
  - every row's `install` string appears verbatim in MANUAL.md;
  - MANUAL names `mutation.cap_seconds`, `mutation.tool`, `ac mutate dismiss`,
    `.astrocode/.local/mutate-notices.json` and "never installs";
  - the CHANGELOG `## Unreleased` mentions `ac mutate`.
- **Implement:**
  - **MANUAL:** a `## Mutation testing (test-strength criteria)` section after "Two gates close a
    phase", 30–50 lines. It covers:
    - the `[mutation]` marker;
    - the tool per language, with install commands;
    - scope;
    - the cap and override keys;
    - the outcome list;
    - the verifier's triage;
    - the notice memory: local and why, how to dismiss, `--check` always shows it;
    - `setup`;
    - the trust note.
  - **MANUAL command reference:** add `/astro-mutate` and the four `ac mutate` CLI lines.
  - **CHANGELOG `## Unreleased`:** one bullet.
- **Final gate, folded in:**
  - Run the full suite (`npm test`) with a PATH without stryker/gremlins/mutmut.
  - Confirm that `package.json` still has no `dependencies`/`devDependencies` (C11).
  - Report the counts in the commit body.

## Waves

| Wave | Tasks | Why together |
|---|---|---|
| 1 | t1, t2, t3, t4, t5 | independent; disjoint files |
| 2 | t6, t7 | both need t1's contract/marker; disjoint files |
| 3 | t8 | needs t1, t2, t3, t6 |
| 4 | t9 | CLI over t8 |
| 5 | t10 | test-after on t9 |
| 6 | t11 | docs cite final CLI; final suite gate |

Rule checks:
- **Same-file pairs:** none in a wave. `bin/ac.mjs` is owned only by t9. The t1 stderr hand-off
  is folded into t9.
- **No deletions or renames,** so there are no consumer fixups to fold (ADR-020).
- **Every task declares its files.** Every task commits; no `commits: none`.
- **No RED test imports a missing symbol statically.**
