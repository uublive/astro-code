// Phase 47 t9 — `ac mutate` through the real CLI (C1-C4, help). Real tmp git projects with ac
// phases and stamped commits; the tools are tests/fixtures/mutate/stub.mjs on a restricted PATH,
// so a real Stryker/Gremlins/mutmut on the dev machine can never be found (C11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { makeProject, installStub, restrictedEnv, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const ac = (p, args, o = {}) => spawnSync(process.execPath, [AC, ...args], { cwd: p.dir, encoding: 'utf8', env: p.env, input: '', timeout: 60000, ...o });
const logLines = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const strip = ({ started_at, duration_ms, log, ...rest }) => rest;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

async function rig(kind, { report, version, extra = {}, nodeModules = false } = {}) {
  const p = await makeProject(kind);
  const name = { js: 'stryker', go: 'gremlins', py: 'mutmut' }[kind];
  const bin = installStub(p.dir, name, nodeModules ? 'node_modules/.bin' : 'stubbin');
  p.log = join(p.dir, 'stub.log');
  p.pids = join(p.dir, 'stub.pids');
  p.env = restrictedEnv(nodeModules ? [] : [bin], {
    MUTATE_STUB_LOG: p.log, MUTATE_STUB_PIDS: p.pids,
    ...(report ? { MUTATE_STUB_REPORT: join(FX, report) } : {}), ...(version ? { MUTATE_STUB_VERSION: version } : {}), ...extra,
  });
  return p;
}

test('C1: --json twice is identical and complete; human output shows the same counts, survivors, tool and why', async () => {
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    const a = ac(p, ['mutate', '1', '--json']);
    assert.equal(a.status, 0, a.stderr);
    const b = ac(p, ['mutate', '1', '--json']);
    const ra = JSON.parse(a.stdout);
    assert.deepEqual(strip(ra), strip(JSON.parse(b.stdout)));
    assert.deepEqual(ra.counts, { killed: 2, survived: 1, timeout: 1, 'no-coverage': 1, error: 2 });
    assert.equal(ra.mutants.length, 7);
    assert.ok(ra.mutants.every((m) => m.file && m.line > 0 && m.mutator));
    assert.equal(ra.tool.why, 'package.json → stryker');
    const h = ac(p, ['mutate', '1']);
    assert.equal(h.status, 0, h.stderr);
    assert.match(h.stdout, /^⚠ Stryker \(package\.json → stryker\) · 7 mutants: 2 killed · 1 timeout · 1 survived · 1 no-coverage · 2 error$/m);
    assert.match(h.stdout, /^scope: src\/a\.mjs$/m);
    assert.match(h.stdout, /^⚠ src\/a\.mjs:10 ArithmeticOperator survived$/m);
    assert.match(h.stdout, /^⚠ src\/a\.mjs:15 ConditionalExpression no-coverage$/m);
  } finally { done(p); }
});

test('C2: only the first phase\'s files reach the tool, for JS, Go and Python', async () => {
  const cases = [
    ['js', 'stryker-mutation.json', (l) => { const a = l.find((x) => x.argv[0] === 'run').argv; return a[a.indexOf('--mutate') + 1]; }, 'src/a.mjs', true],
    ['go', 'gremlins.json', (l) => l.find((x) => x.argv[0] === 'unleash').argv.filter((a, i, all) => all[i - 1] === '--exclude-files').sort().join(' '), '^b\\.go$ ^c\\.go$', false],
    ['py', 'mutmut2-junit.xml', (l) => l.find((x) => x.argv[0] === 'run').argv.join(' '), 'run --paths-to-mutate src/a.py', false],
  ];
  for (const [kind, report, pick, want, nm] of cases) {
    const p = await rig(kind, { report, nodeModules: nm });
    try {
      const r = ac(p, ['mutate', '1']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(pick(logLines(p.log)), want, kind);
      assert.match(r.stdout, new RegExp(`^scope: ${{ js: 'src/a\\.mjs', go: 'a\\.go', py: 'src/a\\.py' }[kind]}$`, 'm'));
    } finally { done(p); }
  }
});

test('C3: Go -> gremlins, Python -> mutmut complete; mutation.tool overrides and says config', async () => {
  let p = await rig('go', { report: 'gremlins.json' });
  try {
    const r = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(r.tool.id, 'gremlins'); assert.equal(r.tool.why, 'go.mod → gremlins');
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 1, 'no-coverage': 1, error: 1 });
  } finally { done(p); }
  p = await rig('py', { report: 'mutmut2-junit.xml' });
  try {
    const r = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(r.tool.id, 'mutmut'); assert.equal(r.tool.why, 'pyproject.toml → mutmut');
    assert.deepEqual(r.counts, { killed: 1, survived: 1, timeout: 2, 'no-coverage': 0, error: 0 });
    // override: this Python project is told to use stryker -> config wins, detection no longer decides
    assert.equal(ac(p, ['config', 'set', 'mutation.tool', 'stryker']).status, 0);
    const o = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(o.tool.id, 'stryker'); assert.equal(o.tool.source, 'config'); assert.equal(o.outcome, 'no-scope', 'no .mjs files in a Python phase');
    assert.match(ac(p, ['mutate', '--check']).stdout, /config mutation\.tool/);
  } finally { done(p); }
});

test('C4: default cap 600; a 2s cap returns fast, capped, with not-run listed and no process left', async () => {
  let p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    assert.equal(JSON.parse(ac(p, ['mutate', '1', '--json']).stdout).cap_seconds, 600);
  } finally { done(p); }
  p = await rig('js', { report: 'stryker-partial.json', nodeModules: true, extra: { MUTATE_STUB_SLEEP: '60', MUTATE_STUB_CHILD: '1' } });
  try {
    ac(p, ['config', 'set', 'mutation.cap_seconds', '2']);
    const t0 = Date.now();
    const r = ac(p, ['mutate', '1', '--json']);
    assert.ok(Date.now() - t0 < 8000, `took ${Date.now() - t0}ms`);
    const res = JSON.parse(r.stdout);
    assert.equal(res.cap_seconds, 2); assert.equal(res.capped, true); assert.equal(res.outcome, 'incomplete');
    assert.ok(res.not_run.length > 0);
    const h = ac(p, ['mutate', '1']);
    assert.match(h.stdout, /^⚠ cap reached after 2s during step unknown — \d+ of \d+ mutants tested; raise for this phase: ac config set mutation\.phases\.1\.cap_seconds 4$/m);
    await new Promise((x) => setTimeout(x, 300));
    for (const pid of readFileSync(p.pids, 'utf8').split(' ').map(Number)) assert.equal(alive(pid), false);
  } finally { done(p); }
  p = await rig('js', { nodeModules: true });
  try {
    const body = { files: { 'src/a.mjs': { mutants: [1, 2, 3].map((i) => ({ id: String(i), mutatorName: 'X', location: { start: { line: i } }, status: 'Timeout' })) } } };
    writeFileSync(join(p.dir, 'rep.json'), JSON.stringify(body));
    p.env.MUTATE_STUB_REPORT = join(p.dir, 'rep.json');
    const res = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(res.outcome, 'clean'); assert.equal(res.counts.timeout, 3); assert.equal(res.survivors.length, 0);
    assert.match(ac(p, ['mutate', '1']).stdout, /^✓ Stryker/m);
  } finally { done(p); }
});

test('usage: unknown flags and unknown phases exit non-zero; --check takes an optional phase', async () => {
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    assert.notEqual(ac(p, ['mutate', '--bogus']).status, 0);
    assert.notEqual(ac(p, ['mutate', '1', '--bogus']).status, 0);
    assert.notEqual(ac(p, ['mutate', 'setup', '--bogus']).status, 0);
    assert.notEqual(ac(p, ['mutate', '99']).status, 0);
    assert.notEqual(ac(p, ['mutate']).status, 0);
    const c = ac(p, ['mutate', '--check', '1']);
    assert.equal(c.status, 0, c.stderr);
    assert.match(c.stdout, /^✓ Stryker \(package\.json → stryker\) 8\.2\.6 at node_modules\/\.bin\/stryker$/m);
    assert.equal(JSON.parse(ac(p, ['mutate', '--check', '--json']).stdout).outcome, 'ready');
  } finally { done(p); }
});

test('ac help lists all four forms', () => {
  const out = spawnSync(process.execPath, [AC, 'help'], { encoding: 'utf8' }).stdout;
  for (const form of ['ac mutate <phase> [--json]', 'ac mutate --check [<phase>] [--json]', 'ac mutate setup', 'ac mutate dismiss [<tool>]']) {
    assert.ok(out.includes(form), form);
  }
});

test('verdict record prints one stderr line per refused criterion', async () => {
  const p = await rig('js', { nodeModules: true });
  try {
    writeFileSync(join(p.dir, '.astrocode', 'phases', p.slug1, 'CRITERIA.md'), '### C1 [mutation] — strong\n- **Observe:** y\n');
    const r = ac(p, ['verdict', 'record', '1', '--result', JSON.stringify({ mode: 'full', criteria: [{ id: 'C1', passed: true }] })]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /⚠ C1 refused: marked \[mutation\] but no mutation evidence/);
  } finally { done(p); }
});

// ---- Phase 48 t10 — C10-C12 through the real CLI ----
import { mkdirSync, mkdtempSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

test('C10: with no tool, the hint matches the project (uv venv, pnpm, yarn), warns on pins, and changes nothing', async () => {
  const cases = [
    ['py', { '.venv/bin/python': '' }, 'uv pip install --python .venv/bin/python mutmut', null],
    ['py', { '.venv/bin/python': '', 'requirements.txt': 'mutmut==2.4.4\n' }, 'uv pip install --python .venv/bin/python mutmut', /requirements\.txt/],
    ['js', { 'pnpm-lock.yaml': 'lockfileVersion: 9\n' }, 'pnpm add -D @stryker-mutator/core', null],
    ['js', { 'yarn.lock': '# yarn\n' }, 'yarn add -D @stryker-mutator/core', null],
    ['js', { 'package-lock.json': '{}\n' }, 'npm i -D @stryker-mutator/core', null],
    ['py', { 'uv.lock': 'version = 1\n' }, 'pip install mutmut', /uv\.lock/],
  ];
  for (const [kind, files, want, warn] of cases) {
    const p = await makeProject(kind);
    const spyDir = mkdtempSync(join(tmpdir(), 'ac-hint-spy-'));
    const spyLog = join(spyDir, 'calls.log');
    for (const n of ['npm', 'pnpm', 'yarn', 'pip', 'uv', 'go']) {
      writeFileSync(join(spyDir, n), `#!/bin/sh\necho ${n} >> "${spyLog}"\nexit 1\n`);
      chmodSync(join(spyDir, n), 0o755);
    }
    try {
      for (const [f, body] of Object.entries(files)) { mkdirSync(dirname(join(p.dir, f)), { recursive: true }); writeFileSync(join(p.dir, f), body); }
      p.env = restrictedEnv([spyDir]);
      const hash = () => Object.fromEntries(Object.keys(files).map((f) => [f, createHash('sha256').update(readFileSync(join(p.dir, f))).digest('hex')]));
      const before = hash();
      for (const args of [['mutate', '1'], ['mutate', '--check']]) {
        const r = ac(p, args);
        assert.equal(r.status, 0, r.stderr);
        assert.ok(r.stdout.includes(`install: ${want}`), `${kind} ${JSON.stringify(files)}: ${r.stdout}`);
        if (warn) assert.match(r.stdout, new RegExp(`⚠ .*${warn.source}`));
        else assert.doesNotMatch(r.stdout, /⚠/);
      }
      assert.deepEqual(hash(), before);
      assert.equal(existsSync(spyLog), false, 'no package manager ran');
    } finally { done(p); rmSync(spyDir, { recursive: true, force: true }); }
  }
});

test('C11: an unconfigured mutmut 3 is reported as installed but not configured, in human and JSON, with no install hint', async () => {
  const p = await rig('py', { extra: { MUTATE_STUB_VERSION_CRASH: '1' } });
  try {
    for (const args of [['mutate', '1'], ['mutate', '--check']]) {
      const h = ac(p, args);
      assert.equal(h.status, 0, h.stderr);
      assert.match(h.stdout, /mutmut is installed but not configured — run: ac mutate setup/);
      assert.doesNotMatch(h.stdout, /not installed|install:/);
    }
    const j = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(j.outcome, 'not-configured');
    assert.equal(j.hint, 'ac mutate setup');
    assert.equal(existsSync(join(p.dir, '.astrocode', '.local', 'mutate-notices.json')), false);
  } finally { done(p); }
});

test('C12: ac mutate setup writes the 3.x keys under a 3.8 mutmut, the 2.x keys under 2.4, and a second run changes no byte', async () => {
  for (const [version, v2, want, deny] of [
    ['3.8.0', '0', /source_paths=src\/\npytest_add_cli_args_test_selection=tests\/\n/, /paths_to_mutate|tests_dir/],
    ['2.4.4', '1', /paths_to_mutate=src\/\ntests_dir=tests\/\n/, /source_paths/],
  ]) {
    const p = await rig('py', { version, extra: { MUTATE_STUB_V2_REAL: v2 } });
    try {
      const a = ac(p, ['mutate', 'setup']);
      assert.equal(a.status, 0, a.stderr);
      const text = readFileSync(join(p.dir, 'setup.cfg'), 'utf8');
      assert.match(text, want);
      assert.doesNotMatch(text, deny);
      const b = ac(p, ['mutate', 'setup']);
      assert.match(b.stdout, /left alone/);
      assert.equal(readFileSync(join(p.dir, 'setup.cfg'), 'utf8'), text);
    } finally { done(p); }
  }
  // an existing setup.cfg with deprecated keys, under 3.x: named, not rewritten
  const p = await rig('py', { version: '3.8.0', extra: { MUTATE_STUB_V2_REAL: '0' } });
  try {
    writeFileSync(join(p.dir, 'setup.cfg'), '[mutmut]\npaths_to_mutate=src/\ntests_dir=tests/\n');
    const r = ac(p, ['mutate', 'setup']);
    assert.match(r.stdout, /deprecated in mutmut 3: paths_to_mutate → source_paths, tests_dir → pytest_add_cli_args_test_selection/);
    assert.match(readFileSync(join(p.dir, 'setup.cfg'), 'utf8'), /paths_to_mutate=src\//);
    writeFileSync(join(p.dir, 'pyproject.toml'), '[tool.mutmut]\nsource_paths = ["src"]\n');
    rmSync(join(p.dir, 'setup.cfg'));
    const q = ac(p, ['mutate', 'setup']);
    assert.match(q.stdout, /pyproject\.toml has \[tool\.mutmut\]/);
    assert.equal(existsSync(join(p.dir, 'setup.cfg')), false, 'nothing written when pyproject owns the config');
  } finally { done(p); }
});

// ---- Phase 48 t11 — the per-phase cap through `ac config set`, and the log path last ----
test('C6/C7: ac config set mutation.phases.<n>.cap_seconds applies to that phase only; the human output ends with the log path', async () => {
  const p = await rig('js', { report: 'stryker-mutation.json', nodeModules: true });
  try {
    assert.equal(ac(p, ['config', 'set', 'mutation.phases.1.cap_seconds', '60']).status, 0);
    const one = JSON.parse(ac(p, ['mutate', '1', '--json']).stdout);
    assert.equal(one.cap.source, 'phase'); assert.equal(one.cap_seconds, 60);
    const two = JSON.parse(ac(p, ['mutate', '2', '--json']).stdout);
    assert.equal(two.cap.source, 'default'); assert.equal(two.cap_seconds, 600);
    const h = ac(p, ['mutate', '1']);
    const lines = h.stdout.trim().split('\n');
    assert.match(lines[lines.length - 1], /^log: \.astrocode\/\.local\/mutate-runs\/0?1-.*\.log$/);
  } finally { done(p); }
});
