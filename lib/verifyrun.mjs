// One headless verifier trial (phase 51, P6): the same agent and the same contract `/astro-verify`
// uses, run in a copy of the project, and its verdict read in code.
//
// Why the contract is read, not copied (9173): `commands/astro-verify.md` step 2 restates the
// verifier's contract when it spawns the agent. Calibration must hand the verifier EXACTLY that, or
// the number would measure a different verifier. The sentence is wrapped in
// `<!-- verifier-contract -->` markers there and read from here; a second copy would drift the first
// time the command is edited, and the drift would be invisible in the result.
//
// Why PASS is judged here and not by the model (333f): the verifier's verdict is its own, but whether
// that verdict counts as a PASS (every CRITERIA.md id present and passed) is a mechanical rule. A
// trial that crashed, was capped, or answered with something unparseable is INVALID, never a PASS and
// never a catch: counting a crash as a catch would flatter the verifier.
//
// The agent role text is loaded by Claude Code from the installed `astro-verifier` agent, exactly as
// a spawned verifier loads it. The prompt fingerprint hashes it (and the package copy, the contract
// and the prompt frame) so a prompt edit changes the hash recorded in the calibration log.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execCommand } from './hosts/claude.mjs';
import { runCapped } from './caprun.mjs';

export const VERIFY_TRIAL_CAP_MS = 45 * 60 * 1000;
export const VERIFIER_AGENT = 'astro-verifier';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = (text) => createHash('sha256').update(text).digest('hex');
const OPEN = '<!-- verifier-contract -->';
const CLOSE = '<!-- /verifier-contract -->';

/** The contract sentence of `commands/astro-verify.md`, whitespace collapsed. Throws without its markers. */
export function verifierContract({ file = join(PKG, 'commands', 'astro-verify.md') } = {}) {
  const text = readFileSync(file, 'utf8');
  const a = text.indexOf(OPEN);
  const b = text.indexOf(CLOSE);
  if (a < 0 || b < a) throw new Error(`${file} has no ${OPEN} … ${CLOSE} markers`);
  return text.slice(a + OPEN.length, b).replace(/\s+/g, ' ').trim();
}

const frameText = ({ number, slug, goal, criteriaPath, contract }) => [
  `Verify phase ${number} (${slug}) of this project. Phase goal: ${goal}`,
  `Its pre-registered bar is ${criteriaPath}.`,
  `Restating your contract: ${contract}`,
  'This is a full verify, not narrowed: check every criterion in CRITERIA.md, and put the full test suite through its paces.',
  'End with the fenced JSON verdict your role defines, covering every criterion:',
  '```json',
  '{"mode":"full","broad":false,"criteria":[{"id":"C1","passed":true}]}',
  '```',
].join('\n');

/**
 * `{ prompt, frame }`. `prompt` is what the verifier receives; `frame` is the same text with the
 * project-sourced values (goal, slug, path) replaced by neutral placeholders, i.e. everything calibrate
 * itself authored, which the blindness check holds to the no-leak-word rule.
 */
export function trialPrompt({ number, slug, goal, criteriaPath, contract = verifierContract() }) {
  return {
    prompt: frameText({ number, slug, goal, criteriaPath, contract }),
    frame: frameText({ number, slug: 'the-phase', goal: 'the goal', criteriaPath: 'CRITERIA.md', contract }),
  };
}

// The agent's own `tools:` frontmatter line, so a trial may use exactly what a spawned verifier may.
function agentTools(file = join(PKG, 'agents', `${VERIFIER_AGENT}.md`)) {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(file, 'utf8').split('\n---')[0]);
  return m ? m[1].split(',').map((t) => t.trim()).filter(Boolean) : [];
}

/** The claude argv (command first) for one trial. `model` of `inherit` or unset adds no `--model`. */
export function trialArgv({ prompt, model, maxBudgetUsd }) {
  const { command, args } = execCommand({
    prompt, json: true, model: model && model !== 'inherit' ? model : undefined,
    tools: agentTools(), agent: VERIFIER_AGENT, maxBudgetUsd,
  });
  return [command, ...args];
}

/**
 * Read a trial's stdout (a `--output-format json` envelope, or plain text). `outcome` is `pass` when
 * the verifier passed EVERY id in `criteriaIds` (an absent id counts as failed, as in a full verdict
 * record), `fail` otherwise, and `invalid` with a `reason` when there is no usable verdict.
 */
export function parseTrialVerdict(stdout, criteriaIds) {
  let text = String(stdout ?? '');
  let cost = null;
  try {
    const env = JSON.parse(text);
    if (env && typeof env === 'object' && !Array.isArray(env)) {
      if (Number.isFinite(env.total_cost_usd)) cost = env.total_cost_usd;
      if (env.is_error) return { outcome: 'invalid', reason: 'the verifier reported an error', cost };
      text = typeof env.result === 'string' ? env.result : '';
    }
  } catch { /* plain text: the whole output is the answer */ }
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  if (!blocks.length) return { outcome: 'invalid', reason: 'no fenced JSON verdict', cost };
  let verdict;
  try { verdict = JSON.parse(blocks[blocks.length - 1][1]); } catch { return { outcome: 'invalid', reason: 'the verdict is not valid JSON', cost }; }
  const rows = Array.isArray(verdict?.criteria) ? verdict.criteria : [];
  if (!rows.length) return { outcome: 'invalid', reason: 'the verdict lists no criteria', cost };
  if (!criteriaIds.length) return { outcome: 'invalid', reason: 'no criteria ids to grade against', cost };
  const failed = criteriaIds.filter((id) => {
    const mine = rows.filter((r) => r?.id === id);
    return !mine.length || mine.some((r) => r.passed !== true);
  });
  return { outcome: failed.length ? 'fail' : 'pass', failed_ids: failed, cost };
}

/**
 * Spawn one trial. Never throws. `{ outcome, reason?, cost, failed_ids?, no_verifier? }`: a missing
 * `claude` binary is `no_verifier` (the caller stops the run), anything else that is not a readable
 * verdict is `invalid`.
 */
export async function runTrial({ cwd, argv, env, criteriaIds, run = runCapped, capMs = VERIFY_TRIAL_CAP_MS }) {
  const r = await run(argv, { cwd, env, capMs });
  if (r.error?.code === 'ENOENT') return { outcome: 'invalid', reason: 'claude is not installed', cost: null, no_verifier: true };
  if (r.error) return { outcome: 'invalid', reason: `could not start claude: ${r.error.message}`, cost: null };
  if (r.capped) return { outcome: 'invalid', reason: 'capped', cost: null };
  if (r.status !== 0) {
    const cost = parseTrialVerdict(r.stdout, criteriaIds).cost;
    return { outcome: 'invalid', reason: `exit ${r.status}`, cost };
  }
  return parseTrialVerdict(r.stdout, criteriaIds);
}

const readOrNull = (f) => { try { return readFileSync(f, 'utf8'); } catch { return null; } };

/** What identifies the verifier under test: the hash that changes when any prompt part does (C9). */
export function promptFingerprint({ env = process.env } = {}) {
  const agent = readFileSync(join(PKG, 'agents', `${VERIFIER_AGENT}.md`), 'utf8');
  const installedFile = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'agents', `${VERIFIER_AGENT}.md`);
  const installed = existsSync(installedFile) ? readOrNull(installedFile) : null;
  const contract = verifierContract();
  const frame = trialPrompt({ number: 0, slug: '', goal: '', criteriaPath: '', contract }).frame;
  const parts = { agent_sha: sha(agent), installed_agent_sha: installed === null ? null : sha(installed), contract_sha: sha(contract), frame_sha: sha(frame) };
  let version = null;
  try { version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version; } catch { /* no package.json */ }
  return { prompt_hash: sha(Object.values(parts).map((p) => p ?? '-').join('\n')).slice(0, 16), ...parts, version };
}
