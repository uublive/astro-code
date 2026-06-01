// Guard against the args/hook shadowing bug: a Workflow script must not bind a local
// name (in any `const { … } = …` destructure) that collides with a Workflow hook
// (phase, agent, parallel, …). `const { phase } = …` shadows phase() and breaks the
// script; `const { phase: phaseSlug } = …` is fine.
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
