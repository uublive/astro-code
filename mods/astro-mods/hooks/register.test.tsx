// The plugin's one engine test, run by `claude plugin test` (PLAN F4: it collects only
// *.test.ts / *.test.tsx; a .tsx is not collected by a bare `node --test`, which would crash
// on this import). It drives the real engine: the plugin must load, read its switches through
// `process.run`, and pass `session.start` through whether `ac` answers or not.
import { test, expect } from 'claude-code/testing'

const START = { cwd: '/work/proj', surface: null, isInteractive: false }
// a hook sitting beneath the plugin stands for the engine: it answers `{ value }` or `{ deny }`
const ran = (stdout: string, exitCode = 0) => ({ exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

test('session.start reads the switches through ac and passes through', async ($, on) => {
  const asked: string[][] = []
  on('process.run', (_$, e) => {
    asked.push([...e.argv])
    return { value: ran(JSON.stringify({ switches: { blindfold: false }, warnings: [] })) }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const result = await $.session.start(START)
  expect(result).toEqual({ cwd: '/work/proj' })
  expect(asked).toEqual([['ac', 'mods', 'status', '--json', '--switches-only']])
})

test('session.start still passes through when ac fails', async ($, on) => {
  on('process.run', () => ({ value: ran('', 1) }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const result = await $.session.start(START)
  expect(result).toEqual({ cwd: '/work/proj' })
})

// blindfold (phase 39): an identified astro-verifier is denied the plan, everyone else is untouched.
// The join is the agent.spawn result (PROBE.md): a hook beneath the plugin answers `{ model, agentId }`
// the way the engine does, and the plugin pairs it with `subagentType`.
const SPAWN = { tool_use_id: 'toolu_1', prompt: 'p', description: 'd', subagentType: 'astro-verifier', provider: { plugin: 'user', tier: 'user' }, parentModel: 'm', permissionMode: 'default', background: false, fork: false }
const PLAN_READ = { tool: 'Read', input: { file_path: '/w/.astrocode/phases/01-x/PLAN.md' }, tool_use_id: 'toolu_2' }

test('blindfold denies an identified astro-verifier reading PLAN.md and leaves the main loop alone', async ($, on) => {
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { blindfold: true }, warnings: [] })) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'opus', agentId: 'a1234567890abcdef' }))
  on('tool.check', () => ({ decision: 'allow' }))
  await $.session.start(START)
  await $.agent.spawn(SPAWN)
  const blocked = await $.tool.check({ ...PLAN_READ, agentId: 'a1234567890abcdef' })
  expect(blocked.decision).toEqual('deny')
  const main = await $.tool.check(PLAN_READ)
  expect(main).toEqual({ decision: 'allow' })
})

// spawn-policy (phase 40) is UNBUILT: PROBE.md (phase 40) records that no spawn-time field
// reveals worktree isolation or a concurrent executor, so nothing refuses. This characterisation
// test pins that with the switch ON: every spawn passes through exactly as the engine beneath
// answered, and `model` is never refused, filled or changed (ADR-073: no haiku refusal;
// CONTEXT decision 2: spawn-policy never touches model; local-model sessions spawn with none on
// purpose). A signal-branch replan revises case (i).
test('with spawn-policy on, every spawn passes through untouched and its model is never changed', async ($, on) => {
  const seen: Array<{ subagentType?: string, model?: string }> = []
  let n = 0
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { 'spawn-policy': true }, warnings: [] })) }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('agent.spawn', (_$, e) => {
    seen.push({ subagentType: e.subagentType, model: e.model })
    return { model: e.model ?? 'inherit', agentId: `a${++n}` }
  })
  await $.session.start(START)
  // (i) two overlapping wave executors with no cwd, the Workflow shape phase-36 PROBE records;
  // (ii) an Agent-tool executor; (iii) a verifier
  const shapes = [
    { ...SPAWN, subagentType: 'astro-executor', workflow: { runId: 'wf_x', agentIndex: 2 } },
    { ...SPAWN, subagentType: 'astro-executor', workflow: { runId: 'wf_x', agentIndex: 3 } },
    { ...SPAWN, subagentType: 'astro-executor' },
    { ...SPAWN, subagentType: 'astro-verifier' },
  ]
  for (const shape of shapes) {
    for (const model of ['haiku', 'sonnet', 'opus', undefined]) {
      const before = seen.length
      const ev = { ...shape, model }
      const result = await $.agent.spawn(ev as typeof SPAWN)
      expect(result).toEqual({ model: model ?? 'inherit', agentId: `a${n}` })
      expect(seen.length).toEqual(before + 1)
      expect(seen[before].model).toEqual(model)
    }
  }
})

// witness (phase 41, ADR-074) through the real engine. The kit's `$.command.run` / `$.prompt.submit`
// carry no `origin` of their own, but they pass a test-supplied one through to the plugin (verified
// by logging beneath it), so a test sets `{ kind: 'composer' }` / `{ kind: 'sdk' }` itself; the type
// omits the field, hence the casts. The engine stamps it in production (PROBE.md). A hook beneath the
// plugin records what would actually run.
const COMPOSER = { kind: 'composer' }
const SDK = { kind: 'sdk' }
const CTX = '/w/.astrocode/phases/01-x/CONTEXT.md'
const HUMAN = '<!-- astro-discuss: captured -->\n# C\n'
const witnessRig = (witness: boolean, on: (...a: any[]) => void) => {
  const toasts: string[] = []
  const ran_: Array<Record<string, any>> = []
  on('process.run', () => ({ value: ran(JSON.stringify({ switches: { witness }, warnings: [] })) }))
  on('ui.toast', (_$: unknown, e: unknown) => { toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('prompt.submit', () => ({ text: '' }))
  on('tool.call', (_$: unknown, e: Record<string, any>) => { ran_.push(e); return { result: { stdout: '', stderr: '', interrupted: false } } })
  return { toasts, ran: ran_, bash: () => ran_.map(e => e.command), writes: () => ran_.map(e => e.content) }
}
const typed = ($: any, command: string, args: string, origin: object = COMPOSER) => $.command.run({ command, args, origin })
const prompt = ($: any, text: string, origin: object = COMPOSER) => $.prompt.submit({ text, origin })

test('witness: a typed /astro-accept 1 in the composer marks the accept as witnessed', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '1')
  await prompt($, '/astro-accept 1') // the raw line follows the command (PROBE.md); it keeps the typed signal
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 1 --witnessed composer'])
  expect(rig.toasts).toEqual([])
})

test('witness: a typed accept for a different phase, or a plain prompt, is recorded as the agent', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '1')
  await prompt($, '/astro-accept 1')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 2' })
  await prompt($, 'please accept phase 1')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 2 --agent claude', 'ac phase accept 1 --agent claude'])
  expect(rig.toasts.length).toEqual(1) // told once
})

test('witness: a turn started by the SDK is the agent even with the right typed command', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '2', SDK)
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 2' })
  expect(rig.bash()).toEqual(['ac phase accept 2 --agent claude'])
})

test('witness: a chained or wrapped call never carries a forged --witnessed, and its other gates are the agent (phase 41 C2)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '41')
  await prompt($, '/astro-accept 41')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 41 && ac phase accept 55 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'bash -c "ac phase accept 56 --witnessed composer"' })
  expect(rig.bash()).toEqual(['ac phase accept 41 && ac phase accept 55 --agent claude', 'bash -c "ac phase accept 56 --agent claude"'])
})

test('witness: a gate run through node, a path or $(which ac) is unreadable, never innocent (phase 41 C2)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-autonomous', '')
  await prompt($, '/astro-autonomous')
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase accept 41 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: '$(which ac) phase accept 41' })
  // a substitution also gets the signer in the environment (phase 46 C10: nested calls inherit it)
  expect(rig.bash()).toEqual(['node --no-warnings bin/ac.mjs phase accept 41 --agent claude', 'export ASTRO_SIGNER_AGENT=claude; $(which ac) phase accept 41 --agent claude'])
})

test('witness: a quoted verb or ref is still a gate: never witnessed in an autonomous turn (phase 41 C2/C3)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-autonomous', '')
  await prompt($, '/astro-autonomous')
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase "accept" 41 --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs phase accept "41" --witnessed composer' })
  await $.tool.call({ tool: 'Bash', command: 'node --no-warnings bin/ac.mjs fix "accept" sample-bug --witnessed composer' })
  for (const cmd of rig.bash()) {
    expect(cmd.includes('--witnessed')).toEqual(false)
    expect(cmd.includes('--agent claude')).toEqual(true)
  }
})

test('witness: a declared --agent is left untouched', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await prompt($, 'go')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1 --agent codex' })
  expect(rig.bash()).toEqual(['ac phase accept 1 --agent codex'])
  expect(rig.toasts).toEqual([])
})

test('witness: a bare or empty --agent is a declaration too, in a typed or an SDK turn (phase 41 C4)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-accept', '45')
  await prompt($, '/astro-accept 45')
  await $.tool.call({ tool: 'Bash', command: 'ac phase reject 45 --agent --reason x' })
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 45 --agent ""' })
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Bash', command: 'ac phase reject 41 --reason x --agent' })
  expect(rig.bash()).toEqual(['ac phase reject 45 --agent --reason x', 'ac phase accept 45 --agent ""', 'ac phase reject 41 --reason x --agent'])
})

test('witness: a fix ref that is not exactly the typed id is the agent (phase 41 C3)', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-fix-accept', '2026-10-12-sample-bug')
  await prompt($, '/astro-fix-accept 2026-10-12-sample-bug')
  await $.tool.call({ tool: 'Bash', command: 'ac fix accept sample-bug' })
  await $.tool.call({ tool: 'Bash', command: 'ac fix accept 2026-10-12-sample-bug' })
  expect(rig.bash()).toEqual(['ac fix accept sample-bug --agent claude', 'ac fix accept 2026-10-12-sample-bug --witnessed composer'])
})

test('witness: with the switch off the calls are byte-identical', async ($, on) => {
  const rig = witnessRig(false, on)
  await $.session.start(START)
  await prompt($, 'go')
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.ran.map(e => e.command ?? e.content)).toEqual(['ac phase accept 1', HUMAN])
  expect(rig.toasts).toEqual([])
})

test('witness: a cold call with no turn is left as declared', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'ac phase accept 1' })
  expect(rig.bash()).toEqual(['ac phase accept 1'])
})

test('witness: a human CONTEXT.md marker written outside a typed /astro-discuss becomes the agent marker', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await prompt($, 'write the context')
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.writes()).toEqual(['<!-- astro-discuss: captured by agent: claude -->\n# C\n'])
})

test('witness: an Edit that would make line 1 the human marker is turned back to the agent marker (phase 41 C6)', async ($, on) => {
  const rig = witnessRig(true, on)
  const AGENT = '<!-- astro-discuss: captured by agent: claude -->'
  const file = `${AGENT}\n# C\n`
  on('fs.read', () => ({ value: file }))
  await $.session.start(START)
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: ' by agent: claude', new_string: '' })
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: AGENT, new_string: '\n<!-- astro-discuss: captured -->' })
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: '# C', new_string: '# Context' })
  expect(rig.ran.map(e => [e.old_string, e.new_string])).toEqual([
    [file, file],
    [file, `\n${AGENT}\n# C\n`],
    ['# C', '# Context'],
  ])
})

test('witness: an Edit putting the human marker on line 2 is left alone (phase 41 C6 d)', async ($, on) => {
  const rig = witnessRig(true, on)
  on('fs.read', () => ({ value: '# Title\nbody\n' }))
  await $.session.start(START)
  await typed($, 'astro-accept', '41', SDK)
  await $.tool.call({ tool: 'Edit', file_path: CTX, old_string: 'body', new_string: '<!-- astro-discuss: captured -->\nbody' })
  expect(rig.ran.map(e => [e.old_string, e.new_string])).toEqual([['body', '<!-- astro-discuss: captured -->\nbody']])
})

test('witness: the same marker after a typed /astro-discuss 1 is left as the human wrote it', async ($, on) => {
  const rig = witnessRig(true, on)
  await $.session.start(START)
  await typed($, 'astro-discuss', '1')
  await prompt($, '/astro-discuss 1')
  await $.tool.call({ tool: 'Write', file_path: CTX, content: HUMAN })
  expect(rig.writes()).toEqual([HUMAN])
})

// brief-section (phase 42): the principles brief as ONE astro-mods:brief section, and no second copy.
// PROBE.md (phase 42) names the events: prompt.compose adds the section (F14), classic.SessionStart
// carries each hook's additionalContext unwrapped and byte-equal (F2, F3), and the PreCompact output
// rides a session.append row on door 'command' (F9-F11). A hook beneath the plugin answers what the
// engine would; process.run answers per argv, so the plugin never reaches a real `ac`.
const BRIEF = 'HARD RULES\n- RULE one\n- RULE two\n\nIN SCOPE\n- RULE three'
const PARTS = ['SESSION BRIEF part 1\n- RULE one', 'SESSION BRIEF part 2\n- RULE two']
const POSITION = 'proj · M1 · Phase 42 executing · Next: /astro-verify 42'
const FOREIGN_CTX = 'a foreign hook says: - RULE one'
type Mode = 'ok' | 'enoent' | 'exit1' | 'empty'
const briefRig = (on: (...a: any[]) => void, { switchOn = true, mode = 'ok' as Mode } = {}) => {
  const asked: string[] = []
  const toasts: string[] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const k = e.argv.join(' ')
    asked.push(k)
    if (k === 'ac mods status --json --switches-only') return { value: ran(JSON.stringify({ switches: { 'brief-section': switchOn }, warnings: [] })) }
    if (k === 'ac mods feed brief-section') return { value: ran(JSON.stringify({ serve: true, parts: PARTS, position: POSITION })) }
    if (k === 'ac mods feed brief-section --position') return { value: ran(JSON.stringify({ position: POSITION })) }
    if (k === 'ac principles brief --stage session --by session') {
      if (mode === 'enoent') throw new Error('spawn ac ENOENT')
      if (mode === 'exit1') return { value: ran('', 1) }
      if (mode === 'empty') return { value: ran('') }
      return { value: ran(`${BRIEF}\n`) }
    }
    throw new Error(`unscripted argv: ${k}`)
  })
  on('ui.toast', (_$: unknown, e: unknown) => { toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('classic.SessionStart', (_$: unknown, e: { source: string }) => ({ additionalContext: [FOREIGN_CTX, ...PARTS] }))
  return { asked, toasts }
}
const briefSections = (r: { sections: Array<{ id: string }> }) => r.sections.filter(s => s.id === 'astro-mods:brief')
// the kit hands hooks the composed input only when the call names one (a bare compose() reaches them as undefined)
const COMPOSE = { model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }
const SS = { source: 'startup', cwd: '/work/proj' }

test('brief-section on: one astro-mods:brief section, BRIEF then the position, the same text every compose', async ($, on) => {
  const rig = briefRig(on)
  on('prompt.compose', () => ({ sections: [{ id: 'lean_body', text: 'core', scope: 'shared' }] }))
  await $.session.start(START)
  const first = await $.prompt.compose(COMPOSE)
  const mine = briefSections(first)
  expect(mine.length).toEqual(1)
  expect(first.sections.at(-1)).toEqual(mine[0])
  expect((mine[0] as any).scope).toEqual('session')
  expect((mine[0] as any).text).toEqual(`${BRIEF}\n\n${POSITION}`)
  for (let i = 0; i < 4; i++) expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual((mine[0] as any).text)
  expect(rig.asked.filter(k => k.startsWith('ac principles brief')).length).toEqual(1)
})

test('brief-section on: the hooks\' parts are dropped, a foreign entry quoting a BRIEF line is kept', async ($, on) => {
  briefRig(on)
  await $.session.start(START)
  const out = await ($ as any).classic.SessionStart(SS)
  expect(out.additionalContext).toEqual([FOREIGN_CTX])
})

// The PreCompact row (session.append, door 'command') cannot be driven here: the test kit has no
// bottom for session.append (a hook that answers without next is skipped, and next(e) has nothing
// beneath), so that path is covered by tests/mods_plugin.test.mjs and by PROBE.md's live runs.

for (const mode of ['enoent', 'exit1', 'empty'] as Mode[]) {
  test(`brief-section fails open when the brief ${mode}: no section, hooks pass through, one notice`, async ($, on) => {
    const rig = briefRig(on, { mode })
    on('prompt.compose', () => ({ sections: [{ id: 'lean_body', text: 'core', scope: 'shared' }] }))
    await $.session.start(START)
    for (let i = 0; i < 3; i++) expect(briefSections(await $.prompt.compose(COMPOSE)).length).toEqual(0)
    const out = await ($ as any).classic.SessionStart(SS)
    expect(out.additionalContext).toEqual([FOREIGN_CTX, ...PARTS])
    expect(rig.toasts.length).toEqual(1)
  })
}

test('brief-section off: no section, no brief run, hook output untouched', async ($, on) => {
  const rig = briefRig(on, { switchOn: false })
  on('prompt.compose', () => ({ sections: [] }))
  await $.session.start(START)
  expect(briefSections(await $.prompt.compose(COMPOSE)).length).toEqual(0)
  expect((await ($ as any).classic.SessionStart(SS)).additionalContext).toEqual([FOREIGN_CTX, ...PARTS])
  expect(rig.asked.some(k => k.startsWith('ac principles brief'))).toEqual(false)
  expect(rig.toasts).toEqual([])
})

// A store that changes mid-session: `rev` moves both what the hooks print and what `ac` answers.
const storeRig = (on: (...a: any[]) => void) => {
  const store = { rev: 1 }
  const asked: string[] = []
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const k = e.argv.join(' ')
    asked.push(k)
    if (k === 'ac mods status --json --switches-only') return { value: ran(JSON.stringify({ switches: { 'brief-section': true }, warnings: [] })) }
    if (k === 'ac mods feed brief-section') return { value: ran(JSON.stringify({ serve: true, parts: [`PART rev${store.rev}`], position: POSITION })) }
    if (k === 'ac mods feed brief-section --position') return { value: ran(JSON.stringify({ position: POSITION })) }
    if (k === 'ac principles brief --stage session --by session') return { value: ran(`BRIEF rev${store.rev}\n`) }
    throw new Error(`unscripted argv: ${k}`)
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('classic.SessionStart', () => ({ additionalContext: [`PART rev${store.rev}`] }))
  on('prompt.compose', () => ({ sections: [] }))
  return { store, briefRuns: () => asked.filter(k => k.startsWith('ac principles brief')).length }
}

// the store changes mid-session: a second session.start and a compaction recompute the brief
test('brief-section: a second session.start and a compact re-fetch, so the new rules are served and the new hook parts dropped', async ($, on) => {
  const { store, briefRuns } = storeRig(on)
  await $.session.start(START)
  expect((await ($ as any).classic.SessionStart(SS)).additionalContext).toEqual([])
  expect(briefRuns()).toEqual(1)
  store.rev = 2
  expect((await ($ as any).classic.SessionStart({ ...SS, source: 'compact' })).additionalContext).toEqual([])
  expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toContain('BRIEF rev2')
  store.rev = 3
  await $.session.start(START)
  expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toContain('BRIEF rev3')
})

// PROBE F20: under -p classic.SessionStart completes BEFORE session.start, interactively after, and
// their start order was not observed. Every order is ONE startup: one brief run between the two,
// a stable section across turns, then a compaction after a store change still re-fetches, and a
// reload (a second session.start) runs the brief exactly once more.
const ORDERS: Array<[string, (s: any) => Promise<unknown>]> = [
  ['classic.SessionStart before session.start', async (s) => { const out = await s.classic.SessionStart(SS); await s.session.start(START); return out }],
  ['session.start before classic.SessionStart', async (s) => { await s.session.start(START); return s.classic.SessionStart(SS) }],
  ['both at once, classic first', async (s) => (await Promise.all([s.classic.SessionStart(SS), s.session.start(START)]))[0]],
  ['both at once, session.start first', async (s) => (await Promise.all([s.session.start(START), s.classic.SessionStart(SS)]))[1]],
]
for (const [order, startup] of ORDERS) {
  test(`brief-section, ${order}: one brief run at startup, and a compact after a store change re-fetches`, async ($, on) => {
    const { store, briefRuns } = storeRig(on)
    expect(((await startup($)) as any).additionalContext).toEqual([])
    expect(briefRuns()).toEqual(1)
    const texts = new Set<string>()
    for (let i = 0; i < 5; i++) texts.add((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text)
    expect([...texts]).toEqual([`BRIEF rev1\n\n${POSITION}`])
    expect(briefRuns()).toEqual(1)
    store.rev = 2
    expect((await ($ as any).classic.SessionStart({ ...SS, source: 'compact' })).additionalContext).toEqual([])
    expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual(`BRIEF rev2\n\n${POSITION}`)
    expect(briefRuns()).toEqual(2)
    store.rev = 3
    await $.session.start(START)
    expect(briefRuns()).toEqual(3)
    expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual(`BRIEF rev3\n\n${POSITION}`)
  })
}

// A reload (session.start again) has no startup classic.SessionStart to pair with: the compaction
// or /clear after it is not its partner and must re-fetch, or the section keeps the reload-time
// brief while the hooks' new parts reach the model next to it (phase 42 C3/C4).
for (const [order, startup] of [ORDERS[1], ORDERS[0]]) {
  for (const source of ['compact', 'clear']) {
    test(`brief-section, ${order}, then a reload: a ${source} after a store change re-fetches`, async ($, on) => {
      const { store, briefRuns } = storeRig(on)
      await startup($)
      await $.session.start(START)
      expect(briefRuns()).toEqual(2)
      store.rev = 2
      expect((await ($ as any).classic.SessionStart({ ...SS, source })).additionalContext).toEqual([])
      expect((briefSections(await $.prompt.compose(COMPOSE))[0] as any).text).toEqual(`BRIEF rev2\n\n${POSITION}`)
      expect(briefRuns()).toEqual(3)
    })
  }
}

// ---------------------------------------------------------------------------------------------------
// phase-band (phase 43) through the real engine.
//
// Fixtures: the stdout of the four read-only `ac` queries the band issues, captured byte for byte from
// a scratch project built the tests/flags.test.mjs way (git, `ac init`, `ac registry init` against a
// bare remote), four phases (1 verified, 2 pending and planned, 3 pending and discussed, 4 pending and
// undiscussed), two debt items, two backlog ideas and one fix. Commands, in that project:
//   ac status --json    ac debt list --json    ac backlog list --json    ac fix list --json
// Only the project root path in `status.root` was rewritten to the test's cwd (/work/proj).
// ---------------------------------------------------------------------------------------------------
const FX_STATUS = `{
  "root": "/work/proj",
  "project": "fxproj",
  "milestone": 1,
  "phase": {
    "number": 1,
    "slug": "01-alpha-verified",
    "name": "Alpha verified",
    "status": "verified"
  },
  "next": "/astro-accept 1",
  "siblings": [
    "/astro-plan 3"
  ],
  "phases": [
    {
      "number": 1,
      "name": "Alpha verified",
      "slug": "01-alpha-verified",
      "status": "verified",
      "planned": false,
      "discussed": false
    },
    {
      "number": 2,
      "name": "Bravo planned",
      "slug": "02-bravo-planned",
      "status": "pending",
      "planned": true,
      "discussed": false
    },
    {
      "number": 3,
      "name": "Charlie discussed",
      "slug": "03-charlie-discussed",
      "status": "pending",
      "planned": false,
      "discussed": true
    },
    {
      "number": 4,
      "name": "Delta fresh",
      "slug": "04-delta-fresh",
      "status": "pending",
      "planned": false,
      "discussed": false
    }
  ],
  "activity": null
}
`
const FX_DEBT = `[
  {
    "id": "2026-10-13-second-debt-item-with-a-rather-long",
    "title": "Second debt item with a rather long descriptive title that keeps going and going",
    "status": "open",
    "cost": "large",
    "found_at": "2026-10-13T08:00:33.503Z"
  },
  {
    "id": "2026-10-13-statusline-hook-crashes-on-epipe",
    "title": "Statusline hook crashes on EPIPE",
    "status": "open",
    "cost": "small",
    "found_at": "2026-10-13T08:00:33.333Z"
  }
]
`
const FX_BACKLOG = `[
  {
    "id": "2026-10-13-idea-one",
    "title": "Idea one",
    "status": "open",
    "captured_at": "2026-10-13T08:00:33.643Z"
  },
  {
    "id": "2026-10-13-idea-two",
    "title": "Idea two",
    "status": "open",
    "captured_at": "2026-10-13T08:00:33.769Z"
  }
]
`
const FX_FIX = `[
  {
    "id": "2026-10-13-login-button-broken",
    "title": "Login button broken",
    "status": "open",
    "opened_at": "2026-10-13T08:00:33.909Z"
  }
]
`

const BAND_OUT: Record<string, string> = {
  'ac status --json': FX_STATUS,
  'ac debt list --json': FX_DEBT,
  'ac backlog list --json': FX_BACKLOG,
  'ac fix list --json': FX_FIX,
}
const SWITCHES_LINE = 'ac mods status --json --switches-only'
const BAND_START = { cwd: '/work/proj', surface: 'terminal', isInteractive: true }
const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { bodyRows: 10 } } as any
const settle = () => new Promise<void>(r => setTimeout(r, 30))
type AcMode = 'ok' | 'exit1' | 'junk' | 'truncated' | 'reject'

// Everything beneath the plugin: `ac` (by argv), the file system (mtimes under .astrocode/), the agent
// list, and a recorder for everything the band must NEVER do (a toast, a submit, a command run).
const bandRig = (on: (...a: any[]) => void, over: { band?: boolean, live?: boolean, projectRoot?: string } = {}) => {
  const rig = {
    mode: 'ok' as AcMode,
    asked: [] as string[], // every ac argv except the switches read
    fills: [] as any[],
    toasts: [] as string[],
    forbidden: [] as string[], // prompt.submit, command.run, tool.call, any other ac verb
    version: 1, // state.json's mtime: bump it to model a real `.astrocode/` change
    out: { ...BAND_OUT },
    agents: [] as any[],
    projectRoot: over.projectRoot ?? '/work/proj',
    fillRefuses: false,
  }
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    const line = [...e.argv].join(' ')
    if (line === SWITCHES_LINE) return { value: ran(JSON.stringify({ switches: { 'phase-band': over.band ?? true, 'live-capture': over.live ?? false }, warnings: [] })) }
    // live-capture's own `ac` calls (phase 44), answered only when that mod is switched on in the rig
    if (over.live && line === 'ac status') return { value: ran('Project:   liveproj\n') }
    if (over.live && line.startsWith('ac principles match')) return { value: ran(JSON.stringify({ exact: [], overlap: [] })) }
    if (over.live && line.startsWith('ac principles add')) return { value: ran('✓ principle p-1 (proposed)\n') }
    rig.asked.push(line)
    if (!(line in BAND_OUT)) rig.forbidden.push(line)
    if (rig.mode === 'reject') throw new Error('timed out')
    if (rig.mode === 'exit1') return { value: ran('', 1) }
    if (rig.mode === 'junk') return { value: ran('not json') }
    if (rig.mode === 'truncated') return { value: ran((rig.out[line] ?? '[]').slice(0, 25)) }
    return { value: ran(rig.out[line] ?? '[]') }
  })
  on('fs.stat', (_$: unknown, e: { path: string }) => {
    const root = `${rig.projectRoot}/.astrocode`
    if (e.path !== root && !e.path.startsWith(`${root}/`)) throw new Error('ENOENT')
    const isDir = e.path === root || !/\.json$/.test(e.path)
    return { value: { kind: isDir ? 'dir' : 'file', size: 0, mtimeMs: e.path.endsWith('/state.json') ? rig.version : 1, isLink: false } }
  })
  on('agent.list', () => ({ value: rig.agents }))
  on('prompt.fill', (_$: unknown, e: any) => { rig.fills.push(e); return { isFilled: !rig.fillRefuses } })
  on('prompt.submit', (_$: unknown, e: any) => { rig.forbidden.push(`prompt.submit ${e.text}`); return { text: '' } })
  on('command.run', (_$: unknown, e: any) => { rig.forbidden.push(`command.run ${e.command}`); return { text: '' } })
  on('ui.toast', (_$: unknown, e: unknown) => { rig.toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('prompt.autocomplete', () => ({ suggestions: [] }))
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] })) // core draws nothing of its own in the band
  return rig
}
const TURN_START = { text: 'go', turnId: 't1' } as any
const TURN_DONE = { turnId: 't1', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as any
const mountBand = ($: any, props: any = BAND_PROPS) => $.ui.mount({ plugin: 'astro-mods', surface: 'terminal', component: 'AbovePrompt', props })
const startBand = async ($: any, start: object = BAND_START) => { await $.session.start(start); await settle() }
const statusWith = (patch: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(FX_STATUS), ...patch }, null, 2)
const buttonKeys = async (ui: any) => (await ui.findAll({ type: 'Button' })).map((b: any) => b.key)
// one string per drawn line: the line's segments joined (the mark, meter and next hint are not lines)
const lineTexts = async (ui: any) => (await ui.findAll({ type: 'Box' })).filter((b: any) => /^line-/.test(b.key ?? '')).map((b: any) => b.text)
const rowsFor = async ($: any, text: string) => {
  const start = text.lastIndexOf(' ') + 1
  const r = await $.prompt.autocomplete({ text, cursor: text.length, token: text.slice(start), start })
  return (r?.suggestions ?? []) as Array<{ text: string, label?: string, description?: string }>
}
// the band at rest over FX_STATUS: one ROADMAP row, a chip per phase (◉ verified, ▸ planned, ◌ discussed, ○ to do)
const IDLE = ['ROADMAP  ◉1  ▸2  ◌3  ○4', 'COUNTS   backlog 2 · debt 2 · fixes 1']
const BAND_QUERIES = ['ac status --json', 'ac debt list --json', 'ac backlog list --json', 'ac fix list --json']

test('phase-band: switch on in a project, the band draws one idle line and the buttons ac recommends (C2, C4)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  const ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  // primary = ac's `next`, then the siblings it names; by phase number
  expect(await buttonKeys(ui)).toEqual(['/astro-accept 1', '/astro-plan 3'])
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.label)).toEqual(['Accept 1', 'Plan 3'])
  expect(rig.asked.slice().sort()).toEqual(BAND_QUERIES.slice().sort())
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: the state is coloured, progress is shown, and a next command with no button is a hint', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  let ui = await mountBand($)
  const texts = await ui.findAll({ type: 'Text' })
  expect(texts.find((t: any) => t.text === '◉1')!.props.color).toEqual('claude')
  expect(texts.some((t: any) => /^ \d+\/\d+$/.test(t.text))).toBe(true) // the milestone meter, in the title rule
  expect(texts.some((t: any) => t.text === 'next › ')).toBe(false) // next is a button here
  await ui.unmount()
  rig.out['ac status --json'] = statusWith({ phase: null, next: '/astro-milestone', siblings: [] })
  rig.version++
  await $.turn.complete(TURN_DONE)
  await settle()
  ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  expect(await buttonKeys(ui)).toEqual([])
  expect((await ui.findAll({ type: 'Text' })).some((t: any) => t.text === '/astro-milestone')).toBe(true)
  expect(rig.fills).toEqual([]) // a hint is text: it fills nothing
  await ui.unmount()
})

test('phase-band: a full-width astro-code banner opens the band, with a blank row above it', async ($, on) => {
  bandRig(on)
  await startBand($)
  const ui = await mountBand($)
  const banner = (await ui.findAll({ type: 'Text' })).find((t: any) => /^── ✦ astro-code ─+ M1 ▱+ 0\/4 ──$/.test(t.text))!
  expect(banner.text.length).toEqual(BAND_PROPS.bodyColumns)
  const outer = (await ui.findAll({ type: 'Box' }))[0]!
  expect(outer.props.marginTop).toEqual(1)
  expect(outer.props.marginBottom).toBeUndefined()
  await ui.unmount()
})

// The RUNNING row: an astro Workflow call starts a run (its result names it), each agent the run
// starts joins its crew (agent.spawn carries the runId), an agent's turn.complete leaves it, and the
// run's task notification ends it. Two runs at once: execute 2, plan 3.
test('phase-band: concurrent astro runs show in RUNNING with their live crews, and leave when they end', async ($, on) => {
  const rig = bandRig(on)
  const runs: Record<string, any> = {
    '02-bravo-planned': { status: 'async_launched', taskId: 'task-exec', runId: 'wf_exec', workflowName: 'astro-execute-phase' },
    '03-charlie-discussed': { status: 'async_launched', taskId: 'task-plan', runId: 'wf_plan', workflowName: 'astro-plan-phase' },
  }
  on('tool.call', (_$: unknown, e: any) => ({ result: runs[e.args.phase] }))
  let n = 0
  on('agent.spawn', () => ({ model: 'sonnet', agentId: `agent-${++n}` }))
  await startBand($)
  await $.tool.call({ tool: 'Workflow', scriptPath: '/x/execute-phase.mjs', args: { phase: '02-bravo-planned' } })
  await $.tool.call({ tool: 'Workflow', scriptPath: '/x/plan-phase.mjs', args: { phase: '03-charlie-discussed' } })
  const spawn = (type: string, runId: string) => $.agent.spawn({ ...SPAWN, subagentType: type, workflow: { runId, agentIndex: 1 } })
  await spawn('astro-executor', 'wf_exec')
  await spawn('astro-researcher', 'wf_plan')
  await spawn('astro-researcher', 'wf_plan')
  await settle()
  let ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual([
    'ROADMAP  ◉1  ⚙2  ✎3  ○4',
    'RUNNING  ⚙ execute 2 · 1 executor   ✎ plan 3 · 2 researchers',
    IDLE[1],
  ])
  // a phase already being executed or planned is not offered again
  expect(await buttonKeys(ui)).toEqual(['/astro-accept 1'])
  await ui.unmount()
  // one researcher finishes; then the plan run's notification arrives
  await $.turn.complete({ ...TURN_DONE, agentId: 'agent-2' })
  await settle()
  ui = await mountBand($)
  expect((await lineTexts(ui))[1]).toEqual('RUNNING  ⚙ execute 2 · 1 executor   ✎ plan 3 · 1 researcher')
  await ui.unmount()
  await $.prompt.submit({ text: '<task-notification><task-id>task-plan</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } })
  await settle()
  ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(['ROADMAP  ◉1  ⚙2  ◌3  ○4', 'RUNNING  ⚙ execute 2 · 1 executor', 'COUNTS   backlog 2 · debt 2 · fixes 1'])
  await ui.unmount()
  await $.prompt.submit({ text: '<task-notification><task-id>task-exec</task-id><status>completed</status></task-notification>', origin: { kind: 'task-notification' } })
  await settle()
  ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  expect(rig.toasts).toEqual([])
  // the only submits are the two notifications this test raised itself; the band submits nothing
  expect(rig.forbidden.every((f: string) => f.startsWith('prompt.submit <task-notification>'))).toBe(true)
  await ui.unmount()
})

test('phase-band: a run first met through its agents is still shown, named from who it runs', async ($, on) => {
  bandRig(on)
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-x' }))
  await startBand($)
  await $.agent.spawn({ ...SPAWN, subagentType: 'astro-planner', workflow: { runId: 'wf_unseen', agentIndex: 3 } })
  await settle()
  const ui = await mountBand($)
  expect((await lineTexts(ui))[1]).toEqual('RUNNING  ✎ plan · 1 planner')
  await ui.unmount()
})

test('phase-band: a non-astro workflow or an agent outside any run adds no RUNNING row', async ($, on) => {
  bandRig(on)
  on('tool.call', () => ({ result: { status: 'async_launched', taskId: 't', runId: 'wf_other', workflowName: 'review-changes' } }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'agent-y' }))
  await startBand($)
  await $.tool.call({ tool: 'Workflow', scriptPath: '/x/review.mjs', args: {} })
  await $.agent.spawn({ ...SPAWN, subagentType: 'astro-executor' })
  await settle()
  const ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  await ui.unmount()
})

test('phase-band: pressing a button only fills the composer with the shown command (C3)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  const ui = await mountBand($)
  for (const key of await buttonKeys(ui)) {
    const before = rig.fills.length
    await ui.press({ key })
    expect(rig.fills.length).toEqual(before + 1)
    // the engine stamps the plugin as origin; the band adds nothing else
    expect(rig.fills[before]).toEqual({ text: key, mode: 'replace', origin: { kind: 'plugin', name: 'astro-mods' } })
  }
  // a sign-off placed by the band is plain composer text: no provenance flag in it
  expect(rig.fills.map(f => f.text)).toEqual(['/astro-accept 1', '/astro-plan 3'])
  expect(rig.fills.every(f => !/--/.test(f.text))).toBe(true)
  expect(rig.forbidden).toEqual([])
  expect(rig.asked.every(a => BAND_QUERIES.includes(a))).toBe(true)
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: a refused fill does nothing further (C3)', async ($, on) => {
  const rig = bandRig(on)
  rig.fillRefuses = true
  await startBand($)
  const ui = await mountBand($)
  await ui.press({ key: '/astro-accept 1' })
  expect(rig.fills.length).toEqual(1)
  expect(rig.forbidden).toEqual([])
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: autocomplete offers ids and labels from ac after each listed command and nowhere else (C5)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  const status = JSON.parse(FX_STATUS)
  const debt = JSON.parse(FX_DEBT)
  const backlog = JSON.parse(FX_BACKLOG)
  const fix = JSON.parse(FX_FIX)
  for (const verb of ['discuss', 'plan', 'execute', 'verify', 'accept']) {
    const all = await rowsFor($, `/astro-${verb} 1`)
    expect(all.map(r => r.text)).toEqual(['1'])
    expect(all[0]!.description).toEqual('verified')
  }
  const phases = [1, 2, 3, 4]
  expect((await rowsFor($, '/astro-plan 3')).map(r => r.text)).toEqual(['3'])
  expect((await rowsFor($, '/astro-plan 3'))[0]!.description).toEqual('pending · discussed')
  expect((await rowsFor($, '/astro-plan 2'))[0]!.description).toEqual('pending · planned')
  expect(phases.map(String)).toEqual(status.phases.map((p: any) => String(p.number)))
  const debtRows = await rowsFor($, '/astro-debt-pay 2')
  expect(debtRows.map(r => r.text)).toEqual(debt.map((d: any) => d.id))
  expect(debtRows.map(r => r.label)).toEqual(debt.map((d: any) => d.title.slice(0, 48)))
  expect((await rowsFor($, '/astro-backlog-promote 2')).map(r => [r.text, r.label])).toEqual(backlog.map((b: any) => [b.id, b.title]))
  expect((await rowsFor($, '/astro-fix-accept 2')).map(r => [r.text, r.label])).toEqual(fix.map((f: any) => [f.id, f.title]))
  // a partial id narrows; an id that matches nothing gives nothing
  expect((await rowsFor($, '/astro-debt-pay 2026-10-13-st')).map(r => r.text)).toEqual(['2026-10-13-statusline-hook-crashes-on-epipe'])
  expect(await rowsFor($, '/astro-plan 9')).toEqual([])
  // not one of the listed commands: no band rows
  for (const text of ['/astro-status 1', '/other 4', 'plain text 1', '/astro-fix 2026', '/astro-debt 2026', '/astro-plan 1 2']) {
    expect(await rowsFor($, text)).toEqual([])
  }
  expect(rig.toasts).toEqual([])
})

test('phase-band: 20 autocomplete keystrokes cost no ac call; an unrelated change does not either (C6)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  const before = rig.asked.length
  expect(before).toEqual(4)
  for (let i = 0; i < 20; i++) await rowsFor($, `/astro-plan ${i % 5}`)
  const ui = await mountBand($)
  for (let i = 0; i < 5; i++) await ui.redraw()
  expect(rig.asked.length).toEqual(before)
  // a project file outside .astrocode/ changed: nothing under .astrocode/ moved, so no new query
  await $.turn.start(TURN_START)
  await settle()
  expect(rig.asked.length).toEqual(before)
  await ui.unmount()
})

test('phase-band: a real .astrocode change at the next turn is drawn, and offered by autocomplete (C2, C6)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  let ui = await mountBand($)
  expect(await buttonKeys(ui)).toEqual(['/astro-accept 1', '/astro-plan 3'])
  await ui.unmount()
  // ac moved on: phase 1 accepted, phase 2 planned phase is now the recommendation
  const next = JSON.parse(FX_STATUS)
  next.phases[0].status = 'complete'
  next.phase = { number: 2, slug: '02-bravo-planned', name: 'Bravo planned', status: 'pending' }
  next.next = '/astro-execute 2'
  next.siblings = ['/astro-plan 3']
  rig.out['ac status --json'] = JSON.stringify(next, null, 2)
  rig.version++
  await $.turn.start(TURN_START)
  await settle()
  ui = await mountBand($)
  expect(await buttonKeys(ui)).toEqual(['/astro-execute 2', '/astro-plan 3'])
  expect(await lineTexts(ui)).toEqual(['ROADMAP  ✓1  ▸2  ◌3  ○4', 'COUNTS   backlog 2 · debt 2 · fixes 1'])
  expect((await rowsFor($, '/astro-accept 1'))[0]!.description).toEqual('complete')
  expect(rig.asked.length).toEqual(8)
  await ui.unmount()
})

for (const mode of ['exit1', 'junk', 'truncated', 'reject'] as const) {
  test(`phase-band: ac ${mode} draws one dim line, no buttons, no rows, no notice, and recovers (C7)`, async ($, on) => {
    const rig = bandRig(on)
    rig.mode = mode
    await startBand($)
    let ui = await mountBand($)
    const lines = await lineTexts(ui)
    expect(lines.length).toEqual(1)
    expect(lines[0]).toMatch(/^astro-code status unavailable \(.{1,60}\)$/)
    expect(await buttonKeys(ui)).toEqual([])
    expect((await ui.findAll({ type: 'Text' }))[0]!.props.dimColor).toEqual(true)
    expect(await rowsFor($, '/astro-plan 1')).toEqual([])
    expect(await rowsFor($, '/astro-debt-pay 2')).toEqual([])
    expect(rig.toasts).toEqual([])
    await ui.unmount()
    // ac is back: the next turn recovers the band
    rig.mode = 'ok'
    await $.turn.start(TURN_START)
    await settle()
    ui = await mountBand($)
    expect(await buttonKeys(ui)).toEqual(['/astro-accept 1', '/astro-plan 3'])
    expect((await rowsFor($, '/astro-plan 3')).length).toEqual(1)
    expect(rig.toasts).toEqual([])
    await ui.unmount()
  })
}

test('phase-band: switch off draws nothing, adds no rows, and asks ac for nothing but the switches (C8b)', async ($, on) => {
  const rig = bandRig(on, { band: false })
  await startBand($)
  const ui = await mountBand($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  expect(await rowsFor($, '/astro-plan 1')).toEqual([])
  await $.turn.start(TURN_START)
  await settle()
  expect(rig.asked).toEqual([])
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: outside an astro-code project nothing is drawn and ac is not asked (C8a)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($, { ...BAND_START, cwd: '/elsewhere' })
  const ui = await mountBand($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(await ui.findAll({ type: 'Text' })).toEqual([])
  expect(await rowsFor($, '/astro-plan 1')).toEqual([])
  expect(rig.asked).toEqual([])
  await ui.unmount()
})

test('phase-band: a non-interactive session start draws nothing (C8c)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($, { ...BAND_START, surface: null, isInteractive: false })
  const ui = await mountBand($)
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  expect(await rowsFor($, '/astro-plan 1')).toEqual([])
  expect(rig.asked).toEqual([])
  await ui.unmount()
})

test('phase-band: a survey holding the band is yielded to', async ($, on) => {
  bandRig(on)
  await startBand($)
  const ui = await mountBand($, { ...BAND_PROPS, hasSurvey: true })
  expect(await ui.findAll({ type: 'Button' })).toEqual([])
  await ui.unmount()
})

// PROBE.md (phase 43): `$.agent.list()` shows no workflow agent, so while a run is live the band shows
// ac's activity text and says that workflow agents are not individually visible. It never invents rows.
test('phase-band: a live run expands the band with the activity text and says workflow agents are not visible; it collapses after (C1, C4)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  let ui = await mountBand($)
  expect((await lineTexts(ui)).length).toEqual(IDLE.length)
  await ui.unmount()
  rig.out['ac status --json'] = statusWith({ activity: '⚙ executing 38' })
  rig.version++
  await $.turn.start(TURN_START)
  await settle()
  ui = await mountBand($)
  const live = await lineTexts(ui)
  expect(live.length).toBeGreaterThan(1)
  expect(live).toEqual([IDLE[0], 'RUNNING  ⚙ executing 38', IDLE[1]])
  expect(live.some(l => /astro-executor — /.test(l))).toBe(false) // no invented per-agent rows
  await ui.unmount()
  // the run ends: activity cleared, the band collapses to one line
  rig.out['ac status --json'] = statusWith({ activity: null })
  rig.version++
  await $.turn.complete(TURN_DONE)
  await settle()
  ui = await mountBand($)
  expect((await lineTexts(ui)).length).toEqual(IDLE.length)
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

const inSeconds = (n: number) => Math.floor(Date.now() / 1000) + n

test('phase-band: a run that ends collapses the band, even after an executor spawn (C4)', async ($, on) => {
  const rig = bandRig(on)
  on('agent.spawn', () => ({ model: 'opus', agentId: 'a1234567890abcdef' }))
  rig.out['ac status --json'] = statusWith({ activity: '⚙ executing', activityUntil: inSeconds(1200) })
  await startBand($)
  await $.agent.spawn({ ...SPAWN, subagentType: 'astro-executor' })
  await settle()
  let ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual([IDLE[0], 'RUNNING  ⚙ executing', IDLE[1]])
  await ui.unmount()
  // `ac activity clear`: the verb goes and state.json changes
  rig.out['ac status --json'] = statusWith({ activity: null, activityUntil: null })
  rig.version++
  await $.turn.complete(TURN_DONE)
  await settle()
  ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  await ui.unmount()
  await $.turn.start(TURN_START)
  await $.turn.complete(TURN_DONE)
  await settle()
  ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: a verb past its activityUntil collapses the band with no file change, re-read once (C4, C6)', async ($, on) => {
  const rig = bandRig(on)
  rig.out['ac status --json'] = statusWith({ activity: '⚙ executing 38', activityUntil: inSeconds(-1) })
  await startBand($)
  const ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE) // aged out locally, drawn from memory
  await ui.unmount()
  const before = rig.asked.length
  await $.turn.complete(TURN_DONE)
  await settle()
  expect(rig.asked.length - before).toEqual(BAND_QUERIES.length) // one refresh for that expiry
  await $.turn.start(TURN_START)
  await $.turn.complete(TURN_DONE)
  await settle()
  expect(rig.asked.length - before).toEqual(BAND_QUERIES.length) // and no more
})

test('phase-band: a live verb triggers no ac call without a .astrocode change (C6)', async ($, on) => {
  const rig = bandRig(on)
  on('agent.spawn', () => ({ model: 'opus', agentId: 'a1234567890abcdef' }))
  rig.out['ac status --json'] = statusWith({ activity: '⚙ executing', activityUntil: inSeconds(1200) })
  await startBand($)
  const before = rig.asked.length
  await $.turn.start(TURN_START)
  for (let i = 0; i < 20; i++) await rowsFor($, `/astro-plan ${'4'.repeat(i + 1)}`)
  for (let i = 0; i < 3; i++) await $.agent.spawn({ ...SPAWN, subagentType: 'astro-executor' })
  await $.turn.complete(TURN_DONE)
  await settle()
  const ui = await mountBand($)
  expect((await lineTexts(ui)).some(l => /⚙ executing/.test(l))).toBe(true)
  await ui.unmount()
  expect(rig.asked.length).toEqual(before)
})

test('phase-band: a listed Agent-tool executor shows its observed state, and the band collapses when it leaves (C1, C4)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  rig.agents = [{ id: 'ad32dadfa6074a54f', type: 'astro-executor', status: 'running', description: 'Create agent.txt file' }]
  await $.turn.complete(TURN_DONE)
  await settle()
  let ui = await mountBand($)
  const live = await lineTexts(ui)
  expect(live).toEqual([IDLE[0], 'RUNNING  astro-executor — running', IDLE[1]])
  await ui.unmount()
  rig.agents = []
  await $.turn.complete(TURN_DONE)
  await settle()
  ui = await mountBand($)
  expect((await lineTexts(ui)).length).toEqual(IDLE.length)
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

test('phase-band: across all of it the band ran only read-only ac queries and nothing else (C3, C6)', async ($, on) => {
  const rig = bandRig(on)
  await startBand($)
  const ui = await mountBand($)
  await ui.press({ key: '/astro-accept 1' })
  await $.turn.start(TURN_START)
  await $.turn.complete(TURN_DONE)
  await settle()
  expect(rig.asked.every(a => BAND_QUERIES.includes(a))).toBe(true)
  expect(rig.forbidden).toEqual([])
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})

// live-capture (phase 44): hooks beneath the plugin stand for the engine. `process.run` answers the
// switches, `ac status`, `ac principles match` and `ac principles add` and records every argv;
// `model.complete` is recorded and answers the rule JSON; `session.id` answers 'sess-1' (the kit
// raises `session.id` as a hook, so the ref is asserted exactly); `ui.log` and `ui.toast` record.
const LIVE_RULE = JSON.stringify({ rule: true, lifted: 'Never mock the database in integration tests', kind: 'antipattern', why: 'mocks hid a migration bug' })
const liveRig = (live: boolean, on: (...a: any[]) => void) => {
  const rig = { argv: [] as string[][], models: [] as any[], logs: [] as string[], toasts: [] as string[] }
  on('process.run', (_$: unknown, e: { argv: string[] }) => {
    rig.argv.push([...e.argv])
    const a = e.argv.join(' ')
    if (a.includes('--switches-only')) return { value: ran(JSON.stringify({ switches: { 'live-capture': live }, warnings: [] })) }
    if (a.startsWith('ac status')) return { value: ran('Project:   liveproj\n') }
    if (a.includes('principles match')) return { value: ran(JSON.stringify({ exact: [], overlap: [] })) }
    if (a.includes('principles add')) return { value: ran('✓ principle p-1 (proposed)\n') }
    return { value: ran('', 1) }
  })
  on('model.complete', (_$: unknown, e: any) => { rig.models.push(e); return { value: { isAnswered: true, text: LIVE_RULE, usage: {} } } })
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', (_$: unknown, e: { text: string }) => { rig.logs.push(e.text); return { value: undefined } })
  on('ui.toast', (_$: unknown, e: unknown) => { rig.toasts.push(JSON.stringify(e)); return { value: undefined } })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('command.run', () => ({ text: '' }))
  on('prompt.submit', (_$: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  return rig
}
const principlesArgv = (rig: { argv: string[][] }) => rig.argv.filter(a => a.includes('principles'))

test('live-capture: a composer prompt passes unchanged, then one Haiku call and a propose carrying the live ref', async ($, on) => {
  const rig = liveRig(true, on)
  await $.session.start(START)
  const out = await prompt($, 'never mock the database in tests')
  expect(out).toEqual({ text: 'never mock the database in tests' })
  await settle()
  expect(rig.models.length).toEqual(1)
  expect(rig.models[0].model).toEqual('haiku')
  const add = rig.argv.find(a => a.includes('add') && a.includes('--propose'))!
  expect(add).toBeDefined()
  expect(add[add.indexOf('--from-ref') + 1]).toEqual('live sess-1')
  expect(rig.toasts).toEqual([])
})

test('live-capture: an sdk prompt, or a typed command then its body, makes no model call', async ($, on) => {
  const rig = liveRig(true, on)
  await $.session.start(START)
  await prompt($, 'never mock the database', SDK)
  await typed($, 'astro-plan', '4')
  await prompt($, 'Plan phase 4 and always write tests first')
  await settle()
  expect(rig.models).toEqual([])
  expect(principlesArgv(rig)).toEqual([])
})

test('live-capture: after a proposal turn.complete logs one quiet count line and no toast', async ($, on) => {
  const rig = liveRig(true, on)
  await $.session.start(START)
  await prompt($, 'never mock the database in tests')
  await settle()
  await $.turn.complete(TURN_DONE)
  expect(rig.logs).toEqual(['1 proposed — /astro-principles-review'])
  expect(rig.toasts).toEqual([])
})

test('live-capture: switched off, no model call and no ac principles argv', async ($, on) => {
  const rig = liveRig(false, on)
  await $.session.start(START)
  const out = await prompt($, 'never mock the database in tests')
  await settle()
  expect(out).toEqual({ text: 'never mock the database in tests' })
  expect(rig.models).toEqual([])
  expect(principlesArgv(rig)).toEqual([])
})

// phase 44 t8: the band draws live-capture's count and claims it, so turn.complete adds no second line
test('phase-band: it draws the live-capture count on its idle line and claims it (one surface, never both)', async ($, on) => {
  const rig = bandRig(on, { live: true })
  const logs: string[] = []
  on('model.complete', () => ({ value: { isAnswered: true, text: LIVE_RULE, usage: {} } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('ui.log', (_$: unknown, e: { text: string }) => { logs.push(e.text); return { value: undefined } })
  await startBand($)
  const ui = await mountBand($)
  expect(await lineTexts(ui)).toEqual(IDLE)
  await prompt($, 'never mock the database in tests')
  await settle()
  await $.turn.complete(TURN_DONE)
  await settle()
  expect(await lineTexts(ui)).toEqual([`${IDLE[0]}   1 proposed — /astro-principles-review`, IDLE[1]])
  expect(logs).toEqual([])
  expect(rig.toasts).toEqual([])
  await ui.unmount()
})
