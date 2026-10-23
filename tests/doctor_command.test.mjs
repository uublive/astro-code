// Phase 50 t9 — /astro-doctor is a thin relay over `ac doctor` (2310: every capability gets a
// slash command; 9173: the checks live in one place). It must not grow check logic of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMANDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'commands');
const DOCTOR = join(COMMANDS, 'astro-doctor.md');

test('astro-doctor.md exists with a description and allowed-tools: Bash', () => {
  assert.ok(existsSync(DOCTOR));
  const src = readFileSync(DOCTOR, 'utf8');
  const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(fm, 'frontmatter');
  assert.match(fm[1], /^description: \S/m);
  assert.match(fm[1], /^allowed-tools: Bash$/m);
});

test('its steps run ac doctor, optionally with --json', () => {
  const src = readFileSync(DOCTOR, 'utf8');
  assert.match(src, /Run `ac doctor`/);
  assert.match(src, /`ac doctor --json`/);
});

test('it carries no check logic of its own', () => {
  const body = readFileSync(DOCTOR, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
  for (const re of [/settings\.json/, /readlink/, /installed_plugins/, /additionalDirectories/, /\bls\b/]) {
    assert.doesNotMatch(body, re, String(re));
  }
});

test('it states its reporting bound and never runs a fix unasked', () => {
  const src = readFileSync(DOCTOR, 'utf8');
  assert.match(src, /single `✓` line.*only/s);
  assert.match(src, /say \*\*nothing\*\* more/);
  assert.match(src, /one line per problem/);
  assert.match(src, /Never run a fix unasked/);
});

test('astro-help.md lists /astro-doctor', () => {
  assert.match(readFileSync(join(COMMANDS, 'astro-help.md'), 'utf8'), /`\/astro-doctor`/);
});
