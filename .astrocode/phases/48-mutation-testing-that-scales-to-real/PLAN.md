# Plan — phase 48: mutation testing that scales to real projects (ADR-084)

This plan follows:
- `.astrocode/CONVENTIONS.md`:
  - zero deps, `node:` builtins only, ESM `.mjs`;
  - named function exports, lowercase one-word `lib/` modules;
  - `die()`/`json()`, `✓ • ⚠ ⊡` glyphs;
  - `node:test` with real `mkdtempSync` dirs and real git, no mocks;
  - dense comments that say why.
- `.astrocode/DECISIONS.in-force.md`:
  - ADR-084 is the decision this phase builds: line scope, phase tests by default, and the verifier
    uses the tool wherever it would hand-make mutants.
  - ADR-083: the tool is never installed, and the `[mutation]` tag is the only code gate.
  - ADR-001: zero deps.
  - ADR-004: config writes go through `updateConfig` and its lock.
  - ADR-017: scope comes from `(phase NN tK)` / `(phase NN remediate-cK)` stamps.
  - ADR-018: new symbols are reached with `await import`.
  - ADR-020: every wave boundary is green.
  - ADR-029: no new CLI flags are needed, so `ALLOWED_FLAGS` is unchanged.
  - ADR-055: every reporting slot states its bound.
- "lib writes nothing outside `.astrocode/`" (phase 47 P11) still holds: every new file this phase
  writes (log, full list, generated Stryker config, Gremlins report) is under
  `.astrocode/.local/mutate-runs/`. `setup`'s project write stays in `bin/`.
- This phase's `CONTEXT.md`, D1–D7 plus "Also in scope". The plan aims at every criterion in
  `CRITERIA.md`, C1–C14.

Principles brief (`--stage plan --by planner`), applied:
- **9173: one place per rule.**
  - The changed-line set: `lib/fixtures.mjs`.
  - Python function spans and mutmut mutant-name grammar: `lib/pyscan.mjs`.
  - Report parsing and scope/range filtering: `lib/mutparse.mjs`.
  - Environment detection: `lib/mutenv.mjs`.
  - Setting keys and their precedence: ONE function, `mutationSettings` in `lib/mutate.mjs`.
  - Run file names: ONE function, `mutateRunPaths` in `lib/verdict.mjs`.
  - Messages and docs cite these; they never restate them.
- **1f10:** detect from manifests and git, allow an override (`mutation.files|exclude|tests`, per-phase
  `cap_seconds|tests`), and every result reports which applied and why (`scope_detail`, `tests`,
  `cap`, `suggestion.why`).
- **b940:** a step that cannot narrow says so in the result and never silently widens. Examples:
  a runner without a test-file option, lines outside functions, an unmapped mutmut line.
- **333f:** everything stays mechanical. Line mapping is text matching, never interpretation.
- **5116:** no prompt and no stdin anywhere.
- **e618:** human output is bounded: survivors in full, everything else as counts, with paths to the
  full versions.
- **ce7b:** the `[mutation]` bar stays the code gate. The untagged "use the tool" directive is
  prompt-only by D3 and is stated as such.
- **4823:** untagged mutation evidence is a non-gating finding.
- **2310:** `/astro-mutate` already exists. The per-phase settings go through `ac config set`, and
  `/astro-mutate` names the command.

## Design decisions made here (the CONTEXT open questions and research forks)

- **P1 — Changed lines are computed in HEAD coordinates with `git blame`.**
  - `phaseChangedLines(root, phase, files)` in `lib/fixtures.mjs` runs
    `git blame --porcelain HEAD -- <file>` once per scoped file.
  - It keeps the final-line numbers whose commit is one of the phase's stamped shas, then collapses
    them into `[[start,end],…]`.
  - **Why blame and not per-commit `-U0` hunks:** later commits shift line numbers. Blame answers
    "which lines at HEAD did this phase write" directly. Lines a later commit rewrote drop out, and
    lines an earlier unstamped commit wrote never enter (C1's 200–210).
  - **New file:** all its lines are in range.
  - **Renamed file:** blame follows the content, so a rename-only phase owns zero lines.
  - **Pure deletion:** zero lines.
  - A file with zero lines drops out of the scope. It never falls back to the whole file. The
    result counts it (`scope_detail.no_lines`).
  - The stamped-sha set comes from ONE helper, `phaseStampedShas`. `phaseStampedPaths` is
    refactored onto it with unchanged output.
- **P2 — Gremlins base.**
  - `phaseBase(root, phase)` finds the topologically oldest stamped sha
    (`git rev-list --topo-order --reverse HEAD`, filtered to the set) and returns
    `git rev-parse <first>^`.
  - If the first stamped commit is a root commit, it returns the empty tree
    (`git hash-object -t tree /dev/null`) and `root: true`, and the result warns.
  - Gremlins gets `unleash --diff <base>`. Its diff may include post-phase commits, so survivors
    are ALWAYS filtered back to P1's ranges in the parser. A filter handed to a tool is not trusted
    (phase 47 P4).
- **P3 — Narrowing per tool. `scope_detail.narrowed` says which applied.**
  - **Stryker `lines`:** `--mutate` gets one comma-joined list of `file:start-end` entries (a single
    line is `file:n-n`), or a bare `file` for a whole-file entry added by a setting.
  - **Gremlins `diff`:** as P2.
    - `mutation.exclude` adds `--exclude-files ^<file>$` for each excluded file only.
    - `mutation.files` cannot be expressed in diff mode. When it adds files, the run falls back to
      the existing exclude-every-other-file mode (`otherGoFiles`), and `scope_detail.why` says so.
  - **mutmut 3 `functions`:**
    - `lib/pyscan.mjs` maps each changed line to its enclosing top-level function or top-level
      class's method.
    - The run gets one mutant-name glob per changed function: `pkg.mod.x_b__mutmut_*` and
      `pkg.mod.xǁKǁm__mutmut_*`, passed as UTF-8 argv.
    - Changed lines outside any function (module or class body) are not mutatable by mutmut 3.
      They are counted in `scope_detail.outside_functions` and warned about. If nothing is left,
      the outcome is `no-scope` with that reason.
  - **mutmut 2 `files`:**
    - `--paths-to-mutate` is used, with `why: "mutmut 2 selects whole files only; its function-level
      pre_mutation hook needs a mutmut_config.py written into the project, which ac never does"`.
    - Results are still filtered to the changed lines through the junit `line` attribute.
- **P4 — Project and phase settings live in `.astrocode/config.json` and are set with
  `ac config set`.** `updateConfig` is lock-guarded, nothing hand-edits `roadmap.json`, and no new
  CLI verb is needed.
  - **Project keys:**
    - `mutation.files`: paths to add whole-file;
    - `mutation.exclude`: paths to drop;
    - `mutation.tests`: the test files to run instead of the phase's;
    - `mutation.cap_seconds`.
  - **Phase keys:** `mutation.phases.<n>.cap_seconds` and `mutation.phases.<n>.tests`, where `<n>`
    is the unpadded phase number.
  - **Precedence:** phase > project > default. The default cap is 600 s and the default tests are
    the phase's own.
  - Paths use `pathMatches` semantics from `lib/fixtures.mjs` (a trailing `/` means a directory),
    exported rather than copied.
  - A value of the wrong type is ignored with a warning (b940).
  - `mutationSettings(root, num, warnings)` is the ONE reader. It returns:
    - `cap: {seconds, source, keys:[phaseKey, projectKey]}`;
    - `tests: {files, source, key} | null`;
    - `files`, `exclude`.
- **P5 — Tests per tool (D2). The result carries `tests: {source, files, mechanism, note}`.**
  - **The default set** is the phase's stamped files that exist at HEAD and match the row's new
    `testFiles` patterns: runnable test files only. A `conftest.py`, a helper, or a
    non-`.test.`/`.spec.` file under `tests/` does not count.
    - It comes from the SAME `phaseStampedPaths` pass as the source scope (9173).
    - When there are none, `source: 'full-suite'`, with
      `note: "the phase changed no test files — full suite"` and NO restriction passed.
  - **Stryker:** there is no CLI test flag. ac writes
    `.astrocode/.local/mutate-runs/<slug>.stryker.config.mjs` and runs `stryker run <that file>`.
    - The file imports the project's config if one exists (JSON through
      `import … with { type: 'json' }`, JS directly). It spreads it and overrides by runner:
      - `command` (also the default runner): `commandRunner.command` = the base command plus the
        files. `npm …` gets `-- <files>`; `pnpm`/`yarn`/others get the files appended.
      - `mocha`: `mochaOptions.spec`.
      - `jest`: `jest.config.testMatch` as absolute paths.
      - `tap`: `tap.testFiles`.
      - `vitest` and unknown runners: NOT narrowed, with `note` naming the runner. Never claimed.
    - With no restriction (full suite), no generated config is written and the run is invoked as in
      phase 47.
  - **Gremlins:** there is no test flag; it runs each mutant's own package tests. Narrowing goes
    through the env
    `GOFLAGS="<existing> -run=^(TestA|TestB)$"`, built from the `func Test…(` names in the chosen
    `_test.go` files. If no names are found, nothing is restricted, with a note.
  - **mutmut 2 and 3:** config is the only selection route, and the project config is never
    touched. ac sets the env `PYTEST_ADDOPTS="<files…> <existing>"`, which pytest reads even when
    called in-process.
    - If the project's own `pytest_add_cli_args_test_selection` / `tests_dir` / a non-pytest
      `runner` is set, a warning says the selection may be widened or ignored.
    - t6 verifies this against real mutmut 3.8. If it does not narrow, t13 reports "not narrowed"
      with the reason and never claims it.
- **P6 — Cap step (D4).** Each tool row gains `steps: [{re, name}]` and `progress: re → {tested,
  total}`, written from t6's real captures:
  - Stryker: "initial test run", then "mutation testing" with the `n/m tested` progress line.
  - mutmut 3: "generating mutants", "stats" ("Running stats"), "clean tests", "forced fail test",
    then the `n/m` progress counter.
  - Gremlins: "gathering coverage", then the per-mutant status lines.
  - `runCapped` gains `onData`, and `runMutate` feeds a small scanner, keeping a 512-byte carry
    across chunk boundaries.
  - A capped result carries `cap: {seconds, source, keys, step, tested, total}`:
    - `step` is `null` when no marker was seen, and the human line says "step unknown" instead of
      guessing;
    - `tested`/`total` come from the partial report when there is one, else the last progress line,
      else 0 when the step precedes mutation.
  - The top-level `cap_seconds` stays (it is evidence).
- **P7 — Run files sit beside the kept run (D5, D7).** `mutateRunPaths(root, slug)` in
  `lib/verdict.mjs` returns `{ dir, run, log, list, strykerConfig, gremlinsReport }`, all
  `.astrocode/.local/mutate-runs/<slug>.*`. `ensureLocalDir(root)` writes the dir and its
  `.gitignore` (`*`) BEFORE the tool starts.
  - **The log** is truncated at run start. The main run's stdout and stderr go into it; collect
    steps add only their stderr.
  - **The full list** is JSONL, one mutant per line, including `not_run`, `ignored` and out-of-scope
    entries (`"scope":"out"`). It is replaced per run. A run that parses nothing deletes a stale
    list and reports `full_list: null`.
  - The `mkdtemp` run dir goes away, so nothing lands only in the system temp dir.
  - `saveMutateRun`'s fields and `matchesRun` are untouched (ADR-083 binding).
- **P8 — Result shape (D5, C8). Changed once, in t14.**
  - `mutants[]`, `not_run[]` and `ignored[]` leave the result.
  - These are added:
    - `per_file: {file: {killed, survived, timeout, 'no-coverage', error, not_run, ignored}}`;
    - `not_run_count`, `ignored_count`, `out_of_scope_count`;
    - `full_list`.
  - The sums reconcile: in-scope counts + `not_run_count` + `ignored_count` + `out_of_scope_count`
    = every mutant in the report.
  - These stay unchanged: `survivors[]` (full objects), `counts`, `scope` (files), `not_run_files`,
    and every evidence field the verifier copies (`outcome`, `reproduce`, `head`, `scope`,
    `cap_seconds`, `capped`, `complete`, `counts`, `survivors`).
  - New descriptive fields: `scope_detail`, `tests`, `cap`, `log` (repo-relative).
- **P9 — mutmut 3 real lines (C9).**
  - **Survivors** (bounded): one `mutmut show <name>` each, under the collect cap.
    - `mutmutShowLine(diff, srcText, fn)` takes the hunk's old-line offset from the function's
      `def` line as the guess, and accepts it when the removed (`-`) line's text is there.
    - Otherwise it searches the removed text within the function's span. A tie goes to the hit
      nearest the guess.
  - **Every mutant** (no process per mutant): `mutantsFileOffsets(text)` diffs each
    `x_<f>__mutmut_N` body in the generated `mutants/<file>` against its `__mutmut_orig`. The
    first differing line's offset plus the function's source `def` line gives the line. This is
    read before `cleanup`.
  - A mutant neither route maps carries `line: null` (never 0), and a warning counts them.
  - Survivors whose mapped line falls outside every changed function are dropped to out-of-scope:
    the scope filter uses the real lines.
- **P10 — "Installed but not configured" (C11) is a new outcome, `not-configured`.**
  - It is detected when mutmut's version command fails and its output matches the real 3.8
    signature (`Could not figure out where the code to mutate is`, from t6's capture).
  - It is added to `MUTATION_OUTCOMES` and deliberately NOT to `FALLBACK_OUTCOMES`. D3 says an
    installed tool forbids hand-made mutants, so the gate refuses a pass on it like any non-clean
    outcome. Every phase-47 input is gated exactly as before.
  - It carries `fallback: null`, no install suggestion and no notice memory, plus
    `hint: "ac mutate setup"`.
- **P11 — Untagged evidence is not gated (D3, C13).**
  - `recordVerdict` applies `mutationGate` only to `[mutation]`-marked criteria.
  - Evidence on an untagged criterion is kept verbatim and structurally validated (junk is still
    refused), and never fails the criterion.
  - Marked criteria are gated exactly as in phase 47.
- **P12 — Install hint (D6, C10).**
  - `lib/mutenv.mjs` detects the environment, read-only, and never spawns anything:
    - JS manager: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, else npm.
    - Python: `.venv/bin/python` without `.venv/bin/pip*` → uv-venv, else pip.
    - Python lock management: `uv.lock`, `poetry.lock` or `Pipfile.lock`.
    - Pins of a package: an exact or bounded spec in `requirements*.txt`, `pyproject.toml`,
      `Pipfile`, `package.json`, or the lockfiles above, plus `go.mod`.
  - Tool rows gain `pkg` and `install(envInfo)`. `installHint(root, row)` returns
    `{install, why, warning}`.
    - The default variants stay byte-identical to phase 47 (`npm i -D @stryker-mutator/core`,
      `pip install mutmut`, the go line).
    - The uv form is exactly `uv pip install --python .venv/bin/python mutmut`.
    - pnpm is `pnpm add -D @stryker-mutator/core`; yarn is `yarn add -D @stryker-mutator/core`.
  - `warning` appears when the tool's package is pinned (naming the file), or when the Python env is
    lock-managed: a later sync drops a manual install. Node lockfiles alone do not warn, because
    `add -D` updates them.
- **P13 — `ac mutate setup` for mutmut is version-aware (C12).**
  - `setupFor` becomes `async` and probes the installed major. An unconfigured 3.x counts as 3. With
    nothing installed, the current 3.x is assumed and the output says so.
  - **3.x:** `[mutmut]` in `setup.cfg` with `source_paths=<src>/` and
    `pytest_add_cli_args_test_selection=<tests>/`. Key names are confirmed against t6's capture of
    3.8's config reader.
    - If `pyproject.toml` already has `[tool.mutmut]`, setup.cfg would be ignored. ac writes nothing
      and prints the `[tool.mutmut]` lines to add.
  - **2.x:** `paths_to_mutate`/`tests_dir`, as now.
  - **An existing file is never rewritten**, so a re-run cannot duplicate anything. If that file
    already has a `[mutmut]` section using keys the installed major deprecated, ac names them and
    prints the replacements.
- **Exit codes:** unchanged. 0 for every reported outcome, and `die` only for usage errors.

## Test strategy (ADR-018)

- **Test-first inside each task.** Each task writes its tests first, sees them fail, then
  implements, all in ONE commit. A red commit never lands at a wave boundary (ADR-020).
- **New symbols are reached with `const { x } = await import('../lib/…')` inside async test
  bodies, never a static import.** This covers new modules (`pyscan`, `mutenv`) and new exports of
  existing ones (`phaseChangedLines`, `phaseBase`, `phaseStampedShas`, `pathMatches`,
  `mutateRunPaths`, `ensureLocalDir`, `mutmutShowLine`, `mutantsFileOffsets`, `perFileCounts`,
  `mutationSettings`, `installHint`). Existing static imports in test files stay as they are.
- **Test-after, chosen explicitly:**
  - t15's flag-guard test exercises the finished invocations, so it depends on t14.
  - t16's docs test depends on the final shapes.
- **No real tool in the default suite.** Use the stub (`tests/fixtures/mutate/stub.mjs`), fixture
  reports, and `restrictedEnv` (a PATH that cannot reach a real tool).
- **Real tools are used in two places only:**
  - t6 captures their output as committed fixtures, run in this container (`/data/bin/mutmut`,
    `/data/bin/gremlins`, `/data/bin/go`). Stryker is absent: no network installs.
  - t15's opt-in `AC_MUTATE_REAL=1` test.
  - No host command is planned. If an executor uses `host`, it must report it.

## Wave shape

| wave | tasks | why |
|---|---|---|
| 1 | t1 t2 t3 t4 t5 t6 t7 t8 | disjoint files: helpers, stub, captures, verifier text, verdict |
| 2 | t9 t10 | t9 mutparse (needs t2, t6); t10 starts the `lib/mutate.mjs` chain (needs t4, t8) |
| 3 | t11 | log + cap (`mutate.mjs`, `bin/ac.mjs` chain) |
| 4 | t12 | line/function scope + settings |
| 5 | t13 | phase tests per tool |
| 6 | t14 | result shape + mutmut real lines |
| 7 | t15 t16 | real-tool flag guard; docs |

`lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs` and `tests/mutate_cli.test.mjs` are owned by
the t10→t11→t12→t13→t14 chain, one task per wave. `tests/mutate_docs.test.mjs` is t10, then t16.
`tests/fixtures/mutate/real/` is t6, then t15.

## Tasks

### t1 — Changed lines in HEAD coordinates, the phase base, one stamped-sha helper
- **id:** t1
- **file:** `lib/fixtures.mjs`, `tests/fixtures.test.mjs`
- **depends_on:** []
- **Tests first** (`await import`; real tmp git repo):
  - The C1 shape: `src/big.js` has 300 lines.
    - An unstamped commit edits lines 200–210.
    - `(phase 5 t1)` edits lines 40–45.
    - `(phase 5 remediate-c2)` edits lines 90–91.
    - A later unstamped commit edits `src/other.js`.
  - `phaseChangedLines(root,'5',['src/big.js','src/other.js'])` deep-equals
    `{ 'src/big.js': [[40,45],[90,91]] }`.
  - A file the phase created gives `[[1,n]]`.
  - A stamped line a later unstamped commit rewrote is gone.
  - A pure-deletion commit adds no range.
  - A rename-only stamped commit gives no lines; a rename plus an edit gives the edited lines at
    the new path.
  - Zero-padded stamps (`(phase 05 t1)`) count.
  - `phaseBase` equals `git rev-parse <oldest stamped>^` when the stamped commits are not in
    `git log` order (create them on a merged side branch).
  - A root-commit first stamp gives the empty tree with `root:true`.
  - `phaseStampedPaths` output is byte-identical to before for an existing fixture (regression).
  - `pathMatches('src/','src/a.js')` holds.
- **Implement:**
  - `phaseStampedShas(root, phase)` → `{num, shas:Set}` (refactored out of `phaseStampedPaths`,
    which now calls it).
  - `phaseChangedLines(root, phase, files)` per P1. Parse `--porcelain` header lines
    `^<40hex> <orig> <final>( <n>)?$`.
  - `phaseBase(root, phase)` → `{base, first, root}` or `null` when there are no stamps.
  - `export function pathMatches`.
  - Header comment: why blame (P1). Total: a git failure gives `{}` / `null`, never a throw.

### t2 — `lib/pyscan.mjs`: Python function spans and the mutmut 3 mutant-name grammar
- **id:** t2
- **file:** `lib/pyscan.mjs` (new), `tests/pyscan.test.mjs` (new)
- **depends_on:** []
- **Tests first** (`await import`):
  - `pythonFunctions(text)` returns `[{qual, name, cls, def, start, end}]`, where `def` is the
    `def` line and `start` is the first decorator line. It covers:
    - top-level `def`/`async def`;
    - methods of top-level classes as `K.m`;
    - a nested function, folded into its parent's span;
    - multi-line signatures;
    - a `def` inside a triple-quoted string, which is ignored;
    - CRLF input.
  - `functionAt(funcs, line)` → qual, or null for module-body and class-body lines.
  - `mutmutModule('src/pkg/mod.py')` gives `pkg.mod`; `pkg/__init__.py` gives `pkg`.
  - `mutmutGlob(file,'b')` gives `pkg.mod.x_b__mutmut_*`; `mutmutGlob(file,'K.m')` gives
    `pkg.mod.xǁKǁm__mutmut_*`.
  - `parseMutantName('pkg.mod.xǁKǁ__init____mutmut_12')` gives
    `{module:'pkg.mod', qual:'K.__init__', n:12}`; `x__priv__mutmut_1` gives qual `_priv`; junk
    gives null.
- **Implement:**
  - Indentation- and string-aware line scanner, no deps, pure.
  - The module-path rule moves here from the mutmut row's inline code. That row switches to it in
    t12, so this task changes no caller.
  - Comment: mutmut 3 trampolines only top-level functions and top-level classes' methods, which is
    why nested defs fold into their parent.

### t3 — `lib/caprun.mjs`: both streams to the log, a streaming hook, bounded memory
- **id:** t3
- **file:** `lib/caprun.mjs`, `tests/caprun.test.mjs`
- **depends_on:** []
- **Tests first:**
  - A child printing `OUT-x` to stdout and `ERR-y` to stderr leaves both in `logFile`.
  - `logStdout:false` keeps stdout out of the log.
  - `onData(chunk, stream)` sees every byte in order.
  - With `tailBytes: 1024`, the returned `stdout` is the last ≤1024 bytes of a 1 MB output. The
    default stays the full output, for the collect steps.
  - The existing group-kill and missing-binary tests are unchanged and pass.
- **Implement:** options `logStdout = true`, `onData`, `tailBytes`. Comment: the Stryker and
  Gremlins progress goes to stdout, so a stderr-only log hid the step (D4/D7).

### t4 — `lib/mutenv.mjs`: read-only environment detection for install hints
- **id:** t4
- **file:** `lib/mutenv.mjs` (new), `tests/mutenv.test.mjs` (new)
- **depends_on:** []
- **Tests first** (`await import`, tmp dirs):
  - `detectEnv(root)`:
    - `pnpm-lock.yaml` → `{node:{manager:'pnpm', via:'pnpm-lock.yaml'}}`;
    - `yarn.lock` → yarn;
    - `package-lock.json` or nothing → npm;
    - `.venv/bin/python` with no `.venv/bin/pip*` → `python.installer 'uv-venv'`, via `.venv`;
    - `.venv` with pip, or no `.venv` → pip;
    - `uv.lock` / `poetry.lock` / `Pipfile.lock` → `python.locked`.
  - `pinsOf(root, 'mutmut', 'python')` finds:
    - `mutmut==2.4.4` in `requirements-dev.txt`;
    - `"mutmut>=3"` in `pyproject.toml`;
    - `name = "mutmut"` in `uv.lock`.
  - `pinsOf(root, '@stryker-mutator/core', 'node')` finds the package in `package.json` or a
    lockfile.
  - Nothing found → `[]`.
  - Every file is byte-identical after the calls (hash before and after), and nothing is spawned
    (a PATH holding logging `npm`/`pip`/`uv`/`go` stubs stays unused).
- **Implement:** pure `fs` reads only. Comment: the hint must match how the project manages its
  environment (Waupaca's uv `.venv` had no pip), and lookup never runs a package manager (phase 47
  P5).

### t5 — Stub tool: markers, the mutmut 3 version crash, `show`, generated mutants, env and config logging
- **id:** t5
- **file:** `tests/fixtures/mutate/stub.mjs`, `tests/fixtures/mutate/project.mjs`
- **depends_on:** []
- **Implement (test infrastructure; the existing suites must stay green, which is the check):**
  - New knobs:
    - `MUTATE_STUB_OUT` / `MUTATE_STUB_ERR`: text written to stdout/stderr when `run`/`unleash`
      starts, before the sleep. This carries the step markers and C7's unique marker.
    - `MUTATE_STUB_VERSION_CRASH=1`: mutmut `--version` and `version` exit 1 with
      `FileNotFoundError: Could not figure out where the code to mutate is. Please specify it by
      adding "source_paths=code_dir" in setup.cfg to the [mutmut] section.`
    - `MUTATE_STUB_SHOW=<dir>`: `mutmut show <name>` prints `<dir>/<name>.diff`.
    - `MUTATE_STUB_MUTANTS=<dir>`: `mutmut run` copies `<dir>` to `./mutants`.
  - The log line gains `env: {GOFLAGS, PYTEST_ADDOPTS}`. When `run`'s first operand is a file path,
    it also gains `configText` (that file's content).
  - `project.mjs` gains:
    - `writeLines(dir, file, n, edit?)`, to build an n-line file and rewrite given line ranges;
    - `phaseCommit(dir, msg)`, an alias of `commit`, for readability.
  - Existing knobs and defaults are unchanged, so every phase-47 test still passes.

### t6 — Real-tool captures as committed fixtures (de-risks P2, P5, P6, P9, P10, P13; feeds C14)
- **id:** t6
- **file:** `tests/fixtures/mutate/real/` (new: `VERSIONS.json` plus the captures listed below)
- **depends_on:** []
- **Do, in this container, on scratch projects under the scratchpad.** Use no network installs, and
  wrap each call in `timeout 120`, because `gremlins --version` has been seen to hang.
  - **mutmut** (`/data/bin/mutmut`; record `--version`):
    - `mutmut3-version-unconfigured.txt`: stderr of `--version` in a project with no src/ and no
      config.
    - Then build a project with `pkg/mod.py` (functions `a`, `b`, `c` and class `K` with method
      `m`) and `tests/test_b.py`/`tests/test_a.py`. From it, capture:
      - `mutmut3-run-output.txt`: the full `mutmut run` stdout and stderr, which carry the step
        markers and progress;
      - `mutmut3-results-methods.txt`: `results --all true`, which shows the `ǁ` names;
      - `mutmut3-show-b-1.txt` and `mutmut3-show-b-N.txt`: `show` for the first mutant of `b` and
        a later one;
      - `mutmut3-show-Km.txt`;
      - `mutmut3-src-mod.py.txt`, the source;
      - `mutmut3-mutants-mod.py.txt`, the generated `mutants/pkg/mod.py`.
    - Verify, and note in `VERSIONS.json`:
      - that `source_paths` and `pytest_add_cli_args_test_selection` in `setup.cfg [mutmut]` are
        read without a deprecation warning;
      - that `paths_to_mutate` warns;
      - whether `PYTEST_ADDOPTS=tests/test_b.py` limits the stats run to that file (compare the
        collected-tests counts);
      - whether name globs `pkg.mod.x_b__mutmut_*` and `pkg.mod.xǁKǁm__mutmut_*` select only those
        mutants.
  - **Gremlins** (`/data/bin/gremlins`):
    - `gremlins-unleash-help.txt` (`unleash --help`).
    - On a scratch two-package Go module, check `--diff <sha>`:
      - Does it accept a sha?
      - Does it diff against the working tree or HEAD?
      - Does `GOFLAGS=-run=^TestX$` reach its `go test` calls?
      - What is the coverage/mutation marker text? Save it as `gremlins-run-output.txt`.
  - **Stryker 10** is not available: there are no network installs.
    - Write `stryker-cli-documented.txt`, holding `--mutate`'s `file:start-end` form, `run
      <configFile>`, the per-runner test options of P5 and the log markers.
    - Mark it `"source": "transcribed, not captured"` in `VERSIONS.json`.
  - **Every surprise goes in `VERSIONS.json` `notes`.** Examples: a flag missing, or ADDOPTS not
    narrowing. Downstream tasks read it and adjust within P3/P5, reporting "not narrowed" honestly
    rather than claiming. Commit the fixtures.

### t7 — Verifier and command text: the tool replaces hand-made mutants whenever installed (D3, C13)
- **id:** t7
- **file:** `agents/astro-verifier.md`, `agents/astro-criteria-author.md`, `commands/astro-verify.md`, `commands/astro-mutate.md`, `tests/mutate_agents.test.mjs`, `tests/commands.test.mjs`
- **depends_on:** []
- **Tests first** (string guards in the files' existing style):
  - The verifier text says that with an installed tool it runs `ac mutate <phase> --json` for ANY
    criterion (tagged or untagged) whose check would involve making broken versions of the code,
    and triages its survivors.
  - It forbids hand-invented mutants in that case.
  - It keeps AI mutants only for `tool-missing`/`no-tool`/`no-scope`.
  - It says `not-configured` fails, with `ac mutate setup` as the next step and no hand mutants.
  - It says untagged evidence is supporting evidence with no code gate.
  - It names `mutation.cap_seconds` and `mutation.phases.<n>.cap_seconds`.
  - The phrases "Only those criteria" and "never run this for a criterion without the tag" are gone
    from both agent files. `astro-criteria-author.md` no longer says the tag is what makes the
    verifier run a tool.
  - `astro-mutate.md`:
    - names `ac config set mutation.phases.<n>.cap_seconds` and `mutation.tests`;
    - every reporting slot states a bound, for example "the counts line, the scope and tests lines,
      at most 10 survivor lines, then the full-list and log paths".
  - The existing `commands.test.mjs` slot markers are unchanged.
- **Implement:**
  - Rewrite the verifier's "Test-strength criteria" section per D3 and ADR-084:
    - step 1 runs once per phase and serves every criterion;
    - step 4 names both cap keys;
    - step 5 is unchanged plus a line for `not-configured`.
  - Add a line stating the untagged directive is prompt-only by design (ce7b exception, D3).
  - Fix the matching sentence in `astro-criteria-author.md` and the `mutation` sentence in
    `astro-verify.md` (optional on any criterion, gated only when tagged).

### t8 — `lib/verdict.mjs`: run-file paths, `not-configured` outcome, untagged evidence never gated
- **id:** t8
- **file:** `lib/verdict.mjs`, `tests/verdict.test.mjs`, `tests/verdict_cli.test.mjs`
- **depends_on:** []
- **Tests first** (new exports via `await import`):
  - `mutateRunPaths(tmp,'48-x')` returns `.astrocode/.local/mutate-runs/48-x.{json,log,mutants.jsonl,stryker.config.mjs,gremlins.json}`.
  - `ensureLocalDir` creates the dir and a `.gitignore` of `*`, and `git check-ignore` matches a
    `.log` there.
  - `MUTATION_OUTCOMES` includes `not-configured`; `FALLBACK_OUTCOMES` is unchanged.
  - **CLI (`verdict_cli`):**
    - An UNTAGGED criterion recorded passed with a capped/incomplete evidence block is saved
      `passed`, with the evidence kept verbatim.
    - An untagged criterion with no evidence passes.
    - An untagged block that is structural junk still exits non-zero.
    - A TAGGED criterion without valid evidence is still refused, and every phase-47 gate test still
      passes untouched.
    - Tagged evidence with outcome `not-configured` is refused, not crashed.
- **Implement:**
  - `mutateRunFile` derives from `mutateRunPaths` (9173).
  - `saveMutateRun` calls `ensureLocalDir`, and its fields are unchanged.
  - The gate condition at `recordVerdict` becomes `c.passed && marked.includes(id)`.
  - Comment on why (ADR-084: only the tag is a code gate).

### t9 — `lib/mutparse.mjs`: range/function filtering, out-of-scope kept, per-file counts, mutmut 3 line mapping
- **id:** t9
- **file:** `lib/mutparse.mjs`, `tests/mutparse.test.mjs`, `tests/fixtures/mutate/mutmut3-results.txt`
- **depends_on:** [t2, t6]
- **Tests first** (new exports via `await import`; t6's real captures as fixtures):
  - `normalize(list, scope, {ranges, funcs})`:
    - A Stryker mutant at line 50 of a file with ranges `[[40,45]]` lands in the new `outside` list.
      Line 44 is kept.
    - A file with no `ranges` entry (whole-file) keeps every line.
    - For mutmut, `funcs: {'pkg/mod.py': ['b','K.m']}` keeps `x_b…`/`xǁKǁm…` and moves `x_a…` to
      `outside`.
    - Existing callers that pass no options are unchanged: the phase-47 fixture tests still pass.
  - `parseMutmutResults(text, {scope, lines, funcs})`:
    - Every entry carries `func`.
    - `lines` maps a mutant name to a line, and an unmapped mutant has `line: null`, never 0.
    - The phase-47 test that asserted integer lines is updated for exactly this case.
    - Null lines sort last within a file.
  - `mutmutShowLine` returns the real line in `mutmut3-src-mod.py.txt` for the first AND a later
    mutant of `b` and for `K.m`. The text at that line contains the removed expression. Two
    identical expressions in one function resolve by the hunk offset.
  - `mutantsFileOffsets(generated)` returns an offset per mutant name that, added to the function's
    `def` line, gives the same lines as `show` for the captured mutants.
  - `perFileCounts(parsed)` gives zero-filled per-file `{5 statuses, not_run, ignored}` whose grand
    total equals the input lists' lengths.
- **Implement:**
  - Use `parseMutantName` from `lib/pyscan.mjs` (9173).
  - Extend `mutmut3-results.txt` with a `ǁ` method line if the existing tests still pass with it;
    otherwise use t6's capture.

### t10 — Install hints match the project; mutmut 3 "installed but not configured"; version-aware `ac mutate setup` (D6, C10–C12)
- **id:** t10
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`, `tests/mutate_cli.test.mjs`, `tests/mutate_docs.test.mjs`, `.astrocode/debt.json`
- **depends_on:** [t4, t5, t6, t8]
- **Tests first** (`installHint` via `await import`; CLI through `restrictedEnv` and spy package
  managers, as in `mutate_cli_quiet`):
  - **C10, with no tool installed:**
    - (a) `.venv/bin/python` without pip → `uv pip install --python .venv/bin/python mutmut`;
    - (b) pnpm → `pnpm add -D @stryker-mutator/core`;
    - (c) yarn → `yarn add -D …`;
    - (d) `package-lock.json` or none → `npm i -D @stryker-mutator/core`;
    - (e) Go → unchanged;
    - (f) `requirements.txt` with `mutmut==2.4.4`, and separately `uv.lock` → a warning line naming
      the file.
    - `--check` shows the same.
    - Lockfiles, `.venv`, `go.mod` and `node_modules` are byte-identical, and the spy log is empty.
  - **C11:** the stub with `MUTATE_STUB_VERSION_CRASH=1` gives outcome `not-configured` in human and
    `--json` modes.
    - The output names `ac mutate setup`.
    - It has no `install`, no "not installed", no notice memory written, and exit 0.
    - A mutmut whose version command fails WITHOUT the signature is still `tool-missing`, with the
      failure in `warnings`.
  - **C12:**
    - A 3.8 stub plus a fresh Python project → `ac mutate setup` writes `setup.cfg [mutmut]` with
      `source_paths=` and `pytest_add_cli_args_test_selection=` pointing at the real `src`/`tests`
      dirs (or `pkg`/`test`), and no `paths_to_mutate`/`tests_dir`.
    - A 2.4 stub → the 2.x keys.
    - A second `setup` changes no byte.
    - An existing `setup.cfg` with deprecated keys under a 3.x stub → it names them and prints the
      replacement lines.
    - `pyproject.toml` with `[tool.mutmut]` → nothing written, and the `[tool.mutmut]` lines are
      printed.
  - Update the phase-47 tests that read `row.install` as a string (`mutate.test.mjs` "exact install
    strings", `mutate_docs.test.mjs`) to the default variant `row.install(defaultEnv)`. Every
    phase-47 assertion on the three default strings still holds.
- **Implement:**
  - P12: `pkg`, `install(env)`, `installHint`, used in `runMutate`'s tool-missing branch AND
    `checkMutate` (one call site each). `suggestion: {install, why, warning?}`.
  - P10: `probe` returns `{present:false, bin, unconfigured:true, reason}` on the signature
    (matched from t6's capture); `runMutate` and `checkMutate` turn it into `not-configured`.
  - P13: async `setupFor(root, tool, {env})`, with row `setup(root, {major})`. The `bin/ac.mjs`
    `setup` arm awaits it and prints the deprecated-key / pyproject guidance in ≤3 lines.
  - Human lines:
    - `not-configured`: `⚠ mutmut is installed but not configured — run: ac mutate setup`;
    - tool-missing full notice: an extra `  ⚠ <warning>` line when one is set.
  - Close the folded debt: `ac debt drop 2026-10-22-ac-mutate-reads-an-installed-mutmut-3 --reason
    "phase 48 t10: reported as not-configured with ac mutate setup (C11)"`, committing the resulting
    `.astrocode/debt.json` change.

### t11 — Log beside the run, per-phase cap, and the step a cap hit (D4, D7, C6, C7)
- **id:** t11
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`, `tests/mutate_cli.test.mjs`
- **depends_on:** [t10, t3]
- **Tests first** (`mutationSettings` via `await import`):
  - **C7:**
    - A stub printing `MARK-1` on stdout and `MARK-E` on stderr → `res.log` equals
      `.astrocode/.local/mutate-runs/<slug>.log`, and the file holds both markers.
    - `git status --porcelain` stays clean and `git check-ignore` matches.
    - A rerun with `MARK-2` → the log holds only `MARK-2`, and that dir holds exactly one `.log` for
      the slug.
    - A run of phase 2 leaves phase 1's log intact.
    - No `ac-mutate-*` dir appears in `os.tmpdir()`.
  - **C6:**
    - Project cap 2 s, with a stub printing the real initial-run marker (from t6) and then sleeping
      30 s. The run returns in under 8 s. The stub and its child pid are gone. `cap.step` matches
      the initial test run, `cap.tested` is 0, and `cap.keys` lists `mutation.phases.<n>.cap_seconds`
      and `mutation.cap_seconds`.
    - A stub that prints a progress line `120/400` before sleeping → that step and those counts.
    - A stub that prints nothing → `step: null`, and the human line says "step unknown".
    - `ac config set mutation.phases.1.cap_seconds 60` → phase 1 completes with `cap.source
      'phase'`, while phase 2 still gets the project cap.
    - No config at all → `cap_seconds` 600, `source 'default'`.
    - Run for each tool row (stryker, gremlins, mutmut 3).
- **Implement:**
  - `mutationSettings` (P4: cap now; t12 and t13 extend the same function).
  - P6 `steps`/`progress` per row, from the t6 captures.
  - `runCapped(…, {onData, tailBytes})` for the main run.
  - P7 paths: `ensureLocalDir` before spawning. Truncate the log. The Gremlins report goes to
    `gremlinsReport`. Remove `mkdtemp` and `tmpdir`.
  - `res.cap`, plus a repo-relative `res.log`.
  - Human capped line: `⚠ cap reached after <s>s during <step|step unknown> — <tested> of <total|?>
    mutants tested; raise for this phase: ac config set mutation.phases.<n>.cap_seconds <s>`, then the
    log path last.

### t12 — Scope = the lines the phase changed: Stryker ranges, Gremlins `--diff`, mutmut functions, settings (D1, C1–C4)
- **id:** t12
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`, `tests/mutate_scope.test.mjs` (new)
- **depends_on:** [t11, t1, t2, t9]
- **Tests first** (in `tests/mutate_scope.test.mjs`, stub argv from `MUTATE_STUB_LOG`):
  - **C1 (Stryker):** the t1 repo shape → `--mutate src/big.js:40-45,src/big.js:90-91` and nothing
    else, with `scope_detail` `{source:'changed-lines', narrowed:'lines', ranges, why}`.
  - **C2 (Gremlins):**
    - A two-package module → the argv holds `--diff <git rev-parse first^>` and no blanket
      `--exclude-files` list.
    - A fixture survivor on the post-phase package's line is not reported, and one on the phase's
      line is.
  - **C3 (mutmut):**
    - `pkg/mod.py` with `a`, `b`, `c` and `K.m`; the phase changes one line in `b` and one in
      `K.m`.
    - With the 3.8 stub, the argv globs are exactly `pkg.mod.x_b__mutmut_*` and
      `pkg.mod.xǁKǁm__mutmut_*`.
    - A module-level change is counted in `outside_functions` and warned about.
    - With the 2.4 stub, `--paths-to-mutate pkg/mod.py` plus `narrowed:'files'` and the reason.
  - **C4:**
    - `ac config set mutation.exclude '["src/big.js"]'` → the target is gone and `scope_detail`
      names the setting.
    - `mutation.files '["src/extra.js"]'` → a bare `src/extra.js` is added.
    - Repeat the same with mutmut.
    - Gremlins with `mutation.files` → the documented fallback and its `why`.
  - Update phase-47's "gremlins excludes every other tracked .go file" test to the new
    behaviour.
- **Implement:**
  - `mutationScope(root, phase, row, settings)` → `{files, ranges|functions, detail}`, from ONE
    `phaseStampedPaths` pass. `phaseScope` stays as the files-only wrapper for `pickTool`.
  - Rows' `build(ctx)` per P3, with `ctx` gaining `ranges`, `functions` and `base`. `parse` passes
    `{ranges, funcs}` into the mutparse filter.
  - `mutationSettings` gains `files`/`exclude`.
  - Human `scope:` line: `scope: <source> — <n> files, <m> line ranges|functions (<why>)`, never the
    joined list.
  - `bin` help text: "changed lines" instead of "changed files".

### t13 — Tests = the phase's own, with an override, passed natively per tool (D2, C5)
- **id:** t13
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`, `tests/mutate_tests.test.mjs` (new)
- **depends_on:** [t12, t8]
- **Tests first** (in `tests/mutate_tests.test.mjs`; stub `env`/`configText` logging), for each of
  Stryker, Gremlins and mutmut 3:
  - **(a)** The phase changes `tests/test_b.*` (Go: `b_test.go` with `func TestB`) while other test
    files exist.
    - Stryker: the generated config's `commandRunner.command` ends with `-- tests/b.test.mjs`. The
      jest and mocha variants are covered by a project config naming the runner.
    - Gremlins: `GOFLAGS` contains `-run=^(TestB)$`.
    - mutmut: `PYTEST_ADDOPTS` holds `tests/test_b.py` only.
    - `res.tests` is `{source:'phase-commits', files:[…], mechanism}`.
  - **(b)** `mutation.tests`, then `mutation.phases.<n>.tests`, set to another file → that file is
    what the tool is given, and `source` names the key. Phase beats project.
  - **(c)** A phase with no test files → `source:'full-suite'` with the note. The stub gets no
    generated config, no `-run`, and no `PYTEST_ADDOPTS` entry.
  - Vitest runner → `note` says not narrowed, and no claim.
  - A pre-existing `GOFLAGS`/`PYTEST_ADDOPTS` is preserved.
- **Implement:**
  - Per P5. Rows gain `testFiles` and `narrowTests(ctx)` → `{env?, configText?, mechanism, note?}`.
  - The generated Stryker config is written to `strykerConfig`.
  - `mutationSettings` gains `tests`.
  - Human line: `tests: <source> — <files, at most 5, then +N> (<mechanism>)`.
  - Apply t6's notes: a mechanism the real tool ignored is reported as not narrowed.

### t14 — Result = survivors in full + per-file counts + full list on disk; mutmut 3 real lines (D5, C8, C9)
- **id:** t14
- **file:** `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`, `tests/mutate_cli.test.mjs`, `tests/mutate_cli_quiet.test.mjs`
- **depends_on:** [t13]
- **Tests first:**
  - **C8:**
    - A Stryker report is generated in the test: 5,200 in-scope mutants across 3 files, 4 survived,
      plus timeouts, Pending and out-of-scope mutants.
    - `--json` is under 100 KB and has no `mutants`/`not_run`/`ignored` arrays.
    - The 4 survivors are listed whole.
    - `per_file` counts plus `out_of_scope_count` sum to the report total.
    - `full_list` names a file under `.local` holding one line per report mutant, with its status.
    - The human form shows the 4 survivor lines and per-file count lines, and no killed mutant line.
  - **C9:**
    - The mutmut 3 stub runs with `MUTATE_STUB_SHOW` (t6's `show` captures) and
      `MUTATE_STUB_MUTANTS` (t6's generated file).
    - Each survivor's line is > 0, it is the real line in `pkg/mod.py` (the text there contains the
      mutated expression), and it falls inside the changed function.
    - The second mutant of `b` is not at `b`'s `def` line.
    - The full list carries no 0 lines.
    - Without `MUTATE_STUB_MUTANTS`, killed mutants have `line: null`, with a warning count.
  - **Consumers:** update phase-47 assertions on `res.mutants`/`res.not_run`/`res.ignored`
    (`mutate.test.mjs` ~121/202, `mutate_cli.test.mjs` ~41–42, and any in `mutate_cli_quiet`) to
    `per_file`/the counts/the full-list file.
  - The evidence round trip (`saveMutateRun`, then `ac verdict record` with the copied fields) still
    passes.
- **Implement:**
  - P8 shape; P9 line mapping. `mutmut show` runs per survivor only, under `COLLECT_CAP_MS` in total.
    The generated file is read before `cleanup`.
  - Stream the JSONL write.
  - Human output, leading with the change:
    - line 1: outcome and counts;
    - then scope, tests, every survivor;
    - per-file lines only for files with survivors, timeouts or not-run mutants, at most 20, then
      `+N more`;
    - capped or warnings lines;
    - `full list: <path>` and `log: <path>` last.

### t15 — Real tools accept what `ac mutate` builds (C14): flag guard + opt-in real run
- **id:** t15
- **file:** `tests/mutate_flags.test.mjs` (new), `tests/mutate_real.test.mjs` (new), `tests/fixtures/mutate/real/VERSIONS.json`, `lib/mutate.mjs`
- **depends_on:** [t14, t6]
- **Test-after (by choice):** it exercises t10–t14's finished invocations.
- **`mutate_flags.test.mjs`** (default suite):
  - For every row, run `ac mutate` on a stub project with phase tests and settings, so every code
    path is exercised.
  - Extract each `--flag` / subcommand from the recorded argv. Each must appear in that tool's
    help/CLI capture in `tests/fixtures/mutate/real/`.
  - Each mutmut 3 key that `setup` writes must appear in the captured 3.8 config-key list.
- **`mutate_real.test.mjs`:**
  - It is skipped unless `AC_MUTATE_REAL=1`.
  - For each tool found on the real PATH (mutmut 3.8 and Gremlins here), on a tiny scratch project
    with a 3-line phase, it asserts:
    - no unknown-flag/option error;
    - `scope_detail` is narrowed;
    - `tests.source` is `phase-commits`;
    - mutmut survivors have lines > 0;
    - `log` and `full_list` exist.
  - Run it once here and record the results in `VERSIONS.json` (`real_runs`). Stryker is recorded as
    "not run: not installed".
  - If a real tool rejects anything, fix the row in `lib/mutate.mjs` in this task. This is the only
    reason this task touches the file.

### t16 — Docs: MANUAL, CHANGELOG, the docs guard
- **id:** t16
- **file:** `MANUAL.md`, `CHANGELOG.md`, `tests/mutate_docs.test.mjs`
- **depends_on:** [t14]
- **Tests first** (docs guard):
  - Every install variant (`row.install` over each manager) appears verbatim in the MANUAL.
  - The MANUAL names:
    - `mutation.files`, `mutation.exclude`, `mutation.tests`;
    - `mutation.phases.<n>.cap_seconds`, `mutation.phases.<n>.tests`;
    - `.astrocode/.local/mutate-runs/`;
    - `not-configured`;
    - "changed lines".
  - It states the per-tool narrowing (Stryker line ranges, Gremlins `--diff`, mutmut 3 functions,
    mutmut 2 files) and that the verifier uses the tool wherever it would hand-make mutants.
  - The section stays within its line bounds; widen the bound to 75 if needed and say why in the
    test.
  - `## Unreleased` mentions line scope and phase tests.
- **Implement:**
  - MANUAL §Mutation testing:
    - the scope, tool choice, cap and outcomes bullets;
    - the settings keys with `ac config set` examples;
    - the install table;
    - the output shape, with the log and full-list paths.
  - The CLI block at ~1195 says "changed lines".
  - One CHANGELOG bullet under Unreleased (ADR-084).

## Rule check (done before writing)

- **Red-test import rule:** every new symbol is reached by `await import` in async test bodies
  (Test strategy). No task statically imports a missing export.
- **Wave-green:**
  - No deletion is split from its consumers.
  - The result-shape removal (`mutants`/`not_run`/`ignored`) carries every consumer: `bin/ac.mjs`
    and the three test files in t14. Repo grep: no lib, workflow or agent reads them.
  - The `row.install` string → function change carries `mutate.test.mjs` and
    `mutate_docs.test.mjs` in t10.
  - The `setupFor` sync → async change carries `bin/ac.mjs` and its tests in t10.
  - The parser's `line:0` → `null` change carries its test in t9.
  - The verdict gate change carries both verdict test files in t8.
- **Same-file serialization:**
  - `lib/mutate.mjs`, `bin/ac.mjs`, `tests/mutate.test.mjs`: chain t10→t11→t12→t13→t14→(t15:
    mutate.mjs only).
  - `tests/mutate_cli.test.mjs`: t10→t11→t14.
  - `tests/mutate_docs.test.mjs`: t10→t16.
  - `tests/fixtures/mutate/real/*`: t6→t15.
  - Every other file has exactly one owner.
- **Every task declares its files**, and every task lands a commit. There is no `commits: none` task.
