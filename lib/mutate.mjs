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
// go or `python -m`. A tool is looked up on disk (node_modules/.bin, PATH, GOBIN/GOPATH/bin,
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
// lib never writes outside `.astrocode/` (ADR-048): `setupFor` is pure and bin/ writes it.
import { existsSync, accessSync, statSync, readFileSync, mkdtempSync, rmSync, rmdirSync, constants } from 'node:fs';
import { join, delimiter, relative, isAbsolute, dirname, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { git } from './git.mjs';
import { loadConfig } from './config.mjs';
import { detectStack, projectStack } from './stack.mjs';
import { phaseStampedPaths } from './fixtures.mjs';
import { paths } from './paths.mjs';
import { runCapped } from './caprun.mjs';
import { assertSafeSlug } from './util.mjs';
import { MUTANT_STATUSES, SURVIVOR_STATUSES, testStrengthIds } from './verdict.mjs';
import { parseStryker, parseGremlins, parseMutmutJunit, parseMutmutResults, countStatuses } from './mutparse.mjs';
import { readNotices, noticeFor, markShown, dismiss, REMINDER } from './mutnotice.mjs';

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

// ---- The tool table (D4). A new tool is a new row, not a new code path. ----
// `build(ctx)` → `{ argv, collectArgv?, reportFile?, config? }`; `parse(text, ctx)` → mutparse shape.
export const MUTATION_TOOLS = [
  {
    id: 'stryker',
    label: 'Stryker',
    tags: ['node', 'typescript'],
    extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'],
    testPatterns: [/\.(test|spec)\.[cm]?[jt]sx?$/, /(^|\/)(tests?|__tests__)\//],
    install: 'npm i -D @stryker-mutator/core',
    configFiles: ['stryker.config.json', 'stryker.config.mjs', 'stryker.config.js', 'stryker.config.cjs', '.stryker.conf.json'],
    find: (root, env) => inDirs([join(root, 'node_modules', '.bin')], 'stryker') ?? onPath('stryker', env),
    versionArgs: ['--version'],
    parseVersion: firstVersion,
    artifacts: ['reports/mutation/mutation.json', '.stryker-tmp'],
    build: (ctx) => ({
      // `stryker run [configFile]`: an existing config is passed explicitly (C7).
      argv: [ctx.bin, 'run', ...(ctx.config ? [ctx.config] : []), '--mutate', ctx.scope.join(','), '--reporters', 'json'],
      reportFile: join(ctx.root, 'reports', 'mutation', 'mutation.json'),
    }),
    parse: (text, ctx) => parseStryker(text, { scope: ctx.scope }),
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
    install: 'go install github.com/go-gremlins/gremlins/cmd/gremlins@latest',
    configFiles: ['.gremlins.yaml'],
    // env vars only, never `go env`: the lookup must not run a package manager or `go`.
    find: (root, env) => onPath('gremlins', env) ?? inDirs([
      env.GOBIN,
      ...String(env.GOPATH ?? '').split(delimiter).filter(Boolean).map((d) => join(d, 'bin')),
      join(env.HOME ?? homedir(), 'go', 'bin'),
    ], 'gremlins'),
    versionArgs: ['--version'],
    parseVersion: firstVersion,
    artifacts: [],
    build: (ctx) => ({
      // Gremlins has no per-file flag: mutate the module and exclude every other tracked .go file.
      argv: [ctx.bin, 'unleash', '--output', ctx.reportFile,
        ...ctx.otherGoFiles.flatMap((f) => ['--exclude-files', `^${escRe(f)}$`])],
      reportFile: ctx.reportFile,
    }),
    parse: (text, ctx) => parseGremlins(text, { scope: ctx.scope }),
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
    install: 'pip install mutmut',
    configFiles: ['setup.cfg'],
    find: (root, env) => onPath('mutmut', env) ?? inDirs([join(root, '.venv', 'bin'), join(root, 'venv', 'bin')], 'mutmut'),
    versionArgs: [['--version'], ['version']], // 3.x has --version; 2.x only `mutmut version`
    parseVersion: firstVersion,
    artifacts: ['.mutmut-cache', 'mutants'],
    // 2.x `junitxml` defaults both policies to `ignore`, which writes an untested mutant (every
    // mutant `run` registered but never reached: a crash, a cap) as a plain testcase — read as
    // killed. `failure` puts the status in the message, so untested is not run, never killed.
    build: (ctx) => ctx.major === 2
      ? { argv: [ctx.bin, 'run', '--paths-to-mutate', ctx.scope.join(',')], collectArgv: [ctx.bin, 'junitxml', '--untested-policy', 'failure', '--suspicious-policy', 'failure'],
          // junitxml writes a `pre_mutation`-skipped mutant as a plain testcase; result-ids names them.
          skippedArgv: [ctx.bin, 'result-ids', 'skipped'] }
      // 3.x reads paths from config only: scope is passed as mutant-name globs (`pkg.mod.*`).
      // mutmut 3 strips a leading `src.` from mutant names (`strip_prefix(..., prefix='src.')`),
      // and names a package's `__init__.py` mutants after the package itself (`pkg.*`).
      : { argv: [ctx.bin, 'run', ...ctx.scope.map((f) => `${f.replace(/(\/__init__)?\.py$/, '').replace(/\//g, '.').replace(/^src\./, '')}.*`)],
          collectArgv: [ctx.bin, 'results', '--all', 'true'] },
    parse: (text, ctx) => (ctx.major === 2 ? parseMutmutJunit : parseMutmutResults)(text, { scope: ctx.scope, skippedIds: ctx.skippedIds }),
    // 2.x exits with a bit mask; bit 1 is fatal (e.g. the baseline tests fail before any mutant
    // runs). Its junitxml then prints the OLD cache, so a fatal run's report is never trusted.
    fatalExit: (status, ctx) => ctx.major === 2 && Number.isInteger(status) && (status & 1) === 1,
    supportedMajors: [2, 3],
    setup(root) {
      const dirs = existingDirs(root, ['src', 'lib']);
      const src = dirs.length ? `${dirs[0]}/` : 'src/';
      const tests = existingDirs(root, ['tests', 'test'])[0] ?? 'tests';
      return { file: 'setup.cfg', content: `[mutmut]\npaths_to_mutate=${src}\ntests_dir=${tests}/\n` };
    },
  },
];

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

/** The phase's changed, existing, non-test source files for one tool row (P4). Sorted. */
export function phaseScope(root, phase, row) {
  const { files } = phaseStampedPaths(root, phase);
  return files
    .filter((f) => row.extensions.some((e) => f.endsWith(e)))
    .filter((f) => !SHARED_EXCLUDES.some((x) => f.startsWith(x) || f.includes(`/${x}`)))
    .filter((f) => !row.testPatterns.some((re) => re.test(f)))
    .filter((f) => { try { return statSync(join(root, f)).isFile(); } catch { return false; } })
    .sort();
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

function capSeconds(root, warnings) {
  const raw = loadConfig(root)?.mutation?.cap_seconds;
  if (raw === undefined) return DEFAULT_CAP_SECONDS;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  warnings.push(`mutation.cap_seconds "${raw}" is not a positive number — using ${DEFAULT_CAP_SECONDS}`);
  return DEFAULT_CAP_SECONDS;
}

async function probe(row, root, env) {
  const bin = row.find(root, env);
  if (!bin) return { present: false };
  // `versionArgs` is one argv tail, or a list of them tried in order until one exits 0.
  const tries = Array.isArray(row.versionArgs[0]) ? row.versionArgs : [row.versionArgs];
  for (const args of tries) {
    const r = await runCapped([bin, ...args], { cwd: root, env, capMs: VERSION_CAP_MS });
    if (r.status === 0) return { present: true, bin, version: row.parseVersion(`${r.stdout}\n${r.stderr}`) };
  }
  return { present: false, bin, reason: `${tries.map((a) => `\`${basename(bin)} ${a.join(' ')}\``).join(' and ')} failed` };
}

const head = (root) => { const r = git(['rev-parse', 'HEAD'], { cwd: root }); return r.status === 0 ? r.stdout.trim() : null; };
const rel = (root, p) => (isAbsolute(p) ? relative(root, p) : p);
const NO_TOOL_REASON = 'no supported mutation tool for this project — AI mutants used';
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
  const cap_seconds = capSeconds(root, warnings);
  const res = {
    tool: null, command: null, reproduce: `ac mutate ${num} --json`, head: head(root), scope: [], cap_seconds,
    capped: false, complete: false, outcome: 'error', counts: zeroCounts(), mutants: [], survivors: [],
    not_run: [], not_run_files: [], ignored: [], skipped_tools: [], fallback: null, notice: null,
    required: criteriaRequired(root, phaseSlug), warnings, log: null, started_at: new Date(t0).toISOString(), duration_ms: 0,
  };
  const finish = (outcome, extra = {}) => {
    Object.assign(res, extra, { outcome, duration_ms: Date.now() - t0 });
    return res;
  };

  const picked = pickTool(root, phaseSlug);
  res.skipped_tools = picked.skipped;
  if (picked.error) return finish('error', { error: picked.error });
  if (!picked.row) return finish('no-tool', { fallback: { reason: NO_TOOL_REASON } });
  const row = picked.row;
  res.tool = { id: row.id, label: row.label, version: null, source: picked.source, why: picked.why };

  res.scope = phaseScope(root, phaseSlug, row);
  if (!res.scope.length) return finish('no-scope', { fallback: { reason: NO_SCOPE_REASON } });

  const found = await probe(row, root, env);
  if (!found.present) {
    if (found.reason) warnings.push(found.reason);
    const extra = { fallback: { reason: REMINDER } };
    if (notice) {
      const n = noticeFor(readNotices(root), row.id);
      extra.notice = n;
      if (n === 'full') { extra.suggestion = { install: row.install }; await markShown(root, row.id); }
    }
    return finish('tool-missing', extra);
  }
  res.tool.version = found.version;
  res.tool.path = rel(root, found.bin);
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

  const runDir = mkdtempSync(join(tmpdir(), 'ac-mutate-'));
  const logFile = join(runDir, 'tool.log');
  res.log = logFile;
  const config = firstFile(root, row.configFiles);
  const goFiles = row.id === 'gremlins'
    ? git(['ls-files', '--', '*.go'], { cwd: root }).stdout.split('\n').filter(Boolean) : [];
  const otherGoFiles = goFiles.filter((f) => !res.scope.includes(f) && !/_test\.go$/.test(f));
  const plan = row.build({
    root, bin: found.bin, scope: res.scope, major, config, otherGoFiles, reportFile: join(runDir, 'gremlins.json'),
  });
  const shown = (argv) => [row.id, ...argv.slice(1)].join(' ');
  res.command = [plan.argv, plan.collectArgv].filter(Boolean).map(shown).join(' && ');

  const before = snapshot(root, row);
  try {
    const runStart = Date.now();
    const run = await runCapped(plan.argv, { cwd: root, env, capMs: cap_seconds * 1000, logFile });
    res.capped = run.capped;
    if (run.error) return finish('error', { error: `could not run ${row.id}: ${run.error.message}` });

    if (!res.capped && row.fatalExit?.(run.status, { major })) {
      const tail = (run.stderr || '').trim().split('\n').filter(Boolean).pop();
      return finish('error', { error: `${row.id} exited with a fatal error (exit ${run.status}${tail ? `: ${tail}` : ''}) — its report is not trusted; see ${logFile}` });
    }

    let text = null;
    let skippedIds = [];
    if (plan.skippedArgv) {
      const k = await runCapped(plan.skippedArgv, { cwd: root, env, capMs: COLLECT_CAP_MS, logFile });
      if (k.status === 0) skippedIds = k.stdout.split(/\s+/).filter((t) => /^\d+$/.test(t));
    }
    if (plan.collectArgv) {
      const c = await runCapped(plan.collectArgv, { cwd: root, env, capMs: COLLECT_CAP_MS, logFile });
      if (c.status === 0 && c.stdout.trim()) text = c.stdout;
    } else if (existsSync(plan.reportFile) && statSync(plan.reportFile).mtimeMs >= runStart - 1000) {
      // A report older than this run is a stale leftover, never this run's result (1s: coarse mtimes).
      text = readFileSync(plan.reportFile, 'utf8');
    }

    let parsed = text === null ? { error: 'the tool produced no report' } : row.parse(text, { scope: res.scope, major, skippedIds });
    if (parsed.error) {
      if (res.capped) {
        // No partial report: never guess which mutants were not generated.
        return finish('incomplete', {
          not_run_files: [...res.scope], not_run_note: 'no partial report — mutants not generated are unknown',
        });
      }
      const tail = (run.stderr || '').trim().split('\n').filter(Boolean).pop();
      return finish('error', { error: `${parsed.error}${run.status ? ` (exit ${run.status}${tail ? `: ${tail}` : ''})` : ''} — see ${logFile}` });
    }

    res.mutants = parsed.mutants;
    res.not_run = parsed.not_run;
    res.ignored = parsed.ignored;
    res.counts = countStatuses(parsed.mutants);
    res.survivors = parsed.mutants.filter((m) => SURVIVOR_STATUSES.includes(m.status));
    if (res.capped) {
      const seen = new Set([...parsed.mutants, ...parsed.not_run, ...parsed.ignored].map((m) => m.file));
      res.not_run_files = res.scope.filter((f) => !seen.has(f));
    }
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
  if (!picked.row) return { ...res, outcome: 'no-tool', fallback: { reason: NO_TOOL_REASON } };
  const row = picked.row;
  res.tool = { id: row.id, label: row.label, version: null, source: picked.source, why: picked.why };
  const found = await probe(row, root, env);
  if (!found.present) {
    if (found.reason) res.warnings.push(found.reason);
    return { ...res, outcome: 'tool-missing', fallback: { reason: REMINDER }, notice: 'full', suggestion: { install: row.install } };
  }
  res.tool.version = found.version;
  res.tool.path = rel(root, found.bin);
  return res;
}

/** Pure: the minimal config for a tool, and whether its file already exists (P11). */
export function setupFor(root, toolId = null) {
  const row = toolId ? rowById(toolId) : pickTool(root).row;
  if (!row) return { error: toolId ? `unknown tool "${toolId}"` : 'no supported mutation tool detected for this project' };
  const { file, content } = row.setup(root);
  return { tool: row.id, file, content, exists: existsSync(join(root, file)) };
}

/** Dismiss the install suggestion for a tool (default: the one detected here). */
export async function dismissTool(root, toolId = null) {
  const row = toolId ? rowById(toolId) : pickTool(root).row;
  if (!row) return { error: toolId ? `unknown tool "${toolId}"` : 'no supported mutation tool detected for this project' };
  await dismiss(root, row.id);
  return { tool: row.id };
}

