// ADR-094 (phase 57 t9): the verdict engine in fast mode (the default). A real scratch git repo, no verify
// setting, the C3 layout; recordVerdict, verifiedGate and planReverify through dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '07-x';
const TPL = 'node --test {files}';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), body); };
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-qm', msg); };
// Under `node --test` a child runner inherits NODE_TEST_CONTEXT and reports every file as passing.
const { NODE_TEST_CONTEXT, ...CLEAN_ENV } = process.env;
const spawn = (cmd, o) => spawnSync(cmd, { ...o, env: CLEAN_ENV });
const CRIT = [
  '### C1 — a', '- **Observe:** `src/a.mjs` behaves', '',
  '### C2 — b', '- **Observe:** `src/b.mjs` behaves', '',
  '### C3 [suite] — the suite', '- **Observe:** `npm test` is green', '',
].join('\n');
const PASS12 = { mode: 'full', criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }] };

// The C3 layout: the phase changes src/a.mjs and adds tests/d.test.mjs; a.test.mjs can be made red by a flag.
async function repo({ setting, docsOnly = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-vfast-'));
  const out = mkdtempSync(join(tmpdir(), 'ac-vfast-out-'));
  const flag = join(out, 'red');
  sh(dir, 'init', '-q');
  sh(dir, 'config', 'user.email', 't@t');
  sh(dir, 'config', 'user.name', 't');
  if (setting) put(dir, '.astrocode/config.json', JSON.stringify({ verify: setting }));
  put(dir, `.astrocode/phases/${SLUG}/CRITERIA.md`, CRIT);
  put(dir, '.astrocode/.local/.gitignore', '*\n');
  put(dir, 'src/a.mjs', 'export const a = 1;\n');
  put(dir, 'src/b.mjs', 'export const b = 1;\n');
  put(dir, 'tests/a.test.mjs', `import '../src/a.mjs';\nimport { existsSync } from 'node:fs';\nif (existsSync(${JSON.stringify(flag)})) process.exit(1);\n`);
  put(dir, 'tests/b.test.mjs', "import '../src/b.mjs';\n");
  put(dir, 'tests/c.test.mjs', "import 'node:test';\n");
  commit(dir, 'init');
  if (docsOnly) {
    put(dir, 'README.md', 'docs\n');
    commit(dir, 'docs (phase 07 t1)');
  } else {
    put(dir, 'src/a.mjs', 'export const a = 2;\n');
    put(dir, 'tests/d.test.mjs', "import 'node:test';\n");
    commit(dir, 'feat (phase 07 t1)');
  }
  return { dir, flag };
}
const A = ['tests/a.test.mjs', 'tests/d.test.mjs'];

test('C5 red: a red targeted set refuses the PASS, names the file, and the gate refuses with it', async () => {
  const { recordVerdict, verifiedGate } = await import('../lib/verdict.mjs');
  const { runTargeted } = await import('../lib/receipts.mjs');
  const r = await repo();
  writeFileSync(r.flag, '');
  assert.equal(runTargeted(r.dir, A, TPL, { spawn }).passed, false);
  const out = await recordVerdict(r.dir, SLUG, PASS12);
  assert.equal(out.passed, false);
  assert.match(out.fast_refused, /tests\/a\.test\.mjs/);
  const gate = verifiedGate(r.dir, SLUG);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /tests\/a\.test\.mjs/);
});

test('C5 green: a fresh green receipt passes, C3 is carried to the milestone check, no suite receipt anywhere', async () => {
  const { recordVerdict, verifiedGate, fastVerdictOf } = await import('../lib/verdict.mjs');
  const { runTargeted } = await import('../lib/receipts.mjs');
  const r = await repo();
  assert.equal(runTargeted(r.dir, A, TPL, { spawn }).passed, true);
  const out = await recordVerdict(r.dir, SLUG, PASS12);
  assert.equal(out.passed, true, JSON.stringify(out));
  const v = JSON.parse(readFileSync(join(r.dir, '.astrocode/phases', SLUG, 'VERDICT.json'), 'utf8'));
  const c3 = v.criteria.find((c) => c.id === 'C3');
  assert.equal(c3.status, 'carried');
  assert.equal(c3.full_check, 'milestone');
  assert.deepEqual(v.base && { run: v.base.run, fast: v.base.fast }, { run: 1, fast: true });
  assert.deepEqual(verifiedGate(r.dir, SLUG), { ok: true, reason: null });
  assert.deepEqual(fastVerdictOf(r.dir, SLUG).tests, A);
});

test('C5 stale: a new stamped commit with no new cheap run is refused as not run on the new commit', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const { runTargeted } = await import('../lib/receipts.mjs');
  const r = await repo();
  runTargeted(r.dir, A, TPL, { spawn });
  put(r.dir, 'src/a.mjs', 'export const a = 3;\n');
  commit(r.dir, 'feat more (phase 07 t2)');
  const sha7 = sh(r.dir, 'rev-parse', '--short=7', 'HEAD').stdout.trim();
  const out = await recordVerdict(r.dir, SLUG, PASS12);
  assert.equal(out.passed, false);
  assert.match(out.fast_refused, new RegExp(`not run on ${sha7}`));
});

test('C4: a docs-only phase passes with no linked tests and no receipt', async () => {
  const { recordVerdict, verifiedGate, fastVerdictOf } = await import('../lib/verdict.mjs');
  const r = await repo({ docsOnly: true });
  const out = await recordVerdict(r.dir, SLUG, PASS12);
  assert.equal(out.passed, true, JSON.stringify(out));
  assert.equal(fastVerdictOf(r.dir, SLUG).reason, 'no linked tests');
  assert.equal(fastVerdictOf(r.dir, SLUG).receipt, undefined);
  assert.equal(verifiedGate(r.dir, SLUG).ok, true);
});

test('C6: in phase mode the suite criterion still fails when unreported, and a fast verdict is refused by the gate', async () => {
  const { recordVerdict, verifiedGate, planReverify } = await import('../lib/verdict.mjs');
  const { runTargeted } = await import('../lib/receipts.mjs');
  const p = await repo({ setting: { full_suite: 'phase' } });
  const out = await recordVerdict(p.dir, SLUG, PASS12);
  assert.equal(out.passed, false);
  assert.deepEqual(out.failing, ['C3']);
  assert.equal(out.fast, undefined);

  const r = await repo();
  runTargeted(r.dir, A, TPL, { spawn });
  assert.equal((await recordVerdict(r.dir, SLUG, PASS12)).passed, true);
  assert.equal(verifiedGate(r.dir, SLUG).ok, true);
  put(r.dir, '.astrocode/config.json', JSON.stringify({ verify: { full_suite: 'phase' } }));
  const gate = verifiedGate(r.dir, SLUG);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /recorded in fast mode/);
  assert.equal(planReverify(r.dir, SLUG).mode, 'full', 'a fast base does not make the phase-mode plan targeted');
});

test('C14: a verdict recorded without fast still passes the gate in fast mode, and is never pending', async () => {
  const { recordVerdict, verifiedGate, fastVerdictOf } = await import('../lib/verdict.mjs');
  const r = await repo({ setting: { full_suite: 'phase' } });
  const out = await recordVerdict(r.dir, SLUG, { mode: 'full', criteria: [{ id: 'C1', passed: true }, { id: 'C2', passed: true }, { id: 'C3', passed: true, suite: true }] });
  assert.equal(out.passed, true, JSON.stringify(out));
  rmSync(join(r.dir, '.astrocode/config.json'));
  assert.deepEqual(verifiedGate(r.dir, SLUG), { ok: true, reason: null });
  assert.equal(fastVerdictOf(r.dir, SLUG), null);
});

test('planReverify in fast mode names the targeted set and leaves suite ids out of the floor and order.last', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const { runTargeted } = await import('../lib/receipts.mjs');
  const r = await repo();
  runTargeted(r.dir, A, TPL, { spawn });
  assert.equal((await recordVerdict(r.dir, SLUG, PASS12)).passed, true);
  put(r.dir, 'src/b.mjs', 'export const b = 2;\n');
  commit(r.dir, 'feat b (phase 07 t2)');
  const plan = planReverify(r.dir, SLUG);
  assert.equal(plan.mode, 'targeted');
  assert.deepEqual(plan.floor, ['C2']);
  assert.deepEqual(plan.order.last, []);
  assert.deepEqual(plan.fast.tests, ['tests/a.test.mjs', 'tests/b.test.mjs', 'tests/d.test.mjs']);
  assert.equal(plan.fast.mode, 'milestone');
});
