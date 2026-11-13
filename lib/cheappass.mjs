// The cheap first pass of a verify (phase 54, D4, ADR-091): the suite (through a reusable receipt)
// plus each criterion's DECLARED cheapest observation, run by code before any expensive scenario.
//
// The bug this prevents: a verifier ran heavy scenarios (a scratch world, a pre-phase build) to
// discover a failure a ten-second command would have shown, then did it again after the fix. Here the
// cheap checks run first, ALL of them (never bailing at the first failure, D5), and when anything is
// unmet the round ends with a FAIL listing every unmet id, before an expensive stage is spawned.
//
// What counts as a cheap observation is declared, not guessed (333f): a `- **Cheap:** `<command>``
// line in the criterion (lib/impact.mjs `cheapCommands`), exit 0 meaning met; or, for a suite
// criterion, its own suite command, checked through `reusableReceipt` first and `runSuite` only on a
// miss (ADR-089, so an identical clean tree is never re-run). A criterion with neither is `unchecked`:
// it is observed in the expensive stage.
//
// A SLOW SUITE IS NEVER RUN HERE (phase 56, ADR-093). On a receipt miss `suiteSpeed` (lib/receipts.mjs)
// decides from the newest recorded run of the command: slow, or never timed, means the suite is `held`
// (held back, not run), not unmet, so a round that fails on a ten-second criterion never pays for a
// fifty-minute suite. A reusable receipt still counts: it costs nothing. `held` never makes a pass unclean
// and never a pass either: the expensive stage runs the suite last, through `ac suite run`.
//
// FAST MODE (phase 57, ADR-094; the default, `verify.full_suite: milestone`). The cheap pass runs NO suite:
// not through a receipt, not timed, not held. A suite criterion, and a `Cheap:` command that is exactly a
// suite command, go to `fast.milestone` (carried to the milestone full check), so a phase never pays for the
// suite through its own Cheap line. In its place it runs the phase's TARGETED test set (lib/targeted.mjs)
// through `runTargeted`, whose receipt is what `recordVerdict` later requires for a PASS. The ADR-093 hold
// never applies here: the suite is skipped, not deferred. A red set makes the pass unclean without a
// pseudo-id in `unmet` (only criteria are recorded as the narrowed cheap verdict); with no linked tests
// nothing runs and `fast.reason` says so, never a fallback to the suite. `verify.full_suite: phase` keeps
// the suite/held behaviour above exactly.
//
// THE CHEAP PASS CAN ONLY FAIL A RUN. A clean pass records nothing. An unmet one records a narrowed,
// `stage: 'cheap'` verdict (`recordVerdict` forces narrowed, never records a cheap pass as passed,
// and `verifiedGate` refuses it), so `ac verdict history` shows the round and the remediation loop
// sees the failing ids; the criteria the pass did not look at are `unobserved`, not failed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { criteriaFile, verdictFile, readVerdict, recordVerdict, parseCriteriaIds } from './verdict.mjs';
import { cheapCommands, suiteIds, suiteCommandsFor, SUITE_COMMANDS } from './impact.mjs';
import { reusableReceipt, runSuite, suiteSpeed, runTargeted } from './receipts.mjs';
import { verifyFullSuite, targetedCommandTemplate } from './config.mjs';
import { targetedTests } from './targeted.mjs';

export const CHEAP_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_MAX = 2000;
const tail = (s) => { const t = String(s ?? '').trim(); return t.length > OUTPUT_MAX ? t.slice(-OUTPUT_MAX) : t; };

/**
 * Run the cheap pass for `slug`. Returns `{ clean, ran: [{ id, kind: 'suite'|'cheap', passed, command,
 * output, receipt? }], unmet: [ids], unchecked: [ids], held: [{ id, command, seconds, threshold_seconds,
 * reason }], warnings: [text], recorded, fast? }`. `recorded` is the record result
 * when something was unmet, else null. `fast` (ADR-094, fast mode only): `{ mode: 'milestone', tests,
 * command, passed, failing, reused, reason, limits, unmapped, milestone: [ids] }`. Never throws on a record failure (b940): it is reported.
 */
export async function runCheapPass(root, slug, { spawn = spawnSync } = {}) {
  const cfile = criteriaFile(root, slug);
  const text = existsSync(cfile) ? readFileSync(cfile, 'utf8') : '';
  const ids = parseCriteriaIds(text);
  const cheap = cheapCommands(text);
  const { verdict } = readVerdict(verdictFile(root, slug));
  const sticky = new Set((verdict?.criteria ?? []).filter((c) => c.suite === true).map((c) => c.id));
  const suite = new Set([...suiteIds(text), ...sticky]);

  const ran = [];
  const unchecked = [];
  const held = [];
  const warnings = [];
  const fastMode = verifyFullSuite(root, warnings) === 'milestone';
  const milestone = []; // fast mode: criteria carried to the milestone full check
  const suiteCache = new Map(); // one suite command is run (or its receipt read) once per pass
  for (const id of ids) {
    if (fastMode && suite.has(id)) { milestone.push(id); continue; }
    if (suite.has(id)) {
      const cmds = suiteCommandsFor(text, id);
      // The criterion names no suite command of its own: the project's suite command is not known
      // here, so there is nothing cheap to run (it is observed in the expensive stage).
      if (cmds === SUITE_COMMANDS) { unchecked.push(id); continue; }
      const cmd = cmds[0];
      if (!suiteCache.has(cmd)) {
        const got = cmds.map((c) => reusableReceipt(root, c)).find((g) => g.ok);
        if (got) suiteCache.set(cmd, { command: got.receipt.command, passed: true, receipt: got.receipt.key, output: `reused suite receipt ${got.receipt.key.slice(0, 8)}` });
        else {
          const sp = suiteSpeed(root, cmd, warnings);
          if (sp.slow) suiteCache.set(cmd, { held: { command: cmd, seconds: sp.seconds, threshold_seconds: sp.threshold_seconds, reason: sp.reason } });
          else {
            const rc = runSuite(root, cmd, { json: true, spawn });
            suiteCache.set(cmd, { command: cmd, passed: rc.exit === 0, receipt: rc.key, output: `suite exited ${rc.exit}: ${cmd}` });
          }
        }
      }
      const cached = suiteCache.get(cmd);
      if (cached.held) { held.push({ id, ...cached.held }); continue; }
      ran.push({ id, kind: 'suite', ...cached });
      continue;
    }
    const command = cheap.get(id);
    if (!command) { unchecked.push(id); continue; }
    if (fastMode && SUITE_COMMANDS.includes(command.trim())) { milestone.push(id); continue; }
    const res = spawn(command, { shell: true, cwd: root, encoding: 'utf8', timeout: CHEAP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const passed = res?.status === 0 && !res?.error;
    const output = tail(`${res?.stdout ?? ''}${res?.stderr ?? ''}`) || (res?.error ? String(res.error.message ?? res.error) : `exit ${res?.status ?? '?'}`);
    ran.push({ id, kind: 'cheap', passed, command, output });
  }

  const unmet = ran.filter((x) => !x.passed).map((x) => x.id);
  let fast;
  if (fastMode) {
    const t = targetedTests(root, slug);
    fast = { mode: 'milestone', tests: t.tests, command: null, passed: true, failing: [], reused: false, reason: t.reason, limits: t.limits, unmapped: t.unmapped, milestone };
    if (t.tests.length) {
      const r = runTargeted(root, t.tests, targetedCommandTemplate(root, warnings), { spawn });
      Object.assign(fast, { command: r.command, passed: r.passed, failing: r.failing, reused: r.reused, ...(r.note ? { note: r.note } : {}) });
    }
  }
  let recorded = null;
  if (unmet.length) {
    try {
      recorded = await recordVerdict(root, slug, {
        mode: 'narrowed', stage: 'cheap',
        criteria: [
          ...ran.filter((x) => !x.passed).map((x) => ({ id: x.id, passed: false, command: x.command, output: x.output })),
          ...held.map((h) => ({ id: h.id, held: true, suite: true })),
        ],
      });
    } catch (e) { recorded = { recorded: false, error: e.message }; }
  }
  return { clean: unmet.length === 0 && (fast?.passed ?? true), ran, unmet, unchecked, held, warnings, recorded, ...(fast ? { fast } : {}) };
}
