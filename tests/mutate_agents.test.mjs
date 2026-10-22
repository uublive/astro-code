// Phase 47 t7 — the verifier and the criteria author agree on the [mutation] marker (C10).
// The criteria author's own example is written into a CRITERIA.md and fed to the one matcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents');
const read = (n) => readFileSync(join(AGENTS, n), 'utf8');

test('the criteria author example, written word for word, is recognised by testStrengthIds', async () => {
  const { testStrengthIds, parseCriteriaIds } = await import('../lib/verdict.mjs');
  const src = read('astro-criteria-author.md');
  const block = [...src.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]).find((b) => b.includes('[mutation]'));
  assert.ok(block, 'a fenced example with the [mutation] tag');
  const heading = block.split('\n').find((l) => l.includes('[mutation]'));
  assert.deepEqual(testStrengthIds(block), ['C4']);
  assert.deepEqual(parseCriteriaIds(block), ['C4']);
  assert.match(heading, /^### C4 \[mutation\] — /);
  assert.match(block, /ac mutate <phase> --json/);
  assert.match(src, /Never tag a criterion that does not ask/);
});

test('the verifier instructions state the mutation workflow and its limits', () => {
  const v = read('astro-verifier.md');
  const sec = v.slice(v.indexOf('## Test-strength checks'), v.indexOf('## Non-blocking findings'));
  assert.ok(sec.length > 200, 'section exists');
  for (const re of [
    /`ac mutate <phase> --json`/, /Judge only the open\s+survivors/, /`test-gap`[^.]*\*\*fails the criterion\*\*/,
    /one-line justification/, /Timeouts are killed/, /capped run is never all killed/, /`ac verdict record`/,
    /AI mutants only when `fallback\.ai_mutants` is true/, /with the reason/,
    /`mutation\.cap_seconds`/, /`mutation\.phases\.<n>\.cap_seconds`/,
  ]) assert.match(sec, re);
  assert.match(v, /`criteria\[\]\.mutation`/);
});

test('the verifier shell section is untouched (identical across agents)', () => {
  const H = '## Shell commands — never stall on a permission prompt';
  const tail = (t) => t.slice(t.indexOf(H));
  assert.equal(tail(read('astro-verifier.md')), tail(read('astro-executor.md')));
});

test('phase 48 D3: with a tool installed the verifier runs ac mutate for ANY criterion that would hand-make mutants', () => {
  const v = read('astro-verifier.md');
  const sec = v.slice(v.indexOf('## Test-strength checks'), v.indexOf('## Non-blocking findings'));
  assert.match(sec, /ANY other criterion where you would otherwise invent\s+mutants/);
  assert.match(sec, /Never invent mutants by hand while a tool is installed/);
  assert.match(sec, /`not-configured`[^]*\*\*fails\*\*[^]*`ac mutate setup`[^]*no mutants by hand/);
  for (const src of [v, read('astro-criteria-author.md')]) {
    assert.doesNotMatch(src, /Only those criteria/);
    assert.doesNotMatch(src, /never run this for a criterion without\s+the\s+tag/);
  }
  assert.doesNotMatch(read('astro-criteria-author.md'), /the tag is what makes the verifier run a mutation tool/);
});

// ---- Phase 49 t13 (ADR-085, C11, C13): the tool's result is the bar for every test-strength criterion ----
const COMMANDS = join(AGENTS, '..', 'commands');

test('phase 49 C11: the verifier declares the mark, starts from recorded judgements, uses --survivors for fix rounds and reads flaky', () => {
  const v = read('astro-verifier.md');
  const sec = v.slice(v.indexOf('## Test-strength checks'), v.indexOf('## Non-blocking findings'));
  assert.match(sec, /set\s+`"test_strength": true` in the verdict JSON/);
  assert.match(sec, /tagged or not/);
  assert.match(sec, /sticky for the phase/);
  assert.match(sec, /Start from `triage`/);
  assert.match(sec, /SURVIVORS\.json/);
  assert.match(sec, /Judge only the open\s+survivors/);
  assert.match(sec, /never re-judge the whole list/);
  assert.match(sec, /`ac mutate judge <phase> <s:key\|g:group>\.\.\. --equivalent "<one line why>"`/);
  assert.match(sec, /`ac mutate <phase> --survivors`/);
  assert.match(sec, /a \*\*partial\*\* run/);
  assert.match(sec, /record THAT/);
  assert.match(sec, /Read `flaky`/);
  assert.match(sec, /`unverified` makes the run incomplete/);
  assert.match(v, /`criteria\[\]\.test_strength`/);
  // the rules' home is named, never restated
  assert.match(sec, /`lib\/verdict\.mjs`/);
  assert.match(sec, /`lib\/survivors\.mjs`/);
  assert.doesNotMatch(sec, /sha1|ordinal|line number/i, 'the key rule is not restated');
});

test('phase 49 C11: no instruction says only [mutation]-tagged criteria get the code bar', () => {
  for (const f of ['agents/astro-verifier.md', 'agents/astro-criteria-author.md', 'commands/astro-verify.md', 'commands/astro-mutate.md']) {
    const src = readFileSync(join(AGENTS, '..', f), 'utf8');
    assert.doesNotMatch(src, /for \*\*`\[mutation\]`-tagged criteria only\*\*/, f);
    assert.doesNotMatch(src, /gated in code only for a\s+`\[mutation\]`/, f);
    assert.doesNotMatch(src, /supporting evidence with no code gate/, f);
    assert.doesNotMatch(src, /prompt-only by design/, f);
    assert.doesNotMatch(src, /tag is what puts a criterion behind the hard pass bar/, f);
  }
  const author = read('astro-criteria-author.md');
  assert.match(author, /untagged test-strength criterion gets the same bar once the\s+verifier\s+marks it `test_strength`/);
  assert.match(author, /Never tag a criterion that does not ask/);
});

test('phase 49 C13: /astro-verify prints fallback.report verbatim and has no fixed "(AI mutants stood in)"', () => {
  const verify = readFileSync(join(COMMANDS, 'astro-verify.md'), 'utf8');
  assert.match(verify, /`fallback\.report`, verbatim/);
  assert.doesNotMatch(verify, /\(AI mutants stood in\)/);
  assert.match(verify, /"test_strength": true/);
});

test('phase 49: /astro-mutate names judge and --survivors', () => {
  const src = readFileSync(join(COMMANDS, 'astro-mutate.md'), 'utf8');
  assert.match(src, /ac mutate <phase> --survivors/);
  assert.match(src, /ac mutate judge/);
  assert.match(src, /never a recordable verdict/);
  assert.match(src, /at most 20 open groups/);
});
