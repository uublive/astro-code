// Guard against the args/hook shadowing bug: a Workflow script must not bind a
// local name (from `const { … } = args`) that collides with a Workflow hook
// (phase, agent, parallel, …). `const { phase } = args` shadows phase() and breaks
// the script at runtime; `const { phase: phaseSlug } = args` is fine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WF = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows');
const HOOKS = ['phase', 'agent', 'parallel', 'pipeline', 'log', 'workflow'];

test('workflow scripts never bind an args name that shadows a Workflow hook', () => {
  const files = readdirSync(WF).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length > 0, 'expected workflow scripts');
  for (const f of files) {
    const src = readFileSync(join(WF, f), 'utf8');
    const m = src.match(/const\s*\{([^}]*)\}\s*=\s*args/);
    assert.ok(m, `${f}: expected a destructure from args`);
    const localNames = m[1].split(',').map((entry) => {
      const noDefault = entry.split('=')[0].trim(); // drop "= default"
      const parts = noDefault.split(':'); // "phase: phaseSlug" → local name is after ':'
      return (parts[1] || parts[0]).trim();
    });
    for (const hook of HOOKS) {
      assert.ok(!localNames.includes(hook), `${f}: local "${hook}" from args shadows the ${hook}() hook — rename it (e.g. ${hook}Slug)`);
    }
  }
});
