// Contract guards for ADR-021's pre-registration half: plan-phase must author a
// plan-blind, goal-derived CRITERIA.md BEFORE the researcher fan-out, and the
// astro-criteria-author agent must pin the falsifiable schema and its plan-blindness.
// Static string/offset guards only (no eval/import) — the prompt text IS the enforcement,
// so we assert the load-bearing language is present and correctly ordered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const planPhase = readFileSync(join(ROOT, 'workflows', 'plan-phase.mjs'), 'utf8');
const author = readFileSync(join(ROOT, 'agents', 'astro-criteria-author.md'), 'utf8');

test('plan-phase lists the Criteria stage before Research in meta.phases', () => {
  const ci = planPhase.indexOf("title: 'Criteria'");
  const ri = planPhase.indexOf("title: 'Research'");
  assert.ok(ci !== -1, "meta.phases must include a 'Criteria' stage");
  assert.ok(ri !== -1, "meta.phases must include a 'Research' stage");
  assert.ok(ci < ri, 'Criteria must be declared before Research');
});

// Anchor on the real hook CALLS (line-start), not comment mentions like the
// `phase('Research')` in the file header — indexOf would otherwise match the comment.
const critCall = planPhase.search(/^phase\('Criteria'\)/m);
const researchCall = planPhase.search(/^phase\('Research'\)/m);
const parCall = planPhase.search(/await parallel\(/);

test('the Criteria stage runs (and writes CRITERIA.md) before the researcher fan-out', () => {
  assert.ok(critCall !== -1, "phase('Criteria') must be called");
  assert.ok(researchCall !== -1 && parCall !== -1);
  assert.ok(critCall < researchCall, "phase('Criteria') must precede phase('Research')");
  assert.ok(critCall < parCall, 'the Criteria stage must run before the researcher parallel() fan-out');
  const window = planPhase.slice(critCall, researchCall);
  assert.match(window, /CRITERIA\.md/, 'the Criteria stage must write CRITERIA.md');
});

test('the Criteria stage spawns the plan-blind criteria-author at planner tier', () => {
  const window = planPhase.slice(critCall, researchCall);
  assert.match(window, /agentType:\s*'astro-criteria-author'/, "must spawn agentType 'astro-criteria-author'");
  assert.match(window, /model:\s*models\.planner/, 'criteria author runs at the planner tier');
  assert.match(window, /plan-blind/i, 'the criteria prompt must restate plan-blindness');
});

test('astro-criteria-author is plan-blind and pins the falsifiable criterion schema', () => {
  assert.match(author, /name:\s*astro-criteria-author/);
  assert.match(author, /tools:\s*Read,\s*Write,\s*Grep,\s*Glob/, 'author authors from disk only — no Bash/web');
  // plan-blind prohibition (incl. a stale prior-attempt plan)
  assert.match(author, /do NOT read[^.\n]*PLAN\.md/i, 'must forbid reading PLAN.md');
  assert.match(author, /even if[^.\n]*present/i, 'must forbid a prior-attempt plan too');
  // the C<n> / Observe / Fails-if schema
  assert.match(author, /### C1/, 'shows the C<n> criterion id shape');
  assert.match(author, /\*\*Observe:\*\*/, 'each criterion carries an Observe: method');
  assert.match(author, /\*\*Fails if:\*\*/, 'each criterion carries a Fails if: mode');
  // goal-level/behavioral + bans structural checks
  assert.match(author, /goal-level|behavioral|different-but-valid|different valid implementation/i);
  assert.match(author, /grep|file X exists|existence check/i, 'must ban structural/existence checks');
});
