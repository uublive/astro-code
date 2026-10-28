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
// THE CHEAP PASS CAN ONLY FAIL A RUN. A clean pass records nothing. An unmet one records a narrowed,
// `stage: 'cheap'` verdict (`recordVerdict` forces narrowed, never records a cheap pass as passed,
// and `verifiedGate` refuses it), so `ac verdict history` shows the round and the remediation loop
// sees the failing ids; the criteria the pass did not look at are `unobserved`, not failed.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { criteriaFile, verdictFile, readVerdict, recordVerdict, parseCriteriaIds } from './verdict.mjs';
import { cheapCommands, suiteIds, suiteCommandsFor, SUITE_COMMANDS } from './impact.mjs';
import { reusableReceipt, runSuite } from './receipts.mjs';

export const CHEAP_TIMEOUT_MS = 10 * 60 * 1000;
const OUTPUT_MAX = 2000;
const tail = (s) => { const t = String(s ?? '').trim(); return t.length > OUTPUT_MAX ? t.slice(-OUTPUT_MAX) : t; };

/**
 * Run the cheap pass for `slug`. Returns `{ clean, ran: [{ id, kind: 'suite'|'cheap', passed, command,
 * output, receipt? }], unmet: [ids], unchecked: [ids], recorded }`. `recorded` is the record result
 * when something was unmet, else null. Never throws on a record failure (b940): it is reported.
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
  const suiteCache = new Map(); // one suite command is run (or its receipt read) once per pass
  for (const id of ids) {
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
          const rc = runSuite(root, cmd, { json: true, spawn });
          suiteCache.set(cmd, { command: cmd, passed: rc.exit === 0, receipt: rc.key, output: `suite exited ${rc.exit}: ${cmd}` });
        }
      }
      ran.push({ id, kind: 'suite', ...suiteCache.get(cmd) });
      continue;
    }
    const command = cheap.get(id);
    if (!command) { unchecked.push(id); continue; }
    const res = spawn(command, { shell: true, cwd: root, encoding: 'utf8', timeout: CHEAP_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    const passed = res?.status === 0 && !res?.error;
    const output = tail(`${res?.stdout ?? ''}${res?.stderr ?? ''}`) || (res?.error ? String(res.error.message ?? res.error) : `exit ${res?.status ?? '?'}`);
    ran.push({ id, kind: 'cheap', passed, command, output });
  }

  const unmet = ran.filter((x) => !x.passed).map((x) => x.id);
  let recorded = null;
  if (unmet.length) {
    try {
      recorded = await recordVerdict(root, slug, {
        mode: 'narrowed', stage: 'cheap',
        criteria: ran.filter((x) => !x.passed).map((x) => ({ id: x.id, passed: false, command: x.command, output: x.output })),
      });
    } catch (e) { recorded = { recorded: false, error: e.message }; }
  }
  return { clean: unmet.length === 0, ran, unmet, unchecked, recorded };
}
