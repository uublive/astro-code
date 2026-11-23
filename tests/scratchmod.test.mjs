// Phase 59 t6 — a scratch git repo of a subfolder Go module, for Gremlins' --diff. Real git, no `go`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { scratchModule } from '../lib/scratchmod.mjs';

const home = mkdtempSync(join(tmpdir(), 'scr-home-'));
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
const GO = Array.from({ length: 12 }, (_, i) => `func f${i}(a int) int { return a + ${i} }`).join('\n');

function repo(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'scr-'));
  git(root, 'init', '-q');
  mkdirSync(join(root, 'svc'));
  writeFileSync(join(root, 'svc', 'go.mod'), 'module example.com/svc\n\ngo 1.21\n');
  writeFileSync(join(root, 'svc', 'main.go'), `package svc\n${GO}\n`);
  for (const [p, c] of Object.entries(extra)) writeFileSync(join(root, p), c);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return { root, base: git(root, 'rev-parse', 'HEAD') };
}
const change = (root) => {
  writeFileSync(join(root, 'svc', 'main.go'), readFileSync(join(root, 'svc', 'main.go'), 'utf8').replace('a + 3', 'a - 3'));
  git(root, 'commit', '-q', '-am', 'phase');
};

test('the scratch diff has exactly the repo hunks, module-relative, and its files equal HEAD:svc', () => {
  const { root, base } = repo();
  change(root);
  const into = mkdtempSync(join(tmpdir(), 'scr-into-'));
  const r = scratchModule(root, { modDir: 'svc', base, into });
  assert.equal(r.ok, true, r.reason);
  const scratch = git(r.dir, 'diff', '--unified=0', r.base, 'HEAD');
  const real = git(root, 'diff', '--unified=0', base, 'HEAD', '--', 'svc');
  const hdr = (t) => t.split('\n').filter((l) => l.startsWith('@@')).map((l) => l.replace(/ @@.*$/, ''));
  assert.deepEqual(hdr(scratch), hdr(real));
  assert.match(scratch, /diff --git a\/main\.go b\/main\.go/);
  assert.equal(readFileSync(join(r.dir, 'main.go'), 'utf8'), git(root, 'show', 'HEAD:svc/main.go') + '\n');
});

test('a module that is new at the base gives a whole-file diff', () => {
  const root = mkdtempSync(join(tmpdir(), 'scr-'));
  git(root, 'init', '-q');
  writeFileSync(join(root, 'README'), 'x');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  mkdirSync(join(root, 'svc'));
  writeFileSync(join(root, 'svc', 'go.mod'), 'module example.com/svc\n');
  writeFileSync(join(root, 'svc', 'main.go'), `package svc\n${GO}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'phase');
  const r = scratchModule(root, { modDir: 'svc', base, into: mkdtempSync(join(tmpdir(), 'scr-into-')) });
  assert.equal(r.ok, true, r.reason);
  assert.match(git(r.dir, 'diff', '--unified=0', r.base, 'HEAD'), /\+\+\+ b\/main\.go\n@@ -0,0 \+1,13 @@/);
});

test('each soundness gate returns ok:false naming its reason', () => {
  const cases = [
    ['go.work', { 'go.work': 'go 1.21\nuse ./svc\n' }, /go\.work/],
    ['replace', { 'svc/go.mod': 'module example.com/svc\n\nreplace x => ../shared\n' }, /replace/],
    ['embed', { 'svc/embed.go': 'package svc\n\n//go:embed ../x\nvar x string\n' }, /go:embed/],
  ];
  for (const [name, files, re] of cases) {
    const { root, base } = repo(files);
    change(root);
    const r = scratchModule(root, { modDir: 'svc', base, into: mkdtempSync(join(tmpdir(), 'scr-into-')) });
    assert.equal(r.ok, false, name);
    assert.match(r.reason, re, name);
  }
});

test('a module whose HEAD equals its base has an empty diff and is refused', () => {
  const { root, base } = repo();
  writeFileSync(join(root, 'other.txt'), 'x');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'unrelated');
  const r = scratchModule(root, { modDir: 'svc', base, into: mkdtempSync(join(tmpdir(), 'scr-into-')) });
  assert.equal(r.ok, false);
  assert.match(r.reason, /empty/);
});

test('commits work with no global git identity and nothing is written outside into', () => {
  const { root, base } = repo();
  change(root);
  const before = git(root, 'status', '--porcelain');
  const into = mkdtempSync(join(tmpdir(), 'scr-into-'));
  const oldHome = process.env.HOME;
  process.env.HOME = mkdtempSync(join(tmpdir(), 'scr-nohome-'));
  try {
    const r = scratchModule(root, { modDir: 'svc', base, into });
    assert.equal(r.ok, true, r.reason);
  } finally { process.env.HOME = oldHome; }
  assert.deepEqual(readdirSync(into), ['mod']);
  assert.equal(git(root, 'status', '--porcelain'), before);
});
