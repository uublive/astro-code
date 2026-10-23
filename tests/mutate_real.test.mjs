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
