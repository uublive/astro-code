// ADR-094 (phase 57 t15): fast mode through the real CLI in a real tmp git project with no verify setting.
// The C3 layout: the phase changes src/a.mjs and adds tests/d.test.mjs; a.test.mjs can be made red by a flag
// file; the suite criterion's command appends SUITE to a log outside the repo (it must never run).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initPlanning } from '../lib/planning.mjs';
import { addPhase, findPhase } from '../lib/roadmap.mjs';

const AC = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ac.mjs');
// `ac` spawns `node --test` itself; under this runner NODE_TEST_CONTEXT would make every file read as passing.
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const ac = (cwd, ...a) => spawnSync(process.execPath, [AC, ...a], { cwd, encoding: 'utf8', env: { ...CLEAN_ENV, ASTRO_SIGNER_AGENT: '' } });
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
const PASS = (extra = []) => JSON.stringify({ mode: 'full', criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }, ...extra] });

async function project({ docsOnly = false, phases = 1 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vfast-cli-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-vfast-cli-out-'));
  const log = join(out, 'log');
  const flag = join(out, 'red');
  writeFileSync(log, '');
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  initPlanning(dir, { name: 'fproj' });
  for (let n = 1; n <= phases; n += 1) await addPhase(dir, { number: n, name: `Phase ${n}`, milestone: 1 });
  const slugs = Array.from({ length: phases }, (_, i) => findPhase(dir, String(i + 1)).slug);
  const crit = [
    '### C1 — a', '- **Observe:** `src/a.mjs` behaves', '',
    '### C2 — b', '- **Observe:** `src/b.mjs` behaves', '',
    '### C3 [suite] — the suite', `- **Observe:** \`echo SUITE >> '${log}'\``, '',
  ].join('\n');
  for (const s of slugs) put(dir, `.astrocode/phases/${s}/CRITERIA.md`, crit);
  const logTest = (name) => `import { appendFileSync, existsSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, '${name}\\n');\nif ('${name}' === 'a' && existsSync(${JSON.stringify(flag)})) process.exit(1);\n`;
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'src/b.mjs', 'export const b = 1;\n');
  put(dir, 'tests/a.test.mjs', `import '../src/a.mjs';\n${logTest('a')}`);
  put(dir, 'tests/b.test.mjs', `import '../src/b.mjs';\n${logTest('b')}`);
  put(dir, 'tests/c.test.mjs', "import 'node:test';\n");
  commit(dir, 'init');
  for (let n = 1; n <= phases; n += 1) {
    if (docsOnly || n > 1) { put(dir, `docs${n}.md`, 'docs\n'); commit(dir, `docs (phase ${n} t1)`); } else {
      put(dir, 'src/a.mjs', 'export const a = 2;\n');
      put(dir, 'tests/d.test.mjs', `import 'node:test';\n${logTest('d')}`);
      commit(dir, 'feat (phase 1 t1)');
    }
  }
  return { dir, flag, slugs, log, lines: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('C1/C3: verdict cheap runs the targeted set (never the suite), twice the same, with the limits line', async () => {
  const p = await project();
  const a = JSON.parse(ac(p.dir, 'verdict', 'cheap', '1', '--json').stdout);
  const b = JSON.parse(ac(p.dir, 'verdict', 'cheap', '1', '--json').stdout);
  assert.deepEqual(a.fast.tests, ['tests/a.test.mjs', 'tests/d.test.mjs']);
  assert.deepEqual(b.fast.tests, a.fast.tests);
  assert.ok(!p.lines().includes('SUITE'));
  assert.deepEqual(a.fast.milestone, ['C3']);
  assert.ok(a.fast.limits.includes('one hop'));
  const text = ac(p.dir, 'verdict', 'cheap', '1').stdout;
  assert.equal(text.split('\n').filter((l) => /^[•✖] fast mode:/.test(l)).length, 1, text);
  assert.equal(text.split('\n').filter((l) => l.startsWith('• limits:')).length, 1, text);
  assert.ok(JSON.parse(ac(p.dir, 'verdict', 'plan', '1', '--json').stdout).fast.tests.length === 2);
});

test('C4: a docs-only phase prints no linked tests, runs no test, records a PASS and verifies', async () => {
  const p = await project({ docsOnly: true });
  const r = ac(p.dir, 'verdict', 'cheap', '1');
  assert.match(r.stdout, /no linked tests/);
  assert.deepEqual(p.lines(), []);
  const rec = ac(p.dir, 'verdict', 'record', '1', '--result', PASS());
  assert.equal(rec.status, 0, rec.stderr);
  assert.equal(JSON.parse(rec.stdout).passed, true);
  const v = ac(p.dir, 'phase', 'verify', '1');
  assert.equal(v.status, 0, v.stderr);
});

test('C5: red refuses with the file named, green after a fresh cheap pass is accepted, a new commit is refused again', async () => {
  const p = await project();
  writeFileSync(p.flag, '');
  assert.equal(ac(p.dir, 'verdict', 'cheap', '1').status, 1);
  const red = ac(p.dir, 'verdict', 'record', '1', '--result', PASS());
  assert.equal(red.status, 1);
  assert.match(red.stderr, /⚠ fast PASS refused: .*tests\/a\.test\.mjs/);
  const refused = ac(p.dir, 'phase', 'verify', '1');
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /tests\/a\.test\.mjs/);
  spawnSync('rm', ['-f', p.flag]);
  assert.equal(ac(p.dir, 'verdict', 'cheap', '1').status, 0);
  assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', PASS()).status, 0);
  assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
  put(p.dir, 'src/a.mjs', 'export const a = 3;\n');
  commit(p.dir, 'feat more (phase 1 t2)');
  const stale = ac(p.dir, 'verdict', 'record', '1', '--result', PASS());
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /fast PASS refused: targeted tests were not run on/);
});

test('C6: with verify.full_suite phase the suite path is unchanged and nothing is marked pending', async () => {
  const p = await project();
  assert.equal(ac(p.dir, 'config', 'set', 'verify.full_suite', 'phase').status, 0);
  commit(p.dir, 'config');
  const cheap = JSON.parse(ac(p.dir, 'verdict', 'cheap', '1', '--json').stdout);
  assert.equal(cheap.fast, undefined);
  assert.equal(cheap.held.length + cheap.ran.filter((x) => x.kind === 'suite').length, 1, 'the suite ran or was held');
  const rec = ac(p.dir, 'verdict', 'record', '1', '--result', PASS());
  assert.deepEqual(JSON.parse(rec.stdout).failing, ['C3'], 'a PASS without the suite criterion is refused');
  assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', PASS([{ id: 'C3', passed: true, suite: true }])).status, 0);
  assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
  assert.equal(ac(p.dir, 'phase', 'accept', '1', '--agent', 'test').status, 0);
  assert.doesNotMatch(ac(p.dir, 'status').stdout, /full check pending/);
});

test('C7 and C12: status, phase show and phase accept show --agent claude the marker; only the LAST accept proposes the check, and starts nothing', async () => {
  const p = await project({ docsOnly: true, phases: 2 });
  for (const n of [1, 2]) {
    assert.equal(ac(p.dir, 'verdict', 'record', String(n), '--result', PASS()).status, 0);
    assert.equal(ac(p.dir, 'phase', 'verify', String(n)).status, 0);
  }
  assert.match(ac(p.dir, 'status').stdout, /01 +verified .*fast-verified, full check pending/);
  assert.equal(JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout).full_check_pending, true);
  const first = ac(p.dir, 'phase', 'accept', '1', '--agent', 'test');
  assert.match(first.stdout, /full check pending/);
  assert.doesNotMatch(first.stdout, /ac milestone verify/);
  const last = ac(p.dir, 'phase', 'accept', '2', '--agent', 'test');
  assert.equal(last.stdout.split('\n').filter((l) => l.includes('ac milestone verify')).length, 1, last.stdout);
  assert.equal(existsSync(join(p.dir, '.astrocode', '.local', 'full-checks')), false, 'nothing was started');
});

test('C14: a verdict recorded without fast shows no marker', async () => {
  const p = await project({ docsOnly: true });
  assert.equal(ac(p.dir, 'config', 'set', 'verify.full_suite', 'phase').status, 0);
  commit(p.dir, 'config');
  assert.equal(ac(p.dir, 'verdict', 'record', '1', '--result', PASS([{ id: 'C3', passed: true, suite: true }])).status, 0);
  assert.equal(ac(p.dir, 'config', 'set', 'verify.full_suite', 'milestone').status, 0);
  commit(p.dir, 'config back');
  assert.equal(ac(p.dir, 'phase', 'verify', '1').status, 0);
  assert.doesNotMatch(ac(p.dir, 'status').stdout, /full check pending/);
  assert.equal(JSON.parse(ac(p.dir, 'phase', 'show', '1').stdout).full_check_pending, undefined);
});
