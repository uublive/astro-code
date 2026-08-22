// Regression guard for commands/astro-execute.md — ensures the Agent-tool fallback
// tier mandates sequential execution and cannot silently regress to parallel-without-
// isolation.  Per ADR-008, when the Workflow tool is unavailable there is no worktree
// isolation or integrator, so tasks must run one at a time.  Any revert to the old
// "spawn the ready tasks as parallel astro-executor calls in a single message" wording
// must make this suite go red — that is the whole point of this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const EXECUTE_MD = join(COMMANDS, 'astro-execute.md');
const ALEX_MD = join(COMMANDS, 'astro-alex.md');
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
//   • astro-alex.md must keep the fast lane pinned to `effort: "light"` (0 remediation
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

test('astro-alex.md pins the fast lane to effort: "light"', () => {
  // The fast lane always runs single-pass: it must pass effort:"light" explicitly in its
  // Workflow call so it never inherits a phase's stored (deeper) budget (C10).
  const hasLight = /effort:\s*"light"/.test(alexSrc);
  assert.ok(
    hasLight,
    `astro-alex.md must pin the fast lane to effort:"light" in its Workflow args ` +
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
