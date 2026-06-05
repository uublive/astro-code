// Guard against the args/hook shadowing bug: a Workflow script must not bind a local
// name (in any `const { … } = …` destructure) that collides with a Workflow hook
// (phase, agent, parallel, …). `const { phase } = …` shadows phase() and breaks the
// script; `const { phase: phaseSlug } = …` is fine.
//
// Also guards the MIRROR drift: the sentinel-delimited copy of lib/waves.mjs inside
// workflows/execute-phase.mjs must stay byte-identical to its source of truth, modulo
// known stylistic deltas (semicolons, `export` prefix).  If they diverge the test
// names both files so the developer knows exactly where to look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
const HOOKS = ['phase', 'agent', 'parallel', 'pipeline', 'log', 'workflow'];

function destructuredLocals(src) {
  const names = [];
  // non-greedy [\s\S]*? so a `= {}` default inside the braces doesn't truncate early
  for (const m of src.matchAll(/const\s*\{([\s\S]*?)\}\s*=/g)) {
    for (const entry of m[1].split(',')) {
      const noDefault = entry.split('=')[0].trim(); // drop "= default"
      if (!noDefault) continue;
      const parts = noDefault.split(':'); // "phase: phaseSlug" → local is after ':'
      names.push((parts[1] || parts[0]).trim());
    }
  }
  return names;
}

test('workflow scripts never bind a local that shadows a Workflow hook', () => {
  const files = readdirSync(WF).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length > 0, 'expected workflow scripts');
  for (const f of files) {
    const locals = destructuredLocals(readFileSync(join(WF, f), 'utf8'));
    assert.ok(locals.includes('phaseSlug'), `${f}: expected the phase slug bound as phaseSlug`);
    for (const hook of HOOKS) {
      assert.ok(!locals.includes(hook), `${f}: local "${hook}" shadows the ${hook}() hook — rename it`);
    }
  }
});

// ── Drift-guard: the MIRROR region in execute-phase.mjs must equal lib/waves.mjs ──
//
// The Workflow sandbox can't import modules, so execute-phase.mjs carries a
// hand-maintained copy of the wave layering functions (delimited by sentinel
// comments).  This test extracts both regions, normalizes for the two known
// stylistic deltas that are intentional and acceptable:
//   1. Semicolons — lib/waves.mjs follows Node style (semicolons); the workflow
//      follows Workflow-tool style (no semicolons).
//   2. `export` prefix — lib exports each function; the workflow can't use ESM
//      export syntax inside the Workflow sandbox, so it omits the keyword.
// Any other difference is an accidental drift and this test will fail loudly,
// naming both the workflow file and the lib file so the developer knows which
// region to reconcile.

const WF_FILE = join(WF, 'execute-phase.mjs');
const LIB_WAVES = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'waves.mjs');

/**
 * Normalize a block of source text so that intentional workflow/lib stylistic
 * differences don't cause false positives.  We strip:
 *   - trailing semicolons (lib has them; the Workflow copy omits them)
 *   - `export ` prefix on function declarations (lib exports; workflow can't)
 * We then strip leading/trailing blank lines and trailing spaces per line so
 * that incidental whitespace doesn't matter either.
 */
function normalizeBlock(text) {
  return text
    .replace(/;(\s*\n)/g, '$1')           // drop trailing semicolons
    .replace(/^export /gm, '')            // drop 'export ' prefix on declarations
    .split('\n')
    .map((l) => l.trimEnd())              // no trailing whitespace
    .join('\n')
    .replace(/^\n+/, '')                  // no leading blank lines
    .replace(/\n+$/, '');                 // no trailing blank lines
}

test('execute-phase.mjs MIRROR region matches lib/waves.mjs (drift guard)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8');
  const libSrc = readFileSync(LIB_WAVES, 'utf8');

  // ── Extract the MIRROR region from the workflow ──────────────────────────
  // The sentinel is:  // >>> MIRROR of lib/waves.mjs … >>>
  //                   …body…
  //                   // <<< MIRROR <<<
  const mirrorMatch = wfSrc.match(/\/\/ >>> MIRROR[^\n]*\n([\s\S]*?)\/\/ <<< MIRROR/);
  assert.ok(
    mirrorMatch,
    `${WF_FILE}: missing MIRROR sentinel comments — expected "// >>> MIRROR" … "// <<< MIRROR"`,
  );
  const mirrorRegion = mirrorMatch[1];

  // ── Extract the core function block from lib/waves.mjs ──────────────────
  // The lib file starts with a module-level comment block, then the first JSDoc.
  // We take everything from the first JSDoc comment onward as the "core" that the
  // mirror must match.
  const libCoreMatch = libSrc.match(/(\/\*\*[\s\S]*)/);
  assert.ok(
    libCoreMatch,
    `${LIB_WAVES}: could not find the start of the JSDoc / function region`,
  );
  const libCore = libCoreMatch[1];

  const normMirror = normalizeBlock(mirrorRegion);
  const normLib = normalizeBlock(libCore);

  assert.strictEqual(
    normMirror,
    normLib,
    `MIRROR drift detected!\n` +
      `  workflow copy : ${WF_FILE}\n` +
      `  lib source    : ${LIB_WAVES}\n` +
      `Reconcile the two files so the MIRROR region matches lib/waves.mjs ` +
      `(only semicolons and the "export" prefix may differ).`,
  );
});
