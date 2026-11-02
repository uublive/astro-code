// Phase 55 t7 — `harvestDebt` files comment-anchored markers from TRACKED files as debt, and is
// idempotent (identity is file + marker text, never the line). Real temp git repo, real planning
// dir. The marker word is assembled at run time (M below) so no source line of THIS file carries
// a comment prefix directly before it; the last test scans this very file to prove that.
// New exports are reached through `await import` (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { loadDebt, dropDebt } from '../lib/debt.mjs';

const M = 'short' + 'cut:';
const HERE = dirname(fileURLToPath(import.meta.url));

function repo() {
  const root = mkdtempSync(join(tmpdir(), 'ac-harvest-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  initPlanning(root, { name: 'harvestdemo' });
  return root;
}
const put = (root, rel, text, { track = true } = {}) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
  if (track) spawnSync('git', ['add', rel], { cwd: root });
};
const count = (root) => loadDebt(root).debt.length;

test('scanShortcuts matches each comment prefix at line start or after whitespace only', async () => {
  const { scanShortcuts } = await import('../lib/debt.mjs');
  const text = [
    `a // ${M} one, upgrade when two`,
    `# ${M} three`,
    `x /* ${M} four, when five */`,
    `-- ${M} six`,
    `a ; ${M} seven`,
    `//${M} eight`,
  ].join('\n');
  const found = scanShortcuts(text);
  assert.deepEqual(found.map((f) => f.line), [1, 2, 3, 4, 5, 6]);
  assert.equal(found[2].marker, 'four, when five');
  assert.equal(found[2].title, 'four');
  assert.equal(found[2].trigger, 'when five');
  assert.equal(found[1].trigger, '');
});

test('scanShortcuts ignores prose, urls, glued prefixes and backtick-quoted markers', async () => {
  const { scanShortcuts } = await import('../lib/debt.mjs');
  const text = [
    `We took a ${M} none needed here.`,
    `see http://x ${M}`,
    `a--b ${M} nope`,
    `x=1;${M} glued`,
    `use \`// ${M} quoted, never\``,
  ].join('\n');
  assert.deepEqual(scanShortcuts(text), []);
});

test('harvestDebt files tracked markers with file, 1-based line, title and trigger', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = repo();
  put(root, 'lib/a.mjs', `const a = 0\nconst x = 1 // ${M} linear scan, upgrade when n exceeds 1000\n`);
  put(root, 'run.sh', `x=1  # ${M} no retry on failure\n`);
  put(root, 'NOTES.md', `We took a ${M} none needed here.\n`);
  put(root, 'scratch.mjs', `// ${M} never harvested, upgrade never\n`, { track: false });
  put(root, 'ignored.mjs', `// ${M} ignored, upgrade never\n`, { track: false });
  writeFileSync(join(root, '.gitignore'), 'ignored.mjs\n');
  const res = await harvestDebt(root);
  assert.equal(res.added.length, 2);
  assert.equal(res.already, 0);
  const a = res.added.find((e) => e.file === 'lib/a.mjs');
  assert.equal(a.title, 'linear scan');
  assert.equal(a.why, 'upgrade when n exceeds 1000');
  assert.equal(a.line, 2);
  assert.equal(a.status, 'open');
  const sh = res.added.find((e) => e.file === 'run.sh');
  assert.match(sh.why, /no upgrade trigger/);
  assert.deepEqual(res.noTrigger, [sh.id]);
  assert.equal(count(root), 2);
});

test('binary, oversize and tracked-but-deleted files are skipped silently', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = repo();
  put(root, 'bin.dat', `\0 // ${M} binary, upgrade never\n`);
  put(root, 'big.txt', `// ${M} huge, upgrade never\n` + 'x'.repeat(1_100_000));
  put(root, 'gone.mjs', `// ${M} deleted, upgrade never\n`);
  rmSync(join(root, 'gone.mjs'));
  assert.equal((await harvestDebt(root)).added.length, 0);
});

test('a second run adds nothing, and a line shift is not a new item', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = repo();
  put(root, 'lib/a.mjs', `const x = 1 // ${M} linear scan, upgrade when n exceeds 1000\n`);
  assert.equal((await harvestDebt(root)).added.length, 1);
  const again = await harvestDebt(root);
  assert.equal(again.added.length, 0);
  assert.equal(again.already, 1);
  put(root, 'lib/a.mjs', `\n\n\nconst x = 1 // ${M} linear scan, upgrade when n exceeds 1000\n`);
  assert.equal((await harvestDebt(root)).added.length, 0);
  assert.equal(count(root), 1);
});

test('a new marker beside old ones adds exactly one entry', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = repo();
  put(root, 'a.mjs', `// ${M} one, upgrade when two\n`);
  await harvestDebt(root);
  put(root, 'b.mjs', `// ${M} cache in memory, upgrade when multi-process\n`);
  const res = await harvestDebt(root);
  assert.equal(res.added.length, 1);
  assert.equal(res.added[0].file, 'b.mjs');
  assert.equal(count(root), 2);
});

test('a marker whose entry was dropped is not re-filed', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = repo();
  put(root, 'a.mjs', `// ${M} one, upgrade when two\n`);
  const first = await harvestDebt(root);
  await dropDebt(root, first.added[0].id, { reason: 'accepted' });
  assert.equal((await harvestDebt(root)).added.length, 0);
  assert.equal(count(root), 1);
});

test('outside a git repository harvestDebt throws a clear error', async () => {
  const { harvestDebt } = await import('../lib/debt.mjs');
  const root = mkdtempSync(join(tmpdir(), 'ac-harvest-nogit-'));
  initPlanning(root, { name: 'nogit' });
  await assert.rejects(() => harvestDebt(root), /git repository/);
});

test('the scanner finds nothing in its own source, the executor prompt or this test', async () => {
  const { scanShortcuts } = await import('../lib/debt.mjs');
  for (const rel of ['../lib/debt.mjs', '../agents/astro-executor.md', 'debt_harvest.test.mjs']) {
    assert.deepEqual(scanShortcuts(readFileSync(join(HERE, rel), 'utf8')), [], rel);
  }
});
