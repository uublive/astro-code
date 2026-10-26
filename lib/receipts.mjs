// Suite receipts: a verifier on the identical clean tree reuses a passing suite run instead of
// repeating it (phase 52 D6, #141: 16% of test minutes re-ran suites on identical clean trees).
//
// A receipt is the machine-local fact "this command exited N on commit C, tree T, and the tree was
// clean before and after". It lives under `.astrocode/.local/suite-receipts/` (covered by
// `.local/.gitignore`) and is never committed: a teammate's run is not evidence THIS machine saw.
//
// The reuse rules are code (333f/ce7b), checked in a fixed order with a distinct reason each, so a
// refusal always says why (b940): same commit, same tree, exact command string (never normalised),
// exit 0, clean when it ran, clean now, same node. Dirty means `git status --porcelain
// --untracked-files=all` prints something beyond what a verify itself writes (VERIFY_WRITES, and
// state.json's live-status keys); ignored files are NOT checked.
//
// `lib/verdict.mjs` reaches this module only through a dynamic import inside `recordVerdict`;
// this module imports `ensureLocalDir` from it (the same pattern as survivors.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { atomicWriteJSON } from './util.mjs';
import { ensureLocalDir } from './verdict.mjs';

export const receiptDir = (root) => join(paths(root).local, 'suite-receipts');

/** sha256(commit NUL tree NUL command), full hex. */
export function receiptKey({ commit, tree, command }) {
  return createHash('sha256').update(`${commit}\0${tree}\0${command}`).digest('hex');
}

// The files a verify itself writes, and nothing else: the local store and each phase's verdict
// records. Any other file under `.astrocode/` (canon, config, roadmap, a phase's PROBE.md or
// CRITERIA.md...) can be read by the suite, so a change to it makes the tree dirty.
const VERIFY_WRITES = [':(exclude).astrocode/.local',
  ...['VERDICT.json', 'SURVIVORS.json', 'SURPRISES.jsonl'].map((f) => `:(exclude,glob).astrocode/phases/*/${f}`)];
// `state.json` is rewritten by every `ac activity`/`ac state set` during a run, and the suite copies
// it. It is exempt only when it still parses and differs from HEAD in these live-status keys alone.
const LIVE_KEYS = ['activity', 'active_phase'];
const STATE = '.astrocode/state.json';

function onlyLiveStatusChanged(root) {
  try {
    const head = git(['show', `HEAD:${STATE}`], { cwd: root });
    if (head.status !== 0) return false;
    const strip = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !LIVE_KEYS.includes(k)).sort()));
    return strip(JSON.parse(head.stdout)) === strip(JSON.parse(readFileSync(join(root, STATE), 'utf8')));
  } catch { return false; }
}

/** HEAD's commit and tree, and whether the working tree is clean apart from what a verify writes. Never throws. */
export function treeState(root) {
  const rev = (what) => { const r = git(['rev-parse', what], { cwd: root }); return r.status === 0 ? r.stdout.trim() : null; };
  const st = git(['status', '--porcelain', '--untracked-files=all', '--', '.', ...VERIFY_WRITES], { cwd: root });
  const lines = (st.status === 0 ? st.stdout.split('\n').filter(Boolean) : [])
    .filter((l) => !(l.slice(3) === STATE && l.slice(0, 2) === ' M' && onlyLiveStatusChanged(root)));
  // An unreadable status is never "clean".
  const dirty = lines.map((l) => l.slice(3).replace(/^"|"$/g, ''));
  return { commit: rev('HEAD'), tree: rev('HEAD^{tree}'), clean: st.status === 0 && lines.length === 0, dirty: dirty.slice(0, 5) };
}

/**
 * Run `command` through the shell in `root`, then ALWAYS write a receipt (a failing or dirty run too,
 * so it can be shown as non-reusable). stdio is inherited; with `json` the child's stdout goes to our
 * stderr so stdout stays pure JSON. Returns the receipt.
 */
export function runSuite(root, command, { json = false, spawn = spawnSync } = {}) {
  const before = treeState(root);
  const started = new Date();
  const res = spawn(command, { shell: true, cwd: root, stdio: json ? ['inherit', 2, 'inherit'] : 'inherit' });
  const after = treeState(root);
  const now = new Date();
  const receipt = {
    version: 1,
    key: receiptKey({ commit: before.commit, tree: before.tree, command }),
    command,
    commit: before.commit,
    tree: before.tree,
    clean_before: before.clean,
    clean_after: after.clean,
    clean: before.clean && after.clean,
    exit: res?.status ?? 1,
    node: process.version,
    started_at: started.toISOString(),
    at: now.toISOString(),
    seconds: Math.round((now - started) / 100) / 10,
    dirty: [...new Set([...before.dirty, ...after.dirty])].slice(0, 5),
  };
  ensureLocalDir(root);
  mkdirSync(receiptDir(root), { recursive: true });
  atomicWriteJSON(join(receiptDir(root), `${receipt.key}.json`), receipt);
  return receipt;
}

const readReceipt = (root, key) => {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return null;
  try { return JSON.parse(readFileSync(join(receiptDir(root), `${key}.json`), 'utf8')); } catch { return null; }
};

// The refusals, in order. `key` is what the receipt was looked up by.
function judge(root, key, rc) {
  const no = (reason) => ({ ok: false, receipt: rc, reason });
  const now = treeState(root);
  if (rc.commit !== now.commit) return no(`receipt is for commit ${String(rc.commit).slice(0, 7)}, not HEAD (${String(now.commit).slice(0, 7)})`);
  if (rc.tree !== now.tree) return no('receipt tree differs from HEAD\'s tree');
  if (receiptKey({ commit: rc.commit, tree: rc.tree, command: rc.command }) !== key) return no('receipt command differs from the one its key was made for');
  if (rc.exit !== 0) return no(`suite exit status was ${rc.exit}`);
  if (rc.clean !== true) return no(`tree was dirty when the suite ran${rc.dirty?.[0] ? ` (${rc.dirty[0]})` : ''}`);
  if (!now.clean) return no(`tree is dirty now (${now.dirty[0] ?? 'status unreadable'})`);
  if (rc.node !== process.version) return no(`node version changed (receipt ${rc.node}, now ${process.version})`);
  return { ok: true, receipt: rc, reason: null };
}

/** Is there a receipt reusable for this exact command on HEAD's clean tree? `{ ok, receipt, reason }`. Never throws. */
export function reusableReceipt(root, command) {
  const now = treeState(root);
  const rc = now.commit && now.tree ? readReceipt(root, receiptKey({ commit: now.commit, tree: now.tree, command })) : null;
  if (!rc) return { ok: false, receipt: null, reason: 'no receipt for this command on HEAD\'s tree' };
  if (rc.command !== command) return { ok: false, receipt: rc, reason: 'receipt command differs from the one asked for' };
  return judge(root, receiptKey({ commit: now.commit, tree: now.tree, command }), rc);
}

/** Resolve a cited key and apply the same refusals. `{ ok, receipt, reason }`. Never throws. */
export function checkReceipt(root, key) {
  const rc = readReceipt(root, key);
  if (!rc) return { ok: false, receipt: null, reason: 'receipt not found' };
  return judge(root, key, rc);
}
