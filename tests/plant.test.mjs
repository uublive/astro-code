// Phase 51 t3 — lib/plant.mjs: exact planting, the throwaway clone, the scrub and the blindness
// check (C3, C4). Real git under mkdtempSync; module reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, lstatSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (dir, f, body) => { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), body); };
const PY = 'def add(x):\n    y = x + 1\n    return y\n';
const JS = 'export function f(a, b) {\n  if (a > b) {\n    return a - b;\n  }\n  return 0;\n}\n';

// A project with a Python and a JS source, committed history, and the files the scrub must remove.
function project({ branch = 'main', ignoreNm = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-plant-proj-'));
  sh(dir, 'init', '-q', '-b', branch);
  sh(dir, 'config', 'user.email', 'orig@example.com');
  sh(dir, 'config', 'user.name', 'Orig Author');
  put(dir, 'src/a.py', PY);
  put(dir, 'src/b.mjs', JS);
  put(dir, '.gitignore', ignoreNm ? 'node_modules/\n' : '');
  put(dir, '.astrocode/phases/p1/SURVIVORS.json', '{"judgements":[]}\n');
  put(dir, '.astrocode/phases/p1/VERDICT.json', '{}\n');
  put(dir, '.astrocode/milestones/1/phases/old/SURVIVORS.json', '{}\n');
  put(dir, '.astrocode/CALIBRATION.jsonl', '{}\n');
  put(dir, 'stryker.config.json', '{}\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'init');
  put(dir, 'src/c.py', 'c = 1\n');
  sh(dir, 'add', '-A');
  sh(dir, 'commit', '-q', '-m', 'feat: c (phase 1 t1)', '--date', '2020-01-02T03:04:05Z');
  return dir;
}
const MUTMUT = { tool: 'mutmut', file: 'src/a.py', line: 2, line_text: '    y = x + 1', replacement_line: '    y = x - 1' };
const STRYKER = { tool: 'stryker', file: 'src/b.mjs', replacement: 'a >= b', loc: { start: { line: 2, column: 7 }, end: { line: 2, column: 12 } } };
const tree = (dir) => sh(dir, 'ls-tree', '-r', 'HEAD').stdout;
const refs = (dir) => sh(dir, 'for-each-ref', '--format=%(refname) %(objectname)').stdout;

test('plantChange replaces a mutmut line keeping the file\'s indentation and changes nothing else', async () => {
  const { plantChange } = await import('../lib/plant.mjs');
  assert.equal(plantChange(PY, MUTMUT), 'def add(x):\n    y = x - 1\n    return y\n');
  // the replacement line's own indentation is ignored; the file's is kept (tabs, CRLF too)
  const tabbed = 'def f():\r\n\tz = 1\r\n';
  assert.equal(plantChange(tabbed, { line: 2, line_text: 'z = 1', replacement_line: '        z = 2' }), 'def f():\r\n\tz = 2\r\n');
});

test('plantChange applies a Stryker replacement at its 1-based location, multi-line ranges included, byte-exact elsewhere', async () => {
  const { plantChange } = await import('../lib/plant.mjs');
  assert.equal(plantChange(JS, STRYKER), JS.replace('a > b', 'a >= b'));
  const multi = { replacement: 'X', loc: { start: { line: 2, column: 7 }, end: { line: 4, column: 4 } } };
  assert.equal(plantChange(JS, multi), 'export function f(a, b) {\n  if (X\n  return 0;\n}\n');
  // non-ASCII text before the range: UTF-16 columns, nothing else moves
  const uni = 'é = "ü"; x = 1\n';
  assert.equal(plantChange(uni, { replacement: '2', loc: { start: { line: 1, column: 14 }, end: { line: 1, column: 15 } } }), 'é = "ü"; x = 2\n');
});

test('plantChange refuses a mutmut line_text that no longer matches and a Stryker loc outside the file', async () => {
  const { plantChange } = await import('../lib/plant.mjs');
  assert.throws(() => plantChange(PY, { ...MUTMUT, line_text: '    y = x + 2' }), /no longer matches/);
  assert.throws(() => plantChange(PY, { ...MUTMUT, line: 40 }), /outside/);
  assert.throws(() => plantChange(JS, { replacement: 'z', loc: { start: { line: 99, column: 1 }, end: { line: 99, column: 2 } } }), /outside/);
  assert.throws(() => plantChange(JS, { replacement: 'z', loc: { start: { line: 2, column: 300 }, end: { line: 2, column: 301 } } }), /outside/);
  assert.throws(() => plantChange(JS, { file: 'x' }), /no exact change/);
});

test('makeCopy clones HEAD outside root, removes origin and tags, plants one file, scrubs SCRUB paths, and leaves `git status --porcelain` empty with every `git log --all` subject equal to the original\'s', async () => {
  const { makeCopy, removeCopy, SCRUB } = await import('../lib/plant.mjs');
  const root = project();
  sh(root, 'tag', 'v1');
  sh(root, 'branch', 'side');
  put(root, '.astrocode/.local/mutate-runs/p1.json', '{}');
  try {
    const c = makeCopy(root, MUTMUT);
    try {
      assert.ok(!c.repo.startsWith(root), 'outside the project');
      assert.match(c.dir, /ac-v-/);
      assert.equal(sh(c.repo, 'remote').stdout.trim(), '');
      assert.equal(sh(c.repo, 'tag').stdout.trim(), '');
      assert.equal(sh(c.repo, 'status', '--porcelain').stdout, '');
      assert.deepEqual(sh(c.repo, 'branch', '--format=%(refname:short)').stdout.trim().split('\n'), ['main'], 'one branch: --single-branch');
      assert.equal(sh(c.repo, 'log', '--all', '--format=%s').stdout, sh(root, 'log', '--format=%s').stdout);
      assert.equal(readFileSync(join(c.repo, 'src/a.py'), 'utf8'), 'def add(x):\n    y = x - 1\n    return y\n');
      assert.equal(readFileSync(join(c.repo, 'src/b.mjs'), 'utf8'), JS, 'nothing else planted');
      assert.ok(existsSync(join(c.repo, 'stryker.config.json')), 'the project\'s own tool configuration stays');
      assert.deepEqual(c.scrubbed, [
        '.astrocode/CALIBRATION.jsonl', '.astrocode/milestones/1/phases/old/SURVIVORS.json',
        '.astrocode/phases/p1/SURVIVORS.json', '.astrocode/phases/p1/VERDICT.json',
      ]);
      assert.ok(SCRUB.length >= 6);
      assert.ok(existsSync(join(c.repo, '.git', 'astrocode-scratch')));
      // the only difference from the original tree: the one planted file and the scrubbed ones
      const names = sh(c.repo, 'diff', '--name-status', sh(root, 'rev-parse', 'HEAD').stdout.trim(), 'HEAD').stdout.trim().split('\n');
      assert.deepEqual(names.filter((l) => l.startsWith('M')), ['M\tsrc/a.py']);
      assert.equal(names.filter((l) => l.startsWith('D')).length, 4);
    } finally { removeCopy(c); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the amended tip keeps the original committer name, email and date', async () => {
  const { makeCopy, removeCopy } = await import('../lib/plant.mjs');
  const root = project();
  try {
    const c = makeCopy(root, MUTMUT);
    try {
      const fmt = '%an|%ae|%aI|%cn|%ce|%cI|%s';
      assert.equal(sh(c.repo, 'log', '-1', `--format=${fmt}`).stdout, sh(root, 'log', '-1', `--format=${fmt}`).stdout);
      assert.equal(sh(c.repo, 'rev-list', '--count', 'HEAD').stdout, sh(root, 'rev-list', '--count', 'HEAD').stdout, 'no extra commit');
      assert.equal(sh(c.repo, 'reflog').stdout.trim(), '', 'the reflog does not show the amend');
    } finally { removeCopy(c); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a leaky branch name is renamed main', async () => {
  const { makeCopy, removeCopy } = await import('../lib/plant.mjs');
  const root = project({ branch: 'mutation-checks' });
  try {
    const c = makeCopy(root, STRYKER);
    try {
      assert.equal(sh(c.repo, 'symbolic-ref', '--short', 'HEAD').stdout.trim(), 'main');
      assert.equal(sh(c.repo, 'for-each-ref', 'refs/heads').stdout.match(/mutation/i), null);
    } finally { removeCopy(c); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('an ignored node_modules is linked and an unignored one is not', async () => {
  const { makeCopy, removeCopy } = await import('../lib/plant.mjs');
  for (const ignored of [true, false]) {
    const root = project({ ignoreNm: ignored });
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'dep', 'i.js'), '1');
    try {
      const c = makeCopy(root, MUTMUT);
      try {
        assert.equal(existsSync(join(c.repo, 'node_modules')), ignored);
        if (ignored) assert.ok(lstatSync(join(c.repo, 'node_modules')).isSymbolicLink());
        assert.equal(sh(c.repo, 'status', '--porcelain').stdout, '', 'a linked dependency dir never shows as untracked');
      } finally { removeCopy(c); }
      assert.ok(existsSync(join(root, 'node_modules', 'dep', 'i.js')), 'removing the copy never follows the link');
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('makeCopy refuses a tmpdir inside root', async () => {
  const { makeCopy } = await import('../lib/plant.mjs');
  const root = project();
  try {
    const inner = join(root, 'tmp'); mkdirSync(inner);
    assert.throws(() => makeCopy(root, MUTMUT, { tmp: inner }), /inside the project/);
    assert.deepEqual(readdirSync(inner), [], 'the refused copy leaves nothing behind');
    assert.throws(() => makeCopy(root, { ...MUTMUT, line_text: 'nope' }), /could not plant/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('removeCopy leaves nothing behind', async () => {
  const { makeCopy, removeCopy } = await import('../lib/plant.mjs');
  const root = project();
  try {
    const c = makeCopy(root, MUTMUT);
    removeCopy(c);
    assert.equal(existsSync(c.dir), false);
    removeCopy(c);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('blindnessCheck fails on a remaining SCRUB path or a leak-named env var, and only reports project-sourced matches', async () => {
  const { makeCopy, removeCopy, blindnessCheck, trialEnv } = await import('../lib/plant.mjs');
  const root = project();
  try {
    const c = makeCopy(root, MUTMUT);
    try {
      const clean = blindnessCheck(c.repo, { prompt: 'goal: add mutation support', frame: 'Verify phase 3', env: { PATH: '/x/mutants/bin', HOME: '/h' } });
      assert.equal(clean.ok, true);
      assert.ok(clean.reported.some((r) => /prompt/.test(r)) && clean.reported.some((r) => /PATH/.test(r)));
      put(c.repo, '.astrocode/phases/p1/SURVIVORS.json', '{}');
      const dirty = blindnessCheck(c.repo, { frame: 'ok', env: {} });
      assert.equal(dirty.ok, false);
      assert.match(dirty.reasons[0], /SURVIVORS\.json is still present/);
      rmSync(join(c.repo, '.astrocode/phases/p1/SURVIVORS.json'));
      assert.equal(blindnessCheck(c.repo, { frame: 'ok', env: { MUTMUT_DEBUG: '1' } }).ok, false);
      assert.equal(blindnessCheck(c.repo, { frame: 'a planted fault', env: {} }).ok, false);
      assert.deepEqual(Object.keys(trialEnv({ A: '1', STRYKER_X: '2', calibrate_me: '3', NODE_TEST_CONTEXT: 'child', PATH: 'p' })), ['A', 'PATH']);
    } finally { removeCopy(c); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the original repo\'s tree, index and refs are byte-identical after makeCopy and removeCopy', async () => {
  const { makeCopy, removeCopy } = await import('../lib/plant.mjs');
  const root = project();
  put(root, 'scratch.txt', 'untracked\n');
  const before = { tree: tree(root), refs: refs(root), status: sh(root, 'status', '--porcelain').stdout, idx: sh(root, 'ls-files', '-s').stdout, a: readFileSync(join(root, 'src/a.py'), 'utf8') };
  try {
    removeCopy(makeCopy(root, MUTMUT));
    removeCopy(makeCopy(root, STRYKER));
    assert.deepEqual({ tree: tree(root), refs: refs(root), status: sh(root, 'status', '--porcelain').stdout, idx: sh(root, 'ls-files', '-s').stdout, a: readFileSync(join(root, 'src/a.py'), 'utf8') }, before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
