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
