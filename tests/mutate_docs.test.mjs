// Phase 47 t11 — the MANUAL and CHANGELOG say what the CLI does (C12). The install strings are
// read from the tool table, so the docs can never drift from what `ac mutate` prints.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manual = readFileSync(join(ROOT, 'MANUAL.md'), 'utf8');

test('every tool row\'s install string appears verbatim in the MANUAL', async () => {
  const { MUTATION_TOOLS } = await import('../lib/mutate.mjs');
  assert.ok(MUTATION_TOOLS.length >= 3);
  for (const row of MUTATION_TOOLS) assert.ok(manual.includes(row.install), `${row.id}: ${row.install}`);
});

test('the MANUAL explains the keys, the dismissal, where the memory lives and that nothing is installed', () => {
  for (const needle of ['mutation.cap_seconds', 'mutation.tool', 'ac mutate dismiss', '.astrocode/.local/mutate-notices.json',
    'never installs', '[mutation]', 'ac mutate setup', 'ac mutate --check', '/astro-mutate']) {
    assert.ok(manual.includes(needle), needle);
  }
  assert.match(manual, /local, never committed/);
  const at = manual.indexOf('## Mutation testing (test-strength criteria)');
  const lines = manual.slice(at, manual.indexOf('\n## ', at + 5)).split('\n').length;
  assert.ok(lines >= 30 && lines <= 60, `section is ${lines} lines`);
});

test('the CHANGELOG records the feature under Unreleased', () => {
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  const unreleased = log.slice(log.indexOf('## Unreleased'), log.indexOf('## v0.'));
  assert.match(unreleased, /ac mutate/);
});

test('astro-code stays dependency-free (ADR-001, C11)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
