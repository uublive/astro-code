// Regression guard for commands/astro-execute.md — ensures the Agent-tool fallback
// tier mandates sequential execution and cannot silently regress to parallel-without-
// isolation.  Per ADR-008, when the Workflow tool is unavailable there is no worktree
// isolation or integrator, so tasks must run one at a time.  Any revert to the old
// "spawn the ready tasks as parallel astro-executor calls in a single message" wording
// must make this suite go red — that is the whole point of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const EXECUTE_MD = join(COMMANDS, 'astro-execute.md');
const ALEX_MD = join(COMMANDS, 'astro-fast.md');
const CONFIG_MD = join(COMMANDS, 'astro-config.md');

/**
 * Slice out the "No Workflow tool, but the Agent tool is available" tier from
 * astro-execute.md.  The tier begins at that exact bullet and ends just before the
 * next peer bullet ("No subagents at all").  Returns the extracted text so that
 * assertions are scoped to the fallback tier only — not to surrounding safe-path prose.
 */
function extractFallbackTier(src) {
  // Start: the line that introduces the Agent-tool fallback
  const startMarker = 'No Workflow tool, but the Agent tool is available';
  // End: the line that opens the inline-only tier
  const endMarker = 'No subagents at all';

  const startIdx = src.indexOf(startMarker);
  assert.ok(
    startIdx !== -1,
    `astro-execute.md: expected to find the marker "${startMarker}" — the fallback tier may have been renamed or removed`,
  );

  const endIdx = src.indexOf(endMarker, startIdx);
  assert.ok(
    endIdx !== -1,
    `astro-execute.md: expected to find the marker "${endMarker}" after the fallback tier — the inline tier may have been renamed or removed`,
  );

  return src.slice(startIdx, endIdx);
}

const src = readFileSync(EXECUTE_MD, 'utf8');
const fallbackTier = extractFallbackTier(src);

// ── 1. The fallback tier mandates sequential execution ──────────────────────────────
//
// At least one of these canonical phrasings must be present.  "sequential" / "one at a
// time" / "one task at a time" are all acceptable ways to express the invariant.  A
// future reword that drops all three would break this test, surfacing that the safety
// contract needs to be re-stated explicitly.

test('astro-execute.md fallback tier requires sequential execution (sequential or one at a time)', () => {
  const hasSequential = /sequential/i.test(fallbackTier);
  const hasOneAtATime = /one\s+(?:task\s+)?at\s+a\s+time/i.test(fallbackTier);
  assert.ok(
    hasSequential || hasOneAtATime,
    `fallback tier must contain "sequential" or "one at a time" / "one task at a time" ` +
      `to express the ADR-008 invariant — found neither in:\n\n${fallbackTier}`,
  );
});

// ── 2. The unsafe "parallel executors, same tree" pattern must be absent ────────────
//
// The original unsafe wording was: "spawn the ready tasks as parallel astro-executor
// calls in a single message".  The regression pattern is `parallel` appearing as an
// instruction *before* `astro-executor` in the tier (i.e. "parallel astro-executor",
// "parallel … astro-executor").  In the safe rewrite, any occurrence of "parallel" is
// used as a negation ("NOT parallel") and `astro-executor` precedes it — so the regex
// below does NOT match the safe text.

test('astro-execute.md fallback tier does not instruct parallel astro-executor calls', () => {
  // The dangerous ordering: the word "parallel" followed (within 80 chars) by
  // "astro-executor" — which was the unsafe "run them in parallel" instruction.
  // The safe text has "astro-executor" mentioned first and "parallel" only in a negation.
  const unsafeParallelExecutor = /parallel.{0,80}astro-executor/s.test(fallbackTier);
  assert.ok(
    !unsafeParallelExecutor,
    `fallback tier must not instruct parallel astro-executor calls (ADR-008). ` +
      `Found the pattern "parallel … astro-executor" in:\n\n${fallbackTier}`,
  );
});

// ── 3. The "in a single message" batching idiom must not be used as an instruction ──
//
// The old unsafe text batched multiple agent spawns "in a single message", which is
// what caused parallel agents to commit to the same working tree.  The safe rewrite
// may mention this phrase only in a negation context ("NOT batched in a single
// message").  We check that every occurrence of "in a single message" in the tier is
// preceded by a negation word within 10 characters so it reads as a prohibition, not
// an instruction.

// ── 4. The fallback tier must instruct executors to stamp commits ───────────────────
//
// Per ADR-017, every astro-executor commit subject must end with `(phase NN tK)` so
// that Discover can detect done tasks on re-run and skip them.  The Agent-tool fallback
// tier in astro-execute.md is the only place this instruction lives for the non-Workflow
// path; its absence would leave fallback runs un-resumable.

test('astro-execute.md fallback tier instructs executors to stamp commits with (phase NN tK)', () => {
  // The phrase "(phase NN tK)" is the canonical stamp format from ADR-017.
  // Accept slight variation in whitespace but require the exact tokens in order.
  const hasStampInstruction = /\(phase\s+NN\s+tK\)/i.test(fallbackTier);
  assert.ok(
    hasStampInstruction,
    `fallback tier must instruct astro-executor to end commit subjects with "(phase NN tK)" ` +
      `(ADR-017 / phase-07 scope) so fallback runs are resumable — found no such instruction in:\n\n${fallbackTier}`,
  );
});

test('astro-execute.md fallback tier does not instruct batching in a single message', () => {
  const phrase = 'in a single message';
  let searchFrom = 0;
  while (true) {
    const idx = fallbackTier.indexOf(phrase, searchFrom);
    if (idx === -1) break; // phrase absent — safe

    // Look back up to 30 characters for a negation token ("NOT batched in a single
    // message" — "NOT" can be up to 20+ chars before "in").
    const lookBack = fallbackTier.slice(Math.max(0, idx - 30), idx).toLowerCase();
    const negated = /\bnot\b|never/.test(lookBack);
    assert.ok(
      negated,
      `fallback tier contains "${phrase}" without a preceding negation (NOT/never) — ` +
        `this reads as an instruction to batch agents in a single message, which is the ` +
        `unsafe pattern (ADR-008). Context:\n\n` +
        fallbackTier.slice(Math.max(0, idx - 40), idx + phrase.length + 40),
    );
    searchFrom = idx + phrase.length;
  }
});

// ── 5. Effort dial (phase 10 / ADR-022) command-doc contract guards ─────────────────
//
// Phase 10 surfaces the per-phase effort dial through the command docs.  These guards
// pin the load-bearing prose so a reword can't silently drop the contract:
//   • astro-execute.md must document the `--effort` one-off, thread `effort` into the
//     Workflow args, and read the now-STRUCTURED verdict (`verdict.summary` /
//     `verdict.passed`) instead of a bare string.
//   • astro-fast.md must keep the fast lane pinned to `effort: "light"` (0 remediation
//     cycles / single-pass) so it never inherits a phase's deeper budget (C10).
// Test-after: t6/t7 have already landed the prose; these assert its shape.

const executeSrc = readFileSync(EXECUTE_MD, 'utf8');
const alexSrc = readFileSync(ALEX_MD, 'utf8');

test('astro-execute.md documents the --effort one-off override', () => {
  // The one-off surface is the `--effort <light|standard|deep>` flag (mirrors `--fast`).
  const hasEffortFlag = /--effort\s+<\s*light\s*\|\s*standard\s*\|\s*deep\s*>/i.test(executeSrc);
  assert.ok(
    hasEffortFlag,
    `astro-execute.md must document the "--effort <light|standard|deep>" one-off override ` +
      `(phase 10 / C5) — found no such flag documentation.`,
  );
});

test('astro-execute.md passes effort into the Workflow args (args.effort)', () => {
  // The level must be threaded to the workflow as an arg — either the `effort: <…>` key
  // inside the args object, or the `args.effort` reference in the surrounding prose.
  const hasEffortArg = /\beffort:\s*</.test(executeSrc) || /\bargs\.effort\b/.test(executeSrc);
  assert.ok(
    hasEffortArg,
    `astro-execute.md must pass the resolved effort level into the Workflow args ` +
      `(an "effort:" key or "args.effort") so the workflow applies the cycle budget — ` +
      `found neither.`,
  );
});

test('astro-execute.md reads the structured verdict (verdict.summary / verdict.passed)', () => {
  // The verify verdict is now a structured object; step 5 must read the boolean gate and
  // the human-facing summary rather than treating the verdict as a bare string.
  const hasPassed = /verdict\.passed/.test(executeSrc);
  const hasSummary = /verdict\.summary/.test(executeSrc);
  assert.ok(
    hasPassed && hasSummary,
    `astro-execute.md must read the structured verdict — both "verdict.passed" and ` +
      `"verdict.summary" (phase 10) — found passed=${hasPassed}, summary=${hasSummary}.`,
  );
});

test('astro-fast.md pins the fast lane to effort: "light"', () => {
  // The fast lane always runs single-pass: it must pass effort:"light" explicitly in its
  // Workflow call so it never inherits a phase's stored (deeper) budget (C10).
  const hasLight = /effort:\s*"light"/.test(alexSrc);
  assert.ok(
    hasLight,
    `astro-fast.md must pin the fast lane to effort:"light" in its Workflow args ` +
      `(0 remediation cycles / single-pass — C10) — found no such pin.`,
  );
});

// ── 6. Cheap-integrator-tier doc guards (phase 14 / ADR-027) ────────────────────────
//
// Phase 14 drops the wave integrator to `models.integrator` (haiku by default) with a
// per-branch bail-to-heal fast-path, and documents `integrator` as the sixth per-role
// model tier. These guards lock the doc text so a future reword can't silently regress
// either contract; test-after by design (t3/t4 already landed the prose — see PLAN.md).
// Assertions are text-shape tolerant (case-insensitive on the load-bearing tokens), not
// brittle full-sentence matches.

const configSrc = readFileSync(CONFIG_MD, 'utf8');

test('astro-execute.md documents the models.integrator tier', () => {
  const hasIntegratorTier = /models\.integrator/i.test(executeSrc);
  assert.ok(
    hasIntegratorTier,
    `astro-execute.md must name "models.integrator" — the per-role config key that drives ` +
      `the wave integrator's tier (ADR-027) — found no such reference.`,
  );
});

test('astro-execute.md documents haiku as the integrator default', () => {
  const hasHaiku = /haiku/i.test(executeSrc);
  assert.ok(
    hasHaiku,
    `astro-execute.md must name "haiku" — the integrator's default tier (ADR-027) — ` +
      `found no such reference.`,
  );
});

test('astro-execute.md documents the per-branch preserve/heal outcome', () => {
  // The fast-path bails per branch, not per wave: a bad branch is preserved and its
  // task re-run through the heal ladder, while clean peers still land in the same pass.
  const hasPreserved = /preserved?/i.test(executeSrc);
  const hasHeal = /heal/i.test(executeSrc);
  assert.ok(
    hasPreserved && hasHeal,
    `astro-execute.md must document the per-branch preserve/heal outcome — both ` +
      `"preserve(d)" and "heal" (ADR-014/ADR-015/ADR-027) — found ` +
      `preserved=${hasPreserved}, heal=${hasHeal}.`,
  );
});

test('astro-config.md role reference names all six roles', () => {
  // Extract the "## Roles, for reference" section so the assertion is scoped to the
  // role list itself, not incidental mentions of role names elsewhere in the doc.
  const startMarker = '## Roles, for reference';
  const startIdx = configSrc.indexOf(startMarker);
  assert.ok(
    startIdx !== -1,
    `astro-config.md: expected to find the "${startMarker}" section — it may have been ` +
      `renamed or removed.`,
  );
  const rolesSection = configSrc.slice(startIdx);

  const roles = ['planner', 'researcher', 'executor', 'verifier', 'discover', 'integrator'];
  const missing = roles.filter((role) => !new RegExp(`\\b${role}\\b`, 'i').test(rolesSection));
  assert.deepEqual(
    missing,
    [],
    `astro-config.md's role reference must name all six roles (phase 14 adds "integrator" ` +
      `as the sixth) — missing: ${missing.join(', ') || 'none'}.`,
  );
});

test('astro-config.md no longer carries an unscoped "do not offer haiku" instruction', () => {
  // Pre-phase-14 the doc forbade haiku for every role, unscoped. Post-phase-14 the
  // prohibition must be scoped to the five *judgement* roles only — integrator is the
  // documented exception (ADR-027) and its own guidance offers haiku as the default.
  // Regression check: every "do not offer haiku" occurrence must have "judgement" (or
  // "judgment") within 300 chars before it, scoping the prohibition to those roles.
  const phrase = /do not\s+offer\s+haiku/gi;
  let match;
  const unscoped = [];
  while ((match = phrase.exec(configSrc)) !== null) {
    const before = configSrc.slice(Math.max(0, match.index - 300), match.index);
    if (!/judg[e]?ment/i.test(before)) {
      unscoped.push(configSrc.slice(Math.max(0, match.index - 40), match.index + 40));
    }
  }
  assert.deepEqual(
    unscoped,
    [],
    `astro-config.md must not carry an unscoped "do not offer haiku" instruction — every ` +
      `occurrence must be scoped to the judgement roles (integrator is the ADR-027 ` +
      `exception). Unscoped occurrences found near:\n\n${unscoped.join('\n---\n')}`,
  );
});

// ── ADR-032: pipelined planning, phase sizing, and the /astro-fast rename ─────────
//
// These three came out of measuring a real project: execution is the long pole (49min
// mean vs 12min for planning), fixed per-phase overhead dominates small phases, and the
// fast lane's old name (/astro-alex) did not say what it was for.

const CMD_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const cmd = (n) => readFileSync(join(CMD_DIR, n), 'utf8');

// The old name is spelled via a variable so a future blanket rename cannot silently
// rewrite the very literal this guard exists to look for.
const OLD_FAST_NAME = ['astro', 'alex'].join('-');

test('ADR-032: /astro-fast exists and the old name is fully gone', () => {
  assert.ok(existsSync(join(CMD_DIR, 'astro-fast.md')), 'commands/astro-fast.md must exist');
  assert.ok(
    !existsSync(join(CMD_DIR, `${OLD_FAST_NAME}.md`)),
    `the old ${OLD_FAST_NAME}.md must be gone, not left as a stale duplicate`,
  );
  // A dangling reference is worse than the rename: it points at a command that no longer
  // registers, so the suggestion silently does nothing.
  for (const f of readdirSync(CMD_DIR).filter((x) => x.endsWith('.md'))) {
    assert.ok(!cmd(f).includes(OLD_FAST_NAME), `commands/${f} still references the old ${OLD_FAST_NAME} name`);
  }
});

test('ADR-032: /astro-execute pipelines the next phase plan, gated on the discuss gate', () => {
  const src = cmd('astro-execute.md');
  assert.ok(/pipeline/i.test(src), 'astro-execute.md must document pipelined planning');
  assert.ok(/plan-phase\.mjs/.test(src), 'the pipelined step must name the plan workflow it launches');
  // Load-bearing: auto-planning an undiscussed phase would defeat the discuss gate that
  // /astro-plan enforces via `ac phase context`.
  assert.ok(
    /ac phase context/.test(src) && /ready/.test(src),
    'the pipelined plan MUST be gated on `ac phase context` printing ready — never auto-plan an undiscussed phase',
  );
  assert.ok(/--no-pipeline/.test(src), 'there must be a documented opt-out');
  // One activity slot: the executing phase owns it.
  assert.ok(/activity/.test(src), 'the pipelined step must say what happens to the live status');
});

test('ADR-032: /astro-phase carries sizing guidance with an explicit upper bound', () => {
  const src = cmd('astro-phase.md');
  assert.ok(/fewer, larger phases/i.test(src), 'astro-phase.md must state the fewer-larger-phases preference');
  // Without the counterweight this reads as "always merge", which breaks verification.
  assert.ok(
    /one coherent goal/i.test(src) && /(too big|do NOT merge)/i.test(src),
    'the sizing guidance must bound itself — a phase whose criteria are not one coherent bar is too big',
  );
});

// ── ADR-034: the pipeline gate must be observable, and its ordering trap documented ──
//
// v0.11.0 benchmark: pipelining fired zero times because the documented per-phase order
// leaves phase N+1 undiscussed when execute N runs. The gate is correct; it was simply
// unreachable — and being silent when unmet made "gated off", "skipped" and "broken"
// indistinguishable.

test('ADR-034: the pipeline gate reports when it does NOT fire', () => {
  const src = cmd('astro-execute.md');
  assert.ok(
    /exactly one line/i.test(src) && /Do not skip silently/i.test(src),
    'the pipeline step must emit one line when the gate is not met — silence made the feature untestable',
  );
});

test('ADR-034: the ordering trap is documented where it bites', () => {
  const src = cmd('astro-execute.md');
  assert.ok(/ordering trap/i.test(src), 'astro-execute.md must name the ordering trap');
  assert.ok(
    /BEFORE `\/astro-execute`|before .{0,20}execute/i.test(src),
    'it must say the next phase has to be discussed BEFORE executing the current one',
  );
  // And the status command should steer the user there proactively.
  assert.ok(/ADR-032|pipeline/i.test(cmd('astro-status.md')), 'astro-status.md should keep the pipeline fed');
});

// ── ADR-048/050: the run-contract's three outcomes must stay distinguishable ─────────
//
// With no manifest and no template (D5), RUN-CONTRACT.md and the two scaffolding
// commands are the ONLY consistency mechanism between generated projects. These guards
// are cheap static checks only — they protect against silent deletion of load-bearing
// prose (C7's three outcomes reading identically, or the pinned values drifting between
// the contract doc and the commands that implement it). They do NOT prove the cold
// start actually works; that proof is t10/t11's live rehearsal.

const RUN_CONTRACT_MD = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'RUN-CONTRACT.md');
const runContractSrc = () => readFileSync(RUN_CONTRACT_MD, 'utf8');

test('ADR-048/050: astro-new-project and astro-adopt keep the three cold-start outcomes worded distinctly', () => {
  for (const name of ['astro-new-project.md', 'astro-adopt.md']) {
    const src = cmd(name);
    assert.ok(src.includes('Cold start verified'), `${name} must report "Cold start verified" on success`);
    assert.ok(
      src.includes('Cold start NOT verified'),
      `${name} must report "Cold start NOT verified" when the boot could not be attempted (e.g. Docker unavailable)`,
    );
    assert.ok(
      src.includes('Cold start FAILED'),
      `${name} must report "Cold start FAILED" when a boot was attempted and did not succeed`,
    );
    // C7 fails the phase if these three outcomes read the same — a caller (human or
    // fleet automation) must be able to tell "never ran" apart from "ran and broke".
    const stems = ['Cold start verified', 'Cold start NOT verified', 'Cold start FAILED'];
    assert.equal(new Set(stems).size, 3, 'sanity: the three stems this test asserts on must themselves be distinct');
  }
});

test('ADR-051: astro-new-project and astro-adopt name the pinned RUN_SEED consent variable', () => {
  for (const name of ['astro-new-project.md', 'astro-adopt.md']) {
    const src = cmd(name);
    assert.ok(src.includes('RUN_SEED'), `${name} must name the pinned RUN_SEED consent variable`);
  }
});

test('ADR-051: the service_completed_successfully edge is named where it is wired', () => {
  // astro-new-project.md deliberately does NOT restate RUN-CONTRACT.md's dependency
  // edges verbatim ("a restatement drifts out of sync with the source of truth") — it
  // points at the contract as the single source of truth instead. astro-adopt.md wires
  // an EXISTING project's compose file directly, so it must state the edge explicitly.
  assert.ok(
    cmd('astro-adopt.md').includes('service_completed_successfully'),
    'astro-adopt.md must name the app.depends_on.seed: service_completed_successfully edge',
  );
  assert.ok(
    runContractSrc().includes('service_completed_successfully'),
    'templates/RUN-CONTRACT.md — the source of truth astro-new-project.md defers to — must name the edge',
  );
});

test('ADR-048/051: templates/RUN-CONTRACT.md states the pinned service names, RUN_SEED, the Compose 2.1.1 floor, and the --reset fork', () => {
  const src = runContractSrc();
  assert.ok(/\bapp\b/.test(src), 'RUN-CONTRACT.md must name the `app` web service');
  assert.ok(/\bseed\b/.test(src), 'RUN-CONTRACT.md must name the `seed` service');
  assert.ok(src.includes('RUN_SEED'), 'RUN-CONTRACT.md must name the pinned RUN_SEED consent variable');
  assert.ok(
    src.includes('2.1.1'),
    'RUN-CONTRACT.md must state the Docker Compose v2.1.1+ floor below which service_completed_successfully is silently ignored',
  );
  assert.ok(
    src.includes('--reset'),
    'RUN-CONTRACT.md must state the --reset fork between local dev (persistent, no reset) and preview (ephemeral, reset)',
  );
});

// ── Phase 17 t11: /astro-new-project fills the declaration and distils the rule ────
//
// C6 requires a generated project to keep the fixture-currency rule and its declaration
// on its own, with astro-code deleted — so /astro-new-project must (a) actually fill in
// RUN-CONTRACT.md's live-but-empty declaration block with the project's real paths when
// it copies the contract to the project root, and (b) distil the rule as a state outcome
// (never a file-edit obligation) into the CONVENTIONS.md "Run contract" section, with a
// pointer to where the declaration lives. Library/CLI-shaped projects skip both.

test('astro-new-project.md fills in the fixtures declaration block when copying RUN-CONTRACT.md', () => {
  const src = cmd('astro-new-project.md');
  assert.ok(
    /fill\s+in\s+the\s+declaration/i.test(src),
    "astro-new-project.md must instruct filling in the declaration block with the project's real paths",
  );
  assert.ok(
    /data-model:/.test(src) && /seed:/.test(src),
    'astro-new-project.md must reference both declaration keys (data-model: and seed:)',
  );
  assert.ok(
    /no\s+data\s+model\s+yet/i.test(src) && /leave\s+`?data-model:`?\s+empty/i.test(src),
    'astro-new-project.md must say to leave data-model: empty at birth when there is no data model yet, and say so in one line',
  );
});

test('astro-new-project.md distils the fixture-currency rule into CONVENTIONS.md as a state outcome, with a pointer to the declaration', () => {
  const src = cmd('astro-new-project.md');
  assert.ok(
    /cold\s+start\s+comes\s+up\s+holding\s+the\s+state/i.test(src),
    'astro-new-project.md must phrase the distilled rule as the state outcome the cold start must hold, not as a file-edit obligation',
  );
  assert.ok(
    !/edit the seed file/i.test(src),
    'astro-new-project.md must not phrase the fixture-currency rule as "edit the seed file" (a file-edit obligation, D1)',
  );
  assert.ok(
    /declaration/i.test(src),
    'astro-new-project.md must point to where the fixtures declaration lives from the distilled canon section',
  );
});

test('astro-new-project.md skips the declaration and distilled rule for library/CLI-shaped projects', () => {
  const src = cmd('astro-new-project.md');
  // The existing "skip all of it" / "skip this entire step" library/CLI carve-out must
  // still be present and cover the newly added declaration-filling and rule-distilling
  // work, not just the container/seed scaffolding it originally guarded.
  assert.ok(
    /Library\/CLI-shaped projects skip/i.test(src),
    'astro-new-project.md must keep an explicit library/CLI skip instruction covering the fixtures declaration and distilled rule',
  );
});

// ── ADR-050/052 (C4): the fixture-currency check must stay wired into both execution
// lanes. This is a regression guard, not new behaviour — deleting either invocation
// (t4's step 4e in astro-execute.md, or t5's step 8b in astro-fast.md) must turn this
// suite red, because a warning nobody triggers is indistinguishable from no warning.

test('astro-execute.md and astro-fast.md both invoke `ac fixtures check`', () => {
  for (const name of ['astro-execute.md', 'astro-fast.md']) {
    assert.ok(
      cmd(name).includes('ac fixtures check'),
      `${name} must invoke \`ac fixtures check\` — deleting the invocation must not go unnoticed`,
    );
  }
});

test('astro-execute.md runs the fixture check after the wave workflow and before the verdict', () => {
  const src = cmd('astro-execute.md');
  const workflowIdx = src.indexOf('Workflow({');
  const checkIdx = src.indexOf('ac fixtures check');
  const verdictIdx = src.indexOf('5. Clear the live status');
  assert.ok(workflowIdx !== -1, 'astro-execute.md must still call Workflow({...})');
  assert.ok(checkIdx !== -1, 'astro-execute.md must invoke `ac fixtures check`');
  assert.ok(verdictIdx !== -1, 'astro-execute.md must still carry the step-5 verdict section');
  assert.ok(
    workflowIdx < checkIdx,
    'the fixture check must run AFTER the Workflow({...}) call — it needs a stamped diff the waves produced, which does not exist before they run',
  );
  assert.ok(
    checkIdx < verdictIdx,
    'the fixture check must run BEFORE step 5 reports the verdict, so its output can be folded into that summary',
  );
});

test('astro-fast.md runs the fixture check after the step-8 execution block and covers both tiers', () => {
  const src = cmd('astro-fast.md');
  const step8Idx = src.search(/^8\./m);
  const checkIdx = src.indexOf('ac fixtures check');
  const step9Idx = src.search(/^9\./m);
  assert.ok(step8Idx !== -1, 'astro-fast.md must still carry the step-8 execution block');
  assert.ok(checkIdx !== -1, 'astro-fast.md must invoke `ac fixtures check`');
  assert.ok(step9Idx !== -1, 'astro-fast.md must still carry the step-9 report');
  assert.ok(
    step8Idx < checkIdx && checkIdx < step9Idx,
    'the fixture check must run after the step-8 execution block and before step 9 reports',
  );
  // One wording must cover BOTH tiers (the Workflow-tool call and the no-Workflow
  // Agent-tool fallback) — a tier-specific step is exactly how the fallback silently
  // skips the check.
  const window = src.slice(step8Idx, step9Idx);
  assert.ok(
    /whichever tier ran/i.test(window),
    'astro-fast.md must phrase the fixture check to cover whichever tier ran step 8 — a tier-specific wording lets the fallback skip it silently',
  );
});

test("both lanes state the fixture-check output is folded into the run's final summary", () => {
  for (const name of ['astro-execute.md', 'astro-fast.md']) {
    const src = cmd(name);
    assert.ok(
      /fold[\s\S]{0,20}output[\s\S]{0,20}verbatim/i.test(src),
      `${name} must state that the fixture check's output is folded verbatim into the final summary, not reduced to a silent side effect`,
    );
  }
});

test('astro-execute.md tells the agent a canon-pull refusal or collision is not a failure to retry or force', () => {
  const src = cmd('astro-execute.md');
  const pullIdx = src.indexOf('ac canon pull');
  assert.ok(pullIdx !== -1, 'astro-execute.md must still call `ac canon pull` in its canon-refresh step');
  const window = src.slice(pullIdx, pullIdx + 600).replace(/\s+/g, ' ');
  assert.ok(
    /refusal or collision warning is \*\*not\*\* a failure to retry or force/i.test(window),
    'astro-execute.md must state that a refusal or collision warning is NOT a failure to retry or force',
  );
  assert.ok(
    /report it in the run summary and continue/i.test(window),
    'astro-execute.md must instruct the agent to report the refusal/collision in the run summary and continue',
  );
  assert.ok(
    /never pass `--force` from an agent/i.test(window),
    'astro-execute.md must forbid an agent from passing `--force` to `ac canon pull`',
  );
});
