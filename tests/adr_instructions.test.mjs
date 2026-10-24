// Planner and executor text routes every decision through the claim (phase 53 t13, ADR-087, C8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const tree = (dir) => readdirSync(join(ROOT, dir)).filter((f) => /\.(md|mjs)$/.test(f)).map((f) => `${dir}/${f}`);

test('the AGENTS.md seed states the claim rule once', () => {
  const seed = read('templates/AGENTS.md');
  assert.equal((seed.match(/ADR numbers are claimed/g) || []).length, 1);
  assert.match(seed, /ac decision add/);
  assert.match(seed, /ac decision renumber/);
  assert.match(seed, /canon-guard refuses it/);
  // the rule lives only there: the pointers name the command and do not restate the rule
  for (const f of ['agents/astro-planner.md', 'agents/astro-executor.md', 'commands/astro-decision.md']) {
    assert.ok(!/ADR numbers are claimed/.test(read(f)), f);
  }
});

test('astro-planner, astro-executor and astro-decision each point to `ac decision add` for recording a decision', () => {
  for (const f of ['agents/astro-planner.md', 'agents/astro-executor.md', 'commands/astro-decision.md']) {
    assert.match(read(f), /ac decision add/, f);
  }
  const cmd = read('commands/astro-decision.md');
  assert.match(cmd, /argument-hint: .*renumber <file\|id> <N\|next>.*backfill/);
  assert.match(cmd, /ac decision renumber <file\|id> <N\|next> --dry-run/);
  assert.match(cmd, /ac decision backfill --apply/);
  assert.match(cmd, /naming the ADR file/);
});

// A line that forbids the thing is not an instruction to do it.
const NEGATED = /\b(never|not|don't|do not|no)\b/i;
const COMPUTE = [/max *\+ *1/i, /highest[^\n]*\+ *1/i, /next (free )?ADR number/i, /(?:write|create|add)\w*[^\n]*\bNNNN-/i, /(?:write|create)\w*[^\n]*\d{4}-[\w*<>-]*\.md/i];

test('no file under commands/, agents/, workflows/ or templates/AGENTS.md tells an agent to compute the next ADR number or create an ADR file by hand', () => {
  const files = [...tree('commands'), ...tree('agents'), ...tree('workflows'), 'templates/AGENTS.md'];
  assert.ok(files.length > 10);
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      if (NEGATED.test(line)) return;
      for (const re of COMPUTE) assert.ok(!re.test(line), `${f}:${i + 1} reads as an instruction to compute a number or write an ADR file: ${line.trim()}`);
    });
  }
});
