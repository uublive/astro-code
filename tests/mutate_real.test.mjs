// Phase 48 t15 — opt-in: `ac mutate` against the REAL tools (AC_MUTATE_REAL=1). Skipped by default so
// the suite needs no mutation tool. For each tool found on the real PATH it runs a tiny scratch
// project whose phase changes a few lines and asserts the invocation `ac mutate` builds is accepted:
// no unknown-flag error, a narrowed scope, the phase's tests, survivors at real lines, a log and a
// full list. Stryker is not installable offline and is recorded as "not run" in VERSIONS.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase } from '../lib/roadmap.mjs';

const REAL = process.env.AC_MUTATE_REAL === '1';
const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const which = (n) => String(process.env.PATH ?? '').split(delimiter).some((d) => existsSync(join(d, n)));
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (dir, f, body) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), body); };
const commit = (dir, msg) => { sh(dir, 'add', '-A'); sh(dir, 'commit', '-q', '-m', msg); };

async function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mutate-real-'));
  sh(dir, 'init', '-q'); sh(dir, 'config', 'user.email', 't@t'); sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'realproj' });
  await addPhase(dir, { number: 5, name: 'Real' });
  return dir;
}
const ac = (dir, args, env = {}) => spawnSync(process.execPath, [AC, ...args], {
  cwd: dir, encoding: 'utf8', input: '', timeout: 540_000, env: { ...process.env, ...env },
});
const common = (res, dir) => {
  const tail = () => { try { return readFileSync(join(dir, res.log), 'utf8').split('\n').slice(-25).join('\n'); } catch { return ''; } };
  assert.notEqual(res.outcome, 'error', `${res.error}\n${tail()}`);
  assert.notEqual(res.outcome, 'not-configured');
  assert.ok(res.scope_detail.narrowed, 'a narrowed scope');
  assert.equal(res.tests.source, 'phase-commits');
  assert.ok(existsSync(join(dir, res.log)), 'the log exists');
  assert.ok(existsSync(join(dir, res.full_list)), 'the full list exists');
  assert.doesNotMatch(readFileSync(join(dir, res.log), 'utf8'), /[Uu]nknown (flag|option)|No such option|unknown shorthand/);
};

test('real mutmut 3 accepts what ac mutate builds (scope, tests, lines, log, full list)', { skip: !REAL || !which('mutmut') }, async () => {
  const dir = await scratch();
  try {
    const src = (k) => `def a(x):\n    return x + 1\n\n\ndef b(x):\n    if x > 10:\n        return x - 10\n    return x * ${k}\n`;
    put(dir, 'pkg/__init__.py', '');
    put(dir, 'pkg/mod.py', src(3));
    put(dir, 'tests/test_a.py', 'from pkg.mod import a\n\n\ndef test_a():\n    assert a(1) == 2\n');
    put(dir, 'tests/test_b.py', 'from pkg.mod import b\n\n\ndef test_b():\n    assert b(2) == 6\n');
    put(dir, 'pyproject.toml', '[project]\nname = "realproj"\n');
    commit(dir, 'baseline');
    put(dir, 'pkg/mod.py', src(2));
    put(dir, 'tests/test_b.py', 'from pkg.mod import b\n\n\ndef test_b():\n    assert b(2) == 4\n\n\ndef test_b_big():\n    assert b(11) == 1\n');
    commit(dir, 'work (phase 5 t1)');
    const s = ac(dir, ['mutate', 'setup']);
    assert.equal(s.status, 0, s.stderr);
    commit(dir, 'config');
    const r = ac(dir, ['mutate', '5', '--json']);
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    common(res, dir);
    assert.equal(res.scope_detail.narrowed, 'functions');
    assert.ok(res.survivors.length > 0 && res.survivors.every((m) => m.line > 0), JSON.stringify(res.survivors));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('real Gremlins accepts what ac mutate builds (diff scope, GOFLAGS tests, log, full list)', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const dir = await scratch();
  const home = mkdtempSync(join(tmpdir(), 'ac-mutate-gohome-'));
  try {
    const sub = (op) => `package p2\n\nfunc Sub(a, b int) int {\n\tif a ${op} b {\n\t\treturn a - b\n\t}\n\treturn b - a\n}\n`;
    put(dir, 'go.mod', 'module example.com/real\n\ngo 1.22\n');
    put(dir, 'p1/p1.go', 'package p1\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n');
    put(dir, 'p1/p1_test.go', 'package p1\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal("bad")\n\t}\n}\n');
    put(dir, 'p2/p2.go', sub('<'));
    put(dir, 'p2/p2_test.go', 'package p2\n\nimport "testing"\n\nfunc TestOld(t *testing.T) {}\n');
    commit(dir, 'baseline');
    put(dir, 'p2/p2.go', sub('>'));
    put(dir, 'p2/p2_test.go', 'package p2\n\nimport "testing"\n\nfunc TestSub(t *testing.T) {\n\tif Sub(3, 1) != 2 {\n\t\tt.Fatal("bad")\n\t}\n}\n');
    commit(dir, 'work (phase 5 t1)');
    const r = ac(dir, ['mutate', '5', '--json'], { HOME: home, GOFLAGS: '-mod=mod' });
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    common(res, dir);
    assert.equal(res.scope_detail.narrowed, 'diff');
    assert.deepEqual(res.scope, ['p2/p2.go']);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});
