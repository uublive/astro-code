// Phase 54 t10 (C7, D6): a "broad fix" claim is accepted only when it names changed files that the
// criteria file map ties to a criterion; otherwise the run stays narrowed and says why. `planReverify`
// answers the same question as `recordVerdict`. Real tmp git; dynamic imports (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const SLUG = '01-demo';
const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); };

const CRIT = ['# Criteria', '',
  '### C1 — one', '- **Files:** `src/b.mjs`', '',
  '### C2 — two', '- **Files:** `src/a.mjs`', '',
  '### C3 — three', '- **Files:** `src/c.mjs`', '',
  '### C4 — four', '- **Files:** `src/d.mjs`', '',
  '### C5 — five', '- **Files:** `src/e.mjs`', '',
  '### C6 — six', '- **Files:** `src/f.mjs`', ''].join('\n');
const ids = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];
const allPassed = (broad_files, extra = {}) => ({ mode: 'full', broad: true, ...(broad_files !== undefined ? { broad_files } : {}), criteria: ids.map((id) => ({ id, passed: true })), ...extra });

// A FAIL on file (C2 unmet), then a fix commit touching src/a.mjs (which C2 names) and README.md.
async function scenario() {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const root = mkdtempSync(join(tmpdir(), 'broad-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  put(root, `.astrocode/phases/${SLUG}/CRITERIA.md`, CRIT);
  for (const f of 'abcdef') put(root, `src/${f}.mjs`);
  put(root, 'README.md');
  commit(root, 'init');
  await recordVerdict(root, SLUG, { mode: 'full', criteria: ids.map((id) => ({ id, passed: id !== 'C2' })) });
  put(root, 'src/a.mjs', 'fixed');
  put(root, 'README.md', 'changed');
  commit(root, 'fix: a (phase 01 t1)');
  return { root, vfile: join(root, '.astrocode', 'phases', SLUG, 'VERDICT.json'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const CASES = [
  ['(a) no files', undefined, /no files named/],
  ['(a2) an empty list', [], /no files named/],
  ['(b) only README.md, which no criterion names', ['README.md'], /no criterion's file map names it/],
  ['(c) a mapped file that did not change', ['src/b.mjs'], /none of the named files .* changed since/],
];

for (const [name, files, why] of CASES) {
  test(`broad claim ${name}: planned and recorded narrowed, cannot pass, and the reason is stated`, async () => {
    const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
    const s = await scenario();
    try {
      const plan = planReverify(s.root, SLUG, { broadFiles: files ?? [] });
      assert.equal(plan.mode, 'narrowed');
      assert.match(plan.broad_refused, why);
      const out = await recordVerdict(s.root, SLUG, allPassed(files));
      assert.equal(out.mode, 'narrowed');
      assert.equal(out.passed, false, 'a refused claim cannot buy a pass');
      assert.match(out.broad_refused, why);
      const v = JSON.parse(readFileSync(s.vfile, 'utf8'));
      assert.match(v.reason, /broad claim refused: .* recorded narrowed/);
      assert.equal(v.broad, false);
    } finally { s.done(); }
  });
}

test('(d) a changed file the map ties to C2 is accepted: planned and recorded full', async () => {
  const { recordVerdict, planReverify } = await import('../lib/verdict.mjs');
  const s = await scenario();
  try {
    const plan = planReverify(s.root, SLUG, { broadFiles: ['src/a.mjs', 'README.md'] });
    assert.equal(plan.mode, 'full');
    assert.match(plan.reason, /^broad fix: src\/a\.mjs changed since .* C2 rests on it/);
    assert.equal('broad_refused' in plan, false);
    const out = await recordVerdict(s.root, SLUG, allPassed(['src/a.mjs']));
    assert.equal(out.mode, 'full');
    assert.equal(out.passed, true);
    assert.equal('broad_refused' in out, false);
    assert.equal(JSON.parse(readFileSync(s.vfile, 'utf8')).broad, true);
  } finally { s.done(); }
});

test('a broad claim on an already-full plan is a no-op', async () => {
  const { planReverify, recordVerdict } = await import('../lib/verdict.mjs');
  const root = mkdtempSync(join(tmpdir(), 'broad-full-'));
  try {
    sh(root, 'init', '-q');
    sh(root, 'config', 'user.email', 't@t');
    sh(root, 'config', 'user.name', 't');
    put(root, `.astrocode/phases/${SLUG}/CRITERIA.md`, CRIT);
    commit(root, 'init');
    const plain = planReverify(root, SLUG);
    assert.equal(plain.mode, 'full', 'no saved verdict: the plan is already full');
    assert.deepEqual(planReverify(root, SLUG, { broadFiles: [] }), plain);
    const out = await recordVerdict(root, SLUG, allPassed([]));
    assert.equal(out.mode, 'full');
    assert.equal('broad_refused' in out, false, 'nothing was narrowed, so nothing was refused');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
