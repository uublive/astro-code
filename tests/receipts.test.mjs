// Phase 52 t2 — suite receipts: run, write, find and check (D6, #141).
// Real tmp git; suite commands are `node -e "process.exit(N)"`; modules by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
};
function repo() {
  const root = mkdtempSync(join(tmpdir(), 'receipts-'));
  sh(root, 'init', '-q');
  sh(root, 'config', 'user.email', 't@t');
  sh(root, 'config', 'user.name', 't');
  put(root, 'src/a.mjs');
  commit(root, 'init');
  return { root, done: () => rmSync(root, { recursive: true, force: true }) };
}
const OK = 'node -e "process.exit(0)"';
const quiet = { spawn: undefined };
const run = async (root, cmd = OK) => {
  const { runSuite } = await import('../lib/receipts.mjs');
  return runSuite(root, cmd, { json: true, ...quiet });
};

test('runSuite on a clean tree writes a receipt with command, commit, tree, clean, exit, node and times, and returns the exit', async () => {
  const { receiptDir, receiptKey } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    const head = sh(r.root, 'rev-parse', 'HEAD').stdout.trim();
    const tree = sh(r.root, 'rev-parse', 'HEAD^{tree}').stdout.trim();
    assert.equal(rc.exit, 0);
    assert.equal(rc.command, OK);
    assert.equal(rc.commit, head);
    assert.equal(rc.tree, tree);
    assert.equal(rc.clean, true);
    assert.equal(rc.clean_before, true);
    assert.equal(rc.clean_after, true);
    assert.equal(rc.node, process.version);
    assert.equal(rc.key, receiptKey({ commit: head, tree, command: OK }));
    assert.match(rc.key, /^[0-9a-f]{64}$/);
    for (const k of ['started_at', 'at']) assert.ok(!Number.isNaN(Date.parse(rc[k])));
    assert.equal(typeof rc.seconds, 'number');
    const onDisk = JSON.parse(readFileSync(join(receiptDir(r.root), `${rc.key}.json`), 'utf8'));
    assert.deepEqual(onDisk, rc);
  } finally { r.done(); }
});

test('a receipt lives under .astrocode/.local and is git-ignored', async () => {
  const { receiptDir } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    const file = join(receiptDir(r.root), `${rc.key}.json`);
    assert.ok(file.includes(join('.astrocode', '.local')));
    assert.ok(existsSync(file));
    assert.equal(sh(r.root, 'check-ignore', '-q', file).status, 0);
    assert.equal(sh(r.root, 'status', '--porcelain', '--untracked-files=all').stdout.trim(), '');
  } finally { r.done(); }
});

test('reusableReceipt reuses the same commit, clean tree and exact command', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, true);
    assert.equal(got.reason, null);
    assert.equal(got.receipt.key, rc.key);
  } finally { r.done(); }
});

test('a modified tracked file refuses reuse, naming the path', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    await run(r.root);
    put(r.root, 'src/a.mjs', 'changed');
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /dirty now/);
    assert.match(got.reason, /src\/a\.mjs/);
  } finally { r.done(); }
});

test('an untracked source file refuses reuse', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    await run(r.root);
    put(r.root, 'src/new.mjs');
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /src\/new\.mjs/);
  } finally { r.done(); }
});

test('a later commit refuses reuse', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    await run(r.root);
    put(r.root, 'src/b.mjs');
    commit(r.root, 'later');
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /no receipt/);
  } finally { r.done(); }
});

test('a different command string refuses reuse (no normalisation)', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    await run(r.root);
    for (const other of [`${OK} `, 'node -e "process.exit(0)" ', OK.replace('node', 'node  ')]) {
      assert.equal(reusableReceipt(r.root, other).ok, false);
    }
  } finally { r.done(); }
});

test('a non-zero exit is written but never reusable', async () => {
  const { reusableReceipt, receiptDir } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const bad = 'node -e "process.exit(3)"';
    const rc = await run(r.root, bad);
    assert.equal(rc.exit, 3);
    assert.ok(existsSync(join(receiptDir(r.root), `${rc.key}.json`)));
    const got = reusableReceipt(r.root, bad);
    assert.equal(got.ok, false);
    assert.match(got.reason, /exit status was 3/);
  } finally { r.done(); }
});

test('a receipt written on a dirty tree is never offered for reuse, even once the tree is clean again', async () => {
  const { reusableReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    put(r.root, 'src/a.mjs', 'dirty');
    const rc = await run(r.root);
    assert.equal(rc.clean, false);
    assert.deepEqual(rc.dirty, ['src/a.mjs']);
    sh(r.root, 'checkout', '--', 'src/a.mjs');
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /dirty when the suite ran/);
  } finally { r.done(); }
});

test('checkReceipt resolves a key and applies the same refusals', async () => {
  const { checkReceipt } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    const ok = checkReceipt(r.root, rc.key);
    assert.equal(ok.ok, true);
    assert.equal(ok.receipt.key, rc.key);
    assert.match(checkReceipt(r.root, 'f'.repeat(64)).reason, /not found/);
    assert.match(checkReceipt(r.root, '../../etc/passwd').reason, /not found/);
    put(r.root, 'src/a.mjs', 'changed');
    assert.match(checkReceipt(r.root, rc.key).reason, /dirty now/);
    sh(r.root, 'checkout', '--', 'src/a.mjs');
    put(r.root, 'src/b.mjs');
    commit(r.root, 'later');
    assert.match(checkReceipt(r.root, rc.key).reason, /is for commit/);
  } finally { r.done(); }
});

test('a changed node version refuses reuse', async () => {
  const { reusableReceipt, receiptDir } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    const f = join(receiptDir(r.root), `${rc.key}.json`);
    writeFileSync(f, JSON.stringify({ ...rc, node: 'v0.0.1' }));
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /node version changed/);
  } finally { r.done(); }
});

test('each refusal has a distinct reason', async () => {
  const { reusableReceipt, checkReceipt, receiptDir } = await import('../lib/receipts.mjs');
  const reasons = [];
  const r = repo();
  try {
    const rc = await run(r.root);
    const f = join(receiptDir(r.root), `${rc.key}.json`);
    const tamper = (patch) => { writeFileSync(f, JSON.stringify({ ...rc, ...patch })); return checkReceipt(r.root, rc.key).reason; };
    reasons.push(reusableReceipt(r.root, 'node -e "1"').reason); // no receipt
    reasons.push(checkReceipt(r.root, 'a'.repeat(64)).reason); // not found
    reasons.push(tamper({ commit: 'b'.repeat(40) })); // commit
    reasons.push(tamper({ tree: 'c'.repeat(40) })); // tree
    reasons.push(tamper({ command: 'other' })); // command
    reasons.push(tamper({ exit: 2 })); // exit
    reasons.push(tamper({ clean: false })); // dirty when ran
    reasons.push(tamper({ node: 'v0.0.1' })); // node
    writeFileSync(f, JSON.stringify(rc));
    put(r.root, 'src/a.mjs', 'changed');
    reasons.push(checkReceipt(r.root, rc.key).reason); // dirty now
    assert.equal(reasons.every((x) => typeof x === 'string' && x), true);
    assert.equal(new Set(reasons).size, reasons.length, reasons.join('\n'));
  } finally { r.done(); }
});

test('changes under .astrocode/ do not make the tree dirty', async () => {
  const { reusableReceipt, treeState } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    const rc = await run(r.root);
    put(r.root, '.astrocode/phases/01-x/VERDICT.json', '{}');
    assert.equal(treeState(r.root).clean, true);
    assert.equal(reusableReceipt(r.root, OK).ok, true);
    assert.equal(rc.clean, true);
  } finally { r.done(); }
});

test('a changed tracked canon file under .astrocode/ makes the tree dirty, but loop runtime state does not', async () => {
  const { reusableReceipt, treeState } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    put(r.root, '.astrocode/CONVENTIONS.md', 'a');
    put(r.root, '.astrocode/state.json', '{"project":"p"}');
    commit(r.root, 'canon');
    await run(r.root);
    put(r.root, '.astrocode/state.json', '{"project":"p","active_phase":"01-x","activity":{"text":"⚙ verifying","at":1}}');
    assert.equal(treeState(r.root).clean, true);
    put(r.root, '.astrocode/CONVENTIONS.md', 'b');
    assert.equal(treeState(r.root).clean, false);
    const got = reusableReceipt(r.root, OK);
    assert.equal(got.ok, false);
    assert.match(got.reason, /CONVENTIONS\.md/);
  } finally { r.done(); }
});

test('a receipt taken after the real `ac activity` / `ac state set` writes is reusable: only live status changed (phase 52 C6)', async () => {
  const { reusableReceipt, treeState } = await import('../lib/receipts.mjs');
  const { updateState } = await import('../lib/state.mjs');
  const r = repo();
  try {
    put(r.root, '.astrocode/state.json', '{"project":"p"}');
    commit(r.root, 'state');
    await updateState(r.root, (s) => ({ ...s, active_phase: '01-x' }));
    await updateState(r.root, (s) => ({ ...s, activity: { text: '⚙ verifying', at: 1 } }));
    assert.equal(treeState(r.root).clean, true);
    const rc = await run(r.root);
    assert.equal(rc.clean, true);
    assert.equal(reusableReceipt(r.root, OK).ok, true);
    // a real change written through the same path is still dirty
    await updateState(r.root, (s) => ({ ...s, project: 'q' }));
    assert.equal(treeState(r.root).clean, false);
  } finally { r.done(); }
});

test('a phase artifact the suite can read (PROBE.md, CRITERIA.md), a new file under phases/ or a real state.json change makes the tree dirty (C7)', async () => {
  const { reusableReceipt, treeState } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    put(r.root, '.astrocode/phases/01-x/PROBE.md', 'probe');
    put(r.root, '.astrocode/phases/01-x/CRITERIA.md', 'c');
    put(r.root, '.astrocode/state.json', '{"project":"p"}');
    commit(r.root, 'phase');
    await run(r.root);
    const dirtyWith = (rel, body) => {
      const was = readFileSync(join(r.root, rel), 'utf8');
      put(r.root, rel, body);
      const st = treeState(r.root);
      const got = reusableReceipt(r.root, OK);
      put(r.root, rel, was);
      return { clean: st.clean, ok: got.ok };
    };
    assert.deepEqual(dirtyWith('.astrocode/phases/01-x/PROBE.md', 'stale'), { clean: false, ok: false });
    assert.deepEqual(dirtyWith('.astrocode/phases/01-x/CRITERIA.md', 'changed'), { clean: false, ok: false });
    assert.deepEqual(dirtyWith('.astrocode/state.json', '{"project":"q"}'), { clean: false, ok: false });
    assert.deepEqual(dirtyWith('.astrocode/state.json', 'not json'), { clean: false, ok: false });
    put(r.root, '.astrocode/phases/02-y/PROBE.md', 'new');
    assert.equal(treeState(r.root).clean, false);
    assert.equal(reusableReceipt(r.root, OK).ok, false);
  } finally { r.done(); }
});

test('runSuite accepts an injected spawn and records its exit', async () => {
  const { runSuite } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    let seen;
    const rc = runSuite(r.root, 'fake', { spawn: (cmd, o) => { seen = { cmd, o }; return { status: 5 }; } });
    assert.equal(rc.exit, 5);
    assert.equal(seen.cmd, 'fake');
    assert.equal(seen.o.shell, true);
    assert.equal(seen.o.cwd, r.root);
  } finally { r.done(); }
});

test('a project nested in a repo subdirectory is dirty when a tracked or untracked file outside it changes', async () => {
  const { treeState } = await import('../lib/receipts.mjs');
  const r = repo();
  try {
    put(r.root, 'shared/lib.js');
    put(r.root, 'app/.astrocode/state.json', '{}');
    commit(r.root);
    const app = join(r.root, 'app');
    assert.equal(treeState(app).clean, true);
    put(r.root, 'shared/lib.js', 'changed');
    assert.equal(treeState(app).clean, false);
    sh(r.root, 'checkout', 'shared/lib.js');
    put(r.root, 'shared/extra.js');
    assert.equal(treeState(app).clean, false);
    rmSync(join(r.root, 'shared/extra.js'));
    put(r.root, 'app/.astrocode/.local/x.json');
    assert.equal(treeState(app).clean, true);
  } finally { r.done(); }
});
