// Regression guard for commands/astro-fast.md — the "fast lane" command for long,
// unplanned prompts.  These tests pin the contracts that make astro-fast safe to hand
// to someone who works off the cuff: nothing is lost, the fast path is genuinely
// no-fan-out, the executor defaults to Opus, and systemic work escalates instead of
// being fast-pathed.  A reword that drops any of these should make this suite go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const src = readFileSync(join(COMMANDS, 'astro-fast.md'), 'utf8');

// ── 1. Raw prompt is captured verbatim as the source of truth ───────────────────────
test('astro-fast captures the raw prompt verbatim to PROMPT.md with a provenance marker', () => {
  assert.match(src, /PROMPT\.md/, 'must write PROMPT.md');
  assert.match(src, /verbatim/i, 'must state the raw prompt is captured verbatim');
  assert.match(src, /<!--\s*astro-fast:\s*raw prompt\s*-->/, 'PROMPT.md needs the raw-prompt provenance marker');
});

// ── 2. Nothing is silently dropped ──────────────────────────────────────────────────
test('astro-fast parks anything it cannot classify in an explicit "To clarify" list', () => {
  assert.match(src, /To clarify \/ unclassified/i, 'must have a "To clarify / unclassified" section');
  assert.match(src, /never silently drop|nothing gets silently lost|nothing (?:is |gets )?silently (?:dropped|lost)/i,
    'must promise nothing is silently dropped');
});

// ── 3. Every spec item traces back to the raw prompt ────────────────────────────────
test('astro-fast requires each spec change to trace back to the raw prompt', () => {
  assert.match(src, /\*\*source:\*\*/, 'each change item needs a mandatory source: pointer');
  assert.match(src, /trace/i, 'must state changes trace to the raw prompt');
});

// ── 4. The fast path is genuinely no-fan-out (sequential, no worktrees) ──────────────
test('astro-fast executes sequentially with no worktree fan-out', () => {
  assert.match(src, /strategy:\s*["']sequential["']/, 'must pass strategy: "sequential"');
  assert.match(src, /useWorktrees:\s*false/, 'must pass useWorktrees: false');
  assert.match(src, /no[- ]fan[- ]out/i, 'must describe the run as no-fan-out');
});

// ── 5. It skips the planner/researcher ──────────────────────────────────────────────
test('astro-fast skips the research/planning fan-out', () => {
  assert.match(src, /no planner|no researchers|skips? the (?:parallel )?researchers|not a research/i,
    'must state it skips the planner/researchers');
});

// ── 6. Executor defaults to Opus, overridable via --model ───────────────────────────
test('astro-fast defaults the executor to Opus and honors --model override', () => {
  assert.match(src, /--model/, 'must document the --model flag');
  // The default-Opus rule must be stated for the executor role.
  assert.match(src, /defaults? to \*\*Opus\*\*|else \*\*`?opus`?\*\*/i, 'executor must default to Opus');
  assert.match(src, /opus[^\n]*sonnet[^\n]*haiku/i, 'must list the override tiers (opus/sonnet/haiku)');
});

// ── 7. Commits are stamped for resumability ─────────────────────────────────────────
test('astro-fast stamps commits with (phase NN tK) for resumable re-runs', () => {
  assert.match(src, /\(phase\s+NN\s+tK\)/, 'must stamp commits with (phase NN tK) (ADR-017)');
});

// ── 8. Scope guard escalates systemic work instead of fast-pathing it ───────────────
test('astro-fast has a scope guard that escalates systemic changes to the full flow', () => {
  assert.match(src, /scope guard/i, 'must have a scope guard');
  assert.match(src, /ESCALATE/, 'must be able to ESCALATE');
  assert.match(src, /\/astro-discuss/, 'escalation must route to the full discuss→plan→execute flow');
});

// ── 9. Verified, never auto-complete (the two-gate invariant holds) ─────────────────
test('astro-fast never auto-accepts — verified at best, human gate closes it', () => {
  assert.match(src, /never auto-accept/i, 'must never auto-accept its own work');
  assert.match(src, /\/astro-accept/, 'must route closing to the human /astro-accept gate');
});
