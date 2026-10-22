// Shared scaffolding for the phase-47 mutate tests: a real tmp git project with ac phases and
// ADR-017-stamped commits, plus the stub tool and a PATH that can never reach a real tool (C11).
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../../../lib/planning.mjs';
import { addPhase, findPhase } from '../../../lib/roadmap.mjs';

export const FX = dirname(fileURLToPath(import.meta.url));
export const STUB = join(FX, 'stub.mjs');
export const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const GIT_BIN = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();

const LAYOUT = {
  js: { manifest: ['package.json', '{"name":"p"}\n'], a: 'src/a.mjs', b: 'src/b.mjs', c: 'src/c.mjs', test: 'tests/a.test.mjs' },
  go: { manifest: ['go.mod', 'module example.com/p\n\ngo 1.22\n'], a: 'a.go', b: 'b.go', c: 'c.go', test: 'a_test.go' },
  py: { manifest: ['pyproject.toml', '[project]\nname = "p"\n'], a: 'src/a.py', b: 'src/b.py', c: 'src/c.py', test: 'tests/test_a.py' },
};
export const layout = (kind) => LAYOUT[kind];

const put = (dir, f, body) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); };
export const commit = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };

/** Same as `commit`, named for the phase-48 repos that build stamped history step by step. */
export const phaseCommit = (dir, msg) => commit(dir, msg);

/**
 * Write an `n`-line file (`line 1`, `line 2`, …) — or, when it exists, keep its lines and rewrite
 * the given inclusive 1-based ranges `[start, end, tag]` to `line <i> <tag>`. Lets a test shape
 * "an unstamped commit edits 200-210, the phase edits 40-45" exactly.
 */
export function writeLines(dir, file, n, edits = []) {
  let lines;
  try { lines = readFileSync(join(dir, file), 'utf8').replace(/\n$/, '').split('\n'); } catch { lines = []; }
  if (lines.length !== n) lines = Array.from({ length: n }, (_, i) => `line ${i + 1}`);
  for (const [a, b, tag = 'edited'] of edits) for (let i = a; i <= b; i++) lines[i - 1] = `line ${i} ${tag}`;
  put(dir, file, `${lines.join('\n')}\n`);
}

// A 30-line body for the files a phase writes. The fixture reports put mutants on lines up to 22, and
// since phase 48 a mutant outside the lines the phase wrote is out of scope, so the files must be long
// enough to hold them. Python gets three 10-line functions (add, sub, mul) because mutmut 3 mutates
// functions: the fixture names `x_add` / `x_sub` / `x_mul`.
function body(kind, tag) {
  const n = 30;
  if (kind === 'py') {
    return ['add', 'sub', 'mul'].map((f) => [`def ${f}(x):`, ...Array.from({ length: 8 }, (_, i) => `    # ${tag} ${f} ${i + 1}`), '    return x'].join('\n')).join('\n') + '\n';
  }
  return Array.from({ length: n }, (_, i) => `// ${tag} ${i + 1}`).join('\n') + '\n';
}

/** Phase 1 changed a (+ a test file), phase 2 changed b, c belongs to no phase. */
export async function makeProject(kind = 'js') {
  const L = LAYOUT[kind];
  const dir = mkdtempSync(join(tmpdir(), 'ac-mutate-proj-'));
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'mproj' });
  await addPhase(dir, { number: 1, name: 'First' });
  await addPhase(dir, { number: 2, name: 'Second' });
  put(dir, L.manifest[0], L.manifest[1]);
  put(dir, L.c, '// c\n');
  commit(dir, 'init');
  put(dir, L.a, body(kind, 'a'));
  put(dir, L.test, '// test\n');
  commit(dir, 'feat: a (phase 1 t1)');
  put(dir, L.b, body(kind, 'b'));
  commit(dir, 'feat: b (phase 2 t1)');
  return { dir, kind, L, slug1: findPhase(dir, '1').slug, slug2: findPhase(dir, '2').slug };
}

/** Copy the stub into `<dir>/<sub>/<name>` (executable). Returns the bin directory. */
export function installStub(dir, name, sub = 'stubbin') {
  const bin = join(dir, sub);
  mkdirSync(bin, { recursive: true });
  copyFileSync(STUB, join(bin, name));
  chmodSync(join(bin, name), 0o755);
  return bin;
}

/** Copy the stub in as the project's test runner (`go` or `pytest`) for the flaky pre-check. */
export const installRunner = (dir, name, sub = 'runnerbin') => installStub(dir, name, sub);

/**
 * A JS project whose phase-1 tests run through a Stryker `command` runner (`node --test`), one
 * stable test and — unless `flaky: false` — one that fails on every other run, toggling a counter
 * file under the project's `.astrocode/.local/`.
 */
export async function jsFlakyProject({ flaky = true } = {}) {
  const p = await makeProject('js');
  put(p.dir, 'stryker.config.json', JSON.stringify({ testRunner: 'command', commandRunner: { command: 'node --test' } }) + '\n');
  put(p.dir, p.L.test, [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';",
    "test('stable', () => assert.ok(true));",
    ...(flaky ? [
      "test('flaky toggles', () => {",
      "  const f = '.astrocode/.local/flaky-counter';",
      "  mkdirSync('.astrocode/.local', { recursive: true });",
      "  let n = 0;",
      "  try { n = Number(readFileSync(f, 'utf8')); } catch { /* first run */ }",
      "  writeFileSync(f, String(n + 1));",
      "  assert.equal(n % 2, 1);",
      "});",
    ] : []),
    '',
  ].join('\n'));
  commit(p.dir, 'test: a (phase 1 t2)');
  return p;
}

/**
 * An env where only the given bin dirs, node and git are reachable; no GOBIN/GOPATH. Node and git sit
 * in a directory of their own holding just those two symlinks: their real directories (/usr/bin,
 * node's prefix) also hold npm, pytest or go, which the flaky pre-check would otherwise find and run
 * (phase 49), making the suites slow and machine-dependent.
 */
export function restrictedEnv(binDirs, extra = {}) {
  const only = mkdtempSync(join(tmpdir(), 'ac-mutate-only-'));
  symlinkSync(process.execPath, join(only, 'node'));
  symlinkSync(GIT_BIN, join(only, 'git'));
  const env = { ...process.env, PATH: [...binDirs, only].join(delimiter), HOME: mkdtempSync(join(tmpdir(), 'ac-mutate-home-')) };
  delete env.GOBIN; delete env.GOPATH;
  return { ...env, ...extra };
}
