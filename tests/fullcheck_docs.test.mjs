// ADR-094 (phase 57 t17): the docs say what fast mode and the milestone full check do, and every verb they name
// exists. Shape only (never quality), like tests/commands.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const squash = (s) => s.replace(/\s+/g, ' ');
const MANUAL = squash(read('MANUAL.md'));
const CONFIG = squash(read('commands', 'astro-config.md'));
const VERIFY_MS = squash(read('commands', 'astro-verify-milestone.md'));
const ACCEPT = squash(read('commands', 'astro-accept.md'));
const COMPLETE = squash(read('commands', 'astro-complete-milestone.md'));

test('MANUAL.md and astro-config.md name every verify setting with its values and defaults', () => {
  for (const [name, doc] of [['MANUAL.md', MANUAL], ['astro-config.md', CONFIG]]) {
    assert.match(doc, /`verify\.full_suite`[^.]*`milestone`[^.]*`phase`|`verify\.full_suite`[^.]*`phase`[^.]*`milestone`/, `${name}: full_suite values`);
    assert.match(doc, /\*\*`?milestone`?\*\* by default|`milestone`, the default|`milestone` by default/, `${name}: default milestone`);
    assert.match(doc, /`verify\.repair_attempts`[^.]*default \*{0,2}2/, `${name}: repair_attempts default 2`);
    assert.match(doc, /`verify\.targeted_command`/, `${name}: targeted_command`);
    assert.match(doc, /`verify\.suite_command`/, `${name}: suite_command`);
  }
});

test('MANUAL.md describes what a phase verify runs in each mode, the limits, the full check, fixes, repair and the close gate', () => {
  assert.match(MANUAL, /no linked tests/);
  assert.match(MANUAL, /one hop only/);
  assert.match(MANUAL, /`verify\.full_suite: phase` a phase verify runs the full suite/);
  assert.match(MANUAL, /`ac milestone verify`/);
  assert.match(MANUAL, /becomes a \*\*fix\*\*/);
  assert.match(MANUAL, /at most `verify\.repair_attempts` times/);
  assert.match(MANUAL, /passed on the current tip/);
  assert.match(MANUAL, /full check pending/);
});

test('every ac milestone verb the docs and the new command name appears in `ac help`', () => {
  const help = spawnSync(process.execPath, [join(ROOT, 'bin', 'ac.mjs'), 'help'], { encoding: 'utf8' }).stdout;
  const verbs = new Set();
  for (const doc of [read('MANUAL.md'), read('commands', 'astro-config.md'), read('commands', 'astro-verify-milestone.md'), read('commands', 'astro-accept.md'), read('commands', 'astro-complete-milestone.md')]) {
    for (const m of doc.matchAll(/`ac milestone (\w+)/g)) verbs.add(m[1]);
  }
  assert.ok(verbs.has('verify') && verbs.has('repair'));
  for (const v of verbs) assert.match(help, new RegExp(`ac milestone ${v}\\b`), `ac help lists "ac milestone ${v}"`);
});

test('astro-verify-milestone.md states the attempt bound, the re-check, the fresh verify and a one-line-per-fix report', () => {
  assert.match(VERIFY_MS, /`verify\.repair_attempts`/);
  assert.match(VERIFY_MS, /At most `limit` attempts per fix/);
  assert.match(VERIFY_MS, /After each attempt run `ac milestone repair <id>`/);
  assert.match(VERIFY_MS, /\*\*fresh\*\* `ac milestone verify`/);
  assert.match(VERIFY_MS, /\*\*one line per fix\*\*/);
  assert.match(VERIFY_MS, /`✓ fixed <id>`/);
  assert.match(VERIFY_MS, /`• still open <id>/);
  assert.match(VERIFY_MS, /Agent tier/);
  assert.match(VERIFY_MS, /Inline tier/);
});

test('astro-accept.md and astro-complete-milestone.md propose the full check in one line with the command, else say nothing', () => {
  assert.match(ACCEPT, /Propose the milestone full check[\s\S]{0,400}\*\*one line\*\* with its command, `ac milestone verify`/);
  assert.match(ACCEPT, /Say nothing when it printed none/);
  assert.match(COMPLETE, /Propose the milestone full check[\s\S]{0,400}\*\*one line\*\* with its command, `ac milestone verify`/);
  assert.match(COMPLETE, /Say nothing about it when the close went through/);
});
