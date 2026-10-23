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
// Phase 49 (ADR-085) adds triage support: survivors get an identity and groups and carry the
// judgements in `.astrocode/phases/<slug>/SURVIVORS.json` (lib/survivors.mjs owns those rules); the
// phase's tests run twice on the unchanged code first (the flaky check, inside the one cap); and
// `--survivors` re-tests only the still-open survivors. That is a PARTIAL run: it is saved apart
// (`<slug>.survivors.json`), the kept full run is never touched and the gate refuses it as evidence.
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
import { describeAll, groupSurvivors, readJudgements, applyJudgements, survivorsFile } from './survivors.mjs';
import { paths } from './paths.mjs';
import { runCapped } from './caprun.mjs';
import { assertSafeSlug } from './util.mjs';
import { MUTANT_STATUSES, SURVIVOR_STATUSES, testStrengthIds, saveMutateRun, savePartialRun, readMutateRun, mutateRunPaths, ensureLocalDir } from './verdict.mjs';
import { parseStryker, parseGremlins, parseMutmutJunit, parseMutmutResults, countStatuses, perFileCounts, mutmutShowLine, mutantsFileOffsets, mutantsFileChanges } from './mutparse.mjs';
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
// The Stryker test runner a project configured and, for the `command` runner, the command with this
// phase's files appended — read once, used by the narrowing AND the flaky check (9173).
function strykerRunner(ctx) {
  const text = ctx.config ? readText(ctx.root, ctx.config) : '';
  const runner = /["']?testRunner["']?\s*:\s*["']([\w-]+)["']/.exec(text)?.[1] ?? 'command';
  const base = /["']?command["']?\s*:\s*["']([^"']+)["']/.exec(text)?.[1] ?? 'npm test';
  const withFiles = (files) => {
    const rest = files.map(shq).join(' ');
    return /^npm\b/.test(base) && !/\s--\s/.test(base) ? `${base} -- ${rest}` : `${base} ${rest}`;
  };
  return { text, runner, base, command: withFiles(ctx.files) };
}

function strykerNarrowTests(ctx) {
  const { runner, command } = strykerRunner(ctx);
  const files = ctx.files;
  const j = JSON.stringify;
  let over;
  let mechanism;
  if (runner === 'command') {
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

// ---- The flaky pre-check (phase 49 D5): the project's own test runner, twice, on unchanged code. ----
// One `testRun(ctx)` hook per row returns `{ argv, command, failing(out) → names[], exclude(names, env)
// → env | null }`, or `{ skip: reason }` when the runner cannot be reached (b940). `exclude` says how a
// mutation run can leave the flaky tests out, so no kill can come from them; a row without one
// (Stryker) relies on the report's attribution instead.
const SH = existsSync('/bin/sh') ? '/bin/sh' : 'sh';
const TEST_FILE = /\.(?:[cm]?[jt]sx?)$/;
// Failing test names from a JS runner's output: TAP `not ok N - name`, the spec reporter's `✖ name`,
// mocha `N) name`, jest `● name`. Deduplicated; a file path is the file failing, not a test.
function jsFailures(out) {
  const names = new Set();
  const add = (n) => {
    const t = String(n).replace(/\s+\(\d+(?:\.\d+)?\s*m?s\)\s*$/, '').replace(/\s+#\s.*$/, '').trim();
    if (t && !/^failing tests:?$/i.test(t) && !TEST_FILE.test(t) && !t.startsWith('/')) names.add(t);
  };
  for (const re of [/^\s*not ok \d+ - (.+)$/gm, /^\s*✖ (.+)$/gm, /^\s*\d+\) (.+)$/gm, /^\s*● (.+)$/gm]) {
    for (const m of String(out).matchAll(re)) add(m[1]);
  }
  return [...names];
}
function strykerTestRun(ctx) {
  const r = strykerRunner(ctx);
  if (r.runner === 'command') return { argv: [SH, '-c', r.command], command: r.command, failing: jsFailures, exclude: null };
  if (['mocha', 'jest', 'vitest', 'tap'].includes(r.runner)) {
    const bin = inDirs([join(ctx.root, 'node_modules', '.bin')], r.runner);
    if (!bin) return { skip: `${r.runner} is not in node_modules/.bin` };
    const args = [...(r.runner === 'vitest' ? ['run'] : []), ...ctx.files];
    return { argv: [bin, ...args], command: [r.runner, ...args].join(' '), failing: jsFailures, exclude: null };
  }
  return { skip: `the ${r.runner} test runner is not one the flaky check can run` };
}
// `go test -count=1` defeats Go's test cache, which would otherwise replay the first result. The
// phase's test selection reaches it through GOFLAGS (`-run`), exactly as it reaches the tool.
function gremlinsTestRun(ctx) {
  const go = onPath('go', ctx.env) ?? inDirs([ctx.env.GOROOT && join(ctx.env.GOROOT, 'bin')], 'go');
  if (!go) return { skip: 'go is not on PATH' };
  const dirs = [...new Set(ctx.files.map((f) => dirname(f)))].map((d) => (d === '.' ? '.' : `./${d}`));
  const args = ['test', '-count=1', '-v', ...(dirs.length ? dirs : ['./...'])];
  return {
    argv: [go, ...args], command: ['go', ...args].join(' '),
    failing: (out) => [...new Set([...String(out).matchAll(/--- FAIL: (\S+)/g)].map((m) => m[1]))],
    exclude: (names, env) => {
      const top = [...new Set(names.map((n) => n.split('/')[0]))];
      return top.length ? { GOFLAGS: [env.GOFLAGS, `-skip=^(${top.join('|')})$`].filter(Boolean).join(' ') } : null;
    },
  };
}
function mutmutTestRun(ctx) {
  const pytest = inDirs([join(ctx.root, '.venv', 'bin'), join(ctx.root, 'venv', 'bin')], 'pytest') ?? onPath('pytest', ctx.env);
  if (!pytest) return { skip: 'pytest was not found in .venv, venv or PATH' };
  const args = [...ctx.files, '-p', 'no:cacheprovider', '-rf', '-q'];
  return {
    argv: [pytest, ...args], command: ['pytest', ...args].join(' '),
    failing: (out) => [...new Set([...String(out).matchAll(/^FAILED (\S+)/gm)].map((m) => m[1]))],
    exclude: (names, env) => (names.length
      ? { PYTEST_ADDOPTS: [env.PYTEST_ADDOPTS, ...names.map((n) => `--deselect ${shq(n)}`)].filter(Boolean).join(' ') } : null),
  };
}

/**
 * Pure: compare the two runs of the flaky check. A run is `{ names, failed, command }`. A test failing
 * in exactly one run is flaky; failing in both is `baseline_failing` (the tool still runs and the gate
 * refuses as before). A failure with unparseable output is `{ name: null, command }`, never dropped.
 */
export function classifyFlaky(run1, run2) {
  const tests = [];
  const baseline = [];
  const s2 = new Set(run2.names);
  for (const n of run1.names) (s2.has(n) ? baseline : tests).push(n);
  for (const n of run2.names) if (!run1.names.includes(n)) tests.push(n);
  const u1 = run1.failed && !run1.names.length;
  const u2 = run2.failed && !run2.names.length;
  if (u1 && u2) baseline.push({ name: null, command: run1.command });
  else if (u1 && !run2.failed) tests.push({ name: null, command: run1.command });
  else if (u2 && !run1.failed) tests.push({ name: null, command: run2.command });
  return { tests, baseline_failing: baseline };
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
    testRun: strykerTestRun,
    // Mutators that only change string-literal text (D6): their survivors form the text-only group.
    textKinds: ['StringLiteral'],
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
    // `--survivors` (D4): one `file:L:C-L:C` span per open survivor limits what is instrumented, and
    // an incremental file crafted from the last full run's own report — every mutant EXCEPT the open
    // survivors — makes Stryker reuse every other result instead of running it (verified on Stryker
    // 10: "3 of 4 mutant result(s) are reused", only the open one ran). Plain `--incremental` is not
    // used: with the command runner it reuses the open survivors too, even after a test was added.
    // The report's start column is one past the column --mutate takes (verified against Stryker 10:
    // the report span 2:7-2:13 selects 0 mutants, 2:6-2:13 selects the survivor), so it is shifted by one.
    buildSurvivors: (ctx, open) => {
      const plan = rowById('stryker').build({
        ...ctx,
        mutateArg: [...new Set(open.map((o) => (o.loc ? `${o.file}:${o.loc.start.line}:${Math.max(0, o.loc.start.column - 1)}-${o.loc.end.line}:${o.loc.end.column}` : o.file)))].join(','),
      });
      if (!ctx.incrementalFile) {
        return { ...plan, narrowing: { narrowed: 'mutant spans', why: 'no Stryker report of the last full run is kept here, so killed or equivalent-judged mutants sharing an open survivor\'s span re-ran too (narrower-than-ideal; their results are discarded) — a fresh full `ac mutate` run makes the next --survivors exact' } };
      }
      return {
        ...plan, argv: [...plan.argv, '--incremental', '--incrementalFile', ctx.incrementalFile],
        narrowing: { narrowed: 'mutants', why: 'exactly the open survivors: one --mutate span each, and every other result reused from the last full run through a crafted incremental file' },
      };
    },
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
    testRun: gremlinsTestRun,
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
    // `--survivors` (D4). Gremlins cannot select single mutants: `--diff` takes only an ancestor commit and
    // ignores a dangling one (tests/fixtures/mutate/real/gremlins-survivors-rerun.txt), so the narrowest
    // honest means is FILES (-E for every file with no open survivor) plus KINDS (`--<type>=false` for the
    // mutant types none of them has, `=true` for a non-default one an open survivor needs). The full run's
    // own --diff base stays, so the lines are still the phase's.
    buildSurvivors: (ctx, open) => {
      const plan = rowById('gremlins').build(ctx);
      const kinds = new Set(open.map((o) => o.kind));
      const flag = (t) => `--${t.toLowerCase().replace(/_/g, '-')}`;
      const extra = [
        ...ctx.otherGoFiles.flatMap((f) => ['--exclude-files', `^${escRe(f)}$`]),
        ...GREMLINS_DEFAULT_ON.filter((t) => !kinds.has(t)).map((t) => `${flag(t)}=false`),
        ...GREMLINS_DEFAULT_OFF.filter((t) => kinds.has(t)).map((t) => `${flag(t)}=true`),
      ];
      return {
        ...plan, argv: [...plan.argv, ...extra],
        narrowing: { narrowed: 'files+kinds', why: 'narrower-than-ideal: Gremlins cannot select single mutants or lines — files with no open survivor are excluded and the mutant kinds none of them has are switched off, so killed and equivalent-judged mutants of those kinds in those files re-ran too; their results are discarded and never change a judgement' },
      };
    },
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
    testRun: mutmutTestRun,
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
    // `--survivors` (D4): mutmut 3 runs exactly the mutant names stored on the kept run (real 3.8:
    // `mutmut run <name>...` runs only those); mutmut 2 selects whole files, so the scope is the files
    // holding open survivors and the rest of those files re-runs.
    buildSurvivors: (ctx, open) => (ctx.major === 2
      ? { ...rowById('mutmut').build(ctx), narrowing: { narrowed: 'files', why: 'mutmut 2 selects whole files only — the files holding open survivors re-ran in full' } }
      : {
        argv: [ctx.bin, 'run', ...open.map((o) => o.name)], collectArgv: [ctx.bin, 'results', '--all', 'true'],
        narrowing: { narrowed: 'mutants', why: 'mutmut 3 runs exactly the open survivors\' mutant names' },
      }),
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

// Gremlins mutant types: `unleash --help` marks these on by default; the rest are opt-in.
const GREMLINS_DEFAULT_ON = ['ARITHMETIC_BASE', 'CONDITIONALS_BOUNDARY', 'CONDITIONALS_NEGATION', 'INCREMENT_DECREMENT', 'INVERT_NEGATIVES'];
const GREMLINS_DEFAULT_OFF = ['INVERT_ASSIGNMENTS', 'INVERT_BITWISE', 'INVERT_BWASSIGN', 'INVERT_LOGICAL', 'INVERT_LOOPCTRL', 'REMOVE_SELF_ASSIGNMENTS'];

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
// The `-`/`+` pair a `mutmut show` diff prints for the first changed line: the mutated line is what the
// identity key and the text-only check read (phase 49). A pure addition has no original.
function showChange(diff) {
  const rows = String(diff ?? '').replace(/\r\n?/g, '\n').split('\n');
  const h = rows.findIndex((r) => /^@@ /.test(r));
  if (h < 0) return null;
  const body = rows.slice(h + 1);
  const m = body.findIndex((r) => r.startsWith('-') || r.startsWith('+'));
  if (m < 0) return null;
  const orig = body[m].startsWith('-') ? body[m].slice(1) : null;
  const repl = body.slice(m + (orig === null ? 0 : 1)).find((r) => r.startsWith('+'));
  return repl === undefined ? null : { line_text: orig, replacement_line: repl.slice(1) };
}

async function mapMutmutLines({ root, bin, env, logFile, scopeFiles, parsed }) {
  const lines = {};
  const details = {};
  const src = {};
  const offsets = {};
  const changes = {};
  const modOf = new Map();
  for (const f of scopeFiles) {
    let text = '';
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    src[f] = { text, funcs: pythonFunctions(text) };
    let gen = '';
    try { gen = readFileSync(join(root, 'mutants', f), 'utf8'); } catch { /* no generated file: show only */ }
    const fc = mutantsFileChanges(gen);
    offsets[f] = fc.offsets;
    changes[f] = fc.changes;
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
    const ch = f && changes[f][m.name.slice(m.name.lastIndexOf('.') + 1)];
    if (ch) details[m.name] = ch;
  }
  // `mutmut show` only for a survivor the generated file could not describe (no mutants/ file):
  // the generated source is the deterministic answer; show is the slow, capped fallback.
  const deadline = Date.now() + COLLECT_CAP_MS;
  for (const m of parsed.mutants.filter((x) => SURVIVOR_STATUSES.includes(x.status))) {
    if (details[m.name] && lines[m.name]) continue;
    const pn = parseMutantName(m.name ?? '');
    const f = pn && modOf.get(pn.module);
    const fn = f && src[f]?.funcs.find((x) => x.qual === pn.qual);
    const left = deadline - Date.now();
    if (!fn || left <= 0) continue;
    const r = await runCapped([bin, 'show', m.name], { cwd: root, env, capMs: left, logFile, logStdout: false });
    const at = r.status === 0 ? mutmutShowLine(r.stdout, src[f].text, fn) : null;
    if (at && !lines[m.name]) lines[m.name] = at;
    const change = r.status === 0 ? showChange(r.stdout) : null;
    if (change && !details[m.name]) details[m.name] = change;
  }
  return { lines, details };
}

const FLAKY_STEP = 'flaky check (tests run twice)';

// The report's own order (file, line, mutator, id): the fallback ordinal of a mutant with no column and
// no replacement counts siblings in this order over EVERY parsed mutant, whatever its status.
const reportOrder = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)
  || (Number.isInteger(a.line) ? a.line : Infinity) - (Number.isInteger(b.line) ? b.line : Infinity)
  || (a.mutator < b.mutator ? -1 : a.mutator > b.mutator ? 1 : 0)
  || String(a.id).padStart(12, '0').localeCompare(String(b.id).padStart(12, '0'));

// D5: run the phase's tests twice on the unchanged code BEFORE mutating, inside the one cap. The
// deadline is shared with the mutation run, so a slow suite spends the same budget. Never throws:
// a check that cannot run says why in `reason` (b940) and the tool still runs.
async function flakyCheck({ row, root, env, files, config, trackedTests, deadline, logFile }) {
  const t0 = Date.now();
  const out = { checked: false, runs: 0, command: null, tests: [], baseline_failing: [], kills: 'none', duration_ms: 0 };
  // The project's tests are not children of a node test runner: NODE_TEST_CONTEXT would turn a nested
  // `node --test` into a machine-readable child whose failures never reach its exit status.
  env = { ...env };
  delete env.NODE_TEST_CONTEXT;
  const hook = row.testRun?.({ root, env, files, config, trackedTests });
  if (!hook) return { flaky: { ...out, reason: `${row.label} has no test command the flaky check can run` } };
  if (hook.skip) return { flaky: { ...out, reason: hook.skip } };
  out.command = hook.command;
  const runs = [];
  for (let i = 0; i < 2; i += 1) {
    const left = deadline - Date.now();
    if (left <= 0) return { flaky: { ...out, runs: runs.length, duration_ms: Date.now() - t0 }, capped: true };
    const r = await runCapped(hook.argv, { cwd: root, env, capMs: left, logFile, tailBytes: 65536 });
    if (r.capped) return { flaky: { ...out, runs: runs.length, duration_ms: Date.now() - t0 }, capped: true };
    // 126/127: the runner itself is missing or not executable — nothing was learned about the tests.
    if (r.error || r.status === 126 || r.status === 127) {
      const why = r.error ? r.error.message : `exit ${r.status}: ${(r.stderr || '').trim().split('\n').filter(Boolean).pop() ?? 'command not found'}`;
      return { flaky: { ...out, runs: runs.length, reason: `the test command could not run — ${why}`, duration_ms: Date.now() - t0 } };
    }
    const names = r.status === 0 ? [] : hook.failing(`${r.stdout}\n${r.stderr}`);
    runs.push({ names, failed: r.status !== 0, command: hook.command });
  }
  const c = classifyFlaky(runs[0], runs[1]);
  Object.assign(out, { checked: true, runs: 2, tests: c.tests, baseline_failing: c.baseline_failing, duration_ms: Date.now() - t0 });
  const named = c.tests.filter((t) => typeof t === 'string');
  // Kills a flaky test made are never counted. Leave the test out of the mutation run when the
  // runner can (Go, pytest); otherwise the caller discounts by the report's attribution.
  const extraEnv = named.length && hook.exclude ? hook.exclude(named, env) : null;
  if (c.tests.length) out.kills = extraEnv ? 'excluded' : 'discounted';
  return { flaky: out, extraEnv, hook };
}

// Stryker only: a kill whose every `killedBy` test is flaky is not a kill. `unverified` when some kill
// has no attribution at all (the `command` runner gives none), so the run cannot be trusted.
function discountFlakyKills(parsed, flakyNames) {
  const flaky = (n) => flakyNames.some((f) => n === f || n.includes(f));
  let discounted = 0;
  let unattributed = 0;
  for (const m of parsed.mutants) {
    if (m.status !== 'killed') continue;
    // The `command` runner reports every kill as the one test "All tests": no attribution either.
    if (!Array.isArray(m.killedBy) || !m.killedBy.length || m.killedBy.every((n) => n === 'All tests')) { unattributed += 1; continue; }
    if (m.killedBy.every(flaky)) { m.status = 'survived'; m.flaky_kill = true; discounted += 1; }
  }
  return { discounted, unattributed };
}

// D3/D6: the identity of every parsed mutant (lib/survivors.mjs owns the key). The scoped files are
// read at HEAD: the dirty-scope check guarantees the tool graded exactly that code. Returns the
// descriptions keyed by mutant object, over EVERY parsed mutant so the fallback ordinal sees them all.
function describeRun(root, row, parsed) {
  const all = [...parsed.mutants, ...parsed.not_run, ...parsed.ignored].sort(reportOrder);
  const sources = {};
  for (const f of new Set(all.map((m) => m.file))) {
    const r = git(['show', `HEAD:${f}`], { cwd: root });
    if (r.status === 0) sources[f] = r.stdout;
  }
  const described = describeAll(all, { tool: row.id, sources, textKinds: row.textKinds ?? [] });
  return { all, byMutant: new Map(all.map((m, i) => [m, described[i]])) };
}

// Carry the recorded judgements onto res.survivors and group them. Sets survivors/groups/triage.
function summarize(root, slug, res, warnings) {
  const file = survivorsFile(root, slug);
  const { judgements, invalid, reason } = readJudgements(file);
  if (reason) warnings.push(`${reason} — no judgements were carried over`);
  const applied = applyJudgements(res.survivors, judgements);
  res.survivors = applied.survivors;
  res.groups = groupSurvivors(res.survivors);
  const eq = res.survivors.filter((s) => s.triage === 'equivalent' && s.judged).length;
  const gap = res.survivors.filter((s) => s.triage === 'test-gap').length;
  res.triage = {
    file: relative(root, file), judged: eq, equivalent: eq, test_gap: gap, untriaged: res.survivors.length - eq - gap,
    open: res.survivors.length - eq, recorded: eq + gap, stale: applied.stale, invalid: invalid.length,
  };
}

function triage(root, slug, row, parsed, res, warnings) {
  const { byMutant } = describeRun(root, row, parsed);
  for (const m of res.survivors) {
    const d = byMutant.get(m);
    if (d) Object.assign(m, { key: d.key, fn: d.fn, kind: d.kind, text_only: d.text_only, group: d.group, line_text: d.line_text });
  }
  summarize(root, slug, res, warnings);
}

// mutmut 3 lists every mutant it knows after a `run <names>`; only the named ones were re-tested.
function keepNames(parsed, names) {
  const keep = (l) => l.filter((m) => names.has(m.name));
  return { ...parsed, mutants: keep(parsed.mutants), not_run: keep(parsed.not_run), ignored: keep(parsed.ignored), outside: [] };
}

// `--survivors` (D4): what happened to each open survivor. Matched by identity key; a mutmut mutant is
// also matched by its name, but a survivor whose key then differs means the code moved under it.
const fileOrNull = (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } };

/** The same Stryker mutant: file, mutator, replacement and start position (ids are run-local). */
export function sameStrykerMutant(o, m) {
  if (o.file !== m.file || o.mutator !== m.mutator) return false;
  if ((o.replacement ?? null) !== (m.replacement ?? null)) return false;
  const a = o.loc?.start;
  const b = m.loc?.start;
  return a && b ? a.line === b.line && a.column === b.column : o.line === m.line;
}

/**
 * The incremental file a `--survivors` Stryker run reuses: the last full run's own report minus the
 * open survivors, so every other result (killed, timeout, equivalent-judged, …) is reused and only
 * the open ones run. Returns its path relative to the root, or null when no full report is kept.
 */
export function craftStrykerIncremental(root, runFiles, open) {
  let report = null;
  try { report = JSON.parse(readFileSync(runFiles.strykerReport, 'utf8')); } catch { return null; }
  if (!report || typeof report.files !== 'object') return null;
  for (const [file, f] of Object.entries(report.files)) {
    if (!Array.isArray(f?.mutants)) continue;
    f.mutants = f.mutants.filter((m) => !open.some((o) => sameStrykerMutant(o, {
      file, mutator: m.mutatorName, replacement: m.replacement, loc: m.location, line: m.location?.start?.line,
    })));
  }
  try { writeFileSync(runFiles.strykerIncremental, JSON.stringify(report)); } catch { return null; }
  return relative(root, runFiles.strykerIncremental);
}

function compareRerun(open, parsed, byMutant) {
  const byKey = new Map();
  const byName = new Map();
  for (const [m, d] of byMutant) { byKey.set(d.key, [m, d]); if (m.name) byName.set(m.name, [m, d]); }
  const out = { killed: [], still: [], errored: [], gone: [] };
  for (const o of open) {
    const hit = byKey.get(o.key) ?? (o.name ? byName.get(o.name) : null);
    if (!hit) { out.gone.push(o); continue; }
    const [m, d] = hit;
    if (m.status === 'killed' || m.status === 'timeout') out.killed.push(o);
    else if (SURVIVOR_STATUSES.includes(m.status)) { if (d.key === o.key) out.still.push({ o, m, d }); else out.gone.push(o); }
    else if (m.status === 'error') out.errored.push(o);
    else out.gone.push(o);
  }
  return out;
}

/**
 * Run mutation testing for one phase. Never throws on a missing tool, a bad report or a
 * capped run — each is a visible outcome (b940, 6105). `notice: false` makes it side-effect free
 * of the suggestion memory (used by tests and `--check`-like callers).
 */
export async function runMutate(root, phaseSlug, { notice = true, env = process.env, survivors = false } = {}) {
  assertSafeSlug(phaseSlug);
  const t0 = Date.now();
  const warnings = [];
  const num = String(parseInt(/^(\d+)/.exec(phaseSlug)?.[1] ?? '0', 10));
  const settings = mutationSettings(root, num, warnings);
  const cap_seconds = settings.cap.seconds;
  const res = {
    tool: null, command: null, reproduce: `ac mutate ${num}${survivors ? ' --survivors' : ''} --json`, head: head(root), scope: [], cap_seconds,
    capped: false, complete: false, outcome: 'error', counts: zeroCounts(), survivors: [], groups: [], triage: null, per_file: {},
    not_run_count: 0, ignored_count: 0, out_of_scope_count: 0, full_list: null, not_run_files: [], skipped_tools: [], fallback: null, notice: null,
    required: criteriaRequired(root, phaseSlug), warnings, log: null, cap: { ...settings.cap }, tests: null, started_at: new Date(t0).toISOString(), duration_ms: 0,
  };
  const partial = !!survivors;
  const finish = (outcome, extra = {}) => {
    Object.assign(res, extra, { outcome, duration_ms: Date.now() - t0 });
    if (partial) {
      // A `--survivors` run is saved BESIDE the kept full run, never over it (ADR-085).
      savePartialRun(root, phaseSlug, res);
      return res;
    }
    saveMutateRun(root, phaseSlug, res); // what `ac verdict record` binds the evidence to (C9)
    // A full run supersedes any partial re-run of the same phase.
    const rf = mutateRunPaths(root, phaseSlug);
    for (const f of [rf.partial, rf.partial.replace(/\.json$/, '.log'), rf.partial.replace(/\.json$/, '.mutants.jsonl')]) rmSync(f, { force: true });
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

  // D4: `--survivors` re-tests the OPEN survivors of the last FULL run. Without one (or with one from
  // before survivors had keys, or another tool's) it refuses — nothing is run and nothing is saved.
  let baseRun = null;
  let open = [];
  let judgedBase = [];
  if (partial) {
    baseRun = readMutateRun(root, phaseSlug);
    const usable = baseRun && baseRun.tool === row.id && ['survivors', 'clean', 'incomplete'].includes(baseRun.outcome)
      && (baseRun.survivors ?? []).every((x) => x.key);
    if (!usable) {
      Object.assign(res, { outcome: 'error', partial: true, duration_ms: Date.now() - t0,
        error: `--survivors needs a full \`ac mutate ${num}\` run of ${row.label} with survivor keys on record for this phase — run \`ac mutate ${num}\` first` });
      return res;
    }
    judgedBase = applyJudgements(baseRun.survivors, readJudgements(survivorsFile(root, phaseSlug)).judgements).survivors;
    open = judgedBase.filter((x) => !(x.triage === 'equivalent' && x.judged));
    res.partial = true;
    res.base_run = { head: baseRun.head ?? null, started_at: baseRun.started_at ?? null };
    if (baseRun.head && res.head && baseRun.head !== res.head) {
      const moved = git(['diff', '--name-only', baseRun.head, 'HEAD', '--', '.', ':(exclude).astrocode'], { cwd: root });
      if (moved.status !== 0 || moved.stdout.trim()) warnings.push('code changed since the last full run — open survivors may have moved; a survivor the re-run cannot find is reported as not re-observed');
    }
    const rerun = { open: open.length, executed: 0, killed_now: 0, still_open: open.length, not_reobserved: 0, extra_executed: 0, narrowing: null };
    res.rerun = rerun;
    // Display: the full run's survivors, judgements overlaid. With nothing open no tool runs.
    res.survivors = judgedBase.map((x) => ({ ...x }));
    if (!open.length) {
      summarize(root, phaseSlug, res, warnings);
      res.counts = zeroCounts();
      return finish(baseRun.outcome === 'clean' ? 'clean' : 'survivors', { complete: true, rerun: { ...rerun, narrowing: { narrowed: 'none', why: 'no open survivors — nothing to re-run' } } });
    }
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
  const logFile = partial ? runFiles.partial.replace(/\.json$/, '.log') : runFiles.log;
  const listFile = partial ? runFiles.partial.replace(/\.json$/, '.mutants.jsonl') : runFiles.list;
  writeFileSync(logFile, '');
  rmSync(listFile, { force: true }); // replaced per run: never a stale list beside a new result
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

  if (partial) {
    // Only the files holding an open survivor are re-tested (and, for mutmut 3, only their names).
    const holding = new Set(open.map((x) => x.file));
    res.scope = res.scope.filter((f) => holding.has(f));
    if (!res.scope.length) res.scope = [...holding].sort();
    if (row.id === 'mutmut' && major !== 2) mutantGlobs = open.map((x) => x.name);
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
  const planCtx = {
    root, bin: found.bin, scope: res.scope, major, config: toolConfig, otherGoFiles, reportFile: runFiles.gremlinsReport,
    ranges: parseRanges, functions, mutantGlobs, base: base?.base, diffMode, excluded: scope.excluded,
    mutateArg: res.scope.flatMap((f) => (scope.ranges[f] ? scope.ranges[f].map(([a, b]) => `${f}:${a}-${b}`) : [f])).join(','),
  };
  if (partial && row.id === 'stryker') planCtx.incrementalFile = craftStrykerIncremental(root, runFiles, open);
  const plan = partial ? row.buildSurvivors(planCtx, open) : row.build(planCtx);
  if (partial) res.rerun.narrowing = plan.narrowing;
  const shown = (argv) => [row.id, ...argv.slice(1)].join(' ');
  res.command = [plan.argv, plan.collectArgv].filter(Boolean).map(shown).join(' && ');

  // D5: the flaky pre-check. ONE deadline covers it and the mutation run (8d73).
  const deadline = Date.now() + cap_seconds * 1000;
  const baseEnv = narrow.env ? { ...env, ...narrow.env } : env;
  const chk = await flakyCheck({ row, root, env: baseEnv, files: [...new Set(chosen.files)], config, trackedTests: scope.trackedTests, deadline, logFile });
  res.flaky = chk.flaky;
  if (!chk.capped && deadline - Date.now() <= 0) chk.capped = true;
  if (chk.capped) {
    res.capped = true;
    res.cap = { ...settings.cap, step: FLAKY_STEP, tested: 0, total: null };
    return finish('incomplete', { not_run_files: [...res.scope], not_run_note: 'the cap was reached before the mutation tool started' });
  }
  const toolEnv = chk.extraEnv ? { ...baseEnv, ...chk.extraEnv } : baseEnv;

  const before = snapshot(root, row);
  try {
    const runStart = Date.now();
    const scan = stepScanner(row);
    const run = await runCapped(plan.argv, { cwd: root, env: toolEnv, capMs: Math.max(1, deadline - Date.now()), logFile, tailBytes: 65536, onData: (c) => scan.feed(c) });
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

    // A full Stryker run keeps its own report: the next `--survivors` crafts its incremental file from it.
    if (!partial && row.id === 'stryker' && text !== null) {
      try { writeFileSync(runFiles.strykerReport, text); } catch { /* --survivors then says it is narrower */ }
    }
    const parseCtx = { scope: res.scope, major, skippedIds, ranges: parseRanges, functions };
    const openNames = new Set(open.map((x) => x.name).filter(Boolean));
    const only = (p) => (partial && row.id === 'mutmut' && major !== 2 && !p.error ? keepNames(p, openNames) : p);
    let parsed = text === null ? { error: 'the tool produced no report' } : only(row.parse(text, parseCtx));
    if (parsed.error) {
      rmSync(listFile, { force: true }); // a stale list from an earlier run must not pass for this one
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
      const { lines, details } = await mapMutmutLines({ root, bin: found.bin, env, logFile, scopeFiles: res.scope, parsed });
      parsed = only(row.parse(text, { ...parseCtx, lines }));
      for (const m of parsed.mutants) if (m.name && details[m.name]) Object.assign(m, details[m.name]);
      const unmapped = [...parsed.mutants, ...parsed.not_run, ...parsed.ignored].filter((m) => m.line === null).length;
      if (unmapped) warnings.push(`${unmapped} mutmut mutant(s) could not be mapped to a source line (line null)`);
    }

    // Flaky kills (Stryker): discount by the report's attribution, or refuse to trust the run.
    let flakyIncomplete = null;
    const flakyNames = res.flaky.tests.filter((t) => typeof t === 'string');
    if (res.flaky.kills === 'discounted' && flakyNames.length) {
      const d = discountFlakyKills(parsed, flakyNames);
      res.flaky.discounted = d.discounted;
      if (d.unattributed) {
        res.flaky.kills = 'unverified';
        flakyIncomplete = `${d.unattributed} kill(s) have no per-test attribution, so kills by the flaky test(s) ${flakyNames.join(', ')} cannot be told apart — not counted on trust`;
        res.flaky.reason = flakyIncomplete;
      }
    } else if (res.flaky.tests.length && !flakyNames.length) {
      // An unnamed flaky failure: nothing to exclude or discount by, so the kills cannot be trusted.
      res.flaky.kills = 'unverified';
      flakyIncomplete = 'a test failed in one of two runs on unchanged code but its output named no test — its kills cannot be told apart';
      res.flaky.reason = flakyIncomplete;
    }
    // Survivors stay whole; everything else is counted per file, with the complete list on disk (D5).
    res.counts = countStatuses(parsed.mutants);
    if (partial) {
      // A crafted incremental run reports the reused results too: only what Stryker actually ran
      // (the open survivors) is this run's evidence, and its own log says how many ran.
      let executed = parsed.mutants.length;
      if (row.id === 'stryker' && planCtx.incrementalFile) {
        const reused = /(\d+) of (\d+) mutant result\(s\) are reused/.exec(fileOrNull(logFile) ?? '');
        // No reuse line from Stryker: every reported mutant counts as executed (never under-reported).
        executed = reused ? Number(reused[2]) - Number(reused[1]) : parsed.mutants.length;
        if (!reused) res.rerun.narrowing = { ...res.rerun.narrowing, why: `${res.rerun.narrowing.why} — but Stryker reported no reused results, so every reported mutant counts as executed` };
        parsed = { ...parsed, mutants: parsed.mutants.filter((m) => open.some((o) => sameStrykerMutant(o, m))) };
        res.counts = countStatuses(parsed.mutants);
      }
      // What happened to each open survivor, and what else the tool ran (never hidden: extra_executed).
      const { byMutant } = describeRun(root, row, parsed);
      const cmp = compareRerun(open, parsed, byMutant);
      Object.assign(res.rerun, {
        executed, killed_now: cmp.killed.length, still_open: cmp.still.length, not_reobserved: cmp.gone.length + cmp.errored.length,
        extra_executed: Math.max(0, executed - cmp.killed.length - cmp.still.length - cmp.errored.length),
      });
      const goneKeys = new Set(cmp.killed.map((x) => x.key));
      const stillBy = new Map(cmp.still.map(({ o, m }) => [o.key, m]));
      const lostKeys = new Set([...cmp.gone, ...cmp.errored].map((x) => x.key));
      res.survivors = judgedBase.filter((x) => !goneKeys.has(x.key)).map((x) => ({
        ...x,
        ...(stillBy.has(x.key) ? { retest: 'survived' } : lostKeys.has(x.key) ? { retest: 'not re-observed' } : {}),
      }));
      summarize(root, phaseSlug, res, warnings);
    } else {
      res.survivors = parsed.mutants.filter((m) => SURVIVOR_STATUSES.includes(m.status));
      triage(root, phaseSlug, row, parsed, res, warnings);
    }
    res.per_file = perFileCounts(parsed);
    res.not_run_count = parsed.not_run.length;
    res.ignored_count = parsed.ignored.length;
    res.out_of_scope_count = parsed.outside.length;
    try {
      writeFullList(listFile, parsed);
      res.full_list = relative(root, listFile);
    } catch (e) { warnings.push(`could not write the full mutant list: ${e.message}`); }
    if (res.capped) {
      const seen = new Set([...parsed.mutants, ...parsed.not_run, ...parsed.ignored].map((m) => m.file));
      res.not_run_files = res.scope.filter((f) => !seen.has(f));
    }
    if (res.capped) capInfo(parsed.mutants.length, parsed.mutants.length + parsed.not_run.length);
    res.complete = !res.capped && parsed.not_run.length === 0 && !flakyIncomplete;
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

