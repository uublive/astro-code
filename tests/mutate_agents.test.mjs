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
    /`ac mutate <phase> --json`/, /Triage only the survivors/, /`test-gap`[^.]*\*\*fails the criterion\*\*/,
    /one-line `justification`/, /Timeouts are killed/, /capped run is never all killed/, /`ac verdict record`/,
    /AI mutants only for `tool-missing`, `no-tool` or `no-scope`/, /with the reason/,
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
  assert.match(sec, /\*\*AI mutants only for `tool-missing`, `no-tool` or `no-scope`\*\*/);
  assert.match(sec, /`not-configured`[^]*\*\*fails\*\*[^]*`ac mutate setup`[^]*no mutants by hand/);
  assert.match(sec, /supporting evidence with no code gate/);
  assert.match(sec, /prompt-only by design/);
  for (const src of [v, read('astro-criteria-author.md')]) {
    assert.doesNotMatch(src, /Only those criteria/);
    assert.doesNotMatch(src, /never run this for a criterion without\s+the\s+tag/);
  }
  assert.doesNotMatch(read('astro-criteria-author.md'), /the tag is what makes the verifier run a mutation tool/);
  assert.match(read('astro-criteria-author.md'), /hard pass bar in code/);
});
