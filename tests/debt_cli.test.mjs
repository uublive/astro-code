// Phase 55 t8 — the debt CLI end to end: `ac debt harvest`, `--stale` listing file-gone debt,
// and the `ac status` file-gone count. Always a scratch `git init` + `ac init` project, never
// this repo's own register. The marker word is assembled at run time (M) so no source line here
// carries a comment prefix directly before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
const M = 'short' + 'cut:';

const sh = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8' });
const ac = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
const put = (cwd, rel, text) => {
  mkdirSync(dirname(join(cwd, rel)), { recursive: true });
  writeFileSync(join(cwd, rel), text);
};

function scratch() {
  const cwd = mkdtempSync(join(tmpdir(), 'ac-debtcli-'));
  sh('git', ['init', '-q'], cwd);
  assert.equal(ac(cwd, 'init').status, 0);
  return cwd;
}
function harvestSetup() {
  const cwd = scratch();
  put(cwd, 'lib/a.mjs', `const a = 0\nconst x = 1 // ${M} linear scan, upgrade when n exceeds 1000\n`);
  put(cwd, 'run.sh', `x=1  # ${M} no retry on failure\n`);
  put(cwd, 'NOTES.md', `We took a ${M} none needed here.\n`);
  put(cwd, 'scratch.mjs', `// ${M} should never be harvested, upgrade never\n`);
  sh('git', ['add', 'lib/a.mjs', 'run.sh', 'NOTES.md'], cwd);
  return cwd;
}
const list = (cwd) => JSON.parse(ac(cwd, 'debt', 'list', '--json').stdout);

test('harvest files exactly the two tracked markers and flags the missing trigger', () => {
  const cwd = harvestSetup();
  const r = ac(cwd, 'debt', 'harvest');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /✓ debt \S+\s+lib\/a\.mjs:2\s+linear scan/);
  assert.match(r.stdout, /✓ debt \S+\s+run\.sh:1\s+no retry on failure/);
  assert.match(r.stdout, /⚠ no upgrade trigger/);
  assert.doesNotMatch(r.stdout, /NOTES\.md|scratch\.mjs/);
  const items = list(cwd);
  assert.equal(items.length, 2);
  assert.ok(items.every((d) => d.status === 'open'));
  assert.equal(items.find((d) => d.file === 'lib/a.mjs').why, 'upgrade when n exceeds 1000');
});

test('harvest --json is valid JSON naming the added entries', () => {
  const cwd = harvestSetup();
  const r = ac(cwd, 'debt', 'harvest', '--json');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.added.length, 2);
  assert.deepEqual(out.added.map((e) => e.file).sort(), ['lib/a.mjs', 'run.sh']);
  assert.equal(out.noTrigger.length, 1);
});

test('harvest is idempotent across a re-run and a line shift, and adds one new marker', () => {
  const cwd = harvestSetup();
  ac(cwd, 'debt', 'harvest');
  assert.match(ac(cwd, 'debt', 'harvest').stdout, /nothing new to harvest/);
  assert.equal(list(cwd).length, 2);
  put(cwd, 'lib/a.mjs', `\n\n\nconst a = 0\nconst x = 1 // ${M} linear scan, upgrade when n exceeds 1000\n`);
  sh('git', ['add', 'lib/a.mjs'], cwd);
  assert.equal(JSON.parse(ac(cwd, 'debt', 'harvest', '--json').stdout).added.length, 0);
  assert.equal(list(cwd).length, 2);
  put(cwd, 'b.mjs', `// ${M} cache in memory, upgrade when multi-process\n`);
  sh('git', ['add', 'b.mjs'], cwd);
  assert.equal(JSON.parse(ac(cwd, 'debt', 'harvest', '--json').stdout).added.length, 1);
  assert.equal(list(cwd).length, 3);
});

test('an unknown harvest flag dies', () => {
  const r = ac(harvestSetup(), 'debt', 'harvest', '--bogus');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unknown flag/);
});

function staleSetup() {
  const cwd = scratch();
  put(cwd, 'keep.mjs', 'x\n');
  mkdirSync(join(cwd, 'sub'));
  ac(cwd, 'debt', 'add', 'kept', '--file', 'keep.mjs');
  ac(cwd, 'debt', 'add', 'gone', '--file', 'gone.mjs');
  ac(cwd, 'debt', 'add', 'nofile');
  ac(cwd, 'debt', 'add', 'closed', '--file', 'gone2.mjs');
  const closed = list(cwd).find((d) => d.title === 'closed');
  assert.equal(ac(cwd, 'debt', 'drop', closed.id, '--reason', 'moved on').status, 0);
  return cwd;
}

test('--stale lists exactly the open debt whose file is gone, from the root and from a subdirectory', () => {
  const cwd = staleSetup();
  for (const dir of [cwd, join(cwd, 'sub')]) {
    const rows = JSON.parse(ac(dir, 'debt', 'list', '--stale', '--json').stdout);
    assert.deepEqual(rows.map((d) => d.title), ['gone']);
  }
  const plain = ac(cwd, 'debt', 'list', '--stale').stdout;
  assert.match(plain, /gone/);
  assert.match(plain, /⚠ file gone — gone\.mjs/);
  assert.doesNotMatch(plain, /kept|nofile/);
});

test('status counts file-gone debt, points at --stale, and goes silent once dropped', () => {
  const cwd = staleSetup();
  const st = ac(cwd, 'status').stdout;
  assert.match(st, /1 file gone/);
  assert.match(st, /ac debt list --stale/);
  const gone = list(cwd).find((d) => d.title === 'gone');
  ac(cwd, 'debt', 'drop', gone.id, '--reason', 'moved on');
  assert.doesNotMatch(ac(cwd, 'status').stdout, /file gone/);
});
