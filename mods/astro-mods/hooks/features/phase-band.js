// phase-band -- a band above the prompt with next-command buttons, and id autocomplete (phase 43).
//
// UX only: it enforces no rule (ADR-071 a, trivially), and nothing depends on it (b). It READS
// astro-code state through `ac ... --json` (c) -- never a file of its own, never a write -- and
// fails open (e): when `ac` fails the band says so in one dim line, or draws nothing.
//
// A button only FILLS the composer (ADR-033, ADR-074). The human presses Enter, so a sign-off
// typed this way stays a composer act that witness can count as human, and the band adds no
// provenance flag to what it fills.
//
// Why the pure work is in lib/: the validator follows `$` only into functions declared in this
// file (F5), so every `$.` call is spelled here, and lib/band.js and lib/complete.js take results.
//
// Session memory only: the one module variable below is rebuilt on every register(), never
// persisted (c). Data is fetched OUTSIDE render (a render hook never writes) and refreshed when
// the mtimes under `.astrocode/` change at a turn boundary, not per keystroke or per render.
//
// Failures. failOpen resets EVERY switch (F6), so a flaky `ac` read for the band must not switch
// off witness or blindfold: refreshes catch their own errors and set an `unavailable` reason.
// The `.catch(failOpen)` in register.js stays as the backstop for a genuine hook bug.
import { isOn } from '../lib/switches.js'
import { badges, claimBadges } from '../lib/badges.js'
import { readJsonResult, rootCandidates, signature, stalePaths, bandView, liveFrom, freshStatus, runOf, notifiedTask } from '../lib/band.js'
import { commandSource, completionRows } from '../lib/complete.js'

export const FEATURE = 'phase-band'
// PROBE.md (phase 43, R1): `$.agent.list()` is `[]` for a workflow's agents. They are seen another
// way: `agent.spawn` carries `workflow.runId` for each agent a run starts, so the band keeps each
// astro run's crew itself (`runs` below) and never invents a row. `$.agent.list()` still serves the
// Agent-tool agents.
export const WORKFLOW_AGENTS_LISTED = false
export const ACTIVE_TIMEOUT_MS = 5000

let st = fresh()

function fresh() {
  return {
    cwd: null, // the project dir holding .astrocode, once found
    interactive: false,
    status: null, // `ac status --json`
    lists: { debt: null, backlog: null, fix: null },
    sig: null, // signature of the .astrocode mtimes the data was read at
    unavailable: null, // why `ac` could not be read, or null
    agentRows: [], // `$.agent.list()` rows
    busy: null, // the refresh in flight
    again: false, // a change arrived while one was in flight
    agedOut: null, // the activityUntil already re-read for: one refresh per expiry, not one per boundary
    // astro workflow runs in flight, by runId: {taskId, kind, phase, agents: Map(agentId -> type), at}
    runs: new Map(),
  }
}

export function resetPhaseBand() {
  st = fresh()
}

/** Resolves when the refresh in flight (if any) is done. Lets a test wait without a timer. */
export function phaseBandSettled() {
  return st.busy ?? Promise.resolve()
}

const active = () => st.interactive && st.cwd !== null

async function statOf($, path) {
  try {
    return { path, mtimeMs: (await $.fs.stat(path)).mtimeMs }
  } catch {
    return { path, mtimeMs: null }
  }
}

async function stats($, paths) {
  return Promise.all(paths.map((p) => statOf($, p)))
}

async function findProject($, cwd) {
  for (const candidate of rootCandidates(cwd)) {
    try {
      if ((await $.fs.stat(candidate)).kind === 'dir') return candidate.slice(0, -'/.astrocode'.length) || '/'
    } catch {
      // not here: keep walking up
    }
  }
  return null
}

function reasonOf(err) {
  const m = String((err && err.message) || err || '')
  if (/ENOENT|not found/i.test(m)) return 'ac not found'
  if (/time/i.test(m)) return 'ac timed out'
  return m.slice(0, 40) || 'ac failed'
}

async function ask($, argv) {
  try {
    return { ran: await $.process.run(argv, { cwd: st.cwd, timeoutMs: ACTIVE_TIMEOUT_MS }) }
  } catch (err) {
    return { error: reasonOf(err) }
  }
}

async function load($) {
  const before = await stats($, stalePaths(st.cwd, st.status))
  const [s, debt, backlog, fix] = await Promise.all([
    ask($, ['ac', 'status', '--json']),
    ask($, ['ac', 'debt', 'list', '--json']),
    ask($, ['ac', 'backlog', 'list', '--json']),
    ask($, ['ac', 'fix', 'list', '--json']),
  ])
  const status = s.ran ? readJsonResult(s.ran) : null
  if (!status) {
    // nothing stale survives a failure: no buttons, no rows
    st.status = null
    st.lists = { debt: null, backlog: null, fix: null }
    st.unavailable = s.error ?? (s.ran.exitCode !== 0 ? `ac exited ${s.ran.exitCode}` : 'ac printed no JSON')
    st.sig = null
    return
  }
  const list = (r) => (r.ran ? readJsonResult(r.ran) : null)
  st.status = status
  st.lists = { debt: list(debt), backlog: list(backlog), fix: list(fix) }
  st.unavailable = null
  const paths = stalePaths(st.cwd, status)
  st.sig = paths.join('|') === before.map((b) => b.path).join('|') ? signature(before) : signature(await stats($, paths))
}

async function readAgents($) {
  try {
    const rows = await $.agent.list()
    st.agentRows = Array.isArray(rows) ? rows : []
  } catch {
    st.agentRows = []
  }
}

function redraw($) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // no UI to redraw
  }
}

/** One refresh; never rejects, never raises a notice, never writes. */
function refresh($) {
  if (st.busy) {
    st.again = true
    return st.busy
  }
  st.busy = (async () => {
    try {
      await load($)
      await readAgents($)
    } catch (err) {
      st.status = null
      st.unavailable = reasonOf(err)
      st.sig = null
    }
    st.busy = null
    redraw($)
    if (st.again) {
      st.again = false
      void refresh($)
    }
  })()
  return st.busy
}

/** Refresh only if `.astrocode` changed since the last read, or the last read failed. */
async function tick($, withAgents) {
  try {
    if (!active()) return
    const sig = signature(await stats($, stalePaths(st.cwd, st.status)))
    // a live verb ages out in `ac` with no file change: re-read once when its activityUntil passes
    const until = st.status && st.status.activity ? st.status.activityUntil : null
    const agedOut = typeof until === 'number' && Date.now() >= until * 1000 && st.agedOut !== until
    if (agedOut) st.agedOut = until
    if (sig !== st.sig || st.unavailable || agedOut) {
      void refresh($)
    } else if (withAgents) {
      await readAgents($)
      redraw($)
    }
  } catch {
    // a failed freshness check is not a failure of the session
  }
}

/** session.start (interactive only, by its matcher): find the project, start the first read. */
export async function phaseBandStart($, e, next) {
  // The one deliberate exception to "open with isOn": the switches are read by the plugin's other
  // session.start, and the order the engine chains two same-plugin hooks in is not observable
  // (F22), so let the rest of the chain run first and only then ask.
  const r = await next(e)
  if (!isOn(FEATURE)) return r
  st = fresh()
  if (e.isInteractive !== true) return r
  const cwd = await findProject($, e.cwd).catch(() => null)
  if (!cwd) return r // outside an astro-code project: nothing, and no `ac` call (C8a)
  st.cwd = cwd
  st.interactive = true
  void refresh($)
  return r
}

export async function phaseBandTurn($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  void tick($, false)
  return next(e)
}

export async function phaseBandDone($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  // an agent's loop ended: it leaves its run's crew
  if (typeof e.agentId === 'string') {
    for (const run of st.runs.values()) if (run.agents.delete(e.agentId)) redraw($)
  }
  void tick($, true)
  return next(e)
}

/** agent.spawn (astro-* agents only, by its matcher): a workflow's agent joins its run's crew. */
export async function phaseBandSpawn($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  void tick($, true)
  const r = await next(e)
  const runId = e.workflow && e.workflow.runId
  if (active() && runId && r && typeof r.agentId === 'string') {
    // a run first met through its agents (one started before this band saw its call) is named
    // from who it runs: executors and verifiers execute, researchers and planners plan
    if (!st.runs.has(runId)) st.runs.set(runId, { taskId: null, kind: kindFrom(e.subagentType), phase: null, agents: new Map(), at: Date.now() })
    st.runs.get(runId).agents.set(r.agentId, e.subagentType)
    redraw($)
  }
  return r
}

const kindFrom = (type) => (type === 'astro-executor' || type === 'astro-verifier' ? 'execute' : 'plan')

/** tool.call on the Workflow tool (by its matcher): an astro run starts; its result names it. */
export async function phaseBandWorkflow($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  const r = await next(e)
  const res = r && r.result
  const info = res && typeof res.runId === 'string' ? runOf(res.workflowName, e.args) : null
  if (active() && info) {
    const known = st.runs.get(res.runId)
    st.runs.set(res.runId, { taskId: typeof res.taskId === 'string' ? res.taskId : null, ...info, agents: known ? known.agents : new Map(), at: Date.now() })
    redraw($)
  }
  return r
}

/** A task notification arriving (by its matcher): the run it names has ended. */
export async function phaseBandNotified($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  const t = notifiedTask(e.text)
  if (t) {
    for (const [id, run] of st.runs) if (run.taskId === t.taskId) st.runs.delete(id)
    redraw($)
  }
  return next(e)
}

// a run whose end was never seen (its notification came while the band was off) stops showing
const RUN_STALE_MS = 6 * 60 * 60 * 1000

function runsNow() {
  const now = Date.now()
  const out = []
  for (const [id, run] of st.runs) {
    if (now - run.at > RUN_STALE_MS && !run.agents.size) st.runs.delete(id)
    else if (run.kind) out.push({ kind: run.kind, phase: run.phase, agents: [...run.agents.values()] })
  }
  return out.sort((a, b) => (a.phase ?? 0) - (b.phase ?? 0))
}

/** ui.render AbovePrompt: draw from memory. Makes no `ac` call and no write. */
export async function phaseBandRender($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  if (e.props.hasSurvey || !active()) return next(e) // a survey holds the band: yield
  const status = freshStatus(st.status, Date.now())
  const live = liveFrom(st.agentRows, status ? status.activity ?? null : null, WORKFLOW_AGENTS_LISTED)
  const view = bandView(status, live, { unavailable: st.unavailable, runs: runsNow() })
  if (!view.lines.length && !view.buttons.length) return next(e)
  const { Box, Text, Button } = $.ui.resolve(e)
  // `ac` failed: one dim line and nothing else (C7), so a broken read never looks like a state
  if (st.unavailable) return h(Box, { key: 'line-0' }, h(Text, { dimColor: true }, view.lines[0]))
  // drawing claims the in-memory badges (live-capture's count), so exactly one surface shows them
  claimBadges()
  const marks = badges()
  const width = Math.max(20, Number(e.props.bodyColumns) || 80)
  const segment = (t) => h(Text, { ...TONES[toneOf(t.tone)], ...(t.current ? { bold: true, underline: true } : {}) }, t.text)
  const rows = view.parts.map((parts, i) => {
    const shown = i === 0 && marks.length ? [...parts, { text: `   ${marks.join(' · ')}`, tone: 'badge' }] : parts
    // keyed Box per row: what a reader (or a test) takes as one line of the band
    return h(Box, { key: `line-${i}`, paddingLeft: 1 }, h(Text, { wrap: 'truncate' }, ...shown.map(segment)))
  })
  const buttons = view.buttons.map((b, i) =>
    h(Button, {
      key: b.key,
      label: b.label,
      variant: i === 0 ? 'primary' : 'secondary',
      // fills the composer and nothing else; a refused fill leaves it as it was
      onPress: () => {
        $.prompt.fill({ text: b.command, mode: 'replace' }).catch(() => {})
      },
    }),
  )
  const hint = view.hint ? [h(Text, {}, h(Text, { dimColor: true }, 'next › '), h(Text, { color: 'suggestion' }, view.hint))] : []
  const actions = buttons.length || hint.length
    ? [h(Box, { key: 'actions', flexDirection: 'row', gap: 1, paddingLeft: 1 }, h(Text, TONES.label, 'NEXT    '), ...buttons, ...hint)]
    : []
  return h(Box, { flexDirection: 'column', marginTop: 1 }, titleRule(Text, view, width), ...rows, ...actions)
}

// `── ✦ astro-code v0.50.0 ─────── M27 ▰▰▱▱▱ 2/5 ──`, `width` cells wide: the band's banner. The
// version is here, so the statusline drops its own while the band draws (renderSegmentParts).
function titleRule(Text, view, width) {
  const rule = { color: 'claude' }
  const tail = [
    ...(view.title ? [[` ${view.title}`, { bold: true }]] : []),
    ...(view.meter ? [[` ${view.meter.bar}`, { color: 'success' }], [` ${view.meter.done}/${view.meter.total}`, { dimColor: true }]] : []),
    [' ──', rule],
  ]
  const head = [['── ', rule], ['✦', { color: 'claude', bold: true }], [' astro-code ', { bold: true }],
    ...(view.version ? [[`v${view.version} `, { dimColor: true }]] : [])]
  const used = [...head, ...tail].reduce((n, [t]) => n + t.length, 0)
  const pieces = [...head, ['─'.repeat(Math.max(1, width - used)), rule], ...tail]
  return h(Text, { wrap: 'truncate' }, ...pieces.map(([t, props]) => h(Text, props, t)))
}

// How each segment is drawn. Theme keys, so the band follows the user's terminal theme.
const TONES = {
  id: { bold: true },
  sep: { dimColor: true },
  note: { dimColor: true, italic: true },
  label: { dimColor: true, bold: true },
  activity: { color: 'warning' },
  badge: { color: 'remember' },
  'chip:done': { color: 'success' },
  'chip:verified': { color: 'claude', bold: true },
  'chip:rejected': { color: 'error', bold: true },
  'chip:executing': { color: 'warning', bold: true },
  'chip:planning': { color: 'suggestion', bold: true },
  'chip:planned': { color: 'text' },
  'chip:discussed': { color: 'suggestion' },
  'chip:todo': { dimColor: true },
  'run:execute': { color: 'warning', bold: true },
  'run:plan': { color: 'suggestion', bold: true },
  'agent:running': { color: 'warning' },
  'agent:done': { color: 'success' },
  'agent:failed': { color: 'error' },
  plain: {},
}
const toneOf = (tone) => (tone in TONES ? tone : 'plain')

/** prompt.autocomplete: rows after the listed commands, from memory. Never calls `ac` (C6). */
export async function phaseBandComplete($, e, next) {
  if (!isOn(FEATURE)) return next(e)
  const source = commandSource(e.text, e.start)
  if (source === null || !active() || !st.status) return next(e)
  const data = source === 'phases' ? st.status.phases : st.lists[source]
  const rows = completionRows(source, data, e.token)
  const base = await next(e)
  if (!rows.length) return base
  return { suggestions: [...(base && Array.isArray(base.suggestions) ? base.suggestions : []), ...rows] }
}
