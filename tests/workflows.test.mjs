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
import { runInNewContext } from 'node:vm';

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

// ── integrateWave: prompt must carry wave task list + correct conflict behavior ──
//
// Phase-05 task (b): the integrator must receive the wave's tasks as an inlined
// JSON scalar (id + title + file) so it can map conflicted worktree-* branches
// to task ids by commit message + changed files.  Without this, the integrator
// is forced to guess or return taskId:null for everything (wasteful re-runs).
//
// Phase-05 task (c): on conflict the integrator must `git cherry-pick --abort`,
// verify `git status` is clean before returning, and PRESERVE (NOT tear down)
// the conflicting branch + worktree; only cleanly-merged worktrees are torn down.
//
// We extract the integrateWave function body from the source (spanning multiple
// concatenated template literals) and check:
//   1. It references JSON.stringify and wave.map (the scalar inlining)
//   2. It instructs cherry-pick --abort on conflict
//   3. It instructs verifying git status is clean before returning
//   4. It instructs PRESERVING (not tearing down) conflicting branches/worktrees
//   5. It still tears down CLEAN (merged) worktrees
//   6. The integrateWave call site passes the wave task array (not just the wave index)

/**
 * Extract the entire integrateWave function definition from the workflow source.
 * The prompt spans multiple concatenated template literals (`...` + `...`), so
 * we extract the whole function body from `const integrateWave` through to the
 * closing `)` of the `agent()` call rather than trying to parse one template literal.
 */
function extractIntegrateWaveBody(wfSrc) {
  // Find the start of the integrateWave const declaration.
  const startIdx = wfSrc.indexOf('const integrateWave')
  if (startIdx === -1) return null
  // Extract a generous window (next ~2000 chars) that covers the full definition.
  // The agent() call ends with `}` + `)` before the next top-level statement.
  // We look for the closing of the outer agent() — the pattern `}\n  )` that
  // ends the options object and closes agent().
  const window = wfSrc.slice(startIdx, startIdx + 2500)
  return window
}

test('integrateWave prompt inlines wave task list as JSON scalar', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegrateWaveBody(wfSrc)
  assert.ok(body, 'integrateWave function definition not found in execute-phase.mjs')

  // The function must accept a wave tasks parameter (not just an index w)
  const fnMatch = body.match(/const integrateWave\s*=\s*\(([^)]*)\)\s*=>/)
  assert.ok(fnMatch, 'integrateWave arrow function signature not found')
  const paramList = fnMatch[1].trim()
  assert.ok(
    paramList.includes('wave') || paramList.length > 3,
    `integrateWave should take wave tasks, not just an index; got: (${paramList})`,
  )

  // The prompt must inline wave tasks as JSON (JSON.stringify + wave.map).
  // These appear inline in the template literal expression, not in a string.
  assert.ok(
    body.includes('JSON.stringify') && body.includes('.map('),
    'integrateWave body must inline wave tasks via JSON.stringify(wave.map(...))',
  )
})

test('integrateWave prompt instructs cherry-pick --abort on conflict', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegrateWaveBody(wfSrc)
  assert.ok(body, 'integrateWave function definition not found')

  assert.ok(
    body.includes('cherry-pick --abort'),
    'integrateWave prompt must instruct "git cherry-pick --abort" on conflict',
  )
})

test('integrateWave prompt instructs verifying git status is clean before returning on conflict', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegrateWaveBody(wfSrc)
  assert.ok(body, 'integrateWave function definition not found')

  // Must verify git status is clean before returning after abort.
  // The prompt must contain both "git status" and a word indicating cleanliness.
  assert.ok(
    body.includes('git status') && (body.includes('clean') || body.includes('nothing to commit')),
    'integrateWave prompt must instruct verifying git status is clean before returning after abort',
  )
})

test('integrateWave prompt preserves conflicting branch and worktree (does NOT tear them down)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegrateWaveBody(wfSrc)
  assert.ok(body, 'integrateWave function definition not found')

  // Must explicitly instruct preservation of conflicting branches/worktrees.
  assert.ok(
    body.match(/preserv|PRESERVE|do NOT.*(?:tear|remov)|do not.*(?:tear|remov)/i),
    'integrateWave prompt must instruct preserving (not tearing down) conflicting branches/worktrees',
  )
  // Must still tear down CLEAN (successfully merged) worktrees.
  assert.ok(
    body.includes('worktree remove') || body.includes('branch -D'),
    'integrateWave prompt must still tear down clean (merged) worktrees',
  )
})

test('integrateWave call site passes the wave tasks array', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The call site must pass BOTH the wave index (for the `integrate:w<N>` label)
  // and the wave tasks array (for branch→taskId mapping) — `integrateWave(w, wave)`.
  // Passing only the index loses the task list; passing only the array regresses
  // the label to a task-count (the phase-06 UAT label finding).
  const callMatch = wfSrc.match(/await integrateWave\(([^)]+)\)/)
  assert.ok(callMatch, 'integrateWave call site not found')
  const callArgs = callMatch[1].split(',').map((a) => a.trim())

  assert.deepEqual(
    callArgs,
    ['w', 'wave'],
    `integrateWave call site must pass (w, wave) — got (${callArgs.join(', ')})`,
  )
})

// ── INTEGRATE_SCHEMA.conflicts items must be { branch, taskId } objects ───────
//
// Phase-05 ADR-014 decision: `INTEGRATE_SCHEMA.conflicts` items are objects with
// `branch` (string) and `taskId` (string|null) so the script can drive
// `runOnBranch(t)` for the right task when healing a wave conflict.  Keeping them
// as plain strings would lose the branch→task mapping and force re-running the
// whole wave remainder (wasteful).  `additionalProperties:false` at every level is
// required by the canon (schema changes must keep it).
test('INTEGRATE_SCHEMA.conflicts items are { branch, taskId } objects, not strings', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract the INTEGRATE_SCHEMA constant literal from the source so we can
  // evaluate just that definition.  The schema is a plain object literal assigned
  // to `const INTEGRATE_SCHEMA = { … }` — extract up to the first `}` that closes
  // the top-level object by matching the delimited block.
  const schemaMatch = wfSrc.match(/const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'INTEGRATE_SCHEMA constant not found in execute-phase.mjs')

  // Evaluate the extracted object literal in an isolated context.
  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // Top-level must have additionalProperties:false (canon requirement).
  assert.strictEqual(schema.additionalProperties, false, 'INTEGRATE_SCHEMA must have additionalProperties:false at the top level')

  // conflicts must be present as an array property.
  assert.ok(schema.properties?.conflicts, 'INTEGRATE_SCHEMA must have a conflicts property')
  assert.strictEqual(schema.properties.conflicts.type, 'array', 'conflicts must be type:array')

  const item = schema.properties.conflicts.items
  assert.ok(item, 'conflicts.items must be defined')

  // The item must be an object schema, not a bare string schema.
  assert.strictEqual(item.type, 'object', 'conflicts.items must have type:object (not string)')
  assert.strictEqual(item.additionalProperties, false, 'conflicts.items must have additionalProperties:false')

  // Required fields: branch and taskId.
  assert.ok(Array.isArray(item.required), 'conflicts.items must have a required array')
  assert.ok(item.required.includes('branch'), 'conflicts.items.required must include "branch"')
  assert.ok(item.required.includes('taskId'), 'conflicts.items.required must include "taskId"')

  // branch must be type:string.
  assert.strictEqual(item.properties?.branch?.type, 'string', 'conflicts.items.properties.branch must be type:string')

  // taskId must accept string OR null (the integrator may not be able to map a branch).
  const taskIdType = item.properties?.taskId?.type
  assert.ok(
    Array.isArray(taskIdType) && taskIdType.includes('string') && taskIdType.includes('null'),
    `conflicts.items.properties.taskId must be type:['string','null'], got: ${JSON.stringify(taskIdType)}`,
  )
})

// ── healPrompt and runHealOnBranch: heal-executor variant (phase-05 t5) ───────
//
// These guards enforce the contract introduced by t5: a `healPrompt(t, preservedBranch)`
// function distinct from `execPrompt` that tells the executor this is a HEAL re-run
// (inspect HEAD/working-tree first, implement fresh against the integrated tip, ONE
// atomic commit); and a `runHealOnBranch(t, preservedBranch)` wrapper that calls
// `agent(healPrompt(...), { label: `heal:${t.id}`, ... })`.
// The comment must reference open-question-1 (bias to fresh implementation).
// These are static source guards — no eval/import needed.

test('healPrompt function is defined in execute-phase.mjs and is distinct from execPrompt', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // healPrompt must be defined as a function/arrow function taking two parameters.
  assert.ok(
    /const\s+healPrompt\s*=/.test(wfSrc) || /function\s+healPrompt\s*\(/.test(wfSrc),
    'execute-phase.mjs must define healPrompt',
  )

  // It must accept a preservedBranch parameter.
  const healMatch = wfSrc.match(/const\s+healPrompt\s*=\s*\(([^)]*)\)/)
    || wfSrc.match(/function\s+healPrompt\s*\(([^)]*)\)/)
  assert.ok(healMatch, 'healPrompt function signature not found')
  const params = healMatch[1]
  assert.ok(
    params.includes('preservedBranch'),
    `healPrompt must accept a preservedBranch parameter; got: (${params})`,
  )

  // It must be a distinct definition from execPrompt (both must exist separately).
  assert.ok(
    /const\s+execPrompt\s*=/.test(wfSrc),
    'execPrompt must still exist in execute-phase.mjs (healPrompt must be distinct, not a replacement)',
  )
})

test('healPrompt content instructs HEAL re-run: inspect HEAD first, implement fresh, ONE atomic commit', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract the healPrompt arrow function body (a generous window after its definition).
  const startIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(startIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  // Must mention this is a HEAL re-run (the executor needs to know the context).
  assert.ok(
    /heal|HEAL/i.test(window),
    'healPrompt must describe this as a HEAL re-run',
  )

  // Must tell the executor to inspect the current HEAD/working-tree state first.
  assert.ok(
    /inspect|HEAD|working.tree/i.test(window),
    'healPrompt must instruct inspecting the current HEAD/working-tree state first',
  )

  // Must tell the executor to implement fresh (not resurrect the dropped attempt).
  assert.ok(
    /fresh|stale|do NOT resurrect|dropped/i.test(window),
    'healPrompt must tell the executor the dropped attempt is stale and to implement fresh',
  )

  // Must instruct ONE atomic commit.
  assert.ok(
    /ONE atomic commit/i.test(window),
    'healPrompt must instruct making ONE atomic commit',
  )
})

test('healPrompt references the preserved branch in its output', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(startIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  // The prompt must reference preservedBranch (interpolated into the string).
  assert.ok(
    window.includes('preservedBranch'),
    'healPrompt body must interpolate preservedBranch into the prompt string',
  )
})

test('runHealOnBranch is defined and calls agent with heal label and correct agentType', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  assert.ok(
    /const\s+runHealOnBranch\s*=/.test(wfSrc) || /function\s+runHealOnBranch\s*\(/.test(wfSrc),
    'execute-phase.mjs must define runHealOnBranch',
  )

  // Extract the runHealOnBranch definition window.
  const startIdx = wfSrc.indexOf('runHealOnBranch')
  assert.ok(startIdx !== -1, 'runHealOnBranch not found')
  const window = wfSrc.slice(startIdx, startIdx + 800)

  // Must call agent(healPrompt(...)).
  assert.ok(
    window.includes('healPrompt'),
    'runHealOnBranch must call agent(healPrompt(...))',
  )

  // Must use label pattern `heal:${t.id}` or `heal:` prefix.
  assert.ok(
    window.includes('heal:'),
    'runHealOnBranch agent call must use a label with "heal:" prefix (e.g. `heal:${t.id}`)',
  )

  // Must use agentType: 'astro-executor'.
  assert.ok(
    window.includes('astro-executor'),
    'runHealOnBranch agent call must use agentType: astro-executor',
  )

  // Must use phase: 'Execute'.
  assert.ok(
    window.includes("'Execute'") || window.includes('"Execute"'),
    'runHealOnBranch agent call must use phase: Execute',
  )
})

test('healPrompt or its surrounding comment references open-question-1 (bias to fresh implementation)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The comment must reference open-question-1 so future readers know why the
  // prompt biases toward fresh rather than referencing the preserved branch diff.
  assert.ok(
    /open-question-1|open question 1/i.test(wfSrc),
    'execute-phase.mjs must contain a comment referencing open-question-1 near healPrompt/runHealOnBranch',
  )
})

// ── TESTGATE_SCHEMA and runTestSuite: healed-wave test gate (phase-05 t6) ─────
//
// ADR-014 + CONTEXT.md § "Test gate only after a HEALED wave": after any wave
// where the heal ladder fired, the script runs the full test suite (an agent does
// it — the Workflow script cannot run processes directly) before the next wave
// proceeds.  A failing suite is treated like an integration failure and stops the
// phase immediately.
//
// The strict schema (`TESTGATE_SCHEMA`, `additionalProperties:false`,
// `required:['passed']`) prevents the phase-04 silent-empty-return trap: without
// it the agent could return `{}` and the script would never know the suite failed.
//
// These guards are static source checks (no eval of the full workflow script,
// which uses Workflow-tool globals).  For TESTGATE_SCHEMA we use `runInNewContext`
// on the extracted object literal (same pattern as the INTEGRATE_SCHEMA guard).

test('TESTGATE_SCHEMA is defined with additionalProperties:false, passed:boolean, output:string, required:[passed]', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract the TESTGATE_SCHEMA constant literal.
  const schemaMatch = wfSrc.match(/const TESTGATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'TESTGATE_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // Top-level must have additionalProperties:false (canon requirement — every schema).
  assert.strictEqual(
    schema.additionalProperties, false,
    'TESTGATE_SCHEMA must have additionalProperties:false at the top level',
  )

  // passed must be type:boolean.
  assert.strictEqual(
    schema.properties?.passed?.type, 'boolean',
    'TESTGATE_SCHEMA.properties.passed must be type:boolean',
  )

  // output must be type:string.
  assert.strictEqual(
    schema.properties?.output?.type, 'string',
    'TESTGATE_SCHEMA.properties.output must be type:string',
  )

  // required must include 'passed' (not 'output' — output is optional for passing suites).
  assert.ok(Array.isArray(schema.required), 'TESTGATE_SCHEMA must have a required array')
  assert.ok(
    schema.required.includes('passed'),
    'TESTGATE_SCHEMA.required must include "passed"',
  )
})

test('runTestSuite is defined and calls agent with agentType:astro-executor, phase:Execute, and TESTGATE_SCHEMA', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // runTestSuite must be defined (arrow or function declaration).
  assert.ok(
    /const\s+runTestSuite\s*=/.test(wfSrc) || /function\s+runTestSuite\s*\(/.test(wfSrc),
    'execute-phase.mjs must define runTestSuite',
  )

  // Extract a window around the runTestSuite definition.
  // Use 1500 chars to capture the full agent() call including options object.
  const startIdx = wfSrc.indexOf('runTestSuite')
  assert.ok(startIdx !== -1, 'runTestSuite not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  // Must call agent().
  assert.ok(
    window.includes('agent('),
    'runTestSuite must call agent()',
  )

  // Must use agentType: 'astro-executor'.
  assert.ok(
    window.includes('astro-executor'),
    'runTestSuite agent call must use agentType: astro-executor',
  )

  // Must use phase: 'Execute'.
  assert.ok(
    window.includes("'Execute'") || window.includes('"Execute"'),
    "runTestSuite agent call must use phase: 'Execute'",
  )

  // Must reference TESTGATE_SCHEMA as the schema.
  assert.ok(
    window.includes('TESTGATE_SCHEMA'),
    'runTestSuite agent call must pass TESTGATE_SCHEMA as the schema',
  )
})

test('runTestSuite prompt instructs running the full test suite and returning passed + failure output', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('runTestSuite')
  assert.ok(startIdx !== -1, 'runTestSuite not found in execute-phase.mjs')
  // Generous window to capture the full prompt template literal.
  const window = wfSrc.slice(startIdx, startIdx + 1000)

  // Must tell the agent to run the test suite.
  assert.ok(
    /test suite|test-suite|run.*test|node.*test/i.test(window),
    'runTestSuite prompt must instruct running the full test suite',
  )

  // Must tell the agent to return passed.
  assert.ok(
    /passed/i.test(window),
    'runTestSuite prompt must instruct returning the passed field',
  )

  // Must reference the root directory so the agent knows where to run.
  assert.ok(
    window.includes('root') || window.includes('${root}'),
    'runTestSuite prompt must reference the root directory',
  )
})

// ── t7: self-healing ladder in the wave loop ────────────────────────────────
//
// ADR-014 + CONTEXT.md § "NO rebase rung — the ladder is: drop & re-run, then
// fail": when the integrator returns integrated=false (conflicts), the script
// must NOT immediately set integrationFailed. Instead it fires the healing
// ladder: log each preserved branch, compute the heal list via resolveHealList,
// re-run each task via runHealOnBranch, gate with runTestSuite.  Only a failed
// re-run or a failed test gate sets integrationFailed and stops the phase.
//
// The return value must include healed:[…taskIds] so the outer command can
// report how many tasks were auto-healed.  The FAIL verdict text must surface
// the richer integrationFailed (task id + branch) rather than the old
// "conflicts: […]" form.
//
// All guards here are static source checks — no eval of the Workflow-tool
// globals.

test('wave loop uses resolveHealList to compute the heal task list on conflict (t7 self-healing ladder)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // resolveHealList must be called in the wave loop (not just defined in the MIRROR).
  // The call site is outside the MIRROR sentinel region and drives the heal loop.
  // We check for a call expression pattern that passes wave, integ.conflicts or
  // similar, and the integratedTaskIds set — the exact names match the spec.
  assert.ok(
    /resolveHealList\s*\(/.test(wfSrc),
    'execute-phase.mjs wave loop must call resolveHealList() for the self-healing ladder',
  )

  // The call must pass integ.conflicts (the integrator's conflict objects).
  const callIdx = wfSrc.indexOf('resolveHealList(')
  assert.ok(callIdx !== -1, 'resolveHealList call not found')
  // There may be multiple: the definition in the MIRROR region + the call site.
  // We need to find the CALL SITE (outside the MIRROR region).
  const mirrorStart = wfSrc.indexOf('// >>> MIRROR')
  const mirrorEnd = wfSrc.indexOf('// <<< MIRROR')
  // Find all resolveHealList occurrences outside the MIRROR.
  const callSites = []
  let searchFrom = 0
  while (true) {
    const idx = wfSrc.indexOf('resolveHealList(', searchFrom)
    if (idx === -1) break
    if (idx < mirrorStart || idx > mirrorEnd) callSites.push(idx)
    searchFrom = idx + 1
  }
  assert.ok(
    callSites.length > 0,
    'resolveHealList must be called OUTSIDE the MIRROR region (in the wave loop)',
  )

  // The call site window must reference integ.conflicts or similar.
  const callWindow = wfSrc.slice(callSites[0], callSites[0] + 300)
  assert.ok(
    /integ\.conflicts|integ\?\.conflicts/.test(callWindow),
    'resolveHealList call site must pass integ.conflicts (the integrator conflict objects)',
  )
})

test('wave loop calls runHealOnBranch for each task in the heal list (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // runHealOnBranch must be called inside the heal loop — not just defined.
  // The call pattern is runHealOnBranch(t, preservedBranch) where preservedBranch
  // comes from the integ.branches or integ.conflicts map.
  const callIdx = wfSrc.indexOf('await runHealOnBranch(')
  assert.ok(
    callIdx !== -1,
    'execute-phase.mjs wave loop must call `await runHealOnBranch(t, preservedBranch)` for each heal task',
  )

  // The call must be inside a for/loop context (not isolated outside any loop).
  // We check that there's a `for` somewhere in the 300 chars before the call.
  const preceding = wfSrc.slice(Math.max(0, callIdx - 400), callIdx)
  assert.ok(
    /for\s*\(|for\s+of/.test(preceding),
    'runHealOnBranch call must be inside a loop (for each heal task)',
  )
})

test('wave loop pushes heal result to results and tracks healedTaskIds (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // After a successful runHealOnBranch call, the result must be pushed to results
  // AND the task id must be tracked in healedTaskIds (for the return value).
  assert.ok(
    /healedTaskIds/.test(wfSrc),
    'execute-phase.mjs must track healedTaskIds for the healed wave',
  )

  // healedTaskIds must be populated with task ids (push or add).
  assert.ok(
    /healedTaskIds\.(push|add)\s*\(/.test(wfSrc),
    'healedTaskIds must be populated via push() or add() with healed task ids',
  )
})

test('wave loop calls runTestSuite after a healed wave and sets integrationFailed on suite failure (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // runTestSuite must be awaited inside the wave loop (not just defined).
  const awaitTestIdx = wfSrc.indexOf('await runTestSuite(')
  assert.ok(
    awaitTestIdx !== -1,
    'execute-phase.mjs wave loop must await runTestSuite() after a healed wave',
  )

  // After the test gate, a failed suite (gate.passed === false) must set integrationFailed.
  // We check the region around the await runTestSuite() call for the failure branch.
  const gateWindow = wfSrc.slice(awaitTestIdx, awaitTestIdx + 600)
  assert.ok(
    /passed/.test(gateWindow),
    'runTestSuite result must be checked for the passed field',
  )
  assert.ok(
    /integrationFailed\s*=/.test(gateWindow),
    'a failing test suite after a healed wave must set integrationFailed',
  )
})

test('wave loop sets integrationFailed with task id and branch on a falsy runHealOnBranch result (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // When runHealOnBranch returns falsy, integrationFailed must be set immediately
  // with a human-readable note that includes the task id and branch.  The note
  // is what astro-execute.md surfaces to the user unchanged.
  const healCallIdx = wfSrc.indexOf('await runHealOnBranch(')
  assert.ok(healCallIdx !== -1, 'runHealOnBranch call not found')
  const healWindow = wfSrc.slice(healCallIdx, healCallIdx + 800)

  // The failure branch must set integrationFailed.
  assert.ok(
    /integrationFailed\s*=/.test(healWindow),
    'wave loop must set integrationFailed when runHealOnBranch returns falsy',
  )

  // The note must reference the task id (t.id) so the user knows which task failed.
  assert.ok(
    /t\.id/.test(healWindow),
    'integrationFailed note on heal failure must reference t.id (task id)',
  )
})

test('return value includes healed: healedTaskIds (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The final return statement must include a healed property.
  // The return is the last statement; we search for its pattern.
  assert.ok(
    /healed\s*:\s*healedTaskIds/.test(wfSrc),
    'execute-phase.mjs return value must include `healed: healedTaskIds`',
  )
})

test('FAIL verdict text reads richer integrationFailed (task id + branch) not just conflicts array (t7)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The Verify phase FAIL verdict for integration failure must surface task id and
  // branch — not just the old `conflicts.join(', ')` array — so the user knows
  // exactly which task and branch triggered the failure.
  // We find the verdict assignment near the 'Verify' phase.
  const verifyIdx = wfSrc.indexOf("phase('Verify')")
  assert.ok(verifyIdx !== -1, "phase('Verify') not found")
  const verifyWindow = wfSrc.slice(verifyIdx, verifyIdx + 1500)

  // Must reference integrationFailed.taskId or integrationFailed.branch
  // (the richer shape set by the self-healing ladder failure branches).
  assert.ok(
    /integrationFailed\.(taskId|branch)/.test(verifyWindow),
    'FAIL verdict in Verify phase must reference integrationFailed.taskId or integrationFailed.branch (richer failure report)',
  )
})

// ── t8: static-source contract guards (string/regex only, no eval/import) ────
//
// These four guards enforce phase-05 contracts via pure string/regex matching
// against the workflow source — no runInNewContext, no dynamic import.
// The pattern mirrors the existing hook-shadowing and MIRROR drift-guard style:
// read the file once, apply regex/includes checks, assert.ok with a diagnostic.
//
// (1) INTEGRATE_SCHEMA.conflicts items must NOT be bare strings.  The schema
//     source text must contain `type: 'object'` inside the conflicts.items
//     definition — the presence of `type: 'string'` as an items type would
//     silently lose the branch→task mapping (the phase-04 wave-2 lesson).
//
// (2) The integrator prompt must reference the wave task list injection.
//     `wave.map(` is the literal interpolation that inlines the task scalar;
//     without it the integrator cannot map branch→taskId and returns null for
//     every conflict (wasteful wide-wave re-runs).
//
// (3) The return statement must carry a `healed` field so the outer command
//     can report how many tasks were auto-healed (the ADR-014 observability
//     surface).
//
// (4) Both the heal-executor label (`heal:`) AND the test-suite gate call
//     (`runTestSuite`) must be present.  Missing either silently removes the
//     ADR-014 "healed waves are test-gated before the next wave proceeds" safety.

test('static guard (t8-1): INTEGRATE_SCHEMA conflicts items source contains type:object, not bare type:string', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Locate the INTEGRATE_SCHEMA constant in the source.
  const schemaStart = wfSrc.indexOf('const INTEGRATE_SCHEMA')
  assert.ok(schemaStart !== -1, 'INTEGRATE_SCHEMA not found in execute-phase.mjs')
  // Take a window large enough to cover the full schema literal (≤ 600 chars).
  const schemaWindow = wfSrc.slice(schemaStart, schemaStart + 600)

  // Must contain type:'object' inside the conflicts section.
  // The `branches` array legitimately has items:{type:'string'} — we target
  // the conflicts sub-tree which appears after the word "conflicts" in the source.
  const conflictsStart = schemaWindow.indexOf('conflicts')
  assert.ok(conflictsStart !== -1, 'INTEGRATE_SCHEMA.conflicts property not found in schema source')
  const conflictsRegion = schemaWindow.slice(conflictsStart)

  // The conflicts.items block must declare type:'object'.
  assert.ok(
    /type:\s*['"]object['"]/.test(conflictsRegion),
    "INTEGRATE_SCHEMA conflicts.items source must declare type:'object' — bare type:'string' items would lose branch→task mapping",
  )

  // Must NOT begin with a bare items:{type:'string'} — the old broken shape.
  // (taskId's type:['string','null'] array is fine; `items: { type: 'string' }`
  // directly under conflicts is the regression we guard against.)
  assert.ok(
    !/items\s*:\s*\{\s*type\s*:\s*['"]string['"]/.test(conflictsRegion),
    "INTEGRATE_SCHEMA conflicts.items must NOT be { type: 'string' } — objects with branch+taskId required",
  )
})

test('static guard (t8-2): integrator prompt source references wave.map( (task-list injection)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The call that inlines the wave task list into the prompt is `wave.map(`.
  // Its absence means the integrator receives no task list and cannot map
  // conflicted worktree-* branches to task ids (every conflict → taskId:null,
  // forcing wasteful full-wave re-runs).
  assert.ok(
    wfSrc.includes('wave.map('),
    'execute-phase.mjs must contain `wave.map(` to inject the wave task list into the integrator prompt',
  )
})

test('static guard (t8-3): return statement source includes healed field', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The final return must carry healed: so the outer command can report
  // auto-healed task ids (ADR-014 observability surface).
  assert.ok(
    /return\s*\{[^}]*healed\s*:/.test(wfSrc) || /healed\s*:\s*healedTaskIds/.test(wfSrc),
    'execute-phase.mjs return statement must include a `healed:` field (for ADR-014 observability)',
  )
})

test('static guard (t8-4): heal: agent label AND runTestSuite gate call are both present in source', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // `heal:` label — present in runHealOnBranch's agent() call.  Absence means
  // the heal executor loses its identity in the Workflow event log.
  assert.ok(
    wfSrc.includes('heal:'),
    'execute-phase.mjs must contain a `heal:` agent label (ADR-014 heal-executor identity)',
  )

  // `runTestSuite` — the healed-wave test gate.  Absence silently removes the
  // ADR-014 "healed waves are test-gated before the next wave proceeds" safety
  // and would reproduce the phase-04 wave-2 bad-merge-gone-undetected incident.
  assert.ok(
    wfSrc.includes('runTestSuite'),
    'execute-phase.mjs must call runTestSuite (healed-wave test gate, ADR-014)',
  )
})

test('static guard (t8-5): post-heal teardown exists and runs only after the test gate passes', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The phase-05 UAT gap: heals landed but the preserved worktree-* branches were
  // never removed — stale worktrees accumulated and the final verifier's
  // `git rev-list HEAD..worktree-*` check would false-FAIL a correctly healed
  // phase. Guard all three pieces:

  // (a) A strict teardown schema — `removed` is required so a silent no-op
  //     teardown cannot read as success.
  assert.ok(
    wfSrc.includes('const TEARDOWN_SCHEMA'),
    'execute-phase.mjs must define TEARDOWN_SCHEMA (strict post-heal teardown contract)',
  )

  // (b) The teardown agent call with its identity label.
  assert.ok(
    wfSrc.includes('runTeardown') && wfSrc.includes('teardown:w'),
    'execute-phase.mjs must call runTeardown with a `teardown:w<N>` agent label',
  )

  // (c) Ordering: teardown must come AFTER the gate-pass narration in the wave
  //     loop — tearing down before the suite passes would destroy the only copy
  //     of the dropped attempt while its replacement was still unproven. Static
  //     index comparison over the source (same technique as the MIRROR guard):
  //     the gate-pass log line precedes the runTeardown(w, …) call site.
  const gatePassIdx = wfSrc.indexOf('test gate passed after heal')
  const teardownCallIdx = wfSrc.indexOf('await runTeardown(')
  assert.ok(gatePassIdx !== -1, 'gate-pass narration line not found')
  assert.ok(teardownCallIdx !== -1, 'await runTeardown( call site not found')
  assert.ok(
    teardownCallIdx > gatePassIdx,
    'runTeardown must be invoked after the test-gate-pass branch — never before the healed wave is proven green',
  )

  // (d) The leftover advisory — cleanup failure must be named, never silent.
  assert.ok(
    wfSrc.includes('clean up manually'),
    'execute-phase.mjs must ⚠-name leftover preserved branches when teardown misses them',
  )
})

// ── t3: execPrompt hygiene + INTEGRATE_SCHEMA stale/overflow fields ───────────
//
// Phase-06 t3: (1) execPrompt must carry the "touch ONLY your declared file(s)"
// hygiene sentence so executors know not to overflow into unrelated files.
// healPrompt must remain UNRESTRICTED — by the time a collision-overflow task
// re-runs on-branch, the co-scheduling hazard is gone (CONTEXT.md note 1).
//
// (2) INTEGRATE_SCHEMA must carry two new optional arrays:
//   - staleBranches: items { branch, taskId } (same shape as conflicts.items)
//     for branches whose merge-base ≠ HEAD (ADR-015 cause #1 stale base).
//   - advisories: items { branch, taskId, extraFiles:[string] }
//     for branches that overflowed into unclaimed files (ADR-016 cause #2
//     harmless overflow — integrate with ⚠ advisory, NOT routed to heal).
// Both must have additionalProperties:false at the item level per canon.
// The required:['integrated'] and top-level additionalProperties:false are
// unchanged, and the extraction regex still matches.

test('t3: execPrompt contains "touch ONLY" declared-file hygiene instruction', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Locate the execPrompt definition window.
  const startIdx = wfSrc.indexOf('const execPrompt')
  assert.ok(startIdx !== -1, 'execPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 800)

  // Must contain the hygiene sentence telling executors to touch only declared files.
  assert.ok(
    /touch ONLY your declared file/i.test(window),
    'execPrompt must instruct executors to "touch ONLY your declared file(s)"',
  )
})

test('t3: healPrompt does NOT contain the "touch ONLY" restriction (heal re-runs are unrestricted)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // healPrompt must be unrestricted — the co-scheduling hazard is gone by the
  // time a task re-runs sequentially on-branch (CONTEXT.md note 1).
  const startIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(startIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  assert.ok(
    !/touch ONLY your declared file/i.test(window),
    'healPrompt must NOT contain the "touch ONLY" file restriction (heal re-runs are unrestricted per CONTEXT.md note 1)',
  )
})

test('t3: INTEGRATE_SCHEMA.staleBranches is an array of { branch, taskId } objects with additionalProperties:false', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract the INTEGRATE_SCHEMA constant literal (same regex as the phase-05 guard).
  const schemaMatch = wfSrc.match(/const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'INTEGRATE_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // staleBranches must be present.
  assert.ok(schema.properties?.staleBranches, 'INTEGRATE_SCHEMA must have a staleBranches property')
  assert.strictEqual(schema.properties.staleBranches.type, 'array', 'staleBranches must be type:array')

  const item = schema.properties.staleBranches.items
  assert.ok(item, 'staleBranches.items must be defined')
  assert.strictEqual(item.type, 'object', 'staleBranches.items must have type:object')
  assert.strictEqual(item.additionalProperties, false, 'staleBranches.items must have additionalProperties:false')

  // Required fields: branch and taskId (same shape as conflicts.items).
  assert.ok(Array.isArray(item.required), 'staleBranches.items must have a required array')
  assert.ok(item.required.includes('branch'), 'staleBranches.items.required must include "branch"')
  assert.ok(item.required.includes('taskId'), 'staleBranches.items.required must include "taskId"')

  // taskId must accept string OR null.
  const taskIdType = item.properties?.taskId?.type
  assert.ok(
    Array.isArray(taskIdType) && taskIdType.includes('string') && taskIdType.includes('null'),
    `staleBranches.items.taskId must be type:['string','null'], got: ${JSON.stringify(taskIdType)}`,
  )
})

test('t3: INTEGRATE_SCHEMA.advisories is an array of { branch, taskId, extraFiles } objects with additionalProperties:false', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract and evaluate the INTEGRATE_SCHEMA constant.
  const schemaMatch = wfSrc.match(/const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'INTEGRATE_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // advisories must be present.
  assert.ok(schema.properties?.advisories, 'INTEGRATE_SCHEMA must have an advisories property')
  assert.strictEqual(schema.properties.advisories.type, 'array', 'advisories must be type:array')

  const item = schema.properties.advisories.items
  assert.ok(item, 'advisories.items must be defined')
  assert.strictEqual(item.type, 'object', 'advisories.items must have type:object')
  assert.strictEqual(item.additionalProperties, false, 'advisories.items must have additionalProperties:false')

  // Required fields: branch, taskId, extraFiles.
  assert.ok(Array.isArray(item.required), 'advisories.items must have a required array')
  assert.ok(item.required.includes('branch'), 'advisories.items.required must include "branch"')
  assert.ok(item.required.includes('taskId'), 'advisories.items.required must include "taskId"')
  assert.ok(item.required.includes('extraFiles'), 'advisories.items.required must include "extraFiles"')

  // extraFiles must be an array of strings.
  const ef = item.properties?.extraFiles
  assert.ok(ef, 'advisories.items must have an extraFiles property')
  assert.strictEqual(ef.type, 'array', 'advisories.items.extraFiles must be type:array')
  assert.strictEqual(ef.items?.type, 'string', 'advisories.items.extraFiles.items must be type:string')

  // taskId must accept string OR null (like conflicts.items and staleBranches.items).
  const taskIdType = item.properties?.taskId?.type
  assert.ok(
    Array.isArray(taskIdType) && taskIdType.includes('string') && taskIdType.includes('null'),
    `advisories.items.taskId must be type:['string','null'], got: ${JSON.stringify(taskIdType)}`,
  )
})

test('t3: INTEGRATE_SCHEMA still has required:[integrated] and top-level additionalProperties:false after extension', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const schemaMatch = wfSrc.match(/const INTEGRATE_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'INTEGRATE_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // Invariants from phase-05 that must not be changed.
  assert.strictEqual(schema.additionalProperties, false, 'INTEGRATE_SCHEMA top-level must keep additionalProperties:false')
  assert.ok(Array.isArray(schema.required), 'INTEGRATE_SCHEMA must have a required array')
  assert.ok(schema.required.includes('integrated'), 'INTEGRATE_SCHEMA.required must still include "integrated"')
})

// ── t5: wave-loop wiring — stale/collision routing, overflowFlagged, extended gate, log() ──
//
// ADR-015 cause #1 (stale base) + ADR-016 cause #2 (overflow) wiring in the wave loop.
// After the integrator returns, the loop must:
//   (1) Route staleBranches into the heal ladder alongside conflicts — reusing
//       resolveHealList (no new ladder fork, ADR-014/015).
//   (2) Declare a per-wave `overflowFlagged` boolean at the same scope as `ladderFired`
//       (inside the wave-loop body, not at phase scope — must not leak into later waves).
//   (3) Log ⚠ advisories when integ.advisories is non-empty (branch + extraFiles named).
//   (4) Log •/✖ lines for stale-base branches routed to heal.
//   (5) Extend the gate condition from `ladderFired` to `ladderFired || overflowFlagged`.
// All guards are static source checks (string/regex over the workflow source, no eval).

test('t5: wave loop folds integ.staleBranches into the heal ladder (stale routing, ADR-015)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The wave loop must reference integ.staleBranches so stale branches reach
  // resolveHealList the same way conflicts do (ADR-015: always route stale to heal).
  assert.ok(
    /integ\.(staleBranches|staleBranches)/.test(wfSrc),
    'execute-phase.mjs wave loop must reference integ.staleBranches to route stale branches to the heal ladder',
  )

  // staleBranches must feed into resolveHealList or be combined with conflicts
  // before that call — we check that the call site window contains staleBranches.
  const mirrorStart = wfSrc.indexOf('// >>> MIRROR')
  const mirrorEnd = wfSrc.indexOf('// <<< MIRROR')
  // Find resolveHealList call sites OUTSIDE the MIRROR region.
  let searchFrom = 0
  const callSites = []
  while (true) {
    const idx = wfSrc.indexOf('resolveHealList(', searchFrom)
    if (idx === -1) break
    if (idx < mirrorStart || idx > mirrorEnd) callSites.push(idx)
    searchFrom = idx + 1
  }
  assert.ok(callSites.length > 0, 'resolveHealList must be called outside the MIRROR region')

  // The surrounding window (up to 600 chars before the call) must reference staleBranches.
  const surroundingWindow = wfSrc.slice(Math.max(0, callSites[0] - 600), callSites[0] + 300)
  assert.ok(
    /staleBranches/.test(surroundingWindow),
    'resolveHealList call site area must reference staleBranches (fold stale into heal ladder)',
  )
})

test('t5: overflowFlagged is declared inside the wave loop body (per-wave scope, not phase scope)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // overflowFlagged must be declared with `let` or `const` INSIDE the wave loop.
  // It must appear AFTER the `for (let w = 0;` loop start and BEFORE the loop end.
  const loopStart = wfSrc.indexOf('for (let w = 0;')
  assert.ok(loopStart !== -1, 'wave loop (for let w = 0) not found in execute-phase.mjs')

  // The declaration must be inside the loop body, i.e. its index > loopStart.
  const declIdx = wfSrc.indexOf('overflowFlagged', loopStart)
  assert.ok(
    declIdx !== -1 && declIdx > loopStart,
    'overflowFlagged must be declared inside the wave loop body (after `for (let w = 0;`)',
  )

  // The declaration pattern: `let overflowFlagged` or `const overflowFlagged`.
  assert.ok(
    /(?:let|const)\s+overflowFlagged/.test(wfSrc),
    'overflowFlagged must be declared with let or const (not a global)',
  )
})

test('t5: wave-loop gate condition is (ladderFired || overflowFlagged) && !integrationFailed', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The test-gate if-condition must include overflowFlagged alongside ladderFired.
  // Phase-05 shipped: `if (ladderFired && !integrationFailed)`.
  // t5 extends it to: `if ((ladderFired || overflowFlagged) && !integrationFailed)`.
  assert.ok(
    /if\s*\(\s*\(\s*ladderFired\s*\|\|\s*overflowFlagged\s*\)/.test(wfSrc) ||
    /if\s*\(\s*ladderFired\s*\|\|\s*overflowFlagged\s*\)/.test(wfSrc),
    'wave-loop gate condition must be `(ladderFired || overflowFlagged) && !integrationFailed` (extended gate, t5 / CONTEXT.md)',
  )
})

test('t5: wave loop logs ⚠ advisory per integ.advisories entry naming branch and extraFiles', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The loop must reference integ.advisories and emit a log() with ⚠.
  assert.ok(
    /integ\.advisories/.test(wfSrc),
    'execute-phase.mjs must reference integ.advisories in the wave loop',
  )

  // There must be a log() call that includes both 'advisory' or '⚠' and 'extraFiles'.
  // Locate the advisory log area — after the integ.advisories reference.
  const advisoriesIdx = wfSrc.indexOf('integ.advisories')
  assert.ok(advisoriesIdx !== -1, 'integ.advisories reference not found')
  const advisoriesWindow = wfSrc.slice(advisoriesIdx, advisoriesIdx + 600)

  // Must emit a ⚠ log line.
  assert.ok(
    /⚠/.test(advisoriesWindow) || /log\(/.test(advisoriesWindow),
    'wave loop must log() ⚠ advisory when integ.advisories is non-empty',
  )

  // The advisory log must name extraFiles.
  assert.ok(
    /extraFiles/.test(advisoriesWindow),
    'advisory log() must name extraFiles (so the user sees what overflowed)',
  )
})

test('t5: wave loop logs •/✖ for stale-base branches routed to heal', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The loop must log something when a staleBranch is routed to heal.
  // We look for a log() call near the staleBranches region that uses • or ✖.
  const staleBranchesIdx = wfSrc.indexOf('integ.staleBranches')
  assert.ok(staleBranchesIdx !== -1, 'integ.staleBranches reference not found')
  const staleWindow = wfSrc.slice(staleBranchesIdx, staleBranchesIdx + 800)

  // Must have a log() call with • (info) or ✖ (error) narrating the stale routing.
  assert.ok(
    /log\(/.test(staleWindow) && (/•|stale/.test(staleWindow)),
    'wave loop must log() narration (• or stale keyword) for stale-base branches routed to heal',
  )
})

// ── t6: integrator prompt contract — merge-base staleness + overflow classification ──
//
// ADR-015 cause #1 (stale base): the integrator prompt MUST run
// `git merge-base HEAD <branch>` per candidate and route any stale branch
// (merge-base ≠ HEAD) to staleBranches[], never cherry-picking it — a textually
// clean pick can stack duplicate helpers with zero conflict markers (phase-04
// lesson). ADR-014 mandates drop-and-rerun at the integrated tip; the integrator
// is the only actor that can make this call.
//
// ADR-016 cause #2 (overflow): the integrator prompt MUST classify changed files
// vs each task's declared file set using `git diff --name-only`. An extra file
// claimed by ANOTHER wave task is a collision → route to heal (conflicts[]); an
// extra file nobody in the wave claims is harmless → integrate AND record in
// advisories[] with a ⚠. Neither outcome is a silent pass: the schema surfaces
// both so the wave loop can narrate and gate accordingly.
//
// These guards are static source checks against the integrateWave function body
// (same windowed-slice technique as the phase-05 guards above). No eval/import.

/**
 * Extract the integrateWave agent() call body — the prompt template literal +
 * options object that the integrator agent receives.  Starts at 'const
 * integrateWave' and captures a generous window (≤3000 chars) that covers the
 * full concatenated template literal including OBEY suffix.
 */
function extractIntegratorPromptWindow(wfSrc) {
  const startIdx = wfSrc.indexOf('const integrateWave')
  if (startIdx === -1) return null
  return wfSrc.slice(startIdx, startIdx + 3000)
}

test('t6: integrator prompt runs git merge-base HEAD <branch> staleness check (ADR-015)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegratorPromptWindow(wfSrc)
  assert.ok(body, 'integrateWave definition not found in execute-phase.mjs')

  // The prompt must instruct `git merge-base HEAD <branch>` — the cheap per-branch
  // staleness check mandated by ADR-015.  Its absence means the integrator can
  // silently cherry-pick a stale-base branch and stack duplicate code.
  assert.ok(
    /git merge-base HEAD/.test(body),
    'integrateWave prompt must instruct `git merge-base HEAD <branch>` for staleness detection (ADR-015)',
  )
})

test('t6: integrator prompt routes stale branches to staleBranches[] without cherry-picking (ADR-015)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegratorPromptWindow(wfSrc)
  assert.ok(body, 'integrateWave definition not found in execute-phase.mjs')

  // On staleness the prompt must: (a) say do NOT cherry-pick, and (b) add the
  // branch to staleBranches[].  ADR-015: textual cleanliness proves nothing;
  // the phase-04 wave-2 incident stacked duplicate helpers with no conflict marker.
  assert.ok(
    /do NOT cherry-pick|do not cherry-pick/i.test(body),
    'integrateWave prompt must instruct "do NOT cherry-pick" stale branches (ADR-015)',
  )
  assert.ok(
    /staleBranches/.test(body),
    'integrateWave prompt must route stale branches to staleBranches[] (ADR-015)',
  )
})

test('t6: integrator prompt uses git diff --name-only for overflow classification (ADR-016)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegratorPromptWindow(wfSrc)
  assert.ok(body, 'integrateWave definition not found in execute-phase.mjs')

  // The prompt must instruct `git diff --name-only` to enumerate the files a
  // branch actually changed vs what the task declared — the basis for the
  // collision vs harmless overflow classification (ADR-016 cause #2).
  assert.ok(
    /git diff --name-only/.test(body),
    'integrateWave prompt must instruct `git diff --name-only` for overflow classification (ADR-016)',
  )
})

test('t6: integrator prompt distinguishes collision (→ conflicts[]/heal) from harmless overflow (→ advisories[]) (ADR-016)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')
  const body = extractIntegratorPromptWindow(wfSrc)
  assert.ok(body, 'integrateWave definition not found in execute-phase.mjs')

  // Collision path: extra file claimed by ANOTHER wave task → integrator must NOT
  // cherry-pick and must route to conflicts[] (the heal ladder).
  assert.ok(
    /COLLISION|collision/.test(body) ||
    (/ANOTHER wave task|another wave task/.test(body) && /conflicts\[\]/.test(body)),
    'integrateWave prompt must name the COLLISION path (extra file claimed by another wave task → conflicts[])',
  )

  // Harmless path: extra files unclaimed by any wave peer → cherry-pick AND record
  // in advisories[] with ⚠.  Blanket rejection would have thrown away the
  // legitimate phase-04 t14 hooksPath fix.
  assert.ok(
    /advisories\[\]/.test(body) || /advisories\[/.test(body),
    'integrateWave prompt must route harmless overflow to advisories[] with ⚠ (ADR-016)',
  )

  // The prompt must also mention ⚠ advisory for the harmless path so the integrator
  // knows it is NOT a hard rejection — the ⚠ signals downstream narration, not failure.
  assert.ok(
    /⚠ advisory|⚠/.test(body),
    'integrateWave prompt must include ⚠ advisory notation for harmless overflow path',
  )
})

// ── phase-06 UAT hardening: needsHeal must key on the lists, not the flag ─────
//
// A misbehaving integrator could return integrated=true while still reporting
// staleBranches[]/conflicts[] (contradicting its prompt contract). If the heal
// trigger required `integrated !== true`, those lists would be silently ignored
// and the preserved branches stranded until the end verifier flags them. The
// trigger therefore keys on the LISTS alone; this guard pins that.
test('static guard (phase-06 UAT): needsHeal keys on conflicts/staleBranches lists, never on the integrated flag', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8');

  const idx = wfSrc.indexOf('const needsHeal');
  assert.ok(idx !== -1, 'needsHeal definition not found in execute-phase.mjs');
  // Window covering the full boolean expression (it spans a handful of lines).
  const window = wfSrc.slice(idx, idx + 300);

  assert.ok(
    /staleBranches/.test(window) && /conflicts/.test(window),
    'needsHeal must consider both integ.conflicts and integ.staleBranches',
  );
  assert.ok(
    !/integrated\s*!==?\s*true/.test(window),
    'needsHeal must NOT condition on integ.integrated — lists present ⇒ heal, whatever the flag says',
  );
});

// ── t4 (phase-07): phaseNum extraction + TASK_SCHEMA done field ──────────────
//
// ADR-017: commit stamps encode `(phase NN tK)` where NN is the zero-padded
// project-global phase number derived from the slug.  The phase-04 re-run cause
// was Discover returning every PLAN.md task with no done-awareness, so re-running
// /astro-execute re-executed completed tasks unnecessarily.  These two changes
// together enable the stamp-based done-detection loop:
//
//   (1) phaseNum: string extraction from the slug's leading digits MUST preserve
//       zero-padding (e.g. slug "07-idempotent-…" → "07", never 7).  parseInt
//       would strip the leading zero, breaking stamp matching.
//
//   (2) TASK_SCHEMA items gain `done: { type: 'boolean' }` (properties) and
//       `'done'` in required[], keeping `additionalProperties: false` so the
//       Discover agent is forced to commit to a boolean verdict per task — the
//       same anti-ambiguity pattern used in TESTGATE_SCHEMA.

test('t4 (phase-07): phaseNum is extracted as a STRING from phaseSlug (no parseInt — preserves zero-padding)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // phaseNum must be declared after the phaseSlug destructure.
  assert.ok(
    /const\s+phaseNum\s*=/.test(wfSrc),
    'execute-phase.mjs must declare const phaseNum after the phaseSlug destructure',
  )

  // The extraction must use match() on phaseSlug — NOT parseInt or Number().
  // parseInt would strip leading zeros ("07" → 7), breaking stamp matching.
  const declIdx = wfSrc.indexOf('const phaseNum')
  assert.ok(declIdx !== -1, 'const phaseNum declaration not found')
  const window = wfSrc.slice(declIdx, declIdx + 200)

  assert.ok(
    /phaseSlug\.match/.test(window),
    'phaseNum must be extracted via phaseSlug.match() (not parseInt/Number — zero-padding must be preserved)',
  )
  assert.ok(
    !/parseInt|Number\(/.test(window),
    'phaseNum extraction must NOT use parseInt or Number() — those strip leading zeros like "07" → 7',
  )
})

test('t4 (phase-07): phaseNum extraction comment references ADR-017 and phase-04 re-run cause', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The comment around phaseNum must name ADR-017 (the stamp ADR) and the
  // phase-04 re-run cause (the incident that motivated done-detection).
  // High-density "why" comments are load-bearing here (CONVENTIONS.md).
  const declIdx = wfSrc.indexOf('const phaseNum')
  assert.ok(declIdx !== -1, 'const phaseNum declaration not found')

  // Search a window of ~600 chars before + after the declaration for the comment.
  const commentWindow = wfSrc.slice(Math.max(0, declIdx - 600), declIdx + 400)

  assert.ok(
    /ADR-017/.test(commentWindow),
    'the comment near phaseNum must reference ADR-017 (the stamp decision)',
  )
  assert.ok(
    /phase.04|phase-04/i.test(commentWindow),
    'the comment near phaseNum must reference the phase-04 re-run cause',
  )
})

test('t4 (phase-07): TASK_SCHEMA items include done:boolean in properties', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Extract the TASK_SCHEMA constant literal and evaluate it.
  const schemaMatch = wfSrc.match(/const TASK_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'TASK_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // Drill into items.properties to find the done field.
  const item = schema?.properties?.tasks?.items
  assert.ok(item, 'TASK_SCHEMA.properties.tasks.items must be defined')
  assert.ok(item.properties?.done, 'TASK_SCHEMA items must have a done property in properties')
  assert.strictEqual(
    item.properties.done.type,
    'boolean',
    'TASK_SCHEMA items.properties.done must be type:boolean',
  )
})

test('t4 (phase-07): TASK_SCHEMA items.required includes done', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const schemaMatch = wfSrc.match(/const TASK_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'TASK_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  const item = schema?.properties?.tasks?.items
  assert.ok(item, 'TASK_SCHEMA.properties.tasks.items must be defined')
  assert.ok(Array.isArray(item.required), 'TASK_SCHEMA items must have a required array')
  assert.ok(
    item.required.includes('done'),
    "TASK_SCHEMA items.required must include 'done'",
  )
})

test('t4 (phase-07): TASK_SCHEMA items still have additionalProperties:false after done field addition', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const schemaMatch = wfSrc.match(/const TASK_SCHEMA\s*=\s*(\{[\s\S]*?\n\})/)
  assert.ok(schemaMatch, 'TASK_SCHEMA constant not found in execute-phase.mjs')

  const schema = runInNewContext(`(${schemaMatch[1]})`)

  // Both the outer and inner schema must keep additionalProperties:false per canon.
  assert.strictEqual(
    schema.additionalProperties,
    false,
    'TASK_SCHEMA top-level must keep additionalProperties:false',
  )
  const item = schema?.properties?.tasks?.items
  assert.ok(item, 'TASK_SCHEMA.properties.tasks.items must be defined')
  assert.strictEqual(
    item.additionalProperties,
    false,
    'TASK_SCHEMA items must keep additionalProperties:false after the done field addition',
  )
})

// ── t8: static source-contract guards (phase-07 done-detection) ──────────────
//
// ADR-017: commit stamps `(phase NN tK)` enable idempotent re-execution.
// These guards enforce phase-07 contracts via pure string/regex over the workflow
// source — same technique as the existing hook-shadowing and MIRROR drift guards:
// readFileSync + includes/regex, no eval of Workflow-tool globals.
//
// (a) TASK_SCHEMA carries done in required and a boolean done property.
//     Already covered by the t4 (phase-07) tests immediately above using
//     runInNewContext — do NOT duplicate that guard here.
//
// (b) Discover prompt contains --fixed-strings AND a closing-paren stamp pattern.
//     The t1/t14 trap (CONTEXT.md note 1): `--grep "(phase 07 t1"` (no closing paren)
//     would match both t1 AND t14.  The prompt must spell out the closing paren
//     `(phase ` and instruct --fixed-strings (or regex-escape) so the match is
//     precise.  A bare `t1` substring in the grep would be a silent correctness bug
//     that re-executes already-stamped tasks or skips unstamped ones.
//
// (c) Both execPrompt and healPrompt carry the stamp instruction.
//     The executor must end each commit subject with `(phase NN tK)` so later
//     re-runs can detect it.  Missing the instruction in either prompt means
//     that class of commits is never stamped and done-detection silently breaks
//     for those tasks.
//
// (d) The return object includes skipped:.
//     CONTEXT.md § "result gains skipped:[taskIds]" — the outer /astro-execute
//     command reads this to narrate which tasks were found already stamped.
//     A missing field silently drops observability.
//
// (e) All-done short-circuit: Execute wave loop is conditioned on executable
//     tasks remaining (waves array is non-empty / tasks are not all done).
//     If every task is already stamped, the Execute phase must short-circuit
//     to Verify immediately (re-verify still runs — a phase may have executed
//     fully but failed the prior verification).

test('t8 (b): Discover prompt contains --fixed-strings and closing-paren stamp pattern', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Find the Discover agent call (agent() with schema: TASK_SCHEMA) in the source.
  // The disc = await agent(…) block is the Discover agent; its prompt must contain
  // the stamp-grep instruction with closing-paren precision to avoid the t1/t14 trap.
  const discoverIdx = wfSrc.indexOf("phase('Discover')")
  assert.ok(discoverIdx !== -1, "phase('Discover') call not found in execute-phase.mjs")
  // Take a generous window covering the full Discover agent() call (prompt + options).
  const discoverWindow = wfSrc.slice(discoverIdx, discoverIdx + 2000)

  // Must mention (phase  — the closing-paren stamp pattern that prevents t1/t14 ambiguity.
  // The exact string in the prompt must be "(phase " (with the space) so the agent
  // constructs a grep pattern like `--grep "(phase 07 t1)"` (closing paren required).
  assert.ok(
    discoverWindow.includes('(phase '),
    'Discover prompt must contain "(phase " — the closing-paren stamp pattern that prevents the t1/t14 ambiguity trap',
  )

  // Must instruct --fixed-strings (or equivalent) so the parens are literal chars,
  // not regex metacharacters.  Without it `--grep "(phase 07 t1)"` could have
  // surprising matches depending on grep's default mode.
  assert.ok(
    discoverWindow.includes('--fixed-strings') || discoverWindow.includes('fixed-strings'),
    'Discover prompt must instruct --fixed-strings for the stamp grep (prevents t1/t14 pattern ambiguity)',
  )
})

// ── t5 (phase-07): Discover prompt is a DEAD-SIMPLE mechanical grep per task ──
//
// ADR-017 + CONTEXT.md note 1: Discover may run on the haiku tier, so the
// done-detection instruction must be mechanical — one grep per task, no
// pattern-reasoning prose (which a weaker model may misinterpret).  The
// prompt must spell the EXACT grep command with the closing-paren pattern
// (to avoid the t1/t14 trap) and state the binary rule: output → done:true,
// no output → done:false.  phaseNum must be interpolated from the script
// variable, not invented by the agent.
//
// These guards extend t8 (b) by checking that:
//   (1) The full `git log --oneline --fixed-strings --grep` command form is
//       present — not just `--fixed-strings` in isolation — so the agent
//       receives an unambiguous, copy-pasteable instruction.
//   (2) The phaseNum variable is interpolated directly inside the grep
//       pattern (not explained externally) so the agent never needs to
//       derive or invent it.
//   (3) The prompt states the mechanical done/not-done rule using output
//       presence, keeping reasoning out of the instruction path.

test('t5 (phase-07): Discover prompt spells the exact `git log --oneline --fixed-strings --grep` command', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const discoverIdx = wfSrc.indexOf("phase('Discover')")
  assert.ok(discoverIdx !== -1, "phase('Discover') call not found in execute-phase.mjs")
  const discoverWindow = wfSrc.slice(discoverIdx, discoverIdx + 2000)

  // The full command form must be spelled out so a haiku-tier model gets an
  // unambiguous, copy-pasteable instruction rather than having to infer flags.
  assert.ok(
    discoverWindow.includes('git log --oneline --fixed-strings --grep'),
    'Discover prompt must spell the full `git log --oneline --fixed-strings --grep` command form (DEAD-SIMPLE, haiku-safe)',
  )
})

test('t5 (phase-07): Discover prompt interpolates phaseNum into the grep pattern (never invented by the agent)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const discoverIdx = wfSrc.indexOf("phase('Discover')")
  assert.ok(discoverIdx !== -1, "phase('Discover') call not found in execute-phase.mjs")
  const discoverWindow = wfSrc.slice(discoverIdx, discoverIdx + 2000)

  // phaseNum must be interpolated directly into the grep pattern string so the
  // script computes the phase number at prompt-build time and the Discover agent
  // never needs to derive or invent it (CONTEXT.md note 2: "NN must be derived
  // from the phase slug's leading number at prompt-build time, never invented").
  // We check that the template literal contains `${phaseNum}` inside the grep
  // pattern context — presence of both the literal and its neighbour "(phase "
  // confirms it is the grep arg, not some unrelated interpolation.
  assert.ok(
    discoverWindow.includes('${phaseNum}') && discoverWindow.includes('(phase '),
    'Discover prompt must interpolate ${phaseNum} inside the grep pattern "(phase ${phaseNum} ...)" — never agent-invented',
  )
})

test('t5 (phase-07): Discover prompt states binary done rule (output → done:true, else done:false) without extra reasoning', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const discoverIdx = wfSrc.indexOf("phase('Discover')")
  assert.ok(discoverIdx !== -1, "phase('Discover') call not found in execute-phase.mjs")
  const discoverWindow = wfSrc.slice(discoverIdx, discoverIdx + 2000)

  // The done rule must be mechanical: "if command returns any line → done:true,
  // else done:false".  This phrasing is safe for a haiku-tier model.
  // We verify both branches are named in the prompt window.
  assert.ok(
    /done\s*:\s*true|done:true/.test(discoverWindow),
    'Discover prompt must state the done:true branch of the binary rule',
  )
  assert.ok(
    /done\s*:\s*false|done:false/.test(discoverWindow),
    'Discover prompt must state the done:false branch of the binary rule',
  )
})

test('t8 (c): execPrompt contains the (phase NN tK) stamp instruction', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Locate the execPrompt definition (arrow function).
  const execIdx = wfSrc.indexOf('const execPrompt')
  assert.ok(execIdx !== -1, 'execPrompt not found in execute-phase.mjs')
  // Window covering the full template literal (≤ 1100 chars; expanded from 800
  // to accommodate the phase-08 t3 dynamic-import escape hatch sentence added
  // after the "touch ONLY" hygiene line).
  const execWindow = wfSrc.slice(execIdx, execIdx + 1100)

  // The prompt must instruct the executor to stamp the commit subject with
  // `(phase NN tK)` where NN/tK are interpolated per task.  Without this
  // instruction the executor produces unstamped commits and done-detection
  // silently breaks for tasks run via the normal (non-heal) path.
  assert.ok(
    /\(phase.*tK\)|\(phase.*t\$\{.*\}/.test(execWindow) || execWindow.includes('(phase '),
    'execPrompt must include the (phase NN tK) stamp instruction so executors stamp their commits',
  )

  // More precisely: the stamp pattern must include phaseNum and t.id interpolation,
  // not a hardcoded literal — otherwise all tasks in all phases get the same stamp.
  assert.ok(
    execWindow.includes('phaseNum') || execWindow.includes('phaseSlug'),
    'execPrompt stamp instruction must reference phaseNum (or phaseSlug) so the stamp is phase-specific',
  )
})

test('t8 (c): healPrompt contains the (phase NN tK) stamp instruction', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Locate the healPrompt definition.
  const healIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(healIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const healWindow = wfSrc.slice(healIdx, healIdx + 1500)

  // Heal re-runs are re-implementations — the fresh commit must ALSO be stamped
  // so a second /astro-execute re-run doesn't re-execute a healed task.
  // Same precision requirement: phaseNum/t.id interpolated, not hardcoded.
  assert.ok(
    /\(phase.*tK\)|\(phase.*t\$\{.*\}/.test(healWindow) || healWindow.includes('(phase '),
    'healPrompt must include the (phase NN tK) stamp instruction so healed commits are also stamped',
  )
  assert.ok(
    healWindow.includes('phaseNum') || healWindow.includes('phaseSlug'),
    'healPrompt stamp instruction must reference phaseNum (or phaseSlug) so the stamp is phase-specific',
  )
})

test('t8 (d): return statement includes skipped: field', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The final return object must carry a skipped field (CONTEXT.md: "result gains
  // skipped:[taskIds]").  Without it the outer /astro-execute command cannot narrate
  // which tasks were found already stamped on the branch (silent observability drop).
  // We accept skipped: anywhere in the return statement or as a named variable.
  assert.ok(
    /return\s*\{[^}]*skipped\s*:/.test(wfSrc) || /skipped\s*:\s*skipped/.test(wfSrc),
    'execute-phase.mjs return statement must include a `skipped:` field (CONTEXT.md "result gains skipped:[taskIds]")',
  )
})

test('t8 (e): all-done short-circuit — Execute phase is skipped when no executable waves remain', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // When every task is already stamped (done), buildWaves returns an empty waves
  // array.  The Execute phase must short-circuit to Verify immediately rather than
  // entering the wave loop and logging "strategy: … (0 tasks, widest wave 0, budget 8)".
  // CONTEXT.md: "if every task is done, skip Execute entirely and go straight to Verify".
  //
  // We look for a condition that guards the Execute wave loop against an empty waves
  // array — any of these patterns is acceptable:
  //   `if (waves.length)` / `if (waves.length === 0)` / `if (!waves.length)`
  //   `if (tasks.every(t => t.done))` / `const executableTasks = tasks.filter(!done)`
  // The key invariant: the wave loop body must NOT fire when waves is empty.
  // We check for the presence of a waves.length guard or a done-filtered task list.
  assert.ok(
    /waves\.length\s*(?:===?\s*0|>\s*0)|!waves\.length|if\s*\(\s*waves\.length\s*\)/.test(wfSrc) ||
    /tasks\.every.*done|skippedTasks|executableTasks|doneTasks/.test(wfSrc),
    'execute-phase.mjs must short-circuit the Execute phase when all tasks are done (waves empty) — guard the wave loop',
  )
})

// ── t6: call-site wiring — executableTasks, per-task skip narration, buildWaves(executableTasks) ──
//
// Phase-07 / ADR-017: at the buildWaves call site the script must:
//   (a) Compute `const executableTasks = tasks.filter((t) => !t.done)` so the
//       wave builder only sees tasks that still need running.  Passing the full
//       `tasks` array when some are already done is harmless (buildWaves filters
//       via preCompleted anyway) but the intent must be explicit in the source.
//   (b) Call `buildWaves(executableTasks, preCompleted)` — NOT `buildWaves(tasks, …)` —
//       so the call site mirrors the variable name in the task spec.
//   (c) Narrate each skip INDIVIDUALLY via a log line containing
//       "already on branch (stamp found) — skipping" and the specific task id.
//       A summary-only log ("N task(s) already stamped") is insufficient; the
//       per-task log emits at discovery time so the user sees exactly which task
//       was skipped, matching CONTEXT.md § "Narrate each skip".
//   (d) The Execute wave loop must be conditioned so it is skipped when
//       `executableTasks.length === 0` (all tasks done) but Verify still runs —
//       no early-return before phase('Verify').  The existing `!waves.length`
//       guard is acceptable, but the source must also reference `executableTasks`
//       (so the reader can confirm the no-op wave loop is deliberate).

test('t6 (phase-07): executableTasks is computed as tasks filtered to undone tasks', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // Must declare const executableTasks (or let — but const matches the spec).
  assert.ok(
    /(?:const|let)\s+executableTasks\s*=/.test(wfSrc),
    'execute-phase.mjs must declare executableTasks (filtered to tasks where !t.done)',
  )

  // The right-hand side must filter tasks by !t.done — not some other predicate.
  // Search for the const/let declaration specifically (not a comment mention).
  const declIdx = wfSrc.search(/(?:const|let)\s+executableTasks\s*=/)
  assert.ok(declIdx !== -1, 'executableTasks declaration not found')
  const declWindow = wfSrc.slice(declIdx, declIdx + 120)
  assert.ok(
    /filter\s*\(.*!.*done/.test(declWindow),
    'executableTasks must be computed via tasks.filter((t) => !t.done)',
  )
})

test('t6 (phase-07): buildWaves is called with executableTasks, not with the full tasks array', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The call site must pass executableTasks as the first arg to buildWaves.
  // Passing the full tasks array (which includes done tasks) would make the
  // executableTasks variable irrelevant — the explicit name is load-bearing
  // documentation of intent (only executable tasks enter the wave builder).
  assert.ok(
    /buildWaves\s*\(\s*executableTasks\s*,/.test(wfSrc),
    'buildWaves must be called with executableTasks as the first argument (not the full tasks array)',
  )
})

test('t6 (phase-07): per-task skip narration logs "already on branch (stamp found) — skipping" for each done task', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  // The narration must happen PER TASK (a loop or map over skippedTaskIds), not
  // just as a single summary line.  CONTEXT.md: "Narrate each skip via log('• task
  // ' + id + ' already on branch (stamp found) — skipping')" — the individual
  // task id must appear in the log so the user sees precisely which task was skipped.
  //
  // We verify:
  //  1. The phrase "already on branch (stamp found) — skipping" (or close variant)
  //     exists in the source (the spec's exact text).
  //  2. The log line references a loop variable or task id interpolation (not just a
  //     static count), confirming it fires per task rather than once as a summary.
  assert.ok(
    /already on branch.*stamp found.*skipping|stamp found.*already on branch.*skipping/.test(wfSrc),
    'execute-phase.mjs must contain a log line with "already on branch (stamp found) — skipping" for per-task skip narration',
  )

  // The per-task log must reference the task id (interpolated from a variable),
  // not just the skippedTaskIds array as a whole.  This distinguishes a per-task
  // loop log from a summary log.
  const skipNarrIdx = wfSrc.search(/already on branch.*stamp found.*skipping|stamp found.*already on branch.*skipping/)
  assert.ok(skipNarrIdx !== -1, 'per-task skip narration line not found')
  // The surrounding context (50 chars before, 150 after) must include a task-id
  // variable reference — e.g. `id`, `t.id`, or `${id}` interpolation.
  const narrWindow = wfSrc.slice(Math.max(0, skipNarrIdx - 50), skipNarrIdx + 150)
  assert.ok(
    /\$\{id\}|\$\{t\.id\}|t\.id|` \+ id/.test(narrWindow),
    'per-task skip log must interpolate the individual task id (${id}, ${t.id}, or t.id), not just a count or array',
  )
})

// ── t1 (phase-08): astro-planner.md carries the full test-first + dynamic-import rule ──
//
// ADR-018: RED-test tasks must never statically import a symbol that does not yet
// exist on the branch — a static import of a missing export crashes the whole test
// file at module load, pushing executors to implement the missing export and overflow
// their declared file (the phase-04 t5 trap).  The canonical pattern is
// `await import('../lib/x.mjs')` inside async test bodies so a missing export fails
// only the new tests at call time, preserving test-first cadence and one-file
// ownership.  Test-after serialization (`depends_on` the impl task) stays allowed
// when explicitly chosen — the plan must say which it chose.
//
// This guard is a static source check over agents/astro-planner.md — the same
// readFileSync + regex/includes style used throughout this file.

const PLANNER_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'astro-planner.md')

test('t1 (phase-08): astro-planner.md Principles bullet mandates dynamic-import for RED-test tasks (ADR-018)', () => {
  const src = readFileSync(PLANNER_FILE, 'utf8')

  // The bullet must instruct dynamic import as the canonical RED-test pattern.
  // `await import(` is the literal token that distinguishes the dynamic pattern
  // from a static top-level import statement.
  assert.ok(
    /await import\(/.test(src),
    'astro-planner.md Principles must instruct `await import(` as the dynamic-import pattern for RED-test tasks (ADR-018)',
  )
})

test('t1 (phase-08): astro-planner.md Principles bullet references ADR-018', () => {
  const src = readFileSync(PLANNER_FILE, 'utf8')

  // The rule must cite ADR-018 so readers know where the decision lives.
  assert.ok(
    /ADR-018/.test(src),
    'astro-planner.md Principles must reference ADR-018 (the dynamic-import ADR)',
  )
})

test('t1 (phase-08): astro-planner.md Principles bullet names the phase-04 t5 trap', () => {
  const src = readFileSync(PLANNER_FILE, 'utf8')

  // The WHY must name the phase-04 t5 trap so the planner understands the failure
  // mode it prevents.  High-density "why" comments are load-bearing here
  // (CONVENTIONS.md).  The phrase must be close enough to "phase-04 t5" to be
  // recognisable in the bullet context.
  assert.ok(
    /phase.04.*t5|phase-04.*t5/i.test(src),
    'astro-planner.md Principles must name the phase-04 t5 trap as the WHY for the dynamic-import rule',
  )
})

test('t1 (phase-08): astro-planner.md Principles bullet allows test-after serialization when explicitly chosen', () => {
  const src = readFileSync(PLANNER_FILE, 'utf8')

  // Test-after serialization (depends_on the impl task) stays allowed but must
  // be explicitly chosen — the plan must say which.  The bullet must name this
  // escape hatch so planners know it is available.
  assert.ok(
    /depends_on|depends on/i.test(src) && /explicit|plan must say|chosen/i.test(src),
    'astro-planner.md Principles must allow test-after serialization when explicitly chosen (depends_on the impl task)',
  )
})

// ── t2 (phase-08): plan-phase.mjs Synthesize prompt carries ADR-018 + self-check ──
//
// ADR-018: RED-test tasks must never statically import a missing symbol — the
// phase-04 t5 trap.  The Synthesize prompt in plan-phase.mjs (the main planning
// workflow) must repeat this rule so the planner agent has it in direct context
// when writing PLAN.md, not just in agents/astro-planner.md (which the agent reads
// from disk but may skim under token pressure).
//
// The self-verification instruction closes the Synthesize prompt: before writing
// PLAN.md the planner must check EVERY task against three rules — the red-test
// import rule, the same-file serialization invariant (two same-file tasks never
// both have empty depends_on), and the file-declaration requirement — and fix any
// violation before producing output.  This is defense-in-depth at the point where
// plans are actually written (phase-04 t5 prevention at the source).
//
// Static source checks against workflows/plan-phase.mjs — same readFileSync +
// regex/includes style used throughout this file.

const PLAN_PHASE_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows', 'plan-phase.mjs')

test('t2 (phase-08): plan-phase.mjs Synthesize prompt contains the ADR-018 dynamic-import rule', () => {
  const src = readFileSync(PLAN_PHASE_FILE, 'utf8')

  // The Synthesize agent() call must carry the ADR-018 rule text so the planner
  // has it in its direct context when generating PLAN.md tasks.  The rule must
  // name dynamic-import as the canonical RED-test pattern (await import() inside
  // async test bodies) and forbid static imports of missing symbols — the
  // phase-04 t5 trap that this phase was designed to prevent.
  //
  // We locate the Synthesize agent call and check a generous window for key tokens.
  const synthIdx = src.indexOf("phase('Synthesize')")
  assert.ok(synthIdx !== -1, "phase('Synthesize') call not found in plan-phase.mjs")
  const synthWindow = src.slice(synthIdx, synthIdx + 3000)

  // Must name dynamic import (await import) as the safe RED-test pattern.
  assert.ok(
    /await import/.test(synthWindow),
    'plan-phase.mjs Synthesize prompt must instruct `await import` as the dynamic-import pattern for RED-test tasks (ADR-018)',
  )

  // Must forbid static imports of missing symbols (the phase-04 t5 trap mechanism).
  assert.ok(
    /static import|never.*static|no.*static import/i.test(synthWindow),
    'plan-phase.mjs Synthesize prompt must forbid static imports of missing symbols (the phase-04 t5 trap)',
  )
})

test('t2 (phase-08): plan-phase.mjs Synthesize prompt references ADR-018', () => {
  const src = readFileSync(PLAN_PHASE_FILE, 'utf8')

  const synthIdx = src.indexOf("phase('Synthesize')")
  assert.ok(synthIdx !== -1, "phase('Synthesize') call not found in plan-phase.mjs")
  const synthWindow = src.slice(synthIdx, synthIdx + 3000)

  // The rule must cite ADR-018 so the planner agent can cross-reference the decision.
  assert.ok(
    /ADR-018/.test(synthWindow),
    'plan-phase.mjs Synthesize prompt must reference ADR-018 (the dynamic-import decision)',
  )
})

test('t2 (phase-08): plan-phase.mjs Synthesize prompt closes with self-verification instruction covering all three rules', () => {
  const src = readFileSync(PLAN_PHASE_FILE, 'utf8')

  const synthIdx = src.indexOf("phase('Synthesize')")
  assert.ok(synthIdx !== -1, "phase('Synthesize') call not found in plan-phase.mjs")
  // 3600 (was 3000): the self-check now also names the wave-green rule (ADR-020),
  // which legitimately grew the prompt past the original window.
  const synthWindow = src.slice(synthIdx, synthIdx + 3600)

  // The closing self-verification instruction must tell the planner to check every
  // task before writing PLAN.md.  The four required rule names are:
  //   (1) red-test import rule (the dynamic-import / ADR-018 rule)
  //   (2) same-file serialization: two tasks touching the same file must not both
  //       have empty depends_on (they must be serialized)
  //   (3) every task must declare its file(s)
  // All three must appear in the self-check instruction.

  // Self-check verb: "Before writing PLAN.md" (or equivalent).
  assert.ok(
    /Before writing PLAN\.md|before writing PLAN\.md/i.test(synthWindow),
    'plan-phase.mjs Synthesize prompt must open the self-check with "Before writing PLAN.md"',
  )

  // Rule 1: red-test import rule named in the check.
  assert.ok(
    /red.test import rule|red-test import rule/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must name the "red-test import rule" (rule 1)',
  )

  // Rule 2: same-file tasks / depends_on serialization.
  assert.ok(
    /same.file.*depends_on|same-file.*depends_on|two same.file|two same-file/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must name the same-file serialization rule (rule 2: two same-file tasks never both have empty depends_on)',
  )

  // Rule 3: every task declares its file(s).
  assert.ok(
    /every task declares|declares its file/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must name the file-declaration requirement (rule 3: every task declares its file(s))',
  )

  // Rule 4 (ADR-020): wave-green — a deletion carries its consumer fixups; no task
  // leaves the build broken at a wave boundary.
  assert.ok(
    /wave-green rule|wave-green|build green|deletions carry/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must name the wave-green rule (rule 4, ADR-020: no task leaves the build broken; deletions carry their consumer fixups)',
  )

  // The check must cover EVERY task (not just some).
  assert.ok(
    /EVERY task|every task/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must apply to EVERY task (not a subset)',
  )

  // The check must instruct fixing any violation (not just reporting it).
  assert.ok(
    /fix.*violation|fix any violation/i.test(synthWindow),
    'plan-phase.mjs Synthesize self-check must instruct fixing any violation found',
  )
})

// ── t3 (phase-08): execPrompt carries the dynamic-import escape hatch (ADR-018) ──
//
// ADR-018: a RED-test task whose static import would crash at module load
// (because the export doesn't exist yet) must use the dynamic-import pattern
// (`await import(...)` inside async tests) rather than implement the missing
// export.  Implementing the export is the impl task's job; doing it here is
// the phase-04 t5 overflow trap (touch ONLY declared files tells the WHAT;
// this sentence supplies the HOW for the RED-test case).
//
// healPrompt is unchanged — heals run sequentially after the impl usually
// exists, so the co-scheduling hazard that makes module-load crashes dangerous
// is already gone by heal time.
//
// Static source guard — same readFileSync + regex/includes style.

test('t3 (phase-08): execPrompt contains the dynamic-import escape hatch for RED-test tasks (ADR-018)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('const execPrompt')
  assert.ok(startIdx !== -1, 'execPrompt not found in execute-phase.mjs')
  // Window large enough to capture the full template literal concat chain.
  const window = wfSrc.slice(startIdx, startIdx + 1200)

  // Must instruct the dynamic-import pattern for RED-test tasks.
  // The sentinel token `await import` distinguishes dynamic from static import.
  assert.ok(
    /await import/.test(window),
    'execPrompt must instruct `await import(...)` as the dynamic-import escape hatch for RED-test tasks (ADR-018)',
  )

  // Must name the impl task as the owner of the missing export — so the executor
  // knows NOT to implement the export itself (that is the phase-04 t5 overflow trap).
  assert.ok(
    /impl task|implementation task|impl.*task/i.test(window),
    'execPrompt must name "impl task" as the owner of the missing export (do NOT implement it — that is the impl task\'s job)',
  )
})

test('t3 (phase-08): healPrompt does NOT gain the dynamic-import escape hatch (heals run after impl exists)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(startIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  // healPrompt must remain unchanged — the missing-export problem is gone by
  // heal time (the impl task has usually already run), and adding the hatch
  // would create confusion with the "implement FRESH" instruction (ADR-014).
  // We verify the hatch's exact impl-task reference is absent from healPrompt.
  assert.ok(
    !/if this is a RED-test task/i.test(window),
    'healPrompt must NOT contain the dynamic-import escape hatch sentence — heals run after the impl usually exists (ADR-018 scope)',
  )
})

test('t2 (phase-08): plan-phase.mjs Synthesize agent() call has a high-density comment naming phase-04 t5 and ADR-018', () => {
  const src = readFileSync(PLAN_PHASE_FILE, 'utf8')

  const synthIdx = src.indexOf("phase('Synthesize')")
  assert.ok(synthIdx !== -1, "phase('Synthesize') call not found in plan-phase.mjs")

  // The comment near the Synthesize agent call must name both the WHY (phase-04 t5
  // trap — the incident that motivated this safeguard) and the WHAT (ADR-018).
  // High-density "why" comments are load-bearing in this codebase (CONVENTIONS.md).
  // We search a broad window that includes the comment block above the agent call.
  const commentWindow = src.slice(Math.max(0, synthIdx - 600), synthIdx + 3000)

  assert.ok(
    /phase.04.*t5|phase-04.*t5/i.test(commentWindow),
    'plan-phase.mjs must have a comment near the Synthesize call naming the phase-04 t5 trap (WHY for the ADR-018 rule)',
  )

  assert.ok(
    /ADR-018/.test(commentWindow),
    'plan-phase.mjs must have a comment near the Synthesize call referencing ADR-018',
  )
})

// ── t5 (phase-08): integration guards — all four ADR-018 wiring points in one sweep ──
//
// t5 is the contract-guard task for phase-08: it depends on t1–t4 and asserts that
// ALL four wiring points landed correctly.  The individual t1/t2/t3 tests above were
// added alongside each implementation task; the guards below are t5's own sweep that
// checks the same invariants under t5 labels so the commit stamp `(phase 08 t5)`
// identifies a distinct, verified state of the full phase-08 surface.
//
// (a) plan-phase.mjs Synthesize prompt: dynamic-import rule + self-verification pass.
// (b) execute-phase.mjs execPrompt: escape hatch sentence present.
// (c) agents/astro-planner.md: ADR-018 rule (dynamic-import canon, phase-04 t5 WHY).
// (d) execute-phase.mjs healPrompt: escape hatch sentence ABSENT (negative guard).
//
// All four are pure static source checks — readFileSync + regex/includes, no eval.

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents')

test('t5 (phase-08): plan-phase.mjs Synthesize prompt contains dynamic-import rule and self-verification instruction', () => {
  const src = readFileSync(PLAN_PHASE_FILE, 'utf8')

  const synthIdx = src.indexOf("phase('Synthesize')")
  assert.ok(synthIdx !== -1, "phase('Synthesize') call not found in plan-phase.mjs")
  // 3600 (was 3000): wave-green rule (ADR-020) grew the prompt past the original window.
  const synthWindow = src.slice(synthIdx, synthIdx + 3600)

  // (a-1) Must name the dynamic-import pattern — `await import` is the canonical token.
  assert.ok(
    /await import/.test(synthWindow),
    't5: plan-phase.mjs Synthesize prompt must mention `await import` as the dynamic-import pattern (ADR-018)',
  )

  // (a-2) Must include a self-verification instruction covering every task.
  assert.ok(
    /check EVERY task|fix any violation/i.test(synthWindow),
    't5: plan-phase.mjs Synthesize prompt must contain a self-verification instruction ("check EVERY task" or "fix any violation")',
  )
})

test('t5 (phase-08): execute-phase.mjs execPrompt contains the dynamic-import escape hatch and "do NOT implement" guard', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('const execPrompt')
  assert.ok(startIdx !== -1, 'execPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1200)

  // (b-1) Must name the dynamic-import pattern.
  assert.ok(
    /await import|dynamic.?import/i.test(window),
    't5: execPrompt must instruct `await import(...)` as the escape hatch for RED-test tasks (ADR-018)',
  )

  // (b-2) Must tell the executor NOT to implement the missing export.
  assert.ok(
    /do NOT implement the missing export/i.test(window),
    't5: execPrompt must contain "do NOT implement the missing export" (impl task boundary guard, ADR-018)',
  )
})

test('t5 (phase-08): agents/astro-planner.md contains the ADR-018 dynamic-import rule', () => {
  const src = readFileSync(join(AGENTS_DIR, 'astro-planner.md'), 'utf8')

  // (c-1) Must cite ADR-018 — the decision that mandates dynamic-import in RED-test tasks.
  assert.ok(
    /ADR-018/.test(src),
    't5: agents/astro-planner.md must reference ADR-018 (the dynamic-import decision)',
  )

  // (c-2) Must instruct `await import(` — the canonical token that distinguishes
  // dynamic from static import and is the house pattern (tests/flow.test.mjs style).
  assert.ok(
    /await import\(/.test(src),
    't5: agents/astro-planner.md must instruct `await import(` as the canonical RED-test pattern (ADR-018)',
  )
})

test('t5 (phase-08): execute-phase.mjs healPrompt does NOT contain the escape-hatch sentence (negative guard)', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8')

  const startIdx = wfSrc.indexOf('const healPrompt')
  assert.ok(startIdx !== -1, 'healPrompt not found in execute-phase.mjs')
  const window = wfSrc.slice(startIdx, startIdx + 1500)

  // (d) healPrompt must remain unchanged — the missing-export problem is gone by heal
  // time (the impl task has usually already run).  The escape hatch is execPrompt-only.
  // We check for the absence of the sentinel phrase that marks the escape hatch text.
  assert.ok(
    !/if this is a RED-test task/i.test(window),
    't5: healPrompt must NOT contain the escape-hatch sentence — heals run after the impl usually exists (ADR-018 scope, negative guard)',
  )
})

// ── worktree-robustness guards: honor use_worktrees + adaptive downgrade ──────
//
// Some environments are worktree-hostile: the harness fires one `git worktree add`
// per parallel agent and the concurrent adds lose a lock race under a wide wave, so
// a majority fail with "Cannot create agent worktree: not in a git repository". Two
// safeguards, both pinned here so neither silently regresses:
//   (1) config.use_worktrees (args.useWorktrees) makes the AUTO strategy picker pick
//       sequential when false — an explicit opt-out for known-hostile machines.
//   (2) Adaptive downgrade: a majority worktree-failure in a parallel wave latches
//       `worktreesUnavailable`, routing every remaining wave on-branch.
test('static guard (worktrees): use_worktrees flag gates the auto strategy picker', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8');

  // The script must read the flag from args (default true) ...
  assert.ok(
    /const\s+useWorktrees\s*=\s*input\.useWorktrees\s*!==\s*false/.test(wfSrc),
    'execute-phase.mjs must read `useWorktrees` from args (default true)',
  );
  // ... and the auto strategy branch must consult it (so false ⇒ sequential).
  const idx = wfSrc.indexOf('const strategy =');
  assert.ok(idx !== -1, 'strategy selection not found');
  const window = wfSrc.slice(idx, idx + 320);
  assert.ok(
    /!useWorktrees/.test(window),
    'the auto strategy picker must force sequential when !useWorktrees',
  );
});

test('static guard (worktrees): a majority-failed parallel wave latches the on-branch downgrade', () => {
  const wfSrc = readFileSync(WF_FILE, 'utf8');

  // The latch must exist, the wave-loop guard must consult it, and the downgrade
  // must trip on a MAJORITY (not any) worktree failure.
  assert.ok(
    /let\s+worktreesUnavailable\s*=\s*false/.test(wfSrc),
    'execute-phase.mjs must declare the `worktreesUnavailable` latch',
  );
  assert.ok(
    /wave\.length === 1 \|\| worktreesUnavailable/.test(wfSrc),
    'the wave-loop on-branch guard must consult `worktreesUnavailable`',
  );
  assert.ok(
    /missing\.length \* 2 >= wave\.length/.test(wfSrc),
    'the downgrade must trip on a MAJORITY worktree failure (missing*2 >= wave.length), not a lone flake',
  );
});
