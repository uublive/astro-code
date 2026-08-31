// Behavioral test for templates/kit/tools/kit_test.py — the Tier 1 offline kit
// test. Proves the harness actually FAILS on a broken kit rather than being an
// always-green stub: every check below is exercised by mutating a copy of the
// worked examples/kit-convert-demo/commit-digest kit and asserting both the
// exit code and the specific check id that must fire.
//
// The falsifiability guarantee matters more here than usual. A kit test that
// cannot fail is worse than no kit test, because it converts "I have not
// verified this kit" into "this kit is verified" without doing any work.
//
// Every test copies the kit into a fresh scratch dir (mkdtempSync + cpSync) so
// mutations never touch the committed example.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KIT_SRC = join(ROOT, 'examples/kit-convert-demo/commit-digest');
const TOOL_SRC = join(ROOT, 'templates/kit/tools/kit_test.py');
const RECIPE_REL = 'src/recipes/commit-digest.yaml';

/**
 * Copy the worked kit into a fresh scratch dir, with the CURRENT template copy
 * of kit_test.py dropped in — so the test always exercises the template source
 * of truth, never a stale vendored copy inside the example.
 */
function scratchKit() {
  const dir = mkdtempSync(join(tmpdir(), 'ac-kittest-'));
  cpSync(KIT_SRC, dir, { recursive: true });
  cpSync(TOOL_SRC, join(dir, 'tools/kit_test.py'));
  return dir;
}

/** Run the harness for real (a fresh python3 subprocess, no stubbing). */
function runKitTest(kitDir, env = {}) {
  const res = spawnSync('python3', ['tools/kit_test.py'], {
    cwd: kitDir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return { status: res.status, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function read(kitDir, rel) {
  return readFileSync(join(kitDir, rel), 'utf8');
}
function write(kitDir, rel, text) {
  writeFileSync(join(kitDir, rel), text);
}

/** Assert the run failed AND the named check id is the one that fired. */
function assertFailed(res, checkId, label) {
  assert.equal(res.status, 1, `${label}: expected exit 1, got ${res.status}\n${res.out}`);
  assert.match(res.out, new RegExp(`✗ \\[${checkId}\\]`), `${label}: expected ${checkId} to fire\n${res.out}`);
}

// ── C0: the unmutated worked kit is clean ────────────────────────────────

test('the worked example kit passes Tier 1 cleanly', () => {
  const kit = scratchKit();
  const res = runKitTest(kit);
  assert.equal(res.status, 0, `worked kit should pass\n${res.out}`);
  assert.match(res.out, /0 failure\(s\)/);
});

// ── C1: a deliverable nothing produces ───────────────────────────────────
// The kit contract's definition of done says every declared artifact must
// actually be produced by the workflow the recipe describes. Before this
// harness that was a human eyeball; this proves it is now mechanical.

test('fails when a declared artifact is produced by no phase', () => {
  const kit = scratchKit();
  const manifest = JSON.parse(read(kit, 'kit.json'));
  manifest.outputs.artifacts[0].path = '_report/nothing-makes-this.json';
  write(kit, 'kit.json', JSON.stringify(manifest, null, 2));

  assertFailed(runKitTest(kit), 'R-11', 'unreachable artifact');
});

// ── C2: a phase astro could never mark complete ──────────────────────────

test('fails when a phase declares no output', () => {
  const kit = scratchKit();
  const recipe = read(kit, RECIPE_REL);
  // Drop the last phase's output: block — astro's recipe schema requires
  // output.min(1), since phase completion IS output existence.
  const cut = recipe.lastIndexOf('    output:');
  assert.ok(cut > 0, 'fixture should contain an output: block');
  write(kit, RECIPE_REL, recipe.slice(0, cut));

  assertFailed(runKitTest(kit), 'R-07', 'phase without output');
});

// ── C3: path containment, mirroring astro's T-73-02 guard ────────────────

test('fails when a phase output escapes the work dir', () => {
  const kit = scratchKit();
  const recipe = read(kit, RECIPE_REL);
  write(kit, RECIPE_REL, recipe.replace('- _report/digest.json', '- ../../etc/passwd'));

  assertFailed(runKitTest(kit), 'R-09', 'path traversal');
});

// ── C4: a report script that cannot even compile ─────────────────────────

test('fails when a shipped python script has a syntax error', () => {
  const kit = scratchKit();
  appendFileSync(join(kit, 'src/generate_report.py'), '\ndef broken( :\n');

  assertFailed(runKitTest(kit), 'S-02', 'script syntax error');
});

// ── C5: EXAMPLES.md is what astro reads to learn the kit's invocation ────

test('fails when EXAMPLES.md is missing a required section', () => {
  const kit = scratchKit();
  const examples = read(kit, 'src/EXAMPLES.md');
  write(kit, 'src/EXAMPLES.md', examples.replace(/^## Quick Start/m, '## Renamed Away'));

  assertFailed(runKitTest(kit), 'E-02', 'missing EXAMPLES section');
});

// ── C6: the required kit docs ────────────────────────────────────────────

test('fails when a contract-required doc is missing', () => {
  const kit = scratchKit();
  const res = spawnSync('rm', [join(kit, 'src/CLAUDE.md')], { encoding: 'utf8' });
  assert.equal(res.status, 0);

  assertFailed(runKitTest(kit), 'D-01', 'missing CLAUDE.md');
});

// ── C7: the fallback YAML reader must agree with PyYAML ──────────────────
// kit_test.py prefers PyYAML but must work without it. A fallback that only
// ever runs where it cannot be observed is a fallback that rots, so this
// pins the two parsers to the same verdict on the worked kit.

test('the builtin recipe parser agrees with PyYAML', () => {
  const kit = scratchKit();
  const withYaml = runKitTest(kit);
  const withoutYaml = runKitTest(kit, { KIT_TEST_NO_PYYAML: '1' });

  assert.equal(withYaml.status, withoutYaml.status, 'exit codes must match');
  // The parser name is expected to differ; nothing else may.
  const norm = (s) => s.replace(/\((PyYAML|builtin)\)/g, '(X)');
  assert.equal(norm(withoutYaml.out), norm(withYaml.out), 'verdicts must match');
});

// C8: and the fallback must still CATCH things, not just agree when green.
test('the builtin recipe parser still catches a broken recipe', () => {
  const kit = scratchKit();
  const recipe = read(kit, RECIPE_REL);
  const cut = recipe.lastIndexOf('    output:');
  write(kit, RECIPE_REL, recipe.slice(0, cut));

  assertFailed(runKitTest(kit, { KIT_TEST_NO_PYYAML: '1' }), 'R-07', 'fallback parser, phase without output');
});
