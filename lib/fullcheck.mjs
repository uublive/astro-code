// ADR-094: the milestone full check. Fast mode lets a phase PASS with only its targeted tests, so the full
// suite and every phase's quick re-checks run ONCE, on the milestone tip, here. It is not a re-verify of each
// phase and starts no verifier: it runs the suite, then every `Cheap:` command of the closing milestone's
// phases, at HEAD (ADR-007: the tip of the branch the check runs on).
//
// Why the result is LOCAL (`.astrocode/.local/full-checks/<tip>.json`): a committed result would move HEAD,
// which invalidates the very tip check it records. Keyed by tip, "a new commit needs a new check" comes for
// free. The cost is that another clone needs its own check, the same posture as suite receipts (ADR-089).
//
// Every failure is COLLECTED (never the first only) and becomes a fix tied to the phase that broke
// (lib/fixes.mjs `fullcheck_from`): a criterion failure to its phase; a failing test to the phase of the
// newest STAMPED commit that changed the test's subject (`subjectsOf`, ADR-017), else to the milestone
// (`phase: null`). A candidate test that fails in the suite but passes alone is `flaky`: it opens nothing.
// A dirty tree is refused, since a dirty result could never pass the close gate. A phase in `phase` mode
// writes no fast verdicts, so nothing is pending and the gate is not required (a milestone verified before
// this change closes as it always did).
import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { git, gitOk } from './git.mjs';
import { atomicWriteJSON } from './util.mjs';
import { loadRoadmap } from './roadmap.mjs';
import { belongsToMilestone, plannedMilestones } from './milestone.mjs';
import { criteriaFile, verdictFile, readVerdict, parseCriteriaIds, fastVerdictOf, ensureLocalDir } from './verdict.mjs';
import { cheapCommands, suiteIds, suiteCommandsFor, SUITE_COMMANDS, trackedFiles } from './impact.mjs';
import { reusableReceipt, runSuite, treeState } from './receipts.mjs';
import { suiteCommandSetting, targetedCommandTemplate } from './config.mjs';
import { subjectsOf, targetedCommand, TEST_FILE } from './targeted.mjs';
import { stampedPhase } from './fixtures.mjs';
import { addFix, findFullCheckFix, fullCheckFixes, setFixStatus } from './fixes.mjs';
import { CHEAP_TIMEOUT_MS } from './cheappass.mjs';

export const fullCheckDir = (root) => join(paths(root).local, 'full-checks');
const resultFile = (root, tip) => join(fullCheckDir(root), `${tip}.json`);
const sha7 = (c) => String(c ?? '').slice(0, 7);
const tail = (s, n = 2000) => { const t = String(s ?? '').trim(); return t.length > n ? t.slice(-n) : t; };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const idNum = (id) => Number(String(id).replace(/\D/g, ''));
const headOf = (root) => { const r = git(['rev-parse', 'HEAD'], { cwd: root }); return r.status === 0 ? r.stdout.trim() : null; };
const isAncestorOrSame = (root, a, b) => !!a && !!b && gitOk(['merge-base', '--is-ancestor', a, b], { cwd: root });

/** The closing milestone and its phases (the same set `completeMilestone` owns), in number order. */
export function milestonePhases(root) {
  const rm = loadRoadmap(root);
  const planned = plannedMilestones(root);
  const phases = rm.phases.filter((ph) => belongsToMilestone(ph, rm.milestone, planned)).sort((a, b) => a.number - b.number);
  return { milestone: rm.milestone, phases };
}

/** The stored result for this tip, or null. */
export function readFullCheck(root, tip) {
  try { return JSON.parse(readFileSync(resultFile(root, tip), 'utf8')); } catch { return null; }
}

function allResults(root) {
  let names = [];
  try { names = readdirSync(fullCheckDir(root)); } catch { return []; }
  return names.filter((n) => /^[0-9a-f]{40}\.json$/.test(n)).map((n) => readFullCheck(root, n.slice(0, -5))).filter(Boolean);
}

/** The newest stored result (any tip), or null. */
export function lastFullCheck(root) {
  return allResults(root).sort((a, b) => cmp(String(b.at), String(a.at)))[0] ?? null;
}

/**
 * The suite command, in order: `verify.suite_command`; the first command a `[suite]` criterion of these
 * phases names; `npm test` when package.json has `scripts.test`; else null (the check then fails, saying so).
 */
export function fullCheckSuiteCommand(root, phases) {
  const set = suiteCommandSetting(root, []);
  if (set) return set;
  for (const ph of phases) {
    const cfile = criteriaFile(root, ph.slug);
    if (!existsSync(cfile)) continue;
    const text = readFileSync(cfile, 'utf8');
    for (const id of suiteIds(text)) {
      const cmds = suiteCommandsFor(text, id);
      if (cmds !== SUITE_COMMANDS) return cmds[0];
    }
  }
  try {
    if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))?.scripts?.test) return 'npm test';
  } catch { /* no package.json */ }
  return null;
}

const claimOf = (text, id) => {
  const m = new RegExp(`^#{1,6}[ \\t]*${id}\\b(.*)$`, 'm').exec(text);
  return (m?.[1] ?? '').replace(/\[[^\]]*\]/g, '').replace(/^[\s—–-]+/, '').trim();
};

// The phase of the newest stamped commit that changed any of `subjects`, restricted to this milestone's phases.
function phaseOfSubjects(root, subjects, byNumber) {
  if (!subjects.length) return null;
  const r = git(['log', '--format=%H%x09%s', '--', ...subjects], { cwd: root });
  if (r.status !== 0) return null;
  for (const line of r.stdout.split('\n').filter(Boolean)) {
    const n = stampedPhase(line.slice(line.indexOf('\t') + 1));
    if (n !== null && byNumber.has(n)) return byNumber.get(n).slug;
  }
  return null;
}

/**
 * Run the milestone full check at HEAD. Throws on a dirty tree. Returns the stored result:
 * `{ version, milestone, tip, tree, clean, passed, at, suite, cheap, failures, flaky, fixes, committed }`.
 * Never starts a verifier. `spawn` and `now` are injectable.
 */
export async function runFullCheck(root, { spawn = spawnSync, now = new Date() } = {}) {
  const before = treeState(root);
  if (!before.clean) throw new Error(`the tree is dirty (${before.dirty[0] ?? 'status unreadable'}) — commit or stash first; a dirty result could never pass the close gate`);
  const { milestone, phases } = milestonePhases(root);
  const byNumber = new Map(phases.map((ph) => [String(ph.number), ph]));
  const tip = before.commit;
  const warnings = [];
  const failures = [];
  const flaky = [];
  const template = targetedCommandTemplate(root, warnings);

  // 1. the suite, once (a reusable receipt first, else a captured run)
  const suiteCmd = fullCheckSuiteCommand(root, phases);
  const suite = { command: suiteCmd, exit: null, key: null };
  if (!suiteCmd) {
    suite.exit = 1;
    failures.push({ kind: 'suite', phase: null, criterion: null, test: null, command: null, output: 'no suite command — set verify.suite_command' });
  } else {
    const reuse = reusableReceipt(root, suiteCmd);
    const rc = reuse.ok ? { ...reuse.receipt, output: '' } : runSuite(root, suiteCmd, { json: true, capture: true, spawn });
    suite.exit = rc.exit;
    suite.key = rc.key;
    if (rc.exit !== 0) {
      // Which tests? Candidates are the tracked test files the output names (all of them when it names none),
      // each re-run alone: the ones that fail alone are the failing tests.
      const tracked = trackedFiles(root);
      const tests = tracked.filter((f) => TEST_FILE.test(f));
      const named = tests.filter((t) => rc.output.includes(t));
      const failedLine = (t) => rc.output.split('\n').some((l) => l.includes(t) && /not ok|✖|✗|FAIL/i.test(l));
      const candidates = (named.length ? named : tests).sort(cmp);
      const failing = [];
      for (const t of candidates) {
        const cmd = targetedCommand(template, [t]);
        const one = spawn(cmd, { shell: true, cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: CHEAP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });
        if ((one?.status ?? 1) !== 0) failing.push({ t, cmd, out: tail(`${one?.stdout ?? ''}${one?.stderr ?? ''}`) });
        else if (failedLine(t)) flaky.push(t);
      }
      for (const f of failing) {
        failures.push({ kind: 'test', phase: phaseOfSubjects(root, subjectsOf(root, f.t, tracked), byNumber), criterion: null, test: f.t, command: f.cmd, output: f.out });
      }
      if (!failing.length) failures.push({ kind: 'suite', phase: null, criterion: null, test: null, command: suiteCmd, output: tail(rc.output) });
    }
  }

  // 2. every phase's Cheap commands at HEAD, phases in number order, criteria in id order, all failures kept
  const cheap = [];
  for (const ph of phases) {
    const cfile = criteriaFile(root, ph.slug);
    if (!existsSync(cfile)) continue;
    const text = readFileSync(cfile, 'utf8');
    const cmds = cheapCommands(text);
    for (const id of parseCriteriaIds(text).sort((a, b) => idNum(a) - idNum(b))) {
      const command = cmds.get(id);
      if (!command || SUITE_COMMANDS.includes(command.trim()) || command.trim() === suiteCmd) continue; // the suite covers it
      const res = spawn(command, { shell: true, cwd: root, encoding: 'utf8', timeout: CHEAP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
      const passed = res?.status === 0 && !res?.error;
      cheap.push({ phase: ph.slug, id, command, passed });
      if (!passed) {
        const output = tail(`${res?.stdout ?? ''}${res?.stderr ?? ''}`) || (res?.error ? String(res.error.message ?? res.error) : `exit ${res?.status ?? '?'}`);
        failures.push({ kind: 'criterion', phase: ph.slug, criterion: id, test: null, command, output, claim: claimOf(text, id) });
      }
    }
  }

  const after = treeState(root);
  const clean = before.clean && after.clean;
  const passed = clean && failures.length === 0 && suite.exit === 0;

  // 3. fixes for every failure (never inside the lock: addFix takes it itself), deduplicated by key
  const fixIds = [];
  let changed = 0;
  for (const f of failures) {
    const key = { milestone, phase: f.phase, criterion: f.criterion, test: f.test };
    const existing = findFullCheckFix(root, key);
    if (existing) {
      fixIds.push(existing.id);
      if (existing.status === 'verified') { await setFixStatus(root, existing.id, 'open'); changed++; }
      continue;
    }
    const ph = f.phase ? phases.find((p) => p.slug === f.phase) : null;
    const base = f.kind === 'criterion' ? `phase ${ph?.number ?? f.phase} ${f.criterion} — ${f.claim || 'quick re-check fails'}`
      : f.kind === 'test' ? `${f.test} fails`
      : `milestone ${milestone} suite fails`;
    const report = `${f.command ?? '(no command)'}\n${f.output}`;
    let fix;
    for (let k = 1; !fix && k < 50; k += 1) {
      try {
        fix = await addFix(root, { title: k === 1 ? `full check: ${base}` : `full check #${k}: ${base}`, report, fullcheckFrom: { ...key, command: f.command, tip }, now });
      } catch (e) { if (!/already exists/.test(e.message)) throw e; }
    }
    if (fix) { fixIds.push(fix.id); changed++; }
  }

  const result = { version: 1, milestone, tip, tree: before.tree, clean, passed, at: now.toISOString(), suite, cheap, failures: failures.map(({ claim, ...f }) => f), flaky, fixes: fixIds, warnings };
  ensureLocalDir(root);
  mkdirSync(fullCheckDir(root), { recursive: true });
  atomicWriteJSON(resultFile(root, tip), result);

  // 4. commit fixes.json path-limited (unstamped, the defer.mjs pattern) so the tree stays clean
  let committed = false;
  if (changed) {
    const file = paths(root).fixes;
    const add = git(['add', '--', file], { cwd: root });
    const c = add.status === 0 ? git(['commit', '-m', `chore(fullcheck): milestone ${milestone} — ${changed} fix(es) opened`, '--', file], { cwd: root }) : add;
    committed = c.status === 0;
  }
  return { ...result, committed };
}

/** A stored passing, clean result whose tip contains `commit` and is itself in HEAD's history. */
export function fullCheckCovers(root, commit) {
  const head = headOf(root);
  return allResults(root).some((r) => r.passed === true && r.clean === true && isAncestorOrSame(root, commit, r.tip) && isAncestorOrSame(root, r.tip, head));
}

/** Phases verified or complete on a fast verdict that no passing full check covers yet. A verdict without `fast` is never pending. */
export function pendingPhases(root, phases) {
  return phases.filter((ph) => {
    if (ph.status !== 'verified' && ph.status !== 'complete') return false;
    if (!fastVerdictOf(root, ph.slug)) return false;
    const commit = readVerdict(verdictFile(root, ph.slug)).verdict?.commit;
    return !fullCheckCovers(root, commit);
  });
}

/**
 * May milestone `milestone` close? `{ ok, required, reason }`. Not required (and ok) when no phase has a fast
 * verdict. Otherwise: a passing result for HEAD (so a new commit needs a new check), a clean tree now, and no
 * check-created fix of this milestone left unverified. The refusal names the command, the last tip and the fixes.
 */
export function fullCheckGate(root, { milestone, phases }) {
  const required = phases.some((ph) => fastVerdictOf(root, ph.slug));
  if (!required) return { ok: true, required: false, reason: null };
  const head = headOf(root);
  const res = head ? readFullCheck(root, head) : null;
  const last = lastFullCheck(root);
  const problems = [];
  const open = fullCheckFixes(root, { milestone }).filter((f) => f.status !== 'verified' && f.status !== 'accepted');
  if (open.length) problems.push(`open fix(es): ${open.map((f) => f.id).join(', ')}`);
  if (!res) problems.push(last ? `the last full check was at ${sha7(last.tip)}, not the current tip ${sha7(head)}` : 'no full check has run');
  else if (!res.passed) problems.push(`the full check on ${sha7(head)} failed`);
  else if (res.tree !== git(['rev-parse', 'HEAD^{tree}'], { cwd: root }).stdout?.trim()) problems.push('the check was for another tree');
  else if (!treeState(root).clean) problems.push('the tree is dirty now');
  if (!problems.length) return { ok: true, required: true, reason: null };
  return {
    ok: false, required: true,
    reason: `milestone ${milestone} needs a passing full check on the current tip — ${problems.join('; ')} — run \`ac milestone verify\` (/astro-verify-milestone)`,
  };
}
