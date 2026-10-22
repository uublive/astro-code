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
  const { MUTATION_TOOLS, DEFAULT_ENV } = await import('../lib/mutate.mjs');
  assert.ok(MUTATION_TOOLS.length >= 3);
  // every variant a row can produce, over every environment shape detectEnv knows (phase 48 P12)
  const envs = [DEFAULT_ENV,
    { node: { manager: 'pnpm', via: 'pnpm-lock.yaml' }, python: DEFAULT_ENV.python },
    { node: { manager: 'yarn', via: 'yarn.lock' }, python: DEFAULT_ENV.python },
    { node: DEFAULT_ENV.node, python: { installer: 'uv-venv', via: '.venv', locked: null } }];
  for (const row of MUTATION_TOOLS) {
    for (const env of envs) assert.ok(manual.includes(row.install(env)), `${row.id}: ${row.install(env)}`);
  }
});

test('the MANUAL explains the keys, the dismissal, where the memory lives and that nothing is installed', () => {
  for (const needle of ['mutation.cap_seconds', 'mutation.tool', 'ac mutate dismiss', '.astrocode/.local/mutate-notices.json',
    'never installs', '[mutation]', 'ac mutate setup', 'ac mutate --check', '/astro-mutate']) {
    assert.ok(manual.includes(needle), needle);
  }
  assert.match(manual, /local, never committed/);
  const at = manual.indexOf('## Mutation testing (test-strength criteria)');
  const lines = manual.slice(at, manual.indexOf('\n## ', at + 5)).split('\n').length;
  // widened from 60 to 75 in phase 48 and to 110 in phase 49 (judging, --survivors, flaky, the mark): line scope, phase tests, the settings, the install variants and the
  // output files are each a sentence the reader needs, and a MANUAL that omits them sends people to the code
  assert.ok(lines >= 30 && lines <= 110, `section is ${lines} lines`);
});

test('phase 48: the MANUAL names the settings, the run files, the outcomes, the per-tool narrowing and the verifier rule', () => {
  for (const needle of ['mutation.files', 'mutation.exclude', 'mutation.tests', 'mutation.phases.<n>.cap_seconds',
    'mutation.phases.<n>.tests', '.astrocode/.local/mutate-runs/', 'not-configured', 'changed lines']) {
    assert.ok(manual.includes(needle), needle);
  }
  const at = manual.indexOf('## Mutation testing (test-strength criteria)');
  const sec = manual.slice(at, manual.indexOf('\n## ', at + 5));
  assert.match(sec, /Stryker gets line ranges/);
  assert.match(sec, /Gremlins its own `--diff`/);
  assert.match(sec, /mutmut 3\s+the functions/);
  assert.match(sec, /mutmut 2 whole files/);
  assert.match(sec, /uses it wherever it would otherwise hand-make\s+mutants/);
  assert.doesNotMatch(sec, /tag is the only \*\*code\*\* gate/, 'phase 49 amends the tag-only gate (ADR-085)');
  assert.match(manual, /ac mutate <n> \[--json\]\s+# mutation-test the phase's changed lines/);
});

test('the CHANGELOG records phases 47-48 (released) and phase 49 under Unreleased', () => {
  const log = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  assert.match(log, /ac mutate/);
  assert.match(log, /lines a phase changed/);
  assert.match(log, /phase's own tests/);
  assert.match(log, /ADR-084/);
  const unreleased = log.slice(log.indexOf('## Unreleased'), log.indexOf('## v0.'));
  for (const re of [/ac mutate/, /--survivors/, /ac mutate judge/, /SURVIVORS\.json/, /flaky/, /ADR-085/, /sticky/, /go install/]) assert.match(unreleased, re);
});

// ---- Phase 49 t14 (ADR-085, C14): the MANUAL tells a user how to judge, re-test, and what is the bar ----
test('phase 49: the MANUAL names the judgements file, what re-opens a judgement, --survivors, the flaky check, the sticky mark and the Gremlins limit', () => {
  const at = manual.indexOf('## Mutation testing (test-strength criteria)');
  const sec = manual.slice(at, manual.indexOf('\n## ', at + 5));
  for (const re of [
    /SURVIVORS\.json/, /ac mutate judge/, /editing the mutated line[^.]*re-opens it/, /follows its mutant, not its line number/,
    /--survivors/, /not a recordable verdict/, /Flaky tests/, /shares the one cap|shares the one cap\./, /flaky check \(tests run twice\)/,
    /test_strength/, /sticky for the phase/, /Gremlins has no string mutator/, /Which criteria get the bar/, /Fix rounds/, /Judging survivors/,
  ]) assert.match(sec, re);
  assert.doesNotMatch(sec, /tag is the only \*\*code\*\* gate/);
  assert.doesNotMatch(sec, /no code gate/);
  assert.match(manual, /ac mutate <n> --survivors/);
  assert.match(manual, /ac mutate judge <n>/);
});

test('astro-code stays dependency-free (ADR-001, C11)', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});
