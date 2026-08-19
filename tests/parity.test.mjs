// Behavioral test for templates/kit/tools/parity_check.py (ADR-025) — proves the
// golden-fixture parity harness actually MEASURES parity rather than being an
// always-pass stub. Shells out to python3 against the worked
// examples/kit-convert-demo/commit-digest kit's real fixtures (t5), asserting the
// falsifiability guarantees the harness's own docstring claims (C1/C2/C3).
//
// Test-after (depends_on t1, t5): t1 wrote parity_check.py, t5 produced the worked
// kit + its committed fixtures under tools/parity/. Every test copies the kit into a
// fresh scratch dir first (mkdtempSync + cpSync) so a run can freely mutate a
// parity.json / expected_output.json without ever touching the committed fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SRC = join(ROOT, 'examples/kit-convert-demo/commit-digest');
const MANIFEST_REL = 'tools/parity/parity.json';

/**
 * Copy the worked kit into a fresh scratch dir. Every test mutates its own
 * copy (parity.json, an expected_output.json, ...) and reruns the harness
 * against it — the committed fixtures under examples/kit-convert-demo/
 * commit-digest/tools/parity/ are never written to.
 */
function scratchKit() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-parity-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  return dir;
}

function readManifest(kitDir) {
  return JSON.parse(readFileSync(join(kitDir, MANIFEST_REL), 'utf8'));
}

function writeManifest(kitDir, manifest) {
  writeFileSync(join(kitDir, MANIFEST_REL), JSON.stringify(manifest, null, 2));
}

function readExpected(kitDir, fixtureName) {
  const path = join(kitDir, `tools/parity/fixtures/${fixtureName}/expected_output.json`);
  return { path, data: JSON.parse(readFileSync(path, 'utf8')) };
}

/** Run the parity harness for real (a fresh python3 subprocess, no stubbing). */
function runParity(kitDir) {
  return spawnSync(
    'python3',
    ['tools/parity_check.py', '--manifest', MANIFEST_REL],
    { cwd: kitDir, encoding: 'utf8' },
  );
}

// ── (a) unmodified fixtures → exit 0, per-fixture "matched" lines, count > 0 (C1) ──

test('parity_check.py: unmodified worked-kit fixtures all match (exit 0, fixture count > 0)', () => {
  const kitDir = scratchKit();
  const result = runParity(kitDir);

  assert.equal(result.status, 0, `expected exit 0 — stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /sample-1: matched/);
  assert.match(result.stdout, /sample-2: matched/);
  const countMatch = result.stdout.match(/(\d+) fixtures checked, (\d+) matched, (\d+) mismatched/);
  assert.ok(countMatch, `stdout must report a fixture count — got:\n${result.stdout}`);
  assert.ok(Number(countMatch[1]) > 0, 'fixture count must be > 0 — a 0-fixture run proves nothing');
  assert.equal(countMatch[2], countMatch[1], 'every fixture must be matched on the unmodified worked kit');
});

// ── (b) deleting the produced output for one run → that fixture is NOT matched
//        (C1 anti-stub: the harness can never become a static-file diff that
//        "passes" without actually having a fresh output to compare) ──────────────

test('parity_check.py: a run whose command deletes its own produced output is reported NOT matched', () => {
  const kitDir = scratchKit();
  const manifest = readManifest(kitDir);
  const sample1 = manifest.fixtures.find((fx) => fx.name === 'sample-1');
  assert.ok(sample1, 'expected a sample-1 fixture in the worked kit manifest');
  // Chain a deletion of the declared output onto the real command — the kit still
  // runs for real, but the file the harness is supposed to compare never survives.
  sample1.command = `${sample1.command} && rm -f {output}`;
  writeManifest(kitDir, manifest);

  const result = runParity(kitDir);

  assert.notEqual(result.status, 0, `expected a non-zero exit — stdout:\n${result.stdout}`);
  assert.match(result.stdout, /sample-1: MISMATCH missing-output/);
  // The untouched fixture must be unaffected — this isn't a global failure.
  assert.match(result.stdout, /sample-2: matched/);
});

// ── (c) mutating a semantic (non-normalized) value in expected_output.json →
//        exit non-zero, naming the diverging fixture/field (C2) ───────────────────

test('parity_check.py: a semantic mismatch in expected_output.json fails and names the fixture and field', () => {
  const kitDir = scratchKit();
  const { path, data } = readExpected(kitDir, 'sample-2');
  data.commit_count = data.commit_count + 1; // not the real digest for sample-2's input
  writeFileSync(path, JSON.stringify(data, null, 2));

  const result = runParity(kitDir);

  assert.notEqual(result.status, 0, `expected a non-zero exit — stdout:\n${result.stdout}`);
  assert.match(result.stdout, /sample-2: MISMATCH/);
  assert.match(result.stdout, /commit_count/, 'the harness must name the diverging field, not just "differs"');
  assert.match(result.stdout, /sample-1: matched/, 'the untouched fixture must still match');
});

// ── (d) a diff confined to a declared-benign field still passes, AND the harness
//        output surfaces the normalized field set (C3) ────────────────────────────

test('parity_check.py: a diff confined to the declared normalization list still matches, and normalized fields are surfaced', () => {
  const kitDir = scratchKit();
  const { path, data } = readExpected(kitDir, 'sample-1');
  data.generated_at = '1999-01-01T00:00:00.000000+00:00'; // declared "blank"-normalized field
  writeFileSync(path, JSON.stringify(data, null, 2));

  const result = runParity(kitDir);

  assert.equal(result.status, 0, `expected exit 0 — stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /sample-1: matched/);
  assert.match(
    result.stdout,
    /normalized fields:.*generated_at \(blank\)/,
    `harness must surface which fields it normalized — got:\n${result.stdout}`,
  );
});

// ── (e) a diff in a field NOT on the normalization list fails (C3: normalization
//        never silently widens beyond what's declared) ────────────────────────────

test('parity_check.py: a diff in a field NOT on the normalization list fails', () => {
  const kitDir = scratchKit();
  const { path, data } = readExpected(kitDir, 'sample-2');
  data.unique_authors = data.unique_authors + 1; // not declared in this fixture's normalize.fields
  writeFileSync(path, JSON.stringify(data, null, 2));

  const result = runParity(kitDir);

  assert.notEqual(result.status, 0, `expected a non-zero exit — stdout:\n${result.stdout}`);
  assert.match(result.stdout, /sample-2: MISMATCH/);
  assert.match(result.stdout, /unique_authors/, 'the harness must name the un-normalized diverging field');
});
