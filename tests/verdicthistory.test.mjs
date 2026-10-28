// Phase 54 t3 (D9): the append-only verdict history and the flapping flag. Real tmp git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg = 'c') => {
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', msg);
  return sh(root, 'rev-parse', 'HEAD').stdout.trim();
};
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'vhist-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  put(root, 'src/a.mjs');
  put(root, 'src/b.mjs');
  const first = commit(root, 'init');
  return { root, first, done: () => rmSync(root, { recursive: true, force: true }) };
}
const TEXT = '### C1 — a\n- **Files:** `src/a.mjs`\n### C2 — b\n- **Files:** `src/b.mjs`\n### C3 — loose\n- **Observe:** prose only\n';

test('appendHistory keeps earlier lines byte-identical across three appends', async () => {
  const { appendHistory, readHistory } = await import('../lib/verdicthistory.mjs');
  const r = repo();
  try {
    const f = join(r.root, 'VERDICTS.jsonl');
    appendHistory(f, { run: 1, passed: false });
    const after1 = readFileSync(f, 'utf8');
    appendHistory(f, { run: 2, passed: false });
    const after2 = readFileSync(f, 'utf8');
    appendHistory(f, { run: 3, passed: true });
    const after3 = readFileSync(f, 'utf8');
    assert.ok(after2.startsWith(after1));
    assert.ok(after3.startsWith(after2));
    assert.deepEqual(readHistory(f).entries.map((e) => e.run), [1, 2, 3]);
  } finally { r.done(); }
});

test('readHistory skips and counts a damaged trailing line, and an absent file is empty', async () => {
  const { appendHistory, readHistory } = await import('../lib/verdicthistory.mjs');
  const r = repo();
  try {
    const f = join(r.root, 'VERDICTS.jsonl');
    assert.deepEqual(readHistory(f), { entries: [], damaged: 0 });
    appendHistory(f, { run: 1 });
    appendFileSync(f, '{"run": 2, "pa');
    const h = readHistory(f);
    assert.equal(h.entries.length, 1);
    assert.equal(h.damaged, 1);
    appendHistory(f, { run: 3 });
    assert.deepEqual(readHistory(f).entries.map((e) => e.run), [1, 3], 'a later append survives the damaged line');
  } finally { r.done(); }
});

test('flappingOf: pass then fail with mapped files unchanged / changed, never-passed, and an unknown commit', async () => {
  const { flappingOf } = await import('../lib/verdicthistory.mjs');
  const r = repo();
  try {
    const hist = [{ run: 1, commit: r.first, criteria_sha: 'aaa', criteria: [{ id: 'C1', status: 'passed' }, { id: 'C2', status: 'passed' }, { id: 'C3', status: 'passed' }, { id: 'C4', status: 'failed' }] }];
    put(r.root, 'src/b.mjs', 'changed');
    commit(r.root, 'touch b');
    const out = flappingOf({ history: hist, failedIds: ['C1', 'C2', 'C3', 'C4'], text: TEXT, root: r.root, criteriaSha: 'bbb' });
    const by = Object.fromEntries(out.map((f) => [f.id, f]));
    assert.equal(by.C1.files_changed, false, 'src/a.mjs unchanged');
    assert.equal(by.C2.files_changed, true, 'src/b.mjs changed');
    assert.equal(by.C3.files_changed, null, 'a criterion mapping no file is unknown');
    assert.equal(by.C4, undefined, 'never passed -> not flagged');
    assert.equal(by.C1.passed_run, 1);
    assert.equal(by.C1.passed_commit, r.first);
    assert.equal(by.C1.criteria_changed, true);
    const unk = flappingOf({ history: [{ run: 1, commit: 'deadbeef'.repeat(5), criteria: [{ id: 'C1', status: 'passed' }] }], failedIds: ['C1'], text: TEXT, root: r.root });
    assert.equal(unk[0].files_changed, null, 'git cannot resolve the commit');
    assert.equal('criteria_changed' in unk[0], false);
  } finally { r.done(); }
});

test('flappingOf ignores a cheap-stage pass and uses only the most recent observation', async () => {
  const { flappingOf } = await import('../lib/verdicthistory.mjs');
  const r = repo();
  try {
    const hist = [
      { run: 1, commit: r.first, criteria: [{ id: 'C1', status: 'passed' }] },
      { run: 2, commit: r.first, criteria: [{ id: 'C1', status: 'failed' }] },
      { run: 3, commit: r.first, stage: 'cheap', criteria: [{ id: 'C1', status: 'passed' }] },
    ];
    assert.deepEqual(flappingOf({ history: hist, failedIds: ['C1'], text: TEXT, root: r.root }), [], 'latest real observation was a failure');
  } finally { r.done(); }
});
