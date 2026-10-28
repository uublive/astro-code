// Phase 54 t22 (C6): /astro-accept, /astro-status and /astro-execute present open deferred fixes
// and the deferrable ids, each reporting slot states a bound (Voice), and only the human defers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CMD = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const read = (n) => readFileSync(join(CMD, n), 'utf8');
// the same concept-level bound vocabulary tests/commands.test.mjs guards slots with
const BOUND = /\b(?:in|at most)\s+(?:one|two|three|\d+)\s+(?:line|lines|sentence|sentences)\b|\bsay nothing\b/i;
const slot = (src, start, end) => {
  const a = src.indexOf(start);
  assert.notEqual(a, -1, `anchor not found: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `end anchor not found: ${end}`);
  return src.slice(a, b);
};

test('/astro-accept lists each open deferred fix in one line before the walkthrough and says nothing when there are none', () => {
  const src = read('astro-accept.md');
  const s = slot(src, '2c. **List the open deferred fixes.**', '3. Walk the user through it');
  assert.match(s, /deferred_fixes/);
  assert.match(s, /ac phase show/);
  assert.match(s, /in \*\*one line\*\*/);
  assert.match(s, /Say nothing when there is no/);
  assert.match(s, /ac milestone complete/);
  assert.ok(BOUND.test(s));
});

test('/astro-status repeats the Deferred: line in one line and says nothing without one', () => {
  const s = slot(read('astro-status.md'), '3c. **Open deferred fixes.**', '4. If the active phase');
  assert.match(s, /`Deferred:`/);
  assert.match(s, /in \*\*one\s+line\*\*/);
  assert.match(s, /Say nothing when there is no `Deferred:` line/);
  assert.ok(BOUND.test(s));
});

test('/astro-execute names the deferrable line in a bounded slot and states that only the human runs ac verdict defer', () => {
  const s = slot(read('astro-execute.md'), '**Deferrable criteria (a human\'s call).**', '**The assembled summary is one shape');
  assert.match(s, /`deferrable:` line/);
  assert.match(s, /ac verdict defer <number>/);
  assert.match(s, /Only the human may run `ac verdict defer`/);
  assert.match(s, /never run it yourself/);
  assert.ok(BOUND.test(s));
});
