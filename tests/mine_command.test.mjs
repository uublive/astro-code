// Phase 26 t4 — C12 guards on commands/astro-mine.md, readFileSync-only (no subprocess),
// following tests/principle_capture.test.mjs's shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'commands', 'astro-mine.md'), 'utf8');
const NEVER_IDX = SRC.indexOf('## Never');

test('astro-mine.md points at the capture spec', () => {
  assert.ok(SRC.includes('$(ac path templates)/principle-capture.md'), 'must reference the single-source capture spec');
});

test('astro-mine.md does not restate the lift rule', () => {
  assert.ok(!SRC.includes('strip every project noun'), 'the lift rule lives only in the spec');
});

test('astro-mine.md states no cap number outside the "N more candidates" line', () => {
  assert.ok(!/\b10\b/.test(SRC), 'the 10-per-sweep cap is the spec\'s number, not this command\'s to restate');
  const atMostMatches = SRC.match(/at most \d/gi) || [];
  for (const m of atMostMatches) {
    // Only the "at most one ... N more candidates" reporting-bound line may say "at most N".
    assert.ok(/at most one/i.test(m), `unexpected "at most N" outside the reporting bound: ${m}`);
  }
});

test('astro-mine.md runs the miner in JSON mode', () => {
  assert.ok(SRC.includes('ac principles mine --json'), 'must run `ac principles mine --json`');
});

test('astro-mine.md advances the watermark only in step 4, gated on prior success', () => {
  const step4 = SRC.slice(SRC.indexOf('4. **Advance the watermark'), SRC.indexOf('5. **Report'));
  assert.ok(step4.includes('ac principles mine --advance'), 'step 4 must run --advance');
  assert.ok(/every call.{0,40}succeeded/is.test(step4.replace(/\n/g, ' ')), 'advance must be gated on every prior call succeeding');
  const beforeStep4 = SRC.slice(0, SRC.indexOf('4. **Advance the watermark'));
  assert.ok(!beforeStep4.includes('--advance'), '--advance must not run before step 4');
});

test('astro-mine.md uses --from-session in the lift step', () => {
  const step3 = SRC.slice(SRC.indexOf('3. **Lift the candidates'), SRC.indexOf('4. **Advance the watermark'));
  assert.ok(step3.includes('--from-session'), 'step 3 must pass --from-session');
});

test('astro-mine.md forbids reading transcript files/dirs, confined to ## Never', () => {
  assert.ok(NEVER_IDX !== -1, 'must have a ## Never section');
  const before = SRC.slice(0, NEVER_IDX);
  for (const token of ['projects/', 'sessions/', '.jsonl']) {
    assert.ok(!before.includes(token), `"${token}" must appear only inside ## Never, found earlier`);
  }
  const never = SRC.slice(NEVER_IDX);
  for (const token of ['projects/', 'sessions/', '.jsonl']) {
    assert.ok(never.includes(token), `"${token}" must be named inside ## Never`);
  }
});

test('astro-mine.md names no accept/reject/merge/reopen verb outside ## Never', () => {
  const before = SRC.slice(0, NEVER_IDX);
  for (const verb of [/\baccept\b/i, /\breject\b/i, /\bmerge\b/i, /\breopen\b/i]) {
    assert.ok(!verb.test(before), `verb ${verb} must not appear outside ## Never`);
  }
});

test('astro-mine.md reports "N more candidates — run again" with a silence rule', () => {
  assert.ok(SRC.includes('N more candidates — run again'), 'must state the exact reporting line');
  assert.ok(/silent/i.test(SRC), 'must state a silence rule for when remaining is 0');
});

test('astro-mine.md has the required frontmatter', () => {
  assert.match(SRC, /^---\n/, 'must start with frontmatter');
  assert.ok(/allowed-tools:\s*Bash,\s*Read/.test(SRC), 'must allow only Bash, Read');
  assert.ok(/argument-hint:/.test(SRC), 'must have an argument-hint');
});
