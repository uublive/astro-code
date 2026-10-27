// Phase 51 t11 — the MANUAL and CHANGELOG say what `ac verify calibrate` does (C1 to C11 documented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manual = readFileSync(join(ROOT, 'MANUAL.md'), 'utf8');
const at = manual.indexOf('## Verifier calibration');
const section = at < 0 ? '' : manual.slice(at, manual.indexOf('\n## ', at + 5));

test('the MANUAL has a `## Verifier calibration` section, separate from the mutation section\'s line budget, naming the command, every flag and the terms a reader needs', () => {
  assert.ok(at > manual.indexOf('## Mutation testing (test-strength criteria)'), 'after the mutation section');
  for (const needle of ['ac verify calibrate', '--defects', '--runs', '--seed', '--budget', '--yes', '--json', '/astro-calibrate',
    '.astrocode/CALIBRATION.jsonl', 'test-gap', 'Gremlins', 'Wilson', 'pass^k', 'too few defects', 'defect_set_hash', 'ADR-088']) {
    assert.ok(section.includes(needle), needle);
  }
  assert.match(section, /never touches a phase's status/);
  assert.match(section, /Known limit/);
  const lines = section.split('\n').length;
  assert.ok(lines >= 20 && lines <= 70, `section is ${lines} lines`);
  const mut = manual.slice(manual.indexOf('## Mutation testing (test-strength criteria)'), manual.indexOf('\n## ', manual.indexOf('## Mutation testing') + 5));
  assert.ok(!mut.includes('Verifier calibration'), 'the mutation section keeps its own budget');
});

test('the MANUAL command list has /astro-calibrate and the CLI list has ac verify calibrate', () => {
  const ref = manual.slice(manual.indexOf('## Command reference'));
  assert.match(ref, /^\/astro-calibrate\s/m);
  assert.match(ref, /^ac verify calibrate /m);
});

test('CHANGELOG v0.53.0 names `ac verify calibrate` and cites the decision', () => {
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  // Phase 51 shipped in v0.53.0: its entry sits under that heading, not Unreleased.
  const at = log.indexOf('## v0.53.0');
  assert.ok(at > -1, 'a v0.53.0 section');
  const v053 = log.slice(at, log.indexOf('\n## v0.', at + 5));
  assert.match(v053, /`ac verify calibrate`/);
  assert.match(v053, /ADR-088/);
});
