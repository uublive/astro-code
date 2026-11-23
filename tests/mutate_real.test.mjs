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

// Fix 2026-11-09-ac-mutate-errors-when-the-go-module-is: the Go module sits in a subfolder (no go.mod at
// the repo root). Gremlins and the go-test baseline must run from the module, and the report's paths
// must come back repo-relative so they still match the phase's lines.
test('real Gremlins on a Go module in a subfolder: runs from the module, survivors keep repo paths', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const dir = await scratch();
  const home = mkdtempSync(join(tmpdir(), 'ac-mutate-gohome-'));
  try {
    const sub = (op) => `package p2\n\nfunc Sub(a, b int) int {\n\tif a ${op} b {\n\t\treturn a - b\n\t}\n\treturn b - a\n}\n`;
    put(dir, 'host/go.mod', 'module example.com/real\n\ngo 1.22\n');
    put(dir, 'host/p1/p1.go', 'package p1\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n');
    put(dir, 'host/p1/p1_test.go', 'package p1\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Fatal("bad")\n\t}\n}\n');
    put(dir, 'host/p2/p2.go', sub('<'));
    put(dir, 'host/p2/p2_test.go', 'package p2\n\nimport "testing"\n\nfunc TestOld(t *testing.T) {}\n');
    commit(dir, 'baseline');
    put(dir, 'host/p2/p2.go', sub('>'));
    put(dir, 'host/p2/p2_test.go', 'package p2\n\nimport "testing"\n\nfunc TestSub(t *testing.T) {\n\tif Sub(3, 1) != 2 {\n\t\tt.Fatal("bad")\n\t}\n}\n');
    commit(dir, 'work (phase 5 t1)');
    // No go.mod at the root, so detection finds no Go project: the subfolder project names its tool.
    put(dir, '.astrocode/config.json', JSON.stringify({ ...JSON.parse(readFileSync(join(dir, '.astrocode/config.json'), 'utf8')), mutation: { tool: 'gremlins' } }));
    const r = ac(dir, ['mutate', '5', '--json'], { HOME: home, GOFLAGS: '-mod=mod' });
    assert.equal(r.status, 0, r.stderr);
    const res = JSON.parse(r.stdout);
    common(res, dir);
    // Phase 59: Gremlins' own --diff cannot map a subfolder module, so it runs --diff in a scratch git repo of the
    // module instead; no exclusion list is needed (the whole-file fallback is covered in mutate_subdir_diff.test.mjs).
    assert.equal(res.scope_detail.narrowed, 'diff', res.scope_detail.why);
    assert.doesNotMatch(res.command, /--exclude-files/);
    assert.deepEqual(res.scope, ['host/p2/p2.go']);
    assert.equal(res.flaky.checked, true, res.flaky.reason);
    assert.equal(res.flaky.command, 'go test -count=1 -v ./p2');
    assert.deepEqual(res.flaky.baseline_failing, []);
    const counted = Object.values(res.counts).reduce((a, b) => a + b, 0);
    assert.ok(counted > 0, 'mutants were tested and matched to the phase\'s lines');
    assert.ok(res.survivors.every((s) => s.file === 'host/p2/p2.go'), JSON.stringify(res.survivors));
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

// ---- Phase 49 t12 — triage, --survivors, the flaky check and the Gremlins version, on the real tools ----
const json = (dir, args, env = {}) => { const r = ac(dir, ['mutate', '5', '--json', ...args], env); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout); };
const judgeOk = (dir, ...a) => { const r = ac(dir, ['mutate', 'judge', '5', ...a]); assert.equal(r.status, 0, r.stderr); return r; };

test('real mutmut 3: groups with a text-only group, judgements carry over and survive a line shift, --survivors runs only the open mutants, a flaky test is named', { skip: !REAL || !which('mutmut') || !which('pytest') }, async () => {
  const dir = await scratch();
  try {
    const src = (pad) => `${'# pad\n'.repeat(pad)}def b(x):\n    if x > 10:\n        return x - 10\n    return x * 2\n\n\ndef msg(x):\n    if x < 0:\n        raise ValueError("negative value")\n    return "ok"\n`;
    put(dir, 'pkg/__init__.py', '');
    put(dir, 'conftest.py', '');
    put(dir, 'pyproject.toml', '[project]\nname = "realproj"\n');
    put(dir, 'pkg/mod.py', src(0).replace('return x * 2', 'return x * 3').replace('return "ok"', 'return "fine"'));
    put(dir, 'tests/test_mod.py', 'from pkg.mod import b, msg\n\n\ndef test_b():\n    assert b(20) == 10\n    assert b(3) == 6\n\n\ndef test_msg():\n    assert msg(1) == "ok"\n    try:\n        msg(-1)\n    except ValueError:\n        pass\n');
    commit(dir, 'baseline');
    put(dir, 'pkg/mod.py', src(0));
    commit(dir, 'work (phase 5 t1)');
    assert.equal(ac(dir, ['mutate', 'setup']).status, 0);
    commit(dir, 'config');
    // 1-2: the full run is grouped, with the string-literal mutants in their own group
    const j = json(dir, []);
    assert.ok(j.survivors.length >= 4, `survivors: ${j.survivors.length}`);
    assert.ok(j.survivors.every((s) => /^s:/.test(s.key) && s.group && s.kind));
    assert.equal(j.groups.reduce((n, g) => n + g.count, 0), j.survivors.length);
    const tg = j.groups.find((g) => g.id === 'g:text-only');
    assert.ok(tg && tg.count >= 1, 'a text-only group');
    assert.ok(j.survivors.filter((s) => s.text_only).every((s) => /["']/.test(s.line_text)), 'text-only survivors sit on a line with a string');
    // 3: judge the group, re-run: carried
    judgeOk(dir, 'g:text-only', '--equivalent', 'message text is not asserted by design');
    const j2 = json(dir, []);
    assert.equal(j2.triage.judged, tg.count);
    assert.ok(j2.survivors.filter((s) => s.text_only).every((s) => s.judged));
    // 4: lines inserted above both functions: the judgements hold
    put(dir, 'pkg/mod.py', src(5));
    commit(dir, 'shift (phase 5 t2)');
    const j3 = json(dir, []);
    assert.equal(j3.triage.judged, tg.count, 'a pure line shift keeps every judgement');
    assert.equal(j3.triage.stale, 0);
    // 5: --survivors runs only the open mutants, per the tool's own progress counter
    const open = j3.triage.open;
    const part = json(dir, ['--survivors']);
    assert.equal(part.partial, true);
    assert.equal(part.rerun.open, open);
    assert.equal(part.rerun.narrowing.narrowed, 'mutants');
    assert.equal(part.rerun.extra_executed, 0);
    const log = readFileSync(join(dir, part.log), 'utf8');
    const counters = [...log.matchAll(/(\d+)\/(\d+)\s+🎉/g)];
    assert.equal(Number(counters.at(-1)[1]), open, 'the tool tested exactly the open mutants');
    // 6: a flaky test is named and its kills are not counted
    put(dir, 'tests/test_flaky.py', "import os\n\n\ndef test_flaky():\n    f = '.astrocode/.local/flaky-counter'\n    os.makedirs(os.path.dirname(f), exist_ok=True)\n    n = int(open(f).read()) if os.path.exists(f) else 0\n    open(f, 'w').write(str(n + 1))\n    assert n % 2 == 1\n");
    commit(dir, 'flaky (phase 5 t3)');
    const jf = json(dir, []);
    assert.equal(jf.flaky.checked, true, jf.flaky.reason);
    assert.deepEqual(jf.flaky.tests, ['tests/test_flaky.py::test_flaky']);
    assert.equal(jf.flaky.kills, 'excluded');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('real Gremlins: tool.version is the module version of the binary (go version -m), groups carry judgements, --survivors narrows by files and kinds', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const dir = await scratch();
  const home = mkdtempSync(join(tmpdir(), 'ac-mutate-gohome-'));
  const env = { HOME: home, GOFLAGS: '-mod=mod' };
  try {
    const cmp = (op) => `package p\n\nfunc Cmp(a, b int) int {\n\tif a ${op} b {\n\t\treturn a - b\n\t}\n\treturn 0\n}\n\nfunc Inc(x int) int {\n\tif x >= 10 {\n\t\tx++\n\t}\n\treturn x + 1\n}\n`;
    put(dir, 'go.mod', 'module example.com/real\n\ngo 1.22\n');
    put(dir, 'p/p.go', cmp('<'));
    put(dir, 'p/p_test.go', 'package p\n\nimport "testing"\n\nfunc TestOld(t *testing.T) {}\n');
    put(dir, 'other/o.go', 'package other\n\nfunc O() int { return 1 }\n');
    commit(dir, 'baseline');
    put(dir, 'p/p.go', cmp('>'));
    put(dir, 'p/p_test.go', 'package p\n\nimport "testing"\n\nfunc TestCmp(t *testing.T) {\n\tif Cmp(3, 1) != 2 {\n\t\tt.Fatal("cmp")\n\t}\n}\n\nfunc TestInc(t *testing.T) {\n\tif Inc(1) != 2 {\n\t\tt.Fatal("inc")\n\t}\n\tif Inc(10) != 12 {\n\t\tt.Fatal("inc10")\n\t}\n}\n');
    commit(dir, 'work (phase 5 t1)');
    const j = json(dir, [], env);
    // 7: the version equals what `go version -m` says
    const bin = spawnSync('sh', ['-c', 'command -v gremlins'], { encoding: 'utf8' }).stdout.trim();
    const mod = /\tmod\t\S*\/gremlins\t(v\S+)/.exec(spawnSync('go', ['version', '-m', bin], { encoding: 'utf8' }).stdout)?.[1];
    assert.ok(mod, 'go version -m shows a module version');
    assert.equal(j.tool.version, mod);
    assert.ok(j.survivors.every((s) => /^s:/.test(s.key) && s.group));
    assert.equal(j.groups.reduce((n, g) => n + g.count, 0), j.survivors.length);
    if (j.survivors.length) {
      judgeOk(dir, j.survivors[0].key, '--equivalent', 'judged on the real tool');
      const j2 = json(dir, [], env);
      assert.equal(j2.triage.judged, 1);
      if (j2.triage.open) {
        const part = json(dir, ['--survivors'], env);
        assert.equal(part.rerun.narrowing.narrowed, 'files+kinds');
        assert.match(part.rerun.narrowing.why, /re-ran too/);
        assert.ok(part.rerun.executed <= Object.values(j.counts).reduce((a, b) => a + b, 0));
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); }
});

// ---- Phase 59 t12 — the subfolder module under the budget, on the real tools (C9, C10, C12) ----
// One file of ten one-line functions. `tests` call only the first `covered` of them. The phase commit changes the
// given functions' bodies (a different constant), so each changed line holds exactly one arithmetic mutant.
const GO_FUNCS = (n, changed = []) => `package svc\n\n${Array.from({ length: n }, (_, i) => `func F${i}(a int) int { return a + ${changed.includes(i) ? i + 100 : i} }\n`).join('\n')}`;
const GO_TESTS = (covered, changed = []) => `package svc\n\nimport "testing"\n\n${Array.from({ length: covered }, (_, i) => `func TestF${i}(t *testing.T) {\n\tif F${i}(1) != ${1 + (changed.includes(i) ? i + 100 : i)} {\n\t\tt.Fatal("f${i}")\n\t}\n}\n`).join('\n')}`;

async function goLayout(prefix, { covered = 10, changed = [0], workers } = {}) {
  const dir = await scratch();
  const home = mkdtempSync(join(tmpdir(), 'ac-mutate-gohome-'));
  const heavy = mkdtempSync(join(tmpdir(), 'ac-mutate-heavy-'));
  put(dir, `${prefix}go.mod`, 'module example.com/real\n\ngo 1.22\n');
  put(dir, `${prefix}svc.go`, GO_FUNCS(10));
  put(dir, `${prefix}svc_test.go`, GO_TESTS(covered));
  commit(dir, 'baseline');
  put(dir, `${prefix}svc.go`, GO_FUNCS(10, changed));
  put(dir, `${prefix}svc_test.go`, GO_TESTS(covered, changed));
  commit(dir, 'work (phase 5 t1)');
  const cfgFile = join(dir, '.astrocode/config.json');
  const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
  writeFileSync(cfgFile, JSON.stringify({ ...cfg, mutation: { tool: 'gremlins' }, ...(workers ? { heavy: { workers } } : {}) }));
  return { dir, home, heavy, cleanup: () => { for (const d of [dir, home, heavy]) rmSync(d, { recursive: true, force: true }); } };
}
const runReal = (l, extra = {}) => {
  const r = ac(l.dir, ['mutate', '5', '--json'], { HOME: l.home, GOFLAGS: '-mod=mod', ASTRO_HEAVY_DIR: l.heavy, ...extra });
  assert.equal(r.status, 0, r.stderr);
  const res = JSON.parse(r.stdout);
  assert.notEqual(res.outcome, 'error', res.error);
  return res;
};
const total = (res) => Object.values(res.counts).reduce((a, b) => a + b, 0);

test('real Gremlins, C9: a subfolder module tests only the changed line, like the same module at the root', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const root = await goLayout('');
  const sub = await goLayout('svc/');
  try {
    const a = runReal(root);
    const b = runReal(sub);
    assert.equal(b.scope_detail.narrowed, 'diff', b.scope_detail.why);
    assert.equal(total(b), total(a), 'the same number of mutants as the root layout');
    assert.ok(total(b) > 0 && total(b) <= 3, `per-line count, not the whole-file count (${total(b)})`);
    assert.deepEqual([b.counts.killed, b.counts.survived], [a.counts.killed, a.counts.survived]);
  } finally { root.cleanup(); sub.cleanup(); }
});

test('real Gremlins, C10: an uncovered function is never KILLED, and the outcomes are the same at every budget', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const outcomes = [];
  for (const prefix of ['', 'svc/']) {
    for (const workers of [1, 3, undefined]) {
      const l = await goLayout(prefix, { covered: 5, changed: [0, 7], workers });
      try {
        const res = runReal(l);
        outcomes.push({ prefix, workers, counts: res.counts, survivors: res.survivors.map((s) => `${s.file.replace(/^svc\//, '')}:${s.line}:${s.status}`).sort() });
        assert.ok(res.counts['no-coverage'] + res.counts.survived >= 1, 'the uncovered function F7 is not covered, never killed');
        assert.ok(!res.survivors.some((s) => s.status === 'killed'));
      } finally { l.cleanup(); }
    }
  }
  for (const o of outcomes) assert.deepEqual(o.counts, outcomes[0].counts, `${o.prefix || 'root'} workers ${o.workers}`);
  for (const o of outcomes) assert.deepEqual(o.survivors, outcomes[0].survivors);
});

test('real Gremlins, C12: the user\'s own Go build cache does not grow', { skip: !REAL || !which('gremlins') || !which('go') }, async () => {
  const gocache = spawnSync('go', ['env', 'GOCACHE'], { encoding: 'utf8' }).stdout.trim();
  const du = () => Number(spawnSync('du', ['-sk', gocache], { encoding: 'utf8' }).stdout.split('\t')[0]) || 0;
  const l = await goLayout('svc/');
  try {
    const before = du();
    runReal(l, { HOME: process.env.HOME });
    assert.ok(du() - before < 256, `GOCACHE grew by ${du() - before} KB`);
    assert.ok(existsSync(join(l.heavy, 'gocache')), 'the run used its own cache');
  } finally { l.cleanup(); }
});
