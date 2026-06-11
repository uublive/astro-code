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

  // The call site must be `integrateWave(wave)` — passing the task array —
  // not `integrateWave(w)` passing just the loop index.
  const callMatch = wfSrc.match(/await integrateWave\(([^)]+)\)/)
  assert.ok(callMatch, 'integrateWave call site not found')
  const callArg = callMatch[1].trim()

  assert.ok(
    callArg === 'wave',
    `integrateWave call site must pass the wave tasks array (wave), not "${callArg}"`,
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
