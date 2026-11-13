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
// Timing (ADR-093): `lastSuiteTiming` reads the newest receipt of the exact command on THIS machine,
// whatever its commit or tree (a HEAD-only timing would make every new commit look untimed). A failing
// run is a lower bound, not a timing: the newest passing run gives the seconds, and a newer failure
// only counts when it already ran past the threshold (a 50-minute suite that died after 20 s on a
// compile error must not read as fast). `suiteSpeed` is the one answer both tiers act on.
//
// A targeted run is a receipt with a narrower command (ADR-094): fast mode runs the phase's linked test
// files instead of the full suite, through the SAME receipt format, key and refusals, so "was this set green
// on this exact commit and tree" has one answer (`targetedEvidence`) and no second store to drift. A red
// set is re-run one file at a time, so a report names the file that fails alone, never just "the set".
// `runSuite(..., { capture: true })` pipes the output (kept only in the return value, never in the receipt):
// the milestone full check reads it to find which tests failed.
//
// `lib/verdict.mjs` reaches this module only through a dynamic import inside `recordVerdict`;
// this module imports `ensureLocalDir` from it (the same pattern as survivors.mjs).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { git } from './git.mjs';
import { atomicWriteJSON } from './util.mjs';
import { ensureLocalDir } from './verdict.mjs';
import { slowSuiteMinutes } from './config.mjs';
import { targetedCommand } from './targeted.mjs';

export const receiptDir = (root) => join(paths(root).local, 'suite-receipts');

/** sha256(commit NUL tree NUL command), full hex. */
export function receiptKey({ commit, tree, command }) {
  return createHash('sha256').update(`${commit}\0${tree}\0${command}`).digest('hex');
}

// The files a verify itself writes, and nothing else: the local store and each phase's verdict
// records. Any other file under `.astrocode/` (canon, config, roadmap, a phase's PROBE.md or
// CRITERIA.md...) can be read by the suite, so a change to it makes the tree dirty.
const VERIFY_WRITES = [':(exclude).astrocode/.local',
  ...['VERDICT.json', 'VERDICTS.jsonl', 'SURVIVORS.json', 'SURPRISES.jsonl'].map((f) => `:(exclude,glob).astrocode/phases/*/${f}`)];
// `state.json` is rewritten by every `ac activity`/`ac state set` during a run, and the suite copies
// it. It is exempt only when it still parses and differs from HEAD in these live-status keys alone
// (`updated_at` is stamped by every such write, lib/state.mjs updateState).
const LIVE_KEYS = ['activity', 'active_phase', 'updated_at'];
const STATE = '.astrocode/state.json';

function onlyLiveStatusChanged(root) {
  try {
    const head = git(['show', `HEAD:./${STATE}`], { cwd: root });
    if (head.status !== 0) return false;
    const strip = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => !LIVE_KEYS.includes(k)).sort()));
    return strip(JSON.parse(head.stdout)) === strip(JSON.parse(readFileSync(join(root, STATE), 'utf8')));
  } catch { return false; }
}

/** HEAD's commit and tree, and whether the working tree is clean apart from what a verify writes. Never throws. */
export function treeState(root) {
  const rev = (what) => { const r = git(['rev-parse', what], { cwd: root }); return r.status === 0 ? r.stdout.trim() : null; };
  // The receipt is keyed to the whole repo's tree, so the clean check spans the whole repo (`:/`), not just
  // a project nested in a subdirectory; the excludes stay relative to the project root. Porcelain paths are
  // repo-root-relative, so the state.json line carries the project's prefix.
  const prefix = git(['rev-parse', '--show-prefix'], { cwd: root }).stdout?.trim() ?? '';
  const st = git(['status', '--porcelain', '--untracked-files=all', '--', ':/', ...VERIFY_WRITES], { cwd: root });
  const lines = (st.status === 0 ? st.stdout.split('\n').filter(Boolean) : [])
    .filter((l) => !(l.slice(3) === prefix + STATE && l.slice(0, 2) === ' M' && onlyLiveStatusChanged(root)));
  // An unreadable status is never "clean".
  const dirty = lines.map((l) => l.slice(3).replace(/^"|"$/g, ''));
  return { commit: rev('HEAD'), tree: rev('HEAD^{tree}'), clean: st.status === 0 && lines.length === 0, dirty: dirty.slice(0, 5) };
}

/**
 * Run `command` through the shell in `root`, then ALWAYS write a receipt (a failing or dirty run too,
 * so it can be shown as non-reusable). stdio is inherited; with `json` the child's stdout goes to our
 * stderr so stdout stays pure JSON. Returns the receipt.
 */
export const CAPTURE_CHARS = 20000;
export function runSuite(root, command, { json = false, capture = false, spawn = spawnSync } = {}) {
  const before = treeState(root);
  const started = new Date();
  const res = capture
    ? spawn(command, { shell: true, cwd: root, stdio: ['inherit', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
    : spawn(command, { shell: true, cwd: root, stdio: json ? ['inherit', 2, 'inherit'] : 'inherit' });
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
  if (!capture) return receipt;
  return { ...receipt, output: `${res?.stdout ?? ''}${res?.stderr ?? ''}`.slice(-CAPTURE_CHARS) };
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

/**
 * The newest recorded run of this exact command on this machine, from any commit: `{ seconds, at, exit,
 * commit }`, or null. Unreadable and non-hex files are skipped. Never throws.
 * @param {{ passingOnly?: boolean }} [o]  only runs that exited 0
 */
export function lastSuiteTiming(root, command, { passingOnly = false } = {}) {
  let names = [];
  try { names = readdirSync(receiptDir(root)); } catch { return null; }
  let best = null;
  for (const f of names) {
    const m = /^([0-9a-f]{64})\.json$/.exec(f);
    const rc = m && readReceipt(root, m[1]);
    if (!rc || rc.command !== command || typeof rc.seconds !== 'number') continue;
    if (passingOnly && rc.exit !== 0) continue;
    const at = rc.at ?? rc.started_at ?? '';
    if (!best || at > best.at) best = { seconds: rc.seconds, at, exit: rc.exit, commit: rc.commit };
  }
  return best;
}

/** Is this suite slow? `{ slow, seconds, at, threshold_seconds, reason }`; no timing at all is slow. */
export function suiteSpeed(root, command, warnings = []) {
  const threshold = slowSuiteMinutes(root, warnings) * 60;
  // The newest recorded run decides, whatever its exit status: a fast failing run is a timing too, and an
  // older longer run must not hide it. A slow suite that once failed fast then runs early for one round,
  // which costs only that fast failure.
  const last = lastSuiteTiming(root, command);
  const out = (slow, t, reason) => ({ slow, seconds: t?.seconds ?? null, at: t?.at ?? null, threshold_seconds: threshold, reason });
  if (!last) return out(true, null, 'no recorded run of this command on this machine');
  const what = `last run ${last.seconds}s${last.exit !== 0 ? ` (exit ${last.exit})` : ''}`;
  return last.seconds > threshold
    ? out(true, last, `${what} > ${threshold}s threshold`)
    : out(false, last, `${what} ≤ ${threshold}s threshold`);
}

const sha7 = (c) => String(c ?? '').slice(0, 7);
const keyAt = (root, command) => {
  const now = treeState(root);
  return { now, key: receiptKey({ commit: now.commit, tree: now.tree, command }) };
};

/**
 * Run the targeted `files` (ADR-094) through the receipt machinery: reuse a passing receipt at this clean
 * HEAD (`reused: true`), else run once. On a red run each file is re-run alone, so `failing` names the files
 * that fail alone; when every file passes alone, `failing` is the whole set and `note` says so.
 * `{ command, files, passed, reused, receipt: { key, commit, exit }, failing, note? }`.
 */
export function runTargeted(root, files, template, { spawn = spawnSync } = {}) {
  const command = targetedCommand(template, files);
  const pick = (rc) => ({ key: rc.key, commit: rc.commit, exit: rc.exit });
  const reuse = reusableReceipt(root, command);
  if (reuse.ok) return { command, files, passed: true, reused: true, receipt: pick(reuse.receipt), failing: [] };
  const rc = runSuite(root, command, { json: true, spawn });
  if (rc.exit === 0) return { command, files, passed: true, reused: false, receipt: pick(rc), failing: [] };
  let failing = files;
  let note;
  if (files.length > 1) {
    failing = files.filter((f) => runSuite(root, targetedCommand(template, [f]), { json: true, spawn }).exit !== 0);
    if (!failing.length) { failing = files; note = 'the set failed together; each file passed alone'; }
  }
  return { command, files, passed: false, reused: false, receipt: pick(rc), failing, ...(note ? { note } : {}) };
}

/**
 * Read-only: was this targeted set green on HEAD's commit and tree? Runs nothing. `{ command, ok, reason,
 * receipt|null, failing }`; the reasons say what to do, and a dirty tree or another node is the receipt's own refusal.
 */
export function targetedEvidence(root, files, template) {
  const command = targetedCommand(template, files);
  const { now, key } = keyAt(root, command);
  const rc = now.commit && now.tree ? readReceipt(root, key) : null;
  if (!rc) return { command, ok: false, reason: `targeted tests were not run on ${sha7(now.commit)} — run \`ac verdict cheap <n>\``, receipt: null, failing: [] };
  if (rc.exit !== 0) {
    const alone = files.filter((f) => {
      const one = readReceipt(root, keyAt(root, targetedCommand(template, [f])).key);
      return one && one.exit !== 0;
    });
    const failing = alone.length ? alone : files;
    return { command, ok: false, reason: `targeted tests failed on ${sha7(now.commit)}: ${failing.join(', ')}`, receipt: rc, failing };
  }
  const j = judge(root, key, rc);
  return { command, ok: j.ok, reason: j.reason, receipt: rc, failing: [] };
}
