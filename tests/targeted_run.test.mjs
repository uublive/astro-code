// ADR-094 (phase 57 t7): a targeted run is a suite receipt with a narrower command, plus captured output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const TPL = 'node --test {files}';
// Under `node --test` the child runner inherits NODE_TEST_CONTEXT and reports every file as passing; a real
// `ac` run never has it, so the injected spawn strips it.
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV });

// Two test files; each appends its own name to a marker OUTSIDE the repo, b can be made red by a flag file.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-trun-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-trun-out-'));
  const marker = join(out, 'runs');
  writeFileSync(marker, '');
  const flag = join(out, 'red');
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  put(dir, '.astrocode/.local/.gitignore', '*\n');
  put(dir, 'tests/a.test.mjs', `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'a\\n');\n`);
  put(dir, 'tests/b.test.mjs', `import { appendFileSync, existsSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'b\\n');\nif (existsSync(${JSON.stringify(flag)})) process.exit(1);\n`);
  commit(dir, 'init');
  return { dir, marker, flag, runs: () => readFileSync(marker, 'utf8').split('\n').filter(Boolean) };
}
const FILES = ['tests/a.test.mjs', 'tests/b.test.mjs'];

test('a green set writes one receipt; a second call at the same clean HEAD is reused and runs nothing', async () => {
  const { runTargeted, receiptDir } = await import('../lib/receipts.mjs');
  const r = repo();
  const first = runTargeted(r.dir, FILES, TPL, { spawn });
  assert.equal(first.passed, true);
  assert.equal(first.reused, false);
  assert.equal(readdirSync(receiptDir(r.dir)).length, 1);
  const n = r.runs().length;
  const second = runTargeted(r.dir, FILES, TPL, { spawn });
  assert.equal(second.reused, true);
  assert.equal(second.passed, true);
  assert.equal(r.runs().length, n, 'the marker is unchanged');
});

test('a red set runs each file alone and failing names exactly the red one', async () => {
  const { runTargeted } = await import('../lib/receipts.mjs');
  const r = repo();
  writeFileSync(r.flag, '');
  const res = runTargeted(r.dir, FILES, TPL, { spawn });
  assert.equal(res.passed, false);
  assert.deepEqual(res.failing, ['tests/b.test.mjs']);
});

test('targetedEvidence: not run, failed on a red run, ok on a green run, not run after a new commit', async () => {
  const { runTargeted, targetedEvidence } = await import('../lib/receipts.mjs');
  const r = repo();
  const sha7 = () => sh(r.dir, 'rev-parse', '--short=7', 'HEAD').stdout.trim();
  let ev = targetedEvidence(r.dir, FILES, TPL);
  assert.equal(ev.ok, false);
  assert.match(ev.reason, new RegExp(`^targeted tests were not run on ${sha7()}`));
  writeFileSync(r.flag, '');
  runTargeted(r.dir, FILES, TPL, { spawn });
  ev = targetedEvidence(r.dir, FILES, TPL);
  assert.equal(ev.reason, `targeted tests failed on ${sha7()}: tests/b.test.mjs`);
  spawnSync('rm', ['-f', r.flag]);
  put(r.dir, 'x.txt', 'x');
  commit(r.dir, 'next');
  runTargeted(r.dir, FILES, TPL, { spawn });
  ev = targetedEvidence(r.dir, FILES, TPL);
  assert.equal(ev.ok, true);
  assert.equal(ev.receipt.exit, 0);
  put(r.dir, 'y.txt', 'y');
  commit(r.dir, 'newer');
  assert.match(targetedEvidence(r.dir, FILES, TPL).reason, /^targeted tests were not run on/);
});

test('a dirty tree is refused through the receipt\'s own reason', async () => {
  const { runTargeted, targetedEvidence } = await import('../lib/receipts.mjs');
  const r = repo();
  put(r.dir, 'dirty.txt', 'd');
  runTargeted(r.dir, FILES, TPL, { spawn });
  const ev = targetedEvidence(r.dir, FILES, TPL);
  assert.equal(ev.ok, false);
  assert.match(ev.reason, /dirty/);
});

test('runSuite with capture returns the output and writes a receipt without it', async () => {
  const { runSuite, receiptDir } = await import('../lib/receipts.mjs');
  const r = repo();
  const rc = runSuite(r.dir, 'echo hello-out; echo hello-err 1>&2', { capture: true });
  assert.match(rc.output, /hello-out/);
  assert.match(rc.output, /hello-err/);
  const file = readdirSync(receiptDir(r.dir))[0];
  const stored = JSON.parse(readFileSync(join(receiptDir(r.dir), file), 'utf8'));
  assert.equal(stored.output, undefined);
  assert.equal(stored.exit, 0);
});
