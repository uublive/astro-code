// Phase 52 t1 — criterion files, the suite marker, the diff and the mutate scope.
// Real tmp git repos; the module is reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
const put = (root, rel, body = 'x') => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), body);
};
const commit = (root, msg) => {
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', msg);
  return sh(root, 'rev-parse', 'HEAD').stdout.trim();
};
function repo(files = ['lib/a.mjs', 'lib/ab.mjs', 'tests/b/x.test.mjs', 'scripts/check.mjs']) {
  const root = mkdtempSync(join(tmpdir(), 'impact-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  for (const f of files) put(root, f);
  const first = commit(root, 'init');
  return { root, first, done: () => rmSync(root, { recursive: true, force: true }) };
}
const TRACKED = ['lib/a.mjs', 'lib/ab.mjs', 'tests/b/x.test.mjs', 'scripts/check.mjs'];

test('criterionBlocks splits CRITERIA.md per C<n> heading and keeps each body', async () => {
  const { criterionBlocks } = await import('../lib/impact.mjs');
  const t = '# Criteria\n\n### C1 — one\nbody one\n\n## C2 [mutation] — two\nbody two\nmore\n';
  const b = criterionBlocks(t);
  assert.deepEqual(b.map((x) => x.id), ['C1', 'C2']);
  assert.match(b[0].heading, /^### C1/);
  assert.match(b[0].body, /body one/);
  assert.doesNotMatch(b[0].body, /body two/);
  assert.match(b[1].body, /more/);
});

test('criterionPaths takes a Files: line verbatim and otherwise only backticked tokens that are tracked files or directory prefixes', async () => {
  const { criterionPaths } = await import('../lib/impact.mjs');
  const t = [
    '### C1 — a', '- **Observe:** read `lib/a.mjs` and `nope/missing.mjs` and lib/ab.mjs in prose', '',
    '### C2 — b', '- **Files:** `new/untracked.mjs`, `tests/b/`', '- **Observe:** x', '',
    '### C3 — c', '- **Observe:** look in `tests/b`', '',
  ].join('\n');
  const m = criterionPaths(t, TRACKED);
  assert.deepEqual(m.get('C1'), ['lib/a.mjs']);
  assert.deepEqual(m.get('C2').sort(), ['new/untracked.mjs', 'tests/b/']);
  assert.deepEqual(m.get('C3'), ['tests/b']);
});

test('a backticked command maps to the files it names; `npm run lint`, a glob and prose map to nothing', async () => {
  const { criterionPaths } = await import('../lib/impact.mjs');
  const t = [
    '### C1 — a', '- **Observe:** run `node scripts/check.mjs --flag`', '',
    '### C2 — b', '- **Observe:** run `npm run lint`', '',
    '### C3 — c', '- **Observe:** see `lib/*.mjs` and lib/a.mjs', '',
  ].join('\n');
  const m = criterionPaths(t, TRACKED);
  assert.deepEqual(m.get('C1'), ['scripts/check.mjs']);
  assert.deepEqual(m.get('C2'), []);
  assert.deepEqual(m.get('C3'), []);
});

test('trailing punctuation, :line suffixes and ./ are stripped before matching', async () => {
  const { criterionPaths } = await import('../lib/impact.mjs');
  const t = '### C1 — a\n- **Observe:** `./lib/a.mjs:12`, `lib/ab.mjs.` and `(scripts/check.mjs);`\n';
  const m = criterionPaths(t, TRACKED);
  assert.deepEqual(m.get('C1').sort(), ['lib/a.mjs', 'lib/ab.mjs', 'scripts/check.mjs']);
});

test('a criterion with no resolvable path is reported unmapped', async () => {
  const { criterionPaths } = await import('../lib/impact.mjs');
  const m = criterionPaths('### C1 — a\n- **Observe:** just words\n### C2 — b\n- **Observe:** `lib/a.mjs`\n', TRACKED);
  assert.equal(m.has('C1'), true);
  assert.deepEqual(m.get('C1'), []);
  assert.deepEqual(m.get('C2'), ['lib/a.mjs']);
});

test('touches matches an exact path or a directory prefix, never a partial name (lib/ab.mjs is not lib/a)', async () => {
  const { touches } = await import('../lib/impact.mjs');
  assert.equal(touches(['lib/a.mjs'], ['lib/a.mjs']), true);
  assert.equal(touches(['tests/b'], ['tests/b/x.test.mjs']), true);
  assert.equal(touches(['tests/b/'], ['tests/b/x.test.mjs']), true);
  assert.equal(touches(['lib/a'], ['lib/ab.mjs']), false);
  assert.equal(touches(['lib/a.mjs'], ['lib/ab.mjs']), false);
  assert.equal(touches([], ['lib/a.mjs']), false);
  assert.equal(touches(['lib/a.mjs'], []), false);
});

test('diffSince lists both sides of a rename, excludes .astrocode, and returns null for an unknown commit', async () => {
  const { diffSince, trackedFiles } = await import('../lib/impact.mjs');
  const r = repo();
  try {
    sh(r.root, 'mv', 'lib/a.mjs', 'lib/moved.mjs');
    put(r.root, '.astrocode/phases/x/VERDICT.json', '{}');
    put(r.root, 'lib/ab.mjs', 'changed');
    commit(r.root, 'change');
    assert.deepEqual(diffSince(r.root, r.first), ['lib/ab.mjs', 'lib/a.mjs', 'lib/moved.mjs'].sort());
    assert.equal(diffSince(r.root, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef'), null);
    assert.ok(trackedFiles(r.root).includes('lib/moved.mjs'));
  } finally { r.done(); }
});

test('suiteIds finds the [suite] heading tag, an exact suite command span and the \'full suite\' phrase, but not `node --test tests/x.test.mjs`', async () => {
  const { suiteIds } = await import('../lib/impact.mjs');
  const t = [
    '### C1 [suite] — tagged', '- **Observe:** x', '',
    '### C2 — cmd', '- **Observe:** run `npm test` and expect 0', '',
    '### C3 — phrase', '- **Observe:** The Full Suite passes', '',
    '### C4 — scoped', '- **Observe:** run `node --test tests/x.test.mjs`', '',
    '### C5 — only mentions', '- **Observe:** the [suite] tag is documented', '',
  ].join('\n');
  assert.deepEqual(suiteIds(t), ['C1', 'C2', 'C3']);
});

test('mutateScopeFiles returns the phase\'s stamped paths plus tracked files matched by mutation.files', async () => {
  const { mutateScopeFiles } = await import('../lib/impact.mjs');
  const r = repo(['lib/a.mjs', 'lib/ab.mjs', 'src/deep/m.mjs']);
  try {
    put(r.root, 'lib/stamped.mjs');
    put(r.root, 'tests/stamped.test.mjs');
    commit(r.root, 'feat: stamped (phase 07 t1)');
    put(r.root, 'lib/other.mjs');
    commit(r.root, 'unstamped');
    put(r.root, '.astrocode/config.json', JSON.stringify({ mutation: { files: ['src/deep/', 42] } }));
    commit(r.root, 'config');
    const f = mutateScopeFiles(r.root, '07-demo');
    assert.ok(f.includes('lib/stamped.mjs'));
    assert.ok(f.includes('tests/stamped.test.mjs'));
    assert.ok(f.includes('src/deep/m.mjs'));
    assert.ok(!f.includes('lib/other.mjs'));
    assert.ok(!f.includes('lib/a.mjs'));
  } finally { r.done(); }
});

// ── phase 54 t2: the core/edge tag and the Cheap line (D2, D4) ──────────────────
test('edgeIds returns only criteria tagged [edge] in the heading tag run, and fails closed on everything else', async () => {
  const { edgeIds } = await import('../lib/impact.mjs');
  const text = [
    '### C1 — untagged claim', '- **Observe:** x',
    '### C2 [edge] — an edge claim', '- **Observe:** y',
    '### C3 [core] — core claim',
    '### C4 [mutation] [edge] — mutation then edge',
    '### C5 [Edge] — wrong case',
    '### C6 [edge ] — trailing space in the tag',
    '### C7 — edge in the claim text [edge]',
    '### C8 — the word edge',
    '### C9', '[edge]',
    '### C10 — body tag', '- **Observe:** [edge] here',
    '### C11 [suite] — suite only',
  ].join('\n');
  assert.deepEqual(edgeIds(text), ['C2', 'C4']);
  assert.deepEqual(edgeIds(text.replace(/\n/g, '\r\n')), ['C2', 'C4'], 'survives CRLF');
  assert.deepEqual(edgeIds(''), []);
});

test('cheapCommands maps a Cheap line to its first backticked command and ignores one without', async () => {
  const { cheapCommands } = await import('../lib/impact.mjs');
  const text = [
    '### C1 — a', '- **Cheap:** `node a.mjs`', '- **Observe:** `slow`',
    '### C2 — b', '- **Cheap:** run the thing',
    '### C3 — c', '- **Cheap:** `node c.mjs --x` then `other`',
  ].join('\r\n');
  const m = cheapCommands(text);
  assert.equal(m.get('C1'), 'node a.mjs');
  assert.equal(m.has('C2'), false);
  assert.equal(m.get('C3'), 'node c.mjs --x');
});
