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

test('astro-plan.md tells the agent a canon-pull refusal or collision is not a failure to retry or force', () => {
  const src = cmd('astro-plan.md');
  const pullIdx = src.indexOf('ac canon pull');
  assert.ok(pullIdx !== -1, 'astro-plan.md must still call `ac canon pull` in its canon-refresh step');
  const window = src.slice(pullIdx, pullIdx + 600).replace(/\s+/g, ' ');
  assert.ok(
    /refusal or collision warning is \*\*not\*\* a failure to retry or force/i.test(window),
    'astro-plan.md must state that a refusal or collision warning is NOT a failure to retry or force',
  );
  assert.ok(
    /report it in the run summary and continue/i.test(window),
    'astro-plan.md must instruct the agent to report the refusal/collision in the run summary and continue',
  );
  assert.ok(
    /never pass `--force` from an agent/i.test(window),
    'astro-plan.md must forbid an agent from passing `--force` to `ac canon pull`',
  );
});

// ── Phase 19 t11: the Voice guard (ADR-055, D4/D5) ──────────────────────────────────
//
// What this file asserts, and nothing more (P5): every human-facing reporting slot in
// the seven loop commands (discuss, plan, execute, verify, accept, status, debt) states
// either an emission bound ("in one line", "at most three lines") or a silence rule
// ("say nothing when there is nothing to report"). That is SHAPE ONLY — never quality,
// never free-form prose, never the other nineteen commands. A word/line/character-count
// gate is deliberately absent (D5): whether a paragraph earned its place is not
// mechanically testable, and a length gate would just produce worse writing.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO_CONVENTIONS = join(ROOT, '.astrocode', 'CONVENTIONS.md');
const TEMPLATE_CONVENTIONS = join(ROOT, 'templates', 'CONVENTIONS.md');
const ROOT_AGENTS = join(ROOT, 'AGENTS.md');
const TEMPLATE_AGENTS = join(ROOT, 'templates', 'AGENTS.md');
const VERIFIER_MD = join(ROOT, 'agents', 'astro-verifier.md');

// P4's bound vocabulary — a concept-level regex, not pinned prose. A copyedit of a slot
// must not go red (C3); only deleting the bound itself may (C2). Extended with one extra
// alternative ("two or three sentences") to cover astro-debt.md's pre-existing assessment
// slot, which the phase-19 audit already judged compliant (PLAN.md) but which the plan's
// literal P4 regex does not match — still a stated numeric bound, just an "X or Y" range.
//
// Phase 23 remediation (C5): a `\bnothing extra\b` alternative was added here to make
// astro-accept.md's 4b principle-capture slot pass WITHOUT the slot actually stating its
// own bound — the slot's only matching phrase ("A plain acceptance proposes nothing and
// prints nothing extra") described a DIFFERENT case (the accept path, which never even
// reaches 4b) rather than the capture step's own reporting bound. Widening the regex to
// catch that unrelated phrase is exactly the gaming this guard exists to prevent (C2:
// only deleting/weakening the BOUND, never widening the matcher, may turn a slot green).
// The fix belongs in the doc: 4b now states its own "one line" bound directly, so the
// alternative is removed rather than kept as a foothold for the next copyedit to lean on.
const BOUND_RE =
  /\b(?:in|at most|no more than|to)\s+(?:exactly\s+)?(?:one|two|three|\d+)\s+(?:short\s+)?(?:line|lines|sentence|sentences)\b|\b(?:one|two|three|\d+)\s+or\s+(?:two|three|\d+)\s+(?:short\s+)?(?:line|lines|sentence|sentences)\b|\bone[- ]liner\b|\bone line\b|\bsay nothing\b|\bnothing at all\b|\bno output\b|\bsilence means\b|\bskip (?:this|it) (?:silently|in silence)\b/i;

/**
 * Slice `src` between two literal anchors (the numbered-step / bullet markers already
 * unique per file) and assert BOUND_RE matches inside. `end === null` slices to EOF.
 * Fails loudly, naming the command and the slot, if either anchor is missing — a renamed
 * step must not silently drop out of the guard.
 */
function assertSlotBound(src, command, slot, start, end) {
  const startIdx = src.indexOf(start);
  assert.ok(startIdx !== -1, `${command}: slot "${slot}" — start anchor not found: "${start}"`);
  const endIdx = end === null ? src.length : src.indexOf(end, startIdx + start.length);
  if (end !== null) {
    assert.ok(endIdx !== -1, `${command}: slot "${slot}" — end anchor not found: "${end}"`);
  }
  const slice = src.slice(startIdx, endIdx);
  assert.ok(
    BOUND_RE.test(slice),
    `${command}, slot "${slot}": no line budget and no silence rule — a reporting slot ` +
      `must say how much it may emit or when it emits nothing.\n\n${slice}`,
  );
}

// The slot table. Built by reading all seven loop commands end to end (not by grepping
// for known-good phrases) — every human-facing reporting slot in each file, not a subset.
const SLOTS = [
  // astro-discuss.md
  { command: 'astro-discuss.md', slot: '1b debt fold-in: items when present', start: '1b. **Check the debt register', end: 'Say nothing at all when there is no relevant debt' },
  { command: 'astro-discuss.md', slot: '1b debt fold-in: silence when absent', start: 'Say nothing at all when there is no relevant debt', end: '2. **Map the gray areas.' },
  { command: 'astro-discuss.md', slot: '2 principle-settled fork', start: 'a personal principle already settled a fork', end: '3. **Discuss in rounds' },
  { command: 'astro-discuss.md', slot: '4 capture report', start: '4. **Capture.', end: '5. **Promote firm choices.' },
  { command: 'astro-discuss.md', slot: '6 hand-off', start: '6. Clear the live status', end: 'Keep it conversational' },
  { command: 'astro-discuss.md', slot: 'closing trivial-phase skip', start: 'Keep it conversational', end: null },

  // astro-plan.md
  { command: 'astro-plan.md', slot: '2 discuss-gate canon refusal relay', start: '2. **Discuss gate', end: 'run ONE `ac principles ask' },
  { command: 'astro-plan.md', slot: '2 principles result relay', start: 'run ONE `ac principles ask', end: '3. Mark the live status' },
  { command: 'astro-plan.md', slot: '3 workflow launched (background)', start: 'It runs in the background — say so', end: '3b. **Commit the plan artifacts' },
  { command: 'astro-plan.md', slot: '3b commit of plan artifacts', start: '3b. **Commit the plan artifacts', end: '4. Clear the live status' },
  { command: 'astro-plan.md', slot: '4 plan summary', start: '4. Clear the live status', end: 'Only fan out when the phase is worth parallel research' },

  // astro-execute.md
  { command: 'astro-execute.md', slot: '2b preflight advisory', start: '2b. **Pre-flight the fork base', end: '3. Refresh the team canon' },
  { command: 'astro-execute.md', slot: '3 canon refusal relay', start: '3. Refresh the team canon', end: '4. Run the execution fan-out' },
  { command: 'astro-execute.md', slot: '4 integrationFailed', start: 'If the result has `integrationFailed`', end: '- **No Workflow tool, but the Agent tool is available:**' },
  { command: 'astro-execute.md', slot: '4c leaked-ref sweep', start: '4c. **Sweep for leaked refs', end: '4d. **File the verifier' },
  { command: 'astro-execute.md', slot: '4d debt findings', start: '4d. **File the verifier', end: '4e. **Check fixture currency' },
  { command: 'astro-execute.md', slot: '4e fixtures check', start: '4e. **Check fixture currency', end: '5. Clear the live status' },
  { command: 'astro-execute.md', slot: '5 verdict lead line + PASS/FAIL branches', start: '5. Clear the live status', end: '**The assembled summary' },
  { command: 'astro-execute.md', slot: '5 assembled summary shape', start: '**The assembled summary', end: '**Record surprises for the milestone sweep' },
  { command: 'astro-execute.md', slot: '5 surprise note', start: '**Record surprises for the milestone sweep', end: 'Execution + the in-workflow verifier produce' },

  // astro-verify.md
  { command: 'astro-verify.md', slot: '3 PASS/FAIL verdict', start: '3. Clear the live status first', end: '3b. **On PASS only' },
  { command: 'astro-verify.md', slot: '3b debt findings', start: '3b. **On PASS only', end: 'Verification is the machine gate' },

  // astro-accept.md
  { command: 'astro-accept.md', slot: '1 not-verified stop', start: '1. Resolve the phase slug. Confirm its status', end: '2. Read' },
  { command: 'astro-accept.md', slot: '3 walkthrough per item', start: '3. Walk the user through it', end: '4. Decide:' },
  { command: 'astro-accept.md', slot: '4 accept success', start: '**All criteria hold**', end: '**Who is signing' },
  { command: 'astro-accept.md', slot: '4 reject', start: '**Something fails**', end: '5. On accept' },
  { command: 'astro-accept.md', slot: '5 closing nudge', start: '5. On accept', end: 'Keep it real' },

  // astro-status.md
  { command: 'astro-status.md', slot: '1 no .astrocode/', start: '1. Run `ac status`.', end: '2. Run `ac registry show`' },
  { command: 'astro-status.md', slot: '2 registry show', start: '2. Run `ac registry show`', end: '3. Tell the user the single best next action' },
  { command: 'astro-status.md', slot: '3 recommendation', start: '3. Tell the user the single best next action', end: '3b. **Keep the pipeline fed' },
  { command: 'astro-status.md', slot: '3b pipeline nudge', start: '3b. **Keep the pipeline fed', end: '4. If the active phase' },
  { command: 'astro-status.md', slot: '4 resting-point nudge', start: '4. If the active phase', end: null },

  // astro-debt.md
  { command: 'astro-debt.md', slot: '1 no open debt', start: '1. **Read the register.', end: '2. **Present it' },
  { command: 'astro-debt.md', slot: '2 pressure line', start: 'Lead with the **pressure number', end: 'Then the items, **grouped by file' },
  { command: 'astro-debt.md', slot: '2 grouping', start: 'Then the items, **grouped by file', end: '- Mark the ones carrying real evidence' },
  { command: 'astro-debt.md', slot: '3 assessment', start: '3. **Say what you would do', end: '4. **Offer the exits' },
  { command: 'astro-debt.md', slot: '4 exit taken', start: 'When you actually run one, say which and why in one line', end: '5. **Never file debt' },

  // astro-discuss.md — phase 20 D1 fold-in offer (t9/t10)
  { command: 'astro-discuss.md', slot: '1c backlog fold-in', start: '1c. **Check the backlog', end: '2. **Map the gray areas' },

  // astro-accept.md — phase 20 D1 drain (t11)
  { command: 'astro-accept.md', slot: '4 backlog drain', start: '**Backlog items linked to this phase', end: '**Who is signing' },

  // astro-phase.md — phase 20 D5 declined-match warning (t12)
  { command: 'astro-phase.md', slot: '1b declined match', start: '1b. **Check what you already decided against', end: '2. Run `ac phase add' },

  // astro-backlog.md — capture + review (t9)
  { command: 'astro-backlog.md', slot: '1 empty backlog', start: '1. **Read the backlog.', end: '2. **Present it' },
  { command: 'astro-backlog.md', slot: '2 item presentation', start: '2. **Present it', end: '3. **Offer the exits' },
  { command: 'astro-backlog.md', slot: '3 exit taken', start: '3. **Offer the exits', end: null },

  // astro-backlog-promote.md (t9)
  { command: 'astro-backlog-promote.md', slot: '1 still worth a phase', start: '1. **Confirm the idea is still worth a phase', end: '2. **Promote it' },
  { command: 'astro-backlog-promote.md', slot: '3 promotion reported', start: '3. **Say what happened', end: null },

  // phase 23: principle capture at the moments of intent (D2, t14)
  { command: 'astro-decision.md', slot: '5 principle capture', start: '5. **Propose the principle behind it.', end: 'Use this whenever' },
  { command: 'astro-discuss.md', slot: '5b principle capture', start: '5b. **Propose what the answers settled.', end: '6. Clear the live status' },
  { command: 'astro-accept.md', slot: '4b principle capture', start: '4b. **Propose from a human rejection.', end: '5. On accept' },
  { command: 'astro-complete-milestone.md', slot: '3b sweep', start: '3b. **Sweep the milestone for principles.', end: '4. **Triage stale debt.' },

  // phase 24: /astro-review — batch review of proposed principles (t14)
  { command: 'astro-review.md', slot: '1 empty queue', start: '1. **Read the queue.', end: '2. **Group and batch' },
  { command: 'astro-review.md', slot: '3 item presentation', start: '3. **Present each batch', end: '4. **Ask' },
  { command: 'astro-review.md', slot: '5 failed verb', start: '5. **Act through', end: '6. **Rejected entries seen again' },
  { command: 'astro-review.md', slot: '6 rejected resurfacing', start: '6. **Rejected entries seen again', end: '7. **Report' },
  { command: 'astro-review.md', slot: '7 summary', start: '7. **Report', end: '## Never' },
];

const LOOP_COMMAND_SRC = new Map(
  [
    'astro-discuss.md',
    'astro-plan.md',
    'astro-execute.md',
    'astro-verify.md',
    'astro-accept.md',
    'astro-status.md',
    'astro-debt.md',
    'astro-phase.md',
    'astro-backlog.md',
    'astro-backlog-promote.md',
    'astro-decision.md',
    'astro-complete-milestone.md',
    'astro-review.md',
  ].map((name) => [name, cmd(name)]),
);

test('every reporting slot in the seven loop commands states a bound or a silence rule (C1/C2)', () => {
  for (const { command, slot, start, end } of SLOTS) {
    assertSlotBound(LOOP_COMMAND_SRC.get(command), command, slot, start, end);
  }
});

// ── The canon keeps both audiences (C4) ─────────────────────────────────────────────

test('.astrocode/CONVENTIONS.md keeps the code-comment density rule unweakened AND states the human-facing lead-with-the-change rule, both naming their audience', () => {
  const src = readFileSync(ASTRO_CONVENTIONS, 'utf8');
  assert.ok(
    src.includes('high, explanatory density'),
    'CONVENTIONS.md must still contain the exact phrase "high, explanatory density" — the code-comment rule (D1/scope) must not be weakened or folded into the human-facing rule',
  );
  assert.ok(
    src.includes('leads with the change or the decision') && src.includes('keeps the evidence short'),
    'CONVENTIONS.md must state the human-facing rule: a report to a human leads with the change or the decision and keeps the evidence short (ADR-055 P1)',
  );
  assert.ok(
    src.includes('PLAN.md') && src.includes('CRITERIA.md'),
    'CONVENTIONS.md must name PLAN.md and CRITERIA.md as exempt machine-read artifacts (P3) — otherwise a planner reading the human-facing rule would thin the artifacts that caught real bugs',
  );
});

// ── No drift between the two canons, and the generated one is directly usable (C6) ──

test('the human-facing lead-with-the-change sentence (P1) is byte-identical across .astrocode/CONVENTIONS.md and templates/CONVENTIONS.md', () => {
  const P1 = 'A report to a human **leads with the change or the decision** and keeps the evidence short';
  const astroSrc = readFileSync(ASTRO_CONVENTIONS, 'utf8');
  const templateSrc = readFileSync(TEMPLATE_CONVENTIONS, 'utf8');
  assert.ok(astroSrc.includes(P1), '.astrocode/CONVENTIONS.md must contain P1 verbatim');
  assert.ok(templateSrc.includes(P1), 'templates/CONVENTIONS.md must contain P1 verbatim — a generated project must inherit the same sentence, not a paraphrase');
});

test('the unenforced-narration label ("nothing checks it") appears in all four canon files', () => {
  for (const [label, file] of [
    ['.astrocode/CONVENTIONS.md', ASTRO_CONVENTIONS],
    ['templates/CONVENTIONS.md', TEMPLATE_CONVENTIONS],
    ['AGENTS.md', ROOT_AGENTS],
    ['templates/AGENTS.md', TEMPLATE_AGENTS],
  ]) {
    assert.ok(
      readFileSync(file, 'utf8').includes('nothing checks it'),
      `${label} must state the free-form-narration rule labelled "nothing checks it" (P2) — a reader must not be able to assume it is checked`,
    );
  }
});

test('templates/CONVENTIONS.md Voice section is pre-filled prose, not a fill-me-in stem, and never mentions astro-code or its own test suite', () => {
  const src = readFileSync(TEMPLATE_CONVENTIONS, 'utf8');
  const voiceIdx = src.indexOf('## Voice');
  assert.ok(voiceIdx !== -1, 'templates/CONVENTIONS.md must carry a ## Voice section');
  const voiceSection = src.slice(voiceIdx);
  assert.ok(!voiceSection.includes('{{'), 'templates/CONVENTIONS.md Voice section must not carry a {{…}} placeholder — a rule the project must fill in is not an inherited rule (C6)');
  assert.ok(
    !/^- [^:]+:\s*$/m.test(voiceSection),
    'templates/CONVENTIONS.md Voice section must not carry a blank "- Field:" stem like the Stack entries — it ships pre-filled',
  );
  assert.ok(
    !/astro-code/i.test(voiceSection) && !/tests\//.test(voiceSection),
    'templates/CONVENTIONS.md Voice section must be obeyable with astro-code\'s own repository absent — no reference to astro-code or its test suite',
  );
});

// ── The verifier was not silenced (C5) ──────────────────────────────────────────────

test('the verifier still demands cited commands and actual output per criterion, and astro-verify.md points at where the full evidence lives', () => {
  const verifierSrc = readFileSync(VERIFIER_MD, 'utf8');
  assert.ok(
    /cite the exact command you ran and its actual output/i.test(verifierSrc),
    'agents/astro-verifier.md must still require citing the exact command and its actual output per criterion — the command may summarise, but the verifier must not shrink (D2/C5)',
  );
  const verifySrc = LOOP_COMMAND_SRC.get('astro-verify.md');
  assert.ok(
    /full\s+per-criterion\s+report/i.test(verifySrc),
    'astro-verify.md\'s FAIL path must point at the verifier\'s full per-criterion report — a bounded summary that leaves the reader no route to the detail is its own failure (C5)',
  );
});

// ── C3's counterpart is enforced by construction, not asserted here ─────────────────
//
// C3 requires padding a loop command with ~200 words of ordinary prose to leave the
// suite green. That is guaranteed by this test's own shape: assertSlotBound only checks
// that BOUND_RE matches somewhere inside a slice bounded by two literal anchors — it
// never counts words, lines or characters, so prose added between (or around) those
// anchors cannot turn it red as long as the anchors and the bound phrase both survive.

// ── Phase 20 C9: the fold-in must be ASKED after the debt question, not merely
// written after it ──────────────────────────────────────────────────────────────────
//
// The slot guard above checks that each reporting slot states a bound. It says nothing
// about WHEN the question is raised, and phase 20's first verify pass failed on exactly
// that gap: step 1c carried the bound language but no timing anchor, so an operator
// reading /astro-discuss top to bottom raised the backlog question during grounding —
// ahead of step 3's round one, and ahead of the debt question that 1b defers into it.
//
// The ordering is the criterion, not a nicety: the phase goal is the subject of a
// discussion, and an idea that might be folded in is a rider. Asking the rider first
// inverts that in the only place the user actually sees.
test('the /astro-discuss backlog fold-in is anchored to round one, after the debt question (phase 20 C9)', () => {
  const src = LOOP_COMMAND_SRC.get('astro-discuss.md');
  const slot = src.slice(src.indexOf('1c. **Check the backlog'), src.indexOf('2. **Map the gray areas'));
  assert.ok(slot, 'astro-discuss.md must still carry the 1c backlog fold-in step');

  assert.match(
    slot,
    /in\s+round\s+one/i,
    'the 1c fold-in must anchor its AskUserQuestion to round one — without a timing anchor the ' +
      'question is raised during grounding, before the phase\'s own questions (C9 Fails-if)',
  );
  assert.match(
    slot,
    /after\s+the\s+debt\s+question/i,
    'the 1c fold-in must say it comes AFTER the debt question — C9 requires the fold-in to follow ' +
      'the existing debt prompt, and 1b already defers that one to round one',
  );

  // And the debt prompt it defers to must still be the round-one one it names.
  const debtSlot = src.slice(src.indexOf('1b. **Check the debt register'), src.indexOf('1c. **Check the backlog'));
  assert.match(
    debtSlot,
    /in\s+round\s+one/i,
    'the 1b debt prompt must remain anchored to round one — 1c points at it, so weakening 1b ' +
      'silently un-anchors the backlog fold-in too',
  );
});

// ── /astro-backlog's bare invocation lists and stops ────────────────────────────────
//
// The command originally had two modes: an idea captured it, an empty argument opened a
// triage round that asked what to do with every item. That made the most frequent action
// — glancing at what you have parked — cost a round of questions, which is how a glance
// stops being taken. Bare is now list-only and triage is named explicitly.
//
// The slot guard cannot see this: it checks that each slot STATES a bound, not which mode
// the command lands in. So assert the dispatch directly, the same way phase 20's C9 fix
// had to assert ordering the bound guard could not see.
// ── phase 24 t14: /astro-review's verb contract (D2/D4/D5/D6, P7) ──────────────────
//
// The prose IS the contract here — /astro-review acts only through `ac principles`
// verbs (D4: "no readline/interactive mode in `ac`"), so a reword that drops one of
// these names or loosens a guard silently reopens the destructive path each verb was
// added to prevent (auto-reopening a rejection, rejecting with no reason, merging on
// similarity alone). This guard pins the load-bearing tokens, not full sentences.

test('astro-review.md names all four review choices, requires a reason for reject, offers merge --into, reads the proposed queue as JSON, and gates reopen behind an explicit choice', () => {
  const src = LOOP_COMMAND_SRC.get('astro-review.md');
  assert.ok(src, 'astro-review.md must be a registered loop command source');

  for (const choice of ['accept', 'edit-then-accept', 'reject', 'skip']) {
    assert.ok(src.includes(choice), `astro-review.md must name the "${choice}" review choice`);
  }

  assert.match(
    src,
    /reject.{0,60}\*\*required\*\*\s+reason|\*\*required\*\*\s+reason.{0,60}reject|reject without a reason/i,
    'astro-review.md must require a reason for reject — found no such requirement near "reject"',
  );

  assert.ok(
    src.includes('ac principles merge') && src.includes('--into'),
    'astro-review.md must offer `ac principles merge <dup> --into <id>` for duplicates',
  );

  assert.ok(
    src.includes('ac principles list --proposed --json'),
    'astro-review.md must read the queue via `ac principles list --proposed --json`',
  );

  assert.match(
    src,
    /reopen.{0,80}explicit choice|explicit choice.{0,80}reopen/is,
    'astro-review.md must gate `ac principles reopen` behind an explicit user choice, never an automatic reopen',
  );

  // Every mention of the real store path must read as a prohibition, not an
  // instruction — the same negation-lookback pattern used for the ADR-008 fallback
  // tier guard above.
  const phrase = '~/.astro/principles';
  let searchFrom = 0;
  let found = false;
  while (true) {
    const idx = src.indexOf(phrase, searchFrom);
    if (idx === -1) break;
    found = true;
    const lookBack = src.slice(Math.max(0, idx - 30), idx).toLowerCase();
    const negated = /\bnever\b|\bnot\b/.test(lookBack);
    assert.ok(
      negated,
      `astro-review.md mentions "${phrase}" without a preceding negation (never/not) — every ` +
        `mention must forbid writing there directly, never instruct it. Context:\n\n` +
        src.slice(Math.max(0, idx - 40), idx + phrase.length + 40),
    );
    searchFrom = idx + phrase.length;
  }
  assert.ok(found, 'astro-review.md must mention `~/.astro/principles` at least once, to forbid writing under it directly');
});

test('/astro-backlog lists and stops when given no argument; triage is opt-in', () => {
  const src = LOOP_COMMAND_SRC.get('astro-backlog.md');

  // The list mode must forbid the prompt, not merely omit it — an omission reads as an
  // oversight to the next person editing the file, and gets "helpfully" restored.
  const listMode = src.slice(src.indexOf('### List —'), src.indexOf('### Triage —'));
  assert.ok(listMode, 'astro-backlog.md must carry a list mode section');
  assert.match(
    listMode,
    /do not (offer exits|raise an `AskUserQuestion`)/i,
    'the bare/list mode must explicitly forbid offering exits or asking a question — ' +
      'a glance that ends in a question is not a glance',
  );

  // Triage must be reachable, and only by being named.
  assert.match(
    src,
    /exactly `review`/,
    'astro-backlog.md must route triage through an explicit `review` argument',
  );
  const triage = src.slice(src.indexOf('### Triage —'));
  assert.match(
    triage,
    /AskUserQuestion/,
    'the triage mode must still offer the exits — moving them out of the bare path must ' +
      'not delete them',
  );
});
