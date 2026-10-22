// `ac mutate` — deterministic mutation testing for a phase (phase 47, ADR-083).
//
// What it is: the MECHANICAL half of test-strength verification. It detects the project's
// mutation tool, scopes to the files the phase changed, runs under a wall-clock cap, parses
// the tool's report into one fixed list and classifies the run. The verifier agent then
// judges only the survivors (333f). Nothing here decides what a survivor MEANS.
//
// Where each rule lives (9173): the evidence contract (statuses, outcomes, triage, the pass
// bar) in lib/verdict.mjs; report parsing in lib/mutparse.mjs; the cap in lib/caprun.mjs;
// the "told once" memory in lib/mutnotice.mjs. This module owns the tool TABLE and the run.
//
// P2/P3 notice: with no tool, the first verify-path run per project per tool prints the full
// install suggestion and records it LOCALLY; every later run prints one line. `--check` is the
// user asking, so it always shows the suggestion and never writes the memory. There is no
// prompt anywhere and stdin is never read (5116).
//
// P4 scope: `phaseStampedPaths` (lib/fixtures.mjs, never forked) — only the phase's own
// stamped commits, never the working tree or branch-vs-base — filtered to files that still
// exist, carry the tool's extensions and are not tests. It is passed to the tool explicitly
// (Stryker `--mutate`, mutmut 2.x `--paths-to-mutate`, mutmut 3.x mutant-name globs, Gremlins
// `--exclude-files` for every other tracked .go file) and the parsed mutants are filtered to
// the scope again, because a filter handed to a tool is not trusted. Empty scope = `no-scope`.
//
// P5 lookup never runs a package manager: nothing here ever spawns npm, npx, yarn, pnpm, pip,
// go or `python -m`. (Phase 49: the project's OWN test runner — `go test`, `pytest`, the Stryker
// test command — is run twice by the flaky check, at the same trust level as the tool's own run;
// that is not lookup. A Gremlins built with `go install` answers `version dev`, so its module
// version is read from the Go build info embedded in the binary — file bytes, no `go` spawned.)
// A tool is looked up on disk (node_modules/.bin, PATH, GOBIN/GOPATH/bin,
// venvs) and counts as present when its version command exits 0 within 10 s (`--version`, or
// mutmut 2.x's `version` subcommand: 2.x has no `--version` flag).
//
// P6 outcomes: clean | survivors | incomplete | no-scope | tool-missing | no-tool | error.
// Timeouts count as killed (D4); survivors are `survived` + `no-coverage`; `clean` needs a
// complete, uncapped run with at least one mutant and no survivors.
//
// P7 cap: `mutation.cap_seconds` (default DEFAULT_CAP_SECONDS), enforced as a process-group
// kill. A capped run parses whatever partial report exists; unfinished mutants go to `not_run`
// and scope files with no entry to `not_run_files`. With no report at all, the whole scope is
// not run and it says so rather than guessing.
//
// P8 hygiene: refuse to run on a dirty scope (the result would grade code that is not HEAD);
// artifacts the run created are removed afterwards, pre-existing ones are left; the tool
// runs the project's OWN tests, the same trust level as `npm test`. A scoped file an
// in-place tool left modified is warned about, never restored (git-guard posture).
//
// Phase 48 (ADR-084) narrows what a run covers and reports; each rule lives in one place
// (9173): changed lines in lib/fixtures.mjs, Python spans and mutmut names in lib/pyscan.mjs,
// report filtering in lib/mutparse.mjs, environment detection in lib/mutenv.mjs, run-file
// names in lib/verdict.mjs. This module owns the tool TABLE, the settings and the run.
//
// D2 tests: a run uses the phase's OWN test files by default (the stamped commits' runnable test
// files, from the same pass as the source scope), with `mutation.tests` / `mutation.phases.<n>.tests`
// as the override, and says which applied (`res.tests`). It is handed to each tool its own native way
// and a mechanism a tool cannot honour is reported as NOT narrowed, never claimed (b940): Stryker
// through a generated config (the CLI has no test-file option), Gremlins through GOFLAGS `-run`,
// mutmut through PYTEST_ADDOPTS (tests/fixtures/mutate/real/VERSIONS.json has the findings).
//
// P10 `not-configured`: a tool that is installed but cannot answer its version command because
// it has no configuration (mutmut 3 without `source_paths`) is NOT "not installed". It is a
// distinct outcome with `ac mutate setup` as the way out, no install hint and no notice memory.
// It is deliberately not a fallback outcome: an installed tool forbids hand-made mutants (D3).
//
// lib never writes outside `.astrocode/` (ADR-048): `setupFor` is pure and bin/ writes it.
import { existsSync, accessSync, statSync, readFileSync, writeFileSync, readdirSync, rmSync, rmdirSync, openSync, writeSync, closeSync, constants } from 'node:fs';
import { join, delimiter, relative, isAbsolute, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { git } from './git.mjs';
import { loadConfig } from './config.mjs';
import { detectStack, projectStack } from './stack.mjs';
import { phaseStampedPaths, phaseChangedLines, phaseBase, pathMatches } from './fixtures.mjs';
import { pythonFunctions, functionAt, mutmutGlob, mutmutModule, parseMutantName } from './pyscan.mjs';
import { paths } from './paths.mjs';
import { runCapped } from './caprun.mjs';
import { assertSafeSlug } from './util.mjs';
import { MUTANT_STATUSES, SURVIVOR_STATUSES, testStrengthIds, saveMutateRun, mutateRunPaths, ensureLocalDir } from './verdict.mjs';
import { parseStryker, parseGremlins, parseMutmutJunit, parseMutmutResults, countStatuses, perFileCounts, mutmutShowLine, mutantsFileOffsets } from './mutparse.mjs';
import { readNotices, noticeFor, markShown, dismiss, REMINDER } from './mutnotice.mjs';
import { detectEnv, pinsOf } from './mutenv.mjs';

export const DEFAULT_CAP_SECONDS = 600;
const VERSION_CAP_MS = 10_000;
const COLLECT_CAP_MS = 30_000;
// Never mutate (or count as source) these, whatever the tool's own test patterns say.
const SHARED_EXCLUDES = ['.astrocode/', 'node_modules/', 'vendor/'];

const isExec = (p) => {
  try { return statSync(p).isFile() && (accessSync(p, constants.X_OK), true); } catch { return false; }
};
const exeNames = (name) => (process.platform === 'win32' ? [name, `${name}.cmd`, `${name}.exe`] : [name]);
const inDirs = (dirs, name) => {
  for (const d of dirs.filter(Boolean)) for (const n of exeNames(name)) if (isExec(join(d, n))) return join(d, n);
  return null;
};
const onPath = (name, env) => inDirs(String(env.PATH ?? '').split(delimiter), name);
const firstVersion = (text) => /\d+\.\d+(?:\.\d+)?/.exec(String(text))?.[0] ?? null;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const existingDirs = (root, names) => names.filter((n) => existsSync(join(root, n)) && statSync(join(root, n)).isDirectory());
const firstFile = (root, names) => names.find((n) => existsSync(join(root, n))) ?? null;

// ---- Test narrowing (D2, P5): one function per tool, each returning what it handed over. ----
const shq = (f) => (/^[\w@%+=:,./-]+$/.test(f) ? f : `'${f.replace(/'/g, `'\\''`)}'`);
const readText = (root, f) => { try { return readFileSync(join(root, f), 'utf8'); } catch { return ''; } };

// Stryker has no CLI test-file option, so the tests go in a generated config that imports the
// project's own and overrides its runner's selection (the project file is never touched).
function strykerNarrowTests(ctx) {
  const text = ctx.config ? readText(ctx.root, ctx.config) : '';
  const runner = /["']?testRunner["']?\s*:\s*["']([\w-]+)["']/.exec(text)?.[1] ?? 'command';
  const files = ctx.files;
  const j = JSON.stringify;
  let over;
  let mechanism;
  if (runner === 'command') {
    const base = /["']?command["']?\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ?? 'npm test';
    const rest = files.map(shq).join(' ');
    const command = /^npm\b/.test(base) && !/\s--\s/.test(base) ? `${base} -- ${rest}` : `${base} ${rest}`;
    over = `commandRunner: { ...base.commandRunner, command: ${j(command)} }`;
    mechanism = 'generated Stryker config: commandRunner.command';
  } else if (runner === 'mocha') {
    over = `mochaOptions: { ...base.mochaOptions, spec: ${j(files)} }`;
    mechanism = 'generated Stryker config: mochaOptions.spec';
  } else if (runner === 'jest') {
    over = `jest: { ...base.jest, config: { ...base.jest?.config, testMatch: ${j(files.map((f) => join(ctx.root, f)))} } }`;
    mechanism = 'generated Stryker config: jest.config.testMatch';
  } else if (runner === 'tap') {
    over = `tap: { ...base.tap, testFiles: ${j(files)} }`;
    mechanism = 'generated Stryker config: tap.testFiles';
  } else {
    return { mechanism: 'none', note: `the ${runner} test runner has no test-file option in Stryker — not narrowed, the full suite runs` };
  }
  const imp = !ctx.config ? 'const base = {};'
    : `import base from ${j(pathToFileURL(join(ctx.root, ctx.config)).href)}${ctx.config.endsWith('.json') ? " with { type: 'json' }" : ''};`;
  const configText = `// astro-code: generated by \`ac mutate\` — the project's Stryker config with this phase's tests. Safe to delete.\n${imp}\n\nexport default { ...base, ${over} };\n`;
  return { configText, mechanism };
}

// Gremlins runs each mutant's own package tests and has no test flag; GOFLAGS `-run` reaches its
// `go test` calls (verified on the real tool). Unmatched mutants then read NOT COVERED.
function gremlinsNarrowTests(ctx) {
  const names = [...new Set(ctx.files.flatMap((f) => [...readText(ctx.root, f).matchAll(/^func\s+(Test\w*)\s*\(/gm)].map((m) => m[1])))];
  if (!names.length) return { mechanism: 'none', note: 'no Test functions found in the chosen files — not narrowed, the full suite runs' };
  const flag = `-run=^(${names.join('|')})$`;
  return { env: { GOFLAGS: [ctx.env.GOFLAGS, flag].filter(Boolean).join(' ') }, mechanism: `GOFLAGS ${flag}` };
}

// mutmut: config is the only selection route and the project's config is never touched, so the tests go in
// PYTEST_ADDOPTS (pytest reads it in-process). Real 3.8 finding: positional files only narrow when the
// project config has no `pytest_add_cli_args_test_selection` (the union would still collect that
// directory), so then every OTHER test file is `--ignore`d instead.
function mutmutNarrowTests(ctx) {
  const cfg = `${readText(ctx.root, 'setup.cfg')}\n${readText(ctx.root, 'pyproject.toml')}`;
  const selects = /pytest_add_cli_args_test_selection|tests_dir/.test(cfg);
  const note = /^\s*runner\s*[=:]/m.test(cfg) && !/pytest/.test((/^\s*runner\s*[=:]\s*(.*)$/m.exec(cfg) ?? [])[1] ?? '')
    ? 'the project sets a non-pytest mutmut runner — the selection may be ignored' : undefined;
  const mine = selects
    ? ctx.trackedTests.filter((f) => !ctx.files.includes(f)).map((f) => `--ignore=${shq(f)}`)
    : ctx.files.map(shq);
  if (!mine.length) return { mechanism: 'none', note: 'every test file is already selected — nothing to narrow' };
  return {
    env: { PYTEST_ADDOPTS: [mine.join(' '), ctx.env.PYTEST_ADDOPTS].filter(Boolean).join(' ') },
    mechanism: selects ? 'PYTEST_ADDOPTS --ignore of the other test files' : 'PYTEST_ADDOPTS test files',
    ...(note ? { note } : {}),
  };
}

// ---- The tool table (D4). A new tool is a new row, not a new code path. ----
// `build(ctx)` → `{ argv, collectArgv?, reportFile?, config? }`; `parse(text, ctx)` → mutparse shape.
export const MUTATION_TOOLS = [
  {
    id: 'stryker',
    label: 'Stryker',
    tags: ['node', 'typescript'],
    extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
    testPatterns: [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)(tests?|__tests__)\//],
    // Runnable test files only: a helper or fixture under tests/ is a test PATH but not a test FILE.
    testFiles: [/\.(test|spec)\.[cm]?[jt]sx?$/],
    narrowTests: strykerNarrowTests,
    pkg: '@stryker-mutator/core',
    ecosystem: 'node',
    // The default variant (npm) is byte-identical to phase 47; pnpm and yarn follow the lockfile.
    install: (env) => `${{ pnpm: 'pnpm add -D', yarn: 'yarn add -D' }[env.node.manager] ?? 'npm i -D'} @stryker-mutator/core`,
    installWhy: (env) => (env.node.via ? `${env.node.via} → ${env.node.manager}` : 'no pnpm or yarn lockfile → npm'),
    configFiles: ['stryker.config.json', 'stryker.config.mjs', 'stryker.config.js', 'stryker.config.cjs', '.stryker.conf.json'],
    find: (root, env) => inDirs([join(root, 'node_modules', '.bin')], 'stryker') ?? onPath('stryker', env),
    versionArgs: ['--version'],
    parseVersion: firstVersion,
    artifacts: ['reports/mutation/mutation.json', '.stryker-tmp'],
    // Log markers a capped run is placed by (P6). Stryker prints to STDOUT; see
    // tests/fixtures/mutate/real/stryker-cli-documented.txt (transcribed, not captured).
    steps: [{ re: /initial test run/i, name: 'initial test run' }, { re: /Mutation testing/, name: 'mutation testing' }],
    progress: /(\d+)\/(\d+)\s+(?:Mutants\s+)?tested/gi,
    build: (ctx) => ({
      // `stryker run [configFile]`: an existing config is passed explicitly (C7).
      // One comma-joined list of `file:start-end` line ranges (a bare `file` for a whole-file entry).
      argv: [ctx.bin, 'run', ...(ctx.config ? [ctx.config] : []), '--mutate', ctx.mutateArg, '--reporters', 'json'],
      reportFile: join(ctx.root, 'reports', 'mutation', 'mutation.json'),
    }),
    parse: (text, ctx) => parseStryker(text, { scope: ctx.scope, ranges: ctx.ranges }),
    narrowing: () => ({ narrowed: 'lines', why: 'line ranges the phase wrote, passed as --mutate file:start-end' }),
    setup(root) {
      const dirs = existingDirs(root, ['src', 'lib', 'app']);
      const mutate = (dirs.length ? dirs : ['src']).flatMap((d) => [`${d}/**/*.{js,mjs,cjs,jsx,ts,tsx}`, `!${d}/**/*.{test,spec}.*`]);
      // The built-in `command` runner needs no extra plugin: it runs the project's own `npm test`.
      const cfg = { testRunner: 'command', commandRunner: { command: 'npm test' }, reporters: ['json', 'clear-text'], mutate };
      return { file: 'stryker.config.json', content: JSON.stringify(cfg, null, 2) + '\n' };
    },
  },
  {
    id: 'gremlins',
    label: 'Gremlins',
    tags: ['go'],
    extensions: ['.go'],
    testPatterns: [/_test\.go$/],
    testFiles: [/_test\.go$/],
    narrowTests: gremlinsNarrowTests,
    pkg: 'go-gremlins/gremlins',
    ecosystem: 'go',
    install: () => 'go install github.com/go-gremlins/gremlins/cmd/gremlins@latest',
    installWhy: () => 'go.mod → go install',
    configFiles: ['.gremlins.yaml'],
    // env vars only, never `go env`: the lookup must not run a package manager or `go`.
    find: (root, env) => onPath('gremlins', env) ?? inDirs([
      env.GOBIN,
      ...String(env.GOPATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'bin')),
      join(env.HOME ?? homedir(), 'go', 'bin'),
    ], 'gremlins'),
    versionArgs: ['--version'],
    parseVersion: firstVersion,
    // `go install` builds report `version dev`: the module version sits in the binary's build info.
    binaryVersion: (bin, warn) => goBuildInfoVersion(bin, warn),
    artifacts: [],
    // From tests/fixtures/mutate/real/gremlins-run-output.txt: no counter, one line per finished mutant.
    steps: [
      { re: /Gathering files diff/, name: 'gathering the diff' },
      { re: /Gathering coverage/, name: 'gathering coverage' },
      { re: /^\s*(?:KILLED|LIVED|NOT COVERED|TIMED OUT|NOT VIABLE|SKIPPED)\b/m, name: 'mutation testing' },
    ],
    // No counter: every finished-mutant line counts as one tested (total stays unknown).
    tick: /^\s*(?:KILLED|LIVED|TIMED OUT|NOT VIABLE)\b/,
    build: (ctx) => ({
      // Diff mode against the phase's base (D1): Gremlins itself narrows to what changed since. Only
      // files a setting excludes are named. `mutation.files` cannot be expressed as a diff, so a run
      // that adds files falls back to excluding every other tracked .go file (the phase 47 mode).
      argv: [ctx.bin, 'unleash', '--output', ctx.reportFile,
        ...(ctx.diffMode
          ? ['--diff', ctx.base, ...ctx.excluded.flatMap((f) => ['--exclude-files', `^${escRe(f)}$`])]
          : ctx.otherGoFiles.flatMap((f) => ['--exclude-files', `^${escRe(f)}$`]))],
      reportFile: ctx.reportFile,
    }),
    // The diff may include post-phase commits, so survivors are filtered back to the phase's lines.
    parse: (text, ctx) => parseGremlins(text, { scope: ctx.scope, ranges: ctx.ranges }),
    narrowing: (c) => (c.diffMode
      ? { narrowed: 'diff', why: '--diff against the commit before the phase; survivors are filtered to the phase\'s lines' }
      : { narrowed: 'files', why: 'mutation.files adds whole files, which a --diff run cannot express — every other .go file is excluded instead' }),
    setup() {
      // Plain `key: value` lines only; gremlins reads `.gremlins.yaml` from the working directory.
      return { file: '.gremlins.yaml', content: '# astro-code: minimal Gremlins config (ac mutate setup). Edit freely.\nunleash:\n  workers: 2\n  timeout-coefficient: 3\n' };
    },
  },
  {
    id: 'mutmut',
    label: 'mutmut',
    tags: ['python'],
    extensions: ['.py'],
    testPatterns: [/(^|\/)test_[^/]*\.py$/, /_test\.py$/, /(^|\/)tests?\//, /(^|\/)conftest\.py$/],
    testFiles: [/(^|\/)test_[^/]*\.py$/, /_test\.py$/],
    narrowTests: mutmutNarrowTests,
    pkg: 'mutmut',
    ecosystem: 'python',
    // A uv-managed `.venv` has no pip (Waupaca): `pip install` fails there, uv targets the venv.
    install: (env) => (env.python.installer === 'uv-venv' ? 'uv pip install --python .venv/bin/python mutmut' : 'pip install mutmut'),
    installWhy: (env) => (env.python.installer === 'uv-venv' ? '.venv has no pip → uv' : 'pip'),
    // The real mutmut 3.8 text when it has no configuration to find its source folder (t6 capture).
    unconfigured: /Could not figure out where the code to mutate is/,
    configFiles: ['setup.cfg'],
    find: (root, env) => onPath('mutmut', env) ?? inDirs([join(root, '.venv', 'bin'), join(root, 'venv', 'bin')], 'mutmut'),
    versionArgs: [['--version'], ['version']], // 3.x has --version; 2.x only `mutmut version`
    parseVersion: firstVersion,
    artifacts: ['.mutmut-cache', 'mutants'],
    // From tests/fixtures/mutate/real/mutmut3-run-output.txt (spinner frames included).
    steps: [
      { re: /Generating mutants/, name: 'generating mutants' },
      // mutmut 2.x numbered banner steps
      { re: /Running tests without mutations/, name: 'clean tests run' },
      { re: /Checking mutants/, name: 'mutation testing' },
      { re: /Running stats/, name: 'stats run' },
      { re: /Running clean tests/, name: 'clean tests run' },
      { re: /Running forced fail test/, name: 'forced fail test' },
      { re: /Running mutation testing|\d+\/\d+\s+🎉/, name: 'mutation testing' },
    ],
    progress: /(\d+)\/(\d+)\s+🎉/g,
    // 2.x `junitxml` defaults both policies to `ignore`, which writes an untested mutant (every
    // mutant `run` registered but never reached: a crash, a cap) as a plain testcase — read as
    // killed. `failure` puts the status in the message, so untested is not run, never killed.
    build: (ctx) => ctx.major === 2
      ? { argv: [ctx.bin, 'run', '--paths-to-mutate', ctx.scope.join(',')], collectArgv: [ctx.bin, 'junitxml', '--untested-policy', 'failure', '--suspicious-policy', 'failure'],
          // junitxml writes a `pre_mutation`-skipped mutant as a plain testcase; result-ids names them.
          skippedArgv: [ctx.bin, 'result-ids', 'skipped'] }
      // 3.x reads paths from config only, so scope is passed as mutant-name globs (lib/pyscan.mjs
      // owns the naming: a stripped `src.`, a package's `__init__.py` named after the package).
      // Narrowed to the changed FUNCTIONS (D1): one glob per function; a whole-file entry gets `module.*`.
      : { argv: [ctx.bin, 'run', ...ctx.mutantGlobs], collectArgv: [ctx.bin, 'results', '--all', 'true'] },
    parse: (text, ctx) => (ctx.major === 2 ? parseMutmutJunit : parseMutmutResults)(text, { scope: ctx.scope, skippedIds: ctx.skippedIds, ranges: ctx.ranges, funcs: ctx.major === 2 ? null : ctx.functions, lines: ctx.lines }),
    narrowing: (c) => (c.major === 2
      ? { narrowed: 'files', why: 'mutmut 2 selects whole files only; its function-level pre_mutation hook needs a mutmut_config.py written into the project, which ac never does — results are filtered to the changed lines' }
      : { narrowed: 'functions', why: 'mutmut 3 cannot target lines, so the functions holding changed lines are selected by mutant-name glob' }),
    // 2.x exits with a bit mask; bit 1 is fatal (e.g. the baseline tests fail before any mutant
    // runs). Its junitxml then prints the OLD cache, so a fatal run's report is never trusted.
    fatalExit: (status, ctx) => ctx.major === 2 && Number.isInteger(status) && (status & 1) === 1,
    supportedMajors: [2, 3],
    // 3.x renamed the keys: `source_paths` and `pytest_add_cli_args_test_selection` (t6 capture of
    // 3.8's config reader); `paths_to_mutate` / `tests_dir` still work there but warn as deprecated.
    // When pyproject.toml already has a `[tool.mutmut]` table mutmut 3 reads only that, so a
    // setup.cfg would be ignored: the lines go in the table instead, printed and not written.
    setup(root, { major = 3 } = {}) {
      // src/ or lib/, else the first top-level package (a directory with an __init__.py), else src/.
      const dirs = existingDirs(root, ['src', 'lib']);
      const pkgs = dirs.length ? [] : readdirSync(root).filter((n) => !/^(tests?|docs?|venv|node_modules)$|^\./.test(n)
        && existsSync(join(root, n, '__init__.py'))).sort();
      const src = dirs.length ? `${dirs[0]}/` : pkgs.length ? `${pkgs[0]}/` : 'src/';
      const tests = existingDirs(root, ['tests', 'test'])[0] ?? 'tests';
      if (major < 3) return { file: 'setup.cfg', content: `[mutmut]\npaths_to_mutate=${src}\ntests_dir=${tests}/\n` };
      let pyproject = '';
      try { pyproject = readFileSync(join(root, 'pyproject.toml'), 'utf8'); } catch { /* none */ }
      if (/^\s*\[tool\.mutmut\]/m.test(pyproject)) {
        return {
          file: 'pyproject.toml', exists: true, note: 'pyproject.toml has [tool.mutmut], so mutmut 3 ignores setup.cfg — add these lines to that table',
          content: `[tool.mutmut]\nsource_paths = ["${src}"]\npytest_add_cli_args_test_selection = ["${tests}/"]\n`,
        };
      }
      return { file: 'setup.cfg', content: `[mutmut]\nsource_paths=${src}\npytest_add_cli_args_test_selection=${tests}/\n` };
    },
    deprecatedKeys: { paths_to_mutate: 'source_paths', tests_dir: 'pytest_add_cli_args_test_selection' },
  },
];

/**
 * The module version of a Go binary built with `go install`, read from its embedded build info
 * (the `mod` line `go version -m` prints), or null. Only the `mod` line whose path ends in
 * `/gremlins` counts — never a `dep` line — and `(devel)` is no version (b940). No process runs.
 * `warn(msg)` hears a read error; a missing file is simply null.
 */
export function goBuildInfoVersion(file, warn = () => {}) {
  let text;
  try {
    if (!existsSync(file)) return null;
    text = readFileSync(file).toString('latin1');
  } catch (e) { warn(`could not read ${basename(String(file))} for its Go build info: ${e.message}`); return null; }
  const m = /(?:^|[\n\t])mod\t[^\t\n]*\/gremlins\t(v[^\t\n]+)/.exec(text);
  return m && m[1] !== '(devel)' ? m[1] : null;
}

/**
 * How `/astro-verify` words a fallback (phase 49, C13) — from the reason, never one fixed sentence.
 * `ai_mutants` says whether hand-made mutants stood in; `lead` starts the one-line `report`.
 * The reason strings themselves stay as they are: tests and the gate pin them.
 */
export const FALLBACK_REPORTS = {
  'no-tool': { ai_mutants: true, lead: 'AI mutants stood in' },
  'tool-missing': { ai_mutants: true, lead: 'AI mutants stood in' },
  'no-scope': { ai_mutants: true, lead: 'AI mutants stood in' },
  'no-scope-excluded': { ai_mutants: false, lead: 'no mutants were run' },
  'no-scope-installed': { ai_mutants: false, lead: 'no mutants were run' },
};
const fallbackOf = (kind, reason) => {
  const f = FALLBACK_REPORTS[kind];
  return { reason, ai_mutants: f.ai_mutants, report: `${f.lead}: ${reason}` };
};

/** The environment an install hint falls back to: no lockfile, no uv venv. */
export const DEFAULT_ENV = { node: { manager: 'npm', via: null }, python: { installer: 'pip', via: null, locked: null } };

/**
 * How to install a row's tool HERE (D6, P12): `{ install, why, warning? }`. Read-only detection —
 * nothing is spawned and nothing is written. `warning` appears when the tool's package is pinned
 * (the file is named) or the Python environment is lock-managed, because a later sync can drop a
 * manual install. A Node lockfile alone does not warn: `add -D` updates it.
 */
export function installHint(root, row) {
  const env = detectEnv(root);
  const out = { install: row.install(env), why: row.installWhy(env) };
  const pin = pinsOf(root, row.pkg, row.ecosystem)[0];
  if (pin) out.warning = `${pin.file} pins ${row.pkg} (${pin.spec}) — an install may change nothing`;
  else if (row.ecosystem === 'python' && env.python.locked) {
    out.warning = `${env.python.locked} manages this Python environment — a later sync can drop a manual install`;
  }
  return out;
}

const rowById = (id) => MUTATION_TOOLS.find((r) => r.id === id) ?? null;
const zeroCounts = () => Object.fromEntries(MUTANT_STATUSES.map((s) => [s, 0]));

/** Pure: the outcome for a run (P6). `state` short-circuits for runs that never produced a list. */
export function classifyRun({ state, capped, complete, counts }) {
  if (state) return state;
  if (capped || !complete) return 'incomplete';
  const total = MUTANT_STATUSES.reduce((n, k) => n + (counts?.[k] ?? 0), 0);
  if (total === 0) return 'incomplete';
  const survivors = SURVIVOR_STATUSES.reduce((n, k) => n + (counts[k] ?? 0), 0);
  return survivors > 0 ? 'survivors' : 'clean';
}

// A file `ac mutate` may mutate for this row: right extension, not vendored, not a test, and still
// on disk.
function isSource(root, row, f) {
  return row.extensions.some((e) => f.endsWith(e))
    && !SHARED_EXCLUDES.some((x) => f.startsWith(x) || f.includes(`/${x}`))
    && !row.testPatterns.some((re) => re.test(f))
    && (() => { try { return statSync(join(root, f)).isFile(); } catch { return false; } })();
}

/** The phase's changed, existing, non-test source files for one tool row (P4). Sorted. */
export function phaseScope(root, phase, row) {
  return phaseStampedPaths(root, phase).files.filter((f) => isSource(root, row, f)).sort();
}

/**
 * The scope of one run (D1, P1-P4): the LINES the phase's stamped commits wrote, plus/minus the
 * project's `mutation.files` / `mutation.exclude`. One `phaseStampedPaths` pass feeds the files, the
 * lines (9173). `{ files, ranges, whole, functions, outside_functions, no_lines,
 * excluded, added, base, tests, detail }`. A file with no changed lines drops out — it never falls
 * back to the whole file (b940) — and the detail counts it.
 */
export function mutationScope(root, phase, row, settings, warnings = []) {
  const stamped = phaseStampedPaths(root, phase).files;
  const excludedBy = (f) => settings.exclude.some((x) => pathMatches(x, f));
  const changed = stamped.filter((f) => isSource(root, row, f)).sort();
  // Every tracked source file a `mutation.exclude` entry covers, not only the phase's own: a diff-mode
  // tool (Gremlins) would otherwise still see an excluded file that changed after the phase.
  const tracked = git(['ls-files'], { cwd: root }).stdout.split('\n').filter(Boolean);
  const excluded = [...new Set([...changed, ...tracked.filter((f) => isSource(root, row, f))].filter(excludedBy))].sort();
  const lines = phaseChangedLines(root, phase, changed.filter((f) => !excludedBy(f)));
  const ranges = lines;
  const noLines = changed.filter((f) => !excludedBy(f) && !lines[f]);
  // `mutation.files`: whole-file additions, expanded over tracked files (a trailing "/" is a directory).
  const added = [];
  for (const entry of settings.files) {
    const hits = tracked.filter((f) => pathMatches(entry, f) && isSource(root, row, f) && !excludedBy(f));
    if (!hits.length) warnings.push(`mutation.files "${entry}" matches no ${row.label} source file — ignored`);
    for (const h of hits) if (!added.includes(h)) added.push(h);
  }
  const whole = added.filter((f) => !lines[f]);
  const files = [...new Set([...Object.keys(lines), ...whole])].sort();
  const parts = [];
  if (Object.keys(lines).length) parts.push('changed-lines');
  if (whole.length) parts.push('mutation.files');
  if (excluded.length) parts.push('mutation.exclude');
  const source = parts.join(' + ') || 'changed-lines';
  // Python: which functions hold the changed lines (used when mutmut 3 is the version that runs).
  let functions = null;
  let outside = 0;
  const spans = {};
  if (row.id === 'mutmut') {
    functions = {};
    for (const [f, rs] of Object.entries(lines)) {
      let funcs = [];
      try { funcs = pythonFunctions(readFileSync(join(root, f), 'utf8')); } catch { /* unreadable: no functions */ }
      const quals = new Set();
      for (const [a, b] of rs) {
        for (let n = a; n <= b; n += 1) {
          const q = functionAt(funcs, n);
          if (q) quals.add(q); else outside += 1;
        }
      }
      functions[f] = [...quals].sort();
      spans[f] = functions[f].map((q) => { const fn = funcs.find((x) => x.qual === q); return [fn.start, fn.end]; });
    }
  }
  // The runnable test files the phase wrote (D2) — from the same stamped pass as the source files.
  const exists = (f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } };
  const tests = stamped.filter((f) => row.testFiles.some((re) => re.test(f)) && exists(f)).sort();
  const trackedTests = tracked.filter((f) => row.testFiles.some((re) => re.test(f)));
  const nRanges = Object.values(lines).reduce((n, r) => n + r.length, 0);
  const detail = { source, narrowed: null, why: null, files: files.length, ranges: lines, line_ranges: nRanges, no_lines: noLines, excluded: excluded.slice(0, 20), excluded_count: excluded.length, added };
  return { files, ranges, whole, functions, outside_functions: outside, spans, excluded, added, tests, trackedTests, detail };
}

/**
 * Which tests a run uses (D2): the override setting (phase beats project) when present, else the
 * phase's own test files, else the full suite — said out loud. `{ source, files, note? }`.
 */
export function chooseTests(root, settings, scope, warnings = []) {
  if (settings.tests) {
    const present = settings.tests.files.filter((f) => existsSync(join(root, f)));
    for (const f of settings.tests.files) if (!present.includes(f)) warnings.push(`${settings.tests.key} "${f}" does not exist — ignored`);
    if (present.length) return { source: settings.tests.source, files: present };
  }
  if (scope.tests.length) return { source: 'phase-commits', files: scope.tests };
  return { source: 'full-suite', files: [], note: 'the phase changed no test files — full suite' };
}

/**
 * Pick the tool (P5). `mutation.tool` in config wins outright; otherwise the detected rows in
 * table order, the first with a non-empty scope. `{ row, source, why, skipped, error? }`;
 * `row` is null when no supported language is detected.
 */
export function pickTool(root, phase = null) {
  const cfg = loadConfig(root)?.mutation ?? {};
  if (typeof cfg.tool === 'string' && cfg.tool.trim()) {
    const row = rowById(cfg.tool.trim());
    if (!row) return { row: null, source: 'config', why: 'config mutation.tool', skipped: [], error: `unknown mutation.tool "${cfg.tool}" — supported: ${MUTATION_TOOLS.map((r) => r.id).join(', ')}` };
    return { row, source: 'config', why: 'config mutation.tool', skipped: [] };
  }
  const stack = projectStack(root);
  const detected = MUTATION_TOOLS.filter((r) => r.tags.some((t) => stack.tags.includes(t)));
  if (!detected.length) return { row: null, source: 'detected', why: 'no supported language detected', skipped: [] };
  const chosen = (phase != null && detected.find((r) => phaseScope(root, phase, r).length)) || detected[0];
  const via = stack.override ? 'config stack'
    : detectStack(root).sources.find((s) => s.tags.some((t) => chosen.tags.includes(t)))?.file ?? 'manifest';
  return { row: chosen, source: 'detected', why: `${via} → ${chosen.id}`, skipped: detected.filter((r) => r !== chosen).map((r) => r.id) };
}

// ---- Settings (P4): ONE reader, so the keys and their precedence live in one place (9173). ----
// phase > project > default. A value of the wrong type is ignored with a warning (b940), and the
// result names the keys it consulted so a capped run can say which one to raise (1f10).
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

export function mutationSettings(root, num, warnings = []) {
  const cfg = loadConfig(root)?.mutation ?? {};
  const n = String(parseInt(num, 10));
  const keys = [`mutation.phases.${n}.cap_seconds`, 'mutation.cap_seconds'];
  const cap = { seconds: DEFAULT_CAP_SECONDS, source: 'default', keys };
  const list = (key, raw) => {
    if (raw === undefined) return [];
    if (Array.isArray(raw) && raw.every((x) => typeof x === 'string' && x.trim())) return raw.map((x) => x.trim().replace(/^\.\//, ''));
    warnings.push(`${key} must be a list of paths — ignored`);
    return [];
  };
  for (const [source, raw, key] of [['phase', cfg.phases?.[n]?.cap_seconds, keys[0]], ['project', cfg.cap_seconds, keys[1]]]) {
    if (raw === undefined) continue;
    const ok = positive(raw);
    if (ok) { cap.seconds = ok; cap.source = source; break; }
    warnings.push(`${key} "${raw}" is not a positive number — ignored`);
  }
  // The tests override (D2): phase beats project; the key it came from is kept for the result.
  let tests = null;
  for (const [key, raw] of [[`mutation.phases.${n}.tests`, cfg.phases?.[n]?.tests], ['mutation.tests', cfg.tests]]) {
    if (raw === undefined) continue;
    const l = list(key, raw);
    if (l.length) { tests = { files: l, source: key, key }; break; }
  }
  return { cap, files: list('mutation.files', cfg.files), exclude: list('mutation.exclude', cfg.exclude), tests };
}

// Live progress scanner for a running tool (P6): the step it is in and the last `tested/total`
// counter. It keeps a short carry so a marker split across two chunks is still seen, and a step
// only ever moves forward (a stale marker in the carry cannot move it back).
export function stepScanner(row) {
  const st = { step: null, idx: -1, tested: null, total: null, carry: '', line: '', ticks: 0 };
  const feed = (chunk) => {
    if (row.tick) {
      const parts = (st.line + chunk).split('\n');
      st.line = parts.pop();
      for (const l of parts) if (row.tick.test(l)) st.ticks += 1;
      if (st.ticks) st.tested = st.ticks;
    }
    const text = st.carry + chunk;
    st.carry = text.slice(-512);
    let best = -1;
    let bestAt = -1;
    (row.steps ?? []).forEach((s, i) => {
      const flags = s.re.flags.replace('g', '');
      const re = new RegExp(s.re.source, `${flags}g`);
      let last = -1;
      for (const m of text.matchAll(re)) last = m.index;
      if (last > -1 && i >= st.idx && last >= bestAt) { best = i; bestAt = last; }
    });
    if (best > -1) { st.idx = best; st.step = row.steps[best].name; }
    if (row.progress) {
      let last = null;
      for (const m of text.matchAll(row.progress)) last = m;
      if (last) { st.tested = Number(last[1]); st.total = Number(last[2]); }
    }
  };
  return { feed, state: st };
}

async function probe(row, root, env) {
  const bin = row.find(root, env);
  if (!bin) return { present: false };
  // `versionArgs` is one argv tail, or a list of them tried in order until one exits 0.
  const tries = Array.isArray(row.versionArgs[0]) ? row.versionArgs : [row.versionArgs];
  let output = '';
  for (const args of tries) {
    const r = await runCapped([bin, ...args], { cwd: root, env, capMs: VERSION_CAP_MS });
    if (r.status === 0) {
      let version = row.parseVersion(`${r.stdout}\n${r.stderr}`);
      const warnings = [];
      if (version === null && row.binaryVersion) version = row.binaryVersion(bin, (w) => warnings.push(w));
      return { present: true, bin, version, ...(warnings.length ? { warnings } : {}) };
    }
    output += `${r.stdout}\n${r.stderr}\n`;
  }
  // Installed, but it cannot even report its version without configuration: say so, don't call it missing.
  const sig = row.unconfigured && output.split('\n').find((l) => row.unconfigured.test(l));
  if (sig) return { present: false, bin, unconfigured: true, reason: `${row.label} is installed but not configured: ${sig.trim()}` };
  return { present: false, bin, reason: `${tries.map((a) => `\`${basename(bin)} ${a.join(' ')}\``).join(' and ')} failed` };
}

const head = (root) => { const r = git(['rev-parse', 'HEAD'], { cwd: root }); return r.status === 0 ? r.stdout.trim() : null; };
const rel = (root, p) => (isAbsolute(p) ? relative(root, p) : p);
const NO_TOOL_REASON = 'no supported mutation tool for this project — AI mutants used';
const NOT_CONFIGURED_HINT = 'ac mutate setup';
const NO_SCOPE_REASON = 'phase changed no mutable source files — AI mutants used';

function criteriaRequired(root, slug) {
  try { return testStrengthIds(readFileSync(join(paths(root).phases, slug, 'CRITERIA.md'), 'utf8')); } catch { return []; }
}

function cleanup(root, row, before) {
  for (const a of row.artifacts) if (!before.existed.has(a)) rmSync(join(root, a), { recursive: true, force: true });
  for (const d of before.createdDirs) { try { rmdirSync(d); } catch { /* not empty or gone */ } }
}

function snapshot(root, row) {
  const existed = new Set(row.artifacts.filter((a) => existsSync(join(root, a))));
  const createdDirs = [];
  for (const a of row.artifacts) {
    for (let d = dirname(join(root, a)); d !== root && d.startsWith(root); d = dirname(d)) {
      if (!existsSync(d)) createdDirs.push(d);
    }
  }
  return { existed, createdDirs: createdDirs.sort((x, y) => y.length - x.length) };
}

// The complete mutant list goes to disk, one JSON object per line (D5): every in-scope mutant with its
// status, not-run and ignored ones, and everything the scope left out (`"scope":"out"`). Written in
// batches so a 15,000-mutant run never builds one huge string. Returns the line count.
function writeFullList(file, parsed) {
  const fd = openSync(file, 'w');
  let n = 0;
  try {
    let buf = [];
    const flush = () => { if (buf.length) { writeSync(fd, buf.join('')); buf = []; } };
    for (const [list, scope] of [[parsed.mutants, 'in'], [parsed.not_run, 'in'], [parsed.ignored, 'in'], [parsed.outside ?? [], 'out']]) {
      for (const m of list) {
        buf.push(`${JSON.stringify({ file: m.file, line: m.line, mutator: m.mutator, status: m.status, id: m.id, scope })}\n`);
        n += 1;
        if (buf.length >= 1000) flush();
      }
    }
    flush();
  } finally { closeSync(fd); }
  return n;
}

// mutmut 3 names a mutant but gives no line (P9). Every mutant is placed from the generated
// `mutants/<file>` (no process per mutant); each SURVIVOR is then confirmed by `mutmut show`, bounded
// by COLLECT_CAP_MS in total. Both routes are text matching against the real source (333f).
async function mapMutmutLines({ root, bin, env, logFile, scopeFiles, parsed }) {
  const lines = {};
  const src = {};
  const offsets = {};
  const modOf = new Map();
  for (const f of scopeFiles) {
    let text = '';
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    src[f] = { text, funcs: pythonFunctions(text) };
    let gen = '';
    try { gen = readFileSync(join(root, 'mutants', f), 'utf8'); } catch { /* no generated file: show only */ }
    offsets[f] = mutantsFileOffsets(gen);
    modOf.set(mutmutModule(f), f);
    modOf.set(f.replace(/\.py$/, '').replace(/\//g, '.'), f);
  }
  const all = [...parsed.mutants, ...parsed.not_run, ...parsed.ignored, ...parsed.outside];
  for (const m of all) {
    const pn = m.name ? parseMutantName(m.name) : null;
    const f = pn && modOf.get(pn.module);
    const fn = f && src[f]?.funcs.find((x) => x.qual === pn.qual);
    const off = f && offsets[f][m.name.slice(m.name.lastIndexOf('.') + 1)];
    if (fn && off !== undefined) lines[m.name] = fn.def + off;
  }
  const deadline = Date.now() + COLLECT_CAP_MS;
  for (const m of parsed.mutants.filter((x) => SURVIVOR_STATUSES.includes(x.status))) {
    const pn = parseMutantName(m.name ?? '');
    const f = pn && modOf.get(pn.module);
    const fn = f && src[f]?.funcs.find((x) => x.qual === pn.qual);
    const left = deadline - Date.now();
    if (!fn || left <= 0) continue;
    const r = await runCapped([bin, 'show', m.name], { cwd: root, env, capMs: left, logFile, logStdout: false });
    const at = r.status === 0 ? mutmutShowLine(r.stdout, src[f].text, fn) : null;
    if (at) lines[m.name] = at;
  }
  return lines;
}

/**
 * Run mutation testing for one phase. Never throws on a missing tool, a bad report or a
 * capped run — each is a visible outcome (b940, 6105). `notice: false` makes it side-effect free
 * of the suggestion memory (used by tests and `--check`-like callers).
 */
export async function runMutate(root, phaseSlug, { notice = true, env = process.env } = {}) {
  assertSafeSlug(phaseSlug);
  const t0 = Date.now();
  const warnings = [];
  const num = String(parseInt(/^(\d+)/.exec(phaseSlug)?.[1] ?? '0', 10));
  const settings = mutationSettings(root, num, warnings);
  const cap_seconds = settings.cap.seconds;
  const res = {
    tool: null, command: null, reproduce: `ac mutate ${num} --json`, head: head(root), scope: [], cap_seconds,
    capped: false, complete: false, outcome: 'error', counts: zeroCounts(), survivors: [], per_file: {},
    not_run_count: 0, ignored_count: 0, out_of_scope_count: 0, full_list: null, not_run_files: [], skipped_tools: [], fallback: null, notice: null,
    required: criteriaRequired(root, phaseSlug), warnings, log: null, cap: { ...settings.cap }, tests: null, started_at: new Date(t0).toISOString(), duration_ms: 0,
  };
  const finish = (outcome, extra = {}) => {
    Object.assign(res, extra, { outcome, duration_ms: Date.now() - t0 });
    saveMutateRun(root, phaseSlug, res); // what `ac verdict record` binds the evidence to (C9)
    return res;
  };

  const picked = pickTool(root, phaseSlug);
  res.skipped_tools = picked.skipped;
  if (picked.error) return finish('error', { error: picked.error });
  if (!picked.row) return finish('no-tool', { fallback: fallbackOf('no-tool', NO_TOOL_REASON) });
  const row = picked.row;
  res.tool = { id: row.id, label: row.label, version: null, source: picked.source, why: picked.why };

  const scope = mutationScope(root, phaseSlug, row, settings, warnings);
  res.scope = scope.files;
  res.scope_detail = scope.detail;
  if (!res.scope.length) {
    const why = scope.detail.no_lines.length ? ` (${scope.detail.no_lines.length} stamped file(s) hold no line the phase wrote)` : '';
    // A setting that took the phase's files out is named: "changed no mutable source files" would be false.
    const phaseFiles = phaseScope(root, phaseSlug, row);
    const byExclude = phaseFiles.length && phaseFiles.every((f) => settings.exclude.some((x) => pathMatches(x, f)));
    if (byExclude) {
      return finish('no-scope', { fallback: fallbackOf('no-scope-excluded', `mutation.exclude leaves none of the phase's ${phaseFiles.length} changed source file(s) to mutate — a user setting, not the tool; no AI mutants for them`) });
    }
    // A phase that changed only tests (the typical test-strength phase) has nothing of its own to
    // mutate. With the tool installed that never licenses hand-made mutants (ADR-084): the code
    // under test is brought in with mutation.files. Probed here, so the reason can tell.
    const installed = await probe(row, root, env);
    if (installed.present || installed.unconfigured) {
      res.tool_installed = true;
      return finish('no-scope', { fallback: fallbackOf('no-scope-installed',
        `phase changed no source lines ${row.label} can mutate${why} — the tool is installed, so no AI mutants; bring the code under test into scope with mutation.files (ac config set mutation.files '["<file>"]')`) });
    }
    return finish('no-scope', { fallback: fallbackOf('no-scope', NO_SCOPE_REASON + why) });
  }

  const found = await probe(row, root, env);
  if (found.unconfigured) return finish('not-configured', { hint: NOT_CONFIGURED_HINT, reason: found.reason });
  if (!found.present) {
    if (found.reason) warnings.push(found.reason);
    const extra = { fallback: fallbackOf('tool-missing', REMINDER) };
    if (notice) {
      const n = noticeFor(readNotices(root), row.id);
      extra.notice = n;
      if (n === 'full') { extra.suggestion = installHint(root, row); await markShown(root, row.id); }
    }
    return finish('tool-missing', extra);
  }
  res.tool.version = found.version;
  res.tool.path = rel(root, found.bin);
  if (found.warnings) warnings.push(...found.warnings);
  const major = found.version ? parseInt(found.version, 10) : NaN;
  if (row.supportedMajors && !row.supportedMajors.includes(major)) {
    return finish('error', { error: `unsupported ${row.label} version ${found.version ?? 'unknown'} — supported major versions: ${row.supportedMajors.join(', ')}` });
  }

  // P8: a dirty scope would grade code that is not HEAD.
  const dirty = git(['status', '--porcelain', '--', ...res.scope], { cwd: root });
  if (dirty.stdout.trim()) {
    const files = dirty.stdout.split('\n').filter(Boolean).map((l) => l.slice(3));
    return finish('error', { error: `scoped files have uncommitted changes (${files.join(', ')}) — commit or stash them so the result grades HEAD` });
  }

  // The log sits beside the kept run (D7): `.astrocode/.local/mutate-runs/<slug>.log`, ignored by
  // git, replaced by the next run of the same phase. The directory exists BEFORE the tool starts.
  const runFiles = mutateRunPaths(root, phaseSlug);
  ensureLocalDir(root);
  const logFile = runFiles.log;
  writeFileSync(logFile, '');
  rmSync(runFiles.list, { force: true }); // replaced per run: never a stale list beside a new result
  res.log = relative(root, logFile);
  const config = firstFile(root, row.configFiles);
  // The narrowing a version can honour (mutmut 2 selects files, 3 selects functions) is only known now.
  const base = row.id === 'gremlins' ? phaseBase(root, phaseSlug) : null;
  const diffMode = !!base && !scope.whole.length;
  const detail = res.scope_detail;
  Object.assign(detail, row.narrowing({ major, diffMode }));
  // Gremlins names mutation.files in its own narrowing reason; every other tool says it here.
  if (scope.whole.length && row.id !== 'gremlins') detail.why += `; ${scope.whole.length} whole file(s) added by mutation.files`;
  if (scope.excluded.length) detail.why += `; ${scope.excluded.length} file(s) left out by mutation.exclude`;
  if (row.id === 'gremlins' && base) {
    detail.base = base.base;
    if (base.root) warnings.push('the phase\'s first commit is the repository root — the diff base is the empty tree');
  }
  let functions = null;
  let mutantGlobs = null;
  if (row.id === 'mutmut' && major !== 2) {
    functions = Object.fromEntries(Object.entries(scope.functions).filter(([, q]) => q.length));
    const kept = Object.keys(functions);
    mutantGlobs = [...kept.flatMap((f) => functions[f].map((q) => mutmutGlob(f, q))), ...scope.whole.map((f) => `${mutmutModule(f)}.*`)];
    detail.functions = functions;
    detail.outside_functions = scope.outside_functions;
    if (scope.outside_functions) warnings.push(`${scope.outside_functions} changed line(s) are outside any function (module or class body) — mutmut 3 cannot mutate them`);
    // A file whose changed lines hold no function leaves the scope; if that empties it, nothing runs.
    res.scope = [...new Set([...kept, ...scope.whole])].sort();
    detail.files = res.scope.length;
    // No changed function survived (excluded or none): the scope is the setting's whole files alone.
    if (!kept.length && scope.whole.length) {
      detail.narrowed = 'files';
      detail.why = `mutation.files decides the scope: ${scope.whole.length} whole file(s), as \`module.*\` globs`
        + (scope.excluded.length ? `; ${scope.excluded.length} file(s) left out by mutation.exclude` : '');
    }
    if (!mutantGlobs.length) return finish('no-scope', { fallback: fallbackOf('no-scope-installed', 'the phase changed no line inside a function — mutmut 3 mutates functions only') });
  }

  const goFiles = row.id === 'gremlins'
    ? git(['ls-files', '--', '*.go'], { cwd: root }).stdout.split('\n').filter(Boolean) : [];
  const otherGoFiles = goFiles.filter((f) => !res.scope.includes(f) && !/_test\.go$/.test(f));
  // Tests (D2): chosen once, handed over the tool's own way; a refusal to narrow is reported, not hidden.
  const chosen = chooseTests(root, settings, scope, warnings);
  const narrow = chosen.files.length ? row.narrowTests({ root, env, files: chosen.files, config, trackedTests: scope.trackedTests }) : { mechanism: 'none' };
  res.tests = { source: chosen.source, files: chosen.files, mechanism: narrow.mechanism, ...(chosen.note || narrow.note ? { note: chosen.note ?? narrow.note } : {}) };
  let toolConfig = config;
  if (narrow.configText) {
    writeFileSync(runFiles.strykerConfig, narrow.configText);
    toolConfig = relative(root, runFiles.strykerConfig);
  }
  // mutmut 3 selects whole functions, so its results are held to the functions' spans, not the changed lines.
  const parseRanges = row.id === 'mutmut' && major !== 2 ? scope.spans : scope.ranges;
  const plan = row.build({
    root, bin: found.bin, scope: res.scope, major, config: toolConfig, otherGoFiles, reportFile: runFiles.gremlinsReport,
    ranges: parseRanges, functions, mutantGlobs, base: base?.base, diffMode, excluded: scope.excluded,
    mutateArg: res.scope.flatMap((f) => (scope.ranges[f] ? scope.ranges[f].map(([a, b]) => `${f}:${a}-${b}`) : [f])).join(','),
  });
  const shown = (argv) => [row.id, ...argv.slice(1)].join(' ');
  res.command = [plan.argv, plan.collectArgv].filter(Boolean).map(shown).join(' && ');

  const before = snapshot(root, row);
  try {
    const runStart = Date.now();
    const scan = stepScanner(row);
    const run = await runCapped(plan.argv, { cwd: root, env: narrow.env ? { ...env, ...narrow.env } : env, capMs: cap_seconds * 1000, logFile, tailBytes: 65536, onData: (c) => scan.feed(c) });
    res.capped = run.capped;
    // Where a capped run was (P6): the step is null when no marker was seen — never guessed.
    const capInfo = (tested, total) => {
      const st = scan.state;
      res.cap = { ...settings.cap, step: st.step, tested: tested ?? st.tested ?? 0, total: total ?? st.total ?? null };
    };
    if (res.capped) capInfo();
    if (run.error) return finish('error', { error: `could not run ${row.id}: ${run.error.message}` });

    if (!res.capped && row.fatalExit?.(run.status, { major })) {
      const tail = (run.stderr || '').trim().split('\n').filter(Boolean).pop();
      return finish('error', { error: `${row.id} exited with a fatal error (exit ${run.status}${tail ? `: ${tail}` : ''}) — its report is not trusted; see ${res.log}` });
    }

    let text = null;
    let skippedIds = [];
    if (plan.skippedArgv) {
      const k = await runCapped(plan.skippedArgv, { cwd: root, env, capMs: COLLECT_CAP_MS, logFile, logStdout: false });
      if (k.status === 0) skippedIds = k.stdout.split(/\s+/).filter((t) => /^\d+$/.test(t));
    }
    if (plan.collectArgv) {
      const c = await runCapped(plan.collectArgv, { cwd: root, env, capMs: COLLECT_CAP_MS, logFile, logStdout: false });
      if (c.status === 0 && c.stdout.trim()) text = c.stdout;
    } else if (existsSync(plan.reportFile) && statSync(plan.reportFile).mtimeMs >= runStart - 1000) {
      // A report older than this run is a stale leftover, never this run's result (1s: coarse mtimes).
      text = readFileSync(plan.reportFile, 'utf8');
    }

    const parseCtx = { scope: res.scope, major, skippedIds, ranges: parseRanges, functions };
    let parsed = text === null ? { error: 'the tool produced no report' } : row.parse(text, parseCtx);
    if (parsed.error) {
      rmSync(runFiles.list, { force: true }); // a stale list from an earlier run must not pass for this one
      if (res.capped) {
        // No partial report: never guess which mutants were not generated.
        return finish('incomplete', {
          not_run_files: [...res.scope], not_run_note: 'no partial report — mutants not generated are unknown',
        });
      }
      const tail = (run.stderr || '').trim().split('\n').filter(Boolean).pop();
      return finish('error', { error: `${parsed.error}${run.status ? ` (exit ${run.status}${tail ? `: ${tail}` : ''})` : ''} — see ${res.log}` });
    }

    if (row.id === 'mutmut' && major !== 2) {
      // The generated sources are read now: `cleanup` removes `mutants/` in the finally below.
      const lines = await mapMutmutLines({ root, bin: found.bin, env, logFile, scopeFiles: res.scope, parsed });
      parsed = row.parse(text, { ...parseCtx, lines });
      const unmapped = [...parsed.mutants, ...parsed.not_run, ...parsed.ignored].filter((m) => m.line === null).length;
      if (unmapped) warnings.push(`${unmapped} mutmut mutant(s) could not be mapped to a source line (line null)`);
    }

    // Survivors stay whole; everything else is counted per file, with the complete list on disk (D5).
    res.counts = countStatuses(parsed.mutants);
    res.survivors = parsed.mutants.filter((m) => SURVIVOR_STATUSES.includes(m.status));
    res.per_file = perFileCounts(parsed);
    res.not_run_count = parsed.not_run.length;
    res.ignored_count = parsed.ignored.length;
    res.out_of_scope_count = parsed.outside.length;
    try {
      writeFullList(runFiles.list, parsed);
      res.full_list = relative(root, runFiles.list);
    } catch (e) { warnings.push(`could not write the full mutant list: ${e.message}`); }
    if (res.capped) {
      const seen = new Set([...parsed.mutants, ...parsed.not_run, ...parsed.ignored].map((m) => m.file));
      res.not_run_files = res.scope.filter((f) => !seen.has(f));
    }
    if (res.capped) capInfo(parsed.mutants.length, parsed.mutants.length + parsed.not_run.length);
    res.complete = !res.capped && parsed.not_run.length === 0;
    if (!res.capped && parsed.mutants.length === 0) warnings.push('the tool reported zero mutants for the scope');
    const after = git(['status', '--porcelain', '--', ...res.scope], { cwd: root });
    if (after.stdout.trim()) warnings.push(`the tool left scoped files modified (${after.stdout.split('\n').filter(Boolean).map((l) => l.slice(3)).join(', ')}) — not restored automatically`);
    return finish(classifyRun({ capped: res.capped, complete: res.complete, counts: res.counts }));
  } finally {
    cleanup(root, row, before);
  }
}

/**
 * Read-only: which tool applies and is it installed. It is the user asking, so a missing tool
 * ALWAYS carries the full suggestion; it never writes the notice memory.
 */
export async function checkMutate(root, phaseSlug = null, { env = process.env } = {}) {
  if (phaseSlug) assertSafeSlug(phaseSlug);
  const picked = pickTool(root, phaseSlug);
  const res = { outcome: 'ready', tool: null, skipped_tools: picked.skipped, fallback: null, notice: null, warnings: [] };
  if (picked.error) return { ...res, outcome: 'error', error: picked.error };
  if (!picked.row) return { ...res, outcome: 'no-tool', fallback: fallbackOf('no-tool', NO_TOOL_REASON) };
  const row = picked.row;
  res.tool = { id: row.id, label: row.label, version: null, source: picked.source, why: picked.why };
  const found = await probe(row, root, env);
  if (found.unconfigured) return { ...res, outcome: 'not-configured', hint: NOT_CONFIGURED_HINT, reason: found.reason };
  if (!found.present) {
    if (found.reason) res.warnings.push(found.reason);
    return { ...res, outcome: 'tool-missing', fallback: fallbackOf('tool-missing', REMINDER), notice: 'full', suggestion: installHint(root, row) };
  }
  res.tool.version = found.version;
  res.tool.path = rel(root, found.bin);
  return res;
}

/**
 * The minimal config for a tool, and whether its file already exists (P11, P13). Read-only;
 * `bin/` writes it. For mutmut it is version-aware: the installed major picks the keys (an
 * unconfigured 3.x counts as 3; nothing installed assumes the current 3.x and says so). An
 * existing file is never rewritten, so a re-run cannot duplicate anything; when that file uses
 * keys the installed major deprecated they are named with their replacements.
 */
export async function setupFor(root, toolId = null, { env = process.env } = {}) {
  const row = toolId ? rowById(toolId) : pickTool(root).row;
  if (!row) return { error: toolId ? `unknown tool "${toolId}"` : 'no supported mutation tool detected for this project' };
  let major = 3;
  let assumed = false;
  if (row.id === 'mutmut') {
    const found = await probe(row, root, env);
    if (found.unconfigured) major = 3;
    else if (found.present && found.version) major = parseInt(found.version, 10) || 3;
    else { assumed = true; }
  }
  const made = row.setup(root, { major });
  const exists = made.exists ?? existsSync(join(root, made.file));
  const res = { tool: row.id, file: made.file, content: made.content, exists };
  if (made.note) res.note = made.note;
  if (row.id === 'mutmut') {
    res.major = major;
    if (assumed) res.assumed = `mutmut is not installed — assumed the current ${major}.x`;
    if (exists && major >= 3 && !made.note) {
      let cfg = '';
      try { cfg = readFileSync(join(root, made.file), 'utf8'); } catch { /* unreadable: nothing to name */ }
      const sec = /^\[mutmut\][^[]*/m.exec(cfg)?.[0] ?? '';
      const dep = Object.entries(row.deprecatedKeys).filter(([k]) => new RegExp(`^\\s*${k}\\s*[=:]`, 'm').test(sec));
      if (dep.length) res.deprecated = dep.map(([key, replacement]) => ({ key, replacement }));
    }
  }
  return res;
}

/** Dismiss the install suggestion for a tool (default: the one detected here). */
export async function dismissTool(root, toolId = null) {
  const row = toolId ? rowById(toolId) : pickTool(root).row;
  if (!row) return { error: toolId ? `unknown tool "${toolId}"` : 'no supported mutation tool detected for this project' };
  await dismiss(root, row.id);
  return { tool: row.id };
}

