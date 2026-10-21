// Phase 47 t10 (test-after, by choice: it exercises t9's CLI end to end) — with no tool
// `ac mutate` installs nothing and never blocks (C5), suggests once per project per tool (C6),
// and only `ac mutate setup` ever writes tool config (C7). Real tmp projects, a restricted PATH
// holding logging package-manager stubs that exit 1, stdin closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync, statSync, mkdirSync, mkdtempSync, cpSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { makeProject, installStub, restrictedEnv, sh, FX } from './fixtures/mutate/project.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const run = (dir, env, args) => spawnSync(process.execPath, [AC, ...args], { cwd: dir, env, encoding: 'utf8', input: '', timeout: 60000 });
const done = (...ps) => ps.forEach((p) => rmSync(p.dir ?? p, { recursive: true, force: true }));
const INSTALL = {
  js: 'npm i -D @stryker-mutator/core',
  go: 'go install github.com/go-gremlins/gremlins/cmd/gremlins@latest',
  py: 'pip install mutmut',
};
const REMINDER = '⊡ mutation tool not installed — AI mutants used';

// Logging stubs for every package manager: they record the call and fail.
function spyBin() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-mutate-spy-'));
  const log = join(dir, 'calls.log');
  for (const n of ['npm', 'npx', 'yarn', 'pnpm', 'pip', 'pip3', 'go']) {
    writeFileSync(join(dir, n), `#!/bin/sh\necho "${n} $@" >> "${log}"\nexit 1\n`);
    chmodSync(join(dir, n), 0o755);
  }
  return { dir, log };
}

// Hash every file outside .git/.astrocode, plus git's own view of the tree.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      if (e === '.git' || e === '.astrocode') continue;
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else out[relative(dir, f)] = createHash('sha256').update(readFileSync(f)).digest('hex');
    }
  };
  walk(dir);
  return { files: out, status: sh(dir, 'status', '--porcelain', '--untracked-files=all').stdout };
}

test('C5: no tool installs nothing, never blocks, suggests the exact command and states the fallback', async () => {
  for (const kind of ['js', 'go', 'py']) {
    const p = await makeProject(kind);
    const spy = spyBin();
    try {
      mkdirSync(join(p.dir, 'node_modules'), { recursive: true });
      writeFileSync(join(p.dir, 'package-lock.json'), '{}\n');
      const env = restrictedEnv([spy.dir]);
      const before = snapshot(p.dir);
      const h = run(p.dir, env, ['mutate', '1']);
      assert.equal(h.status, 0, h.stderr);
      assert.ok(h.stdout.includes(INSTALL[kind]), `${kind}: ${h.stdout}`);
      const c = run(p.dir, env, ['mutate', '--check']);
      assert.equal(c.status, 0, c.stderr);
      assert.ok(c.stdout.includes(INSTALL[kind]));
      for (const args of [['mutate', '--check', '--json'], ['mutate', '1', '--json']]) {
        const r = run(p.dir, env, args);
        assert.equal(r.status, 0, r.stderr);
        const j = JSON.parse(r.stdout);
        assert.equal(j.outcome, 'tool-missing');
        assert.match(j.fallback.reason, /AI mutants used/);
      }
      assert.equal(existsSync(spy.log), false, 'no package manager was invoked');
      assert.deepEqual(snapshot(p.dir), before, 'manifests, lockfiles, node_modules and git status are unchanged');
      for (const other of Object.entries(INSTALL).filter(([k]) => k !== kind)) {
        assert.ok(!h.stdout.includes(other[1]), 'only this ecosystem\'s command');
      }
    } finally { done(p, spy.dir); }
  }
});

test('C6: full suggestion once per project per tool, remembered across processes and by dismissal', async () => {
  const a = await makeProject('js');
  const b = await makeProject('js');
  const g = await makeProject('go');
  const env = restrictedEnv([]);
  try {
    const r1 = JSON.parse(run(a.dir, env, ['mutate', '1', '--json']).stdout);
    assert.equal(r1.notice, 'full'); assert.equal(r1.suggestion.install, INSTALL.js);
    const r2 = run(a.dir, env, ['mutate', '1']);
    assert.equal(r2.stdout.trim(), REMINDER, 'exactly one reminder line');
    assert.ok(!r2.stdout.includes('npm i'));
    const r3 = JSON.parse(run(a.dir, env, ['mutate', '1', '--json']).stdout);
    assert.equal(r3.notice, 'reminder'); assert.equal(r3.suggestion, undefined);
    assert.equal(r3.fallback.reason, 'mutation tool not installed — AI mutants used');
    assert.ok(run(a.dir, env, ['mutate', '--check']).stdout.includes(INSTALL.js), '--check always shows it');
    assert.equal(run(a.dir, env, ['mutate', '1']).stdout.trim(), REMINDER, '--check did not touch the memory');

    // a second project: dismiss first, then only the reminder
    const d = run(b.dir, env, ['mutate', 'dismiss']);
    assert.equal(d.status, 0, d.stderr);
    assert.match(d.stdout, /install suggestion dismissed for stryker/);
    assert.equal(run(b.dir, env, ['mutate', '1']).stdout.trim(), REMINDER);

    // Go on the same machine has its own first-time suggestion
    assert.ok(run(g.dir, env, ['mutate', '1']).stdout.includes(INSTALL.go));

    // a copy whose memory was never written shows it again
    const copy = mkdtempSync(join(tmpdir(), 'ac-mutate-copy-'));
    cpSync(a.dir, copy, { recursive: true, filter: (s) => !s.includes('.local') });
    assert.ok(run(copy, env, ['mutate', '1']).stdout.includes(INSTALL.js));
    done(copy);
    const ignored = sh(a.dir, 'check-ignore', '-q', '.astrocode/.local/mutate-notices.json').status;
    assert.equal(ignored, 0, 'the memory is never committed');
  } finally { done(a, b, g); }
});

test('C7: running and checking change nothing; setup is the only writer, parses, and the next run uses it', async () => {
  for (const kind of ['js', 'go', 'py']) {
    const p = await makeProject(kind);
    const logs = mkdtempSync(join(tmpdir(), 'ac-mutate-logs-'));
    try {
      const name = { js: 'stryker', go: 'gremlins', py: 'mutmut' }[kind];
      const bin = installStub(logs, name);
      const report = { js: 'stryker-mutation.json', go: 'gremlins.json', py: 'mutmut2-junit.xml' }[kind];
      const log = join(logs, 'stub.log');
      const env = restrictedEnv([bin], { MUTATE_STUB_LOG: log, MUTATE_STUB_REPORT: join(FX, report) });
      const manifest = p.L.manifest[0];
      const before = snapshot(p.dir);
      assert.equal(run(p.dir, env, ['mutate', '--check']).status, 0);
      assert.equal(run(p.dir, env, ['mutate', '1']).status, 0);
      assert.deepEqual(snapshot(p.dir), before, `${kind}: nothing outside .astrocode changed, no config appeared`);

      const s = run(p.dir, env, ['mutate', 'setup']);
      assert.equal(s.status, 0, s.stderr);
      assert.match(s.stdout, /^✓ wrote /);
      const file = { js: 'stryker.config.json', go: '.gremlins.yaml', py: 'setup.cfg' }[kind];
      const text = readFileSync(join(p.dir, file), 'utf8');
      if (kind === 'js') {
        const cfg = JSON.parse(text);
        assert.ok(cfg.mutate.length && !cfg.dependencies && !cfg.devDependencies);
      } else if (kind === 'go') {
        for (const l of text.split('\n').filter((x) => x.trim() && !x.startsWith('#'))) assert.match(l, /^\s*[\w-]+:( .+)?$/);
      } else {
        assert.match(text, /^\[mutmut\]$/m); assert.match(text, /^paths_to_mutate=/m);
      }
      assert.equal(readFileSync(join(p.dir, manifest), 'utf8'), p.L.manifest[1], 'manifest untouched');

      // the next run sees the config: passed explicitly (stryker) or read from cwd
      sh(p.dir, 'add', '-A'); sh(p.dir, 'commit', '-q', '-m', 'chore: tool config');
      writeFileSync(log, '');
      assert.equal(run(p.dir, env, ['mutate', '1']).status, 0);
      const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const call = calls.find((c) => c.argv[0] === 'run' || c.argv[0] === 'unleash');
      assert.ok(call.configs.includes(file), `${kind}: config visible from the tool's cwd`);
      if (kind === 'js') assert.equal(call.argv[1], 'stryker.config.json', 'passed explicitly');

      // a second setup leaves it alone
      const again = run(p.dir, env, ['mutate', 'setup']);
      assert.match(again.stdout, /exists — left alone/);
      assert.equal(readFileSync(join(p.dir, file), 'utf8'), text);
    } finally { done(p, logs); }
  }
});

test('C7: setup never overwrites an existing setup.cfg; it prints the snippet instead', async () => {
  const p = await makeProject('py');
  try {
    writeFileSync(join(p.dir, 'setup.cfg'), '[metadata]\nname = p\n');
    const r = run(p.dir, restrictedEnv([]), ['mutate', 'setup']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /left alone/); assert.match(r.stdout, /\[mutmut\]/);
    assert.equal(readFileSync(join(p.dir, 'setup.cfg'), 'utf8'), '[metadata]\nname = p\n');
  } finally { done(p); }
});
