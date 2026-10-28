// Phase 54 t8 (C1, C10, C11): recordVerdict lists every observed unmet id in ONE pass, appends one
// history line per record (before VERDICT.json, committed with it), and reports flapping without
// ever changing the verdict. Real tmp git; dynamic imports (ADR-018).
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
const commit = (root, msg) => { sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', msg); return sh(root, 'rev-parse', 'HEAD').stdout.trim(); };

const CRIT = ['# Criteria', '',
  ...[1, 2, 3, 4, 5].flatMap((n) => [`### C${n} — claim ${n}`, `- **Files:** \`src/c${n}.mjs\``, '']),
].join('\n');
const ids = ['C1', 'C2', 'C3', 'C4', 'C5'];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vhist-rec-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  const dir = join(root, '.astrocode', 'phases', SLUG);
  put(root, '.astrocode/phases/' + SLUG + '/CRITERIA.md', CRIT);
  for (const n of [1, 2, 3, 4, 5]) put(root, `src/c${n}.mjs`);
  commit(root, 'init');
  return { root, dir, vfile: join(dir, 'VERDICT.json'), hfile: join(dir, 'VERDICTS.jsonl'), done: () => rmSync(root, { recursive: true, force: true }) };
}
const full = (failed = []) => ({ mode: 'full', criteria: ids.map((id) => ({ id, passed: !failed.includes(id) })) });
const lines = (f) => readFileSync(f, 'utf8').split('\n').filter(Boolean);

test('a full FAIL with C2 and C4 unmet names both in out.failing, VERDICT.json and the history line', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const out = await recordVerdict(f.root, SLUG, full(['C2', 'C4']));
    assert.deepEqual(out.failing, ['C2', 'C4']);
    const v = JSON.parse(readFileSync(f.vfile, 'utf8'));
    assert.deepEqual(v.criteria.filter((c) => c.status === 'failed').map((c) => c.id), ['C2', 'C4']);
    const h = JSON.parse(lines(f.hfile)[0]);
    assert.deepEqual(h.unmet, ['C2', 'C4']);
    assert.equal(h.passed, false);
    assert.equal(h.run, 1);
    assert.equal(h.commit, sh(f.root, 'rev-parse', 'HEAD~1').stdout.trim(), 'the graded commit, not the verdict commit');
    assert.equal(h.criteria.length, 5);
  } finally { f.done(); }
});

test('a narrowed re-verify reporting C2 and C3 failed records both, not just the carried-over C2', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, full(['C2']));
    const out = await recordVerdict(f.root, SLUG, { mode: 'narrowed', criteria: [{ id: 'C2', passed: false }, { id: 'C3', passed: false }] });
    assert.equal(out.passed, false);
    assert.deepEqual(out.failing, ['C2', 'C3']);
    const h = JSON.parse(lines(f.hfile)[1]);
    assert.deepEqual(h.unmet, ['C2', 'C3']);
  } finally { f.done(); }
});

test('three records (FAIL, FAIL, PASS) leave three history lines, the first two byte-identical, committed with VERDICT.json', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    await recordVerdict(f.root, SLUG, full(['C2']));
    const l1 = lines(f.hfile);
    await recordVerdict(f.root, SLUG, full(['C2', 'C3']));
    const l2 = lines(f.hfile);
    const out = await recordVerdict(f.root, SLUG, full());
    const l3 = lines(f.hfile);
    assert.equal(l3.length, 3);
    assert.equal(l2[0], l1[0]);
    assert.deepEqual(l3.slice(0, 2), l2);
    assert.equal(out.passed, true);
    assert.equal(sh(f.root, 'status', '--porcelain').stdout, '', 'history is committed, not left dirty');
    const files = sh(f.root, 'show', '--name-only', '--format=', 'HEAD').stdout.split('\n').filter(Boolean);
    assert.ok(files.some((x) => x.endsWith('VERDICT.json')) && files.some((x) => x.endsWith('VERDICTS.jsonl')));
  } finally { f.done(); }
});

test('flapping: a criterion that passed and now fails is flagged, with whether its mapped files changed', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const f = fixture();
  try {
    const first = await recordVerdict(f.root, SLUG, full());
    assert.equal('flapping' in first, false);
    // C2's file unchanged, an unrelated file changed
    put(f.root, 'src/c5.mjs', 'v2');
    commit(f.root, 'feat: c5');
    const unchanged = await recordVerdict(f.root, SLUG, full(['C2']));
    assert.equal(unchanged.flapping.length, 1);
    assert.equal(unchanged.flapping[0].id, 'C2');
    assert.equal(unchanged.flapping[0].files_changed, false);
    assert.equal(unchanged.flapping[0].passed_run, 1);
    assert.equal(unchanged.flapping[0].passed_commit, first.commit);
  } finally { f.done(); }
  const g = fixture();
  try {
    await recordVerdict(g.root, SLUG, full());
    put(g.root, 'src/c2.mjs', 'v2');
    commit(g.root, 'feat: c2');
    const changed = await recordVerdict(g.root, SLUG, full(['C2', 'C3']));
    const by = Object.fromEntries(changed.flapping.map((x) => [x.id, x]));
    assert.equal(by.C2.files_changed, true);
    assert.equal(by.C3.files_changed, false);
    const h = JSON.parse(lines(g.hfile)[1]);
    assert.equal(h.flapping.length, 2, 'the flag is in the history line');
    const v = JSON.parse(readFileSync(g.vfile, 'utf8'));
    assert.equal(JSON.stringify(v).includes('flapping'), false, 'never in VERDICT.json');
  } finally { g.done(); }
});

test('the same result recorded with and without prior history gives identical status, failing and criteria', async () => {
  const { recordVerdict } = await import('../lib/verdict.mjs');
  const a = fixture();
  const b = fixture();
  try {
    for (const f of [a, b]) {
      await recordVerdict(f.root, SLUG, full());
      if (f === b) { rmSync(f.hfile); sh(f.root, 'add', '-A'); sh(f.root, 'commit', '-q', '-m', 'drop history'); }
    }
    const ra = await recordVerdict(a.root, SLUG, full(['C2', 'C4']));
    const rb = await recordVerdict(b.root, SLUG, full(['C2', 'C4']));
    assert.ok(ra.flapping && !rb.flapping, 'only history differs');
    assert.equal(ra.passed, rb.passed);
    assert.deepEqual(ra.failing, rb.failing);
    assert.deepEqual(JSON.parse(readFileSync(a.vfile, 'utf8')).criteria, JSON.parse(readFileSync(b.vfile, 'utf8')).criteria);
  } finally { a.done(); b.done(); }
});
