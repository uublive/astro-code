// Phase 54 t21 (C1, C2, C4): the verifier contract and agent text say the same new things - every gap in
// one pass, the failing evidence, broad_files checked in code, the setup cache, and that a verifier never
// defers - and /astro-verify runs the cheap pass before it spawns the verifier. Dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERIFY_MD = readFileSync(join(ROOT, 'commands', 'astro-verify.md'), 'utf8');
const AGENT_MD = readFileSync(join(ROOT, 'agents', 'astro-verifier.md'), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');

const SAYS = [
  ['report every unmet criterion, never stop at the first', /never stop at the first failing criterion/i],
  ['report EVERY criterion observed unmet', /report EVERY criterion you (?:observe[d]?) unmet/i],
  ['the failing command and output for each', /failing command and (?:its )?output/i],
  ['broad_files', /broad_files/],
  ['checked with ac verdict plan --broad-files', /ac verdict plan [^\n`]*--broad-files/],
  ['a verifier never defers', /never defers? a criterion/i],
  ['use ac setup run for declared setup', /ac setup run <name>/],
  // Phase 56 (ADR-093): a slow suite runs last, and ac decides which suite is slow.
  ['observe every non-suite criterion first', /observe every non-suite criterion first/i],
  ['a slow suite only after they all pass, only through ac suite run', /a slow suite runs only after every non-suite criterion passes, and only through `ac suite run`/i],
  ['the slow-or-fast decision comes from ac', /the slow-or-fast decision comes from `ac suite receipt` \(its `slow` line\) or `ac verdict cheap` \(`held`\)/i],
  ['otherwise report it held, never passed or failed', /report it `held: true` \(held back, not run\), never passed or failed/],
  // Phase 57 (ADR-094): fast mode never runs the full suite; phase mode keeps it.
  ['in fast mode never run the full suite', /in fast mode[^.]*never run the full (?:test )?suite/i],
  ['run only the targeted tests ac verdict cheap ran', /the targeted tests `ac verdict cheap` ran \(`fast\.tests`\)/],
  ['no linked tests', /no linked tests/],
  ['a suite criterion is carried to the milestone full check', /carried to the milestone full check/i],
  ['phase mode still runs the full suite', /with `verify\.full_suite: phase`[^.]*run the full suite/i],
];

test('verifierContract() (the single marked block), the agent text and astro-verify.md each say every required rule', async () => {
  const { verifierContract } = await import('../lib/verifyrun.mjs');
  const contract = verifierContract();
  for (const [name, re] of SAYS) {
    assert.match(contract, re, `contract: ${name}`);
    assert.match(squash(AGENT_MD), re, `agents/astro-verifier.md: ${name}`);
    assert.match(squash(VERIFY_MD), re, `commands/astro-verify.md: ${name}`);
  }
  assert.equal(VERIFY_MD.split('<!-- verifier-contract -->').length, 2, 'the contract stays ONE marked block');
});

test('the contract carries no word the calibration blindness check forbids', async () => {
  const { verifierContract } = await import('../lib/verifyrun.mjs');
  const { LEAK_RE } = await import('../lib/plant.mjs');
  assert.doesNotMatch(verifierContract(), LEAK_RE);
});

test('astro-verify.md runs ac verdict cheap before spawning the verifier and stops with a FAIL on unmet', () => {
  const cheap = VERIFY_MD.indexOf('ac verdict cheap <number>');
  const plan = VERIFY_MD.indexOf('ac verdict plan <slug> --json');
  const spawn = VERIFY_MD.indexOf('spawn **ONE**');
  assert.ok(cheap !== -1 && cheap < plan && plan < spawn, 'cheap, then plan, then the single spawn');
  const step = VERIFY_MD.slice(cheap, plan);
  assert.match(step, /stop with a FAIL/);
  assert.match(step, /EVERY unmet\s+id/);
  assert.match(step, /spawn no verifier/);
});

test('the astro-verify.md report slots state their bound: deferrable in one line or nothing, flapping one line per id or nothing', () => {
  const slot = VERIFY_MD.slice(VERIFY_MD.indexOf('When `ac verdict record` printed a `deferrable:` line'), VERIFY_MD.indexOf('3b. **On PASS only'));
  assert.match(slot, /in \*\*one line\*\*/);
  assert.match(slot, /ac verdict defer <number> <ids>/);
  assert.match(slot, /say nothing when it printed none/i);
  assert.match(slot, /\*\*one line per flagged id\*\*/);
  assert.match(slot, /say nothing when\s+there are none/i);
  assert.match(slot, /Never run it yourself/);
});

test('commands/astro-execute.md (the Agent-tool tier) states the same order, and held back is never remediated', () => {
  const EXEC = squash(readFileSync(join(ROOT, 'commands', 'astro-execute.md'), 'utf8'));
  assert.match(EXEC, /observe every non-suite criterion first/i);
  assert.match(EXEC, /a slow suite runs only after every non-suite criterion passes, and only through `ac suite run`/);
  assert.match(EXEC, /`ac verdict cheap` \(`held`\)/);
  assert.match(EXEC, /held back is not unmet/i);
  assert.match(EXEC, /never handed to (?:the )?(?:remediation|executor)/i);
});

test('no verify contract file tells the verifier to read PLAN.md', () => {
  for (const f of [VERIFY_MD, AGENT_MD, readFileSync(join(ROOT, 'commands', 'astro-execute.md'), 'utf8')]) {
    for (const line of f.split('\n').filter((l) => /PLAN\.md/.test(l) && /\bread\b/i.test(l))) {
      assert.match(line, /\b(?:not|never|NOT|without|blind)\b/i, `a line tells the verifier to read PLAN.md: ${line.trim()}`);
    }
  }
});

test('commands/astro-execute.md says a remediation executor in fast mode runs only the targeted tests, never the full suite', () => {
  const EXEC = squash(readFileSync(join(ROOT, 'commands', 'astro-execute.md'), 'utf8'));
  assert.match(EXEC, /remediation executor runs only the targeted tests[\s\S]{0,120}never the full suite/i);
});
