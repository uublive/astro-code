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

test('astro-mine.md states no cap number outside the "N more turns" line', () => {
  assert.ok(!/\b10\b/.test(SRC), 'the 10-per-sweep cap is the spec\'s number, not this command\'s to restate');
  const atMostMatches = SRC.match(/at most \d/gi) || [];
  for (const m of atMostMatches) {
    // Only the "at most one ... N more turns" reporting-bound line may say "at most N".
    assert.ok(/at most one/i.test(m), `unexpected "at most N" outside the reporting bound: ${m}`);
  }
});

test('astro-mine.md runs the miner in JSON mode', () => {
  assert.ok(SRC.includes('ac principles mine --json'), 'must run `ac principles mine --json`');
});

test('astro-mine.md advances the watermark only in step 4, gated on prior success, passing --keep', () => {
  const step4 = SRC.slice(SRC.indexOf('4. **Advance the watermark'), SRC.indexOf('5. **Report'));
  assert.ok(step4.includes('ac principles mine --advance <sweep> --keep <ids>'), 'step 4 must run --advance with the kept ids');
  assert.ok(/every call.{0,40}succeeded/is.test(step4.replace(/\n/g, ' ')), 'advance must be gated on every prior call succeeding');
  const beforeStep4 = SRC.slice(0, SRC.indexOf('4. **Advance the watermark'));
  assert.ok(!beforeStep4.includes('--advance'), '--advance must not run before step 4');
  assert.ok(!beforeStep4.includes('--keep'), '--keep must not run before step 4');
});

test('astro-mine.md uses --from-session in the group/qualify/lift step, which defers to the spec', () => {
  const step3 = SRC.slice(SRC.indexOf('3. **Group, qualify and lift'), SRC.indexOf('4. **Advance the watermark'));
  assert.ok(step3.length > 40, 'step 3 must exist');
  assert.ok(step3.includes('--from-session'), 'step 3 must pass --from-session');
  assert.ok(step3.includes('$(ac path templates)/principle-capture.md'), 'step 3 must defer to the spec');
});

test('astro-mine.md restates none of the spec\'s transcript-sweep rules (ADR-060)', () => {
  const before = SRC.slice(0, NEVER_IDX);
  for (const re of [/≥\s*2/, /distinct sessions/i, /content-free/i, /opposite/i, /one explicit rule/i]) {
    assert.ok(!re.test(before), `astro-mine.md restates a spec rule: ${re}`);
  }
});

// C4(c) — the agent is told, by the single spec, to do every judgement of meaning.
test('the capture spec\'s transcript-sweep rules cover grouping by meaning, opposites, content-free replies, distinct sessions, the threshold and --keep', () => {
  const spec = readFileSync(join(ROOT, 'templates', 'principle-capture.md'), 'utf8');
  const s9 = spec.slice(spec.indexOf('## 9. Transcript sweep'), spec.indexOf('## 10.')).replace(/\s+/g, ' ');
  assert.ok(s9.length > 200, 'the spec must have a transcript-sweep section 9');
  const must = [
    [/same instruction, across phrasings AND languages/, 'group by meaning across phrasings and languages'],
    [/opposite instructions apart/i, 'keep opposite instructions apart'],
    [/content-free replies/i, 'ignore content-free replies'],
    [/"No\."/, 'name "No." as content-free'],
    [/explicit rules?/i, 'judge explicit rules'],
    [/DISTINCT sessions/, 'count distinct sessions'],
    [/`earlier` items included/, 'count earlier items too'],
    [/≥2 distinct sessions\*\* or \*\*one explicit rule/, 'qualify at ≥2 sessions or one explicit rule'],
    [/strongest first: more distinct sessions first, then explicit rules/, 'order strongest first'],
    [/--keep <id,id,\.\.\.>/, 'carry forward with --keep'],
    [/below-threshold steers/, 'keep below-threshold steers'],
    [/beyond the cap/, 'keep qualifying groups beyond the cap'],
    [/Never `--keep` an item you proposed/, 'never keep a proposed item'],
    [/not to be a steer/, 'never keep a non-steer'],
  ];
  for (const [re, what] of must) assert.ok(re.test(s9), `spec §9 must ${what}`);
  const s3 = spec.slice(spec.indexOf('## 3. Volume'), spec.indexOf('## 4.'));
  assert.ok(/--keep/.test(s3), 'the cap section must say the overflow is carried with --keep');
  assert.ok(spec.includes("the item's `fromRef`"), 'the evidence row must use the item\'s fromRef');
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

test('astro-mine.md reports "N more turns — run again" with a silence rule', () => {
  assert.ok(SRC.includes('N more turns — run again'), 'must state the exact reporting line');
  assert.ok(/silent/i.test(SRC), 'must state a silence rule for when remaining is 0');
});

test('astro-mine.md has the required frontmatter', () => {
  assert.match(SRC, /^---\n/, 'must start with frontmatter');
  assert.ok(/allowed-tools:\s*Bash,\s*Read/.test(SRC), 'must allow only Bash, Read');
  assert.ok(/argument-hint:/.test(SRC), 'must have an argument-hint');
});

// C12 remediate-r2: the skipped-lines notice used to be a THIRD report line the spec never
// defined. ADR-060: the spec owns it, folded into its single line.
test('astro-mine.md adds no report line of its own for skipped transcript lines', () => {
  assert.ok(!/⚠ skipped/.test(SRC), 'no separate "⚠ skipped …" line in the command');
  assert.ok(!/skipped N transcript line/i.test(SRC), 'the skipped notice is the spec\'s, not the command\'s');
  const lineSlots = (SRC.slice(0, NEVER_IDX).match(/at most one\b/gi) || []).length;
  assert.equal(lineSlots, 1, 'exactly one extra-line bound: the "N more turns — run again" line');
});

test('the capture spec §7 folds the skipped count into its single line, never a separate one', () => {
  const spec = readFileSync(join(ROOT, 'templates', 'principle-capture.md'), 'utf8');
  const s7 = spec.slice(spec.indexOf('## 7. Reporting'), spec.indexOf('## 8.')).replace(/\s+/g, ' ');
  assert.ok(s7.includes('`, K transcript line(s) skipped`'), '§7 names the folded clause');
  assert.ok(/before the ` — `/.test(s7.slice(s7.indexOf('K transcript line(s) skipped'))), 'the clause goes before the dash');
  assert.ok(/never a separate line/i.test(s7), '§7 forbids a separate skipped line');
  assert.ok(/K transcript line\(s\) skipped — ac principles mine`/.test(s7), '§7 states the line when only skips are reported');
});
