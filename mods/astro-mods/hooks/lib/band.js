// The phase-band mod's pure core (ADR-071): parsing `ac` output, the root walk, the freshness
// signature and the lines and buttons the band draws. Plain values in, plain values out.
//
// Why no `$` here (F5). The plugin validator follows `$` only into functions declared in the
// same file, never across an import, so every `$.…` call lives in features/phase-band.js and
// this module takes results as arguments. It reads no file either: phase-band.js does the stat.
//
// Why `null` and never a throw (F6). `failOpen` resets every switch, so a flaky `ac` read for
// the band must not reach it. Every parser here answers `null` for anything it cannot read, and
// the caller turns that into an `unavailable` reason.

const BUTTON = /^\/astro-(discuss|plan|execute|verify|accept) \d+$/
const MAX_BUTTONS = 3
const REASON_MAX = 60
const AGENT_TYPES = new Set(['astro-executor', 'astro-verifier'])

/** The parsed value of an `ac … --json` run, or `null`; never throws. */
export function readJsonResult(ran) {
  try {
    if (!ran || ran.exitCode !== 0 || ran.isStdoutTruncated) return null
    const v = JSON.parse(ran.stdout)
    return v !== null && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** `cwd/.astrocode`, then each parent's, up to `/`. Pure path math. */
export function rootCandidates(cwd) {
  const out = []
  let dir = String(cwd).replace(/\/+$/, '')
  for (;;) {
    out.push(`${dir}/.astrocode`)
    if (!dir) break
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
  return out
}

/** A stable string from `[{path, mtimeMs|null}]`: changes with any mtime, ignores order. */
export function signature(stats) {
  return stats.map(s => `${s.path}@${s.mtimeMs == null ? '-' : s.mtimeMs}`).sort().join('|')
}

/** What to stat for freshness: `.astrocode` state files and non-complete phase dirs only. */
export function stalePaths(root, status) {
  const base = `${String(root).replace(/\/+$/, '').replace(/\/\.astrocode$/, '')}/.astrocode`
  const paths = ['state', 'roadmap', 'debt', 'backlog', 'fixes'].map(f => `${base}/${f}.json`)
  for (const p of (status && Array.isArray(status.phases)) ? status.phases : []) {
    if (p && p.status !== 'complete' && p.slug) paths.push(`${base}/phases/${p.slug}`)
  }
  // the local registry ref (`ac status --json` → registry_ref): a fetch or `ac flow link` moves it, so
  // the band re-reads ownership and ties at the next turn boundary
  if (status && typeof status.registry_ref === 'string' && status.registry_ref) paths.push(status.registry_ref)
  return paths
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1)

function buttonsOf(status, visible = null) {
  const seen = new Set()
  const out = []
  for (const command of [status.next, ...(Array.isArray(status.siblings) ? status.siblings : [])]) {
    if (typeof command !== 'string' || !BUTTON.test(command) || seen.has(command)) continue
    // scoped bands keep a button only for a phase they show
    if (visible && !visible.has(Number(command.match(/ (\d+)$/)[1]))) continue
    seen.add(command)
    const [, verb, n] = command.match(/^\/astro-(\w+) (\d+)$/)
    out.push({ key: command, label: `${cap(verb)} ${n}`, command })
    if (out.length === MAX_BUTTONS) break
  }
  return out
}

/**
 * `status` with its activity verb dropped once `activityUntil` (epoch seconds) has passed: ac stops
 * reporting a verb that old, and the band must not keep one alive with no file change to re-read on.
 */
export function freshStatus(status, nowMs) {
  if (!status || !status.activity || typeof status.activityUntil !== 'number') return status
  return nowMs < status.activityUntil * 1000 ? status : { ...status, activity: null }
}

const METER_MAX = 10

/** `n` of `total` phases done as a bar at most METER_MAX cells wide, or null with no phases. */
/**
 * The phases the band tracks: the current milestone's, without rejected ones. A phase carrying no
 * milestone stays (an older roadmap); the current phase and a phase with a run in flight always
 * stay, rejected or not, so where you are and what is running never vanish.
 */
export function trackedPhases(status, runs = []) {
  const phases = status && Array.isArray(status.phases) ? status.phases.filter(p => p && typeof p.number === 'number') : []
  const m = status ? status.milestone ?? null : null
  const current = status && status.phase ? status.phase.number : null
  return phases.filter(p => p.number === current || runs.some(r => r.phase === p.number) ||
    (p.status !== 'rejected' && (m == null || p.milestone == null || p.milestone === m)))
}

/**
 * Other milestones still holding work, one entry each: `{milestone, verified, open}` — phases
 * awaiting acceptance and phases not yet verified. Complete and rejected phases count as closed.
 */
export function openMilestones(status) {
  const phases = status && Array.isArray(status.phases) ? status.phases : []
  const m = status ? status.milestone ?? null : null
  const by = new Map()
  for (const p of phases) {
    if (!p || p.milestone == null || p.milestone === m || p.remote) continue
    if (p.status === 'complete' || p.status === 'rejected') continue
    const tally = by.get(p.milestone) || { milestone: p.milestone, verified: 0, open: 0 }
    if (p.status === 'verified') tally.verified++
    else tally.open++
    by.set(p.milestone, tally)
  }
  return [...by.values()].sort((a, b) => a.milestone - b.milestone)
}

export function meterOf(status, scoped = null) {
  const phases = scoped || trackedPhases(status)
  if (!phases.length) return null
  const done = phases.filter(p => p && p.status === 'complete').length
  const cells = Math.min(phases.length, METER_MAX)
  const filled = Math.round((done / phases.length) * cells)
  return { done, total: phases.length, bar: '▰'.repeat(filled) + '▱'.repeat(cells - filled) }
}

const isOpen = p => p.status !== 'complete' && p.status !== 'rejected'
// a roadmap row with no ownership key counts as mine: work that cannot be attributed is never hidden
const isMineRow = p => p.mine !== false

/**
 * What the band shows (phase 58). Pure; anything it cannot read fails open to `full`.
 *
 * - `full`: `status.registry` is not `true` (the registry ref was unreadable, so ownership is
 *   unknown): exactly today's tracked phases and no count line.
 * - `branch`: at least one of my rows is tied to `branch` (a milestone-inherited tie included): only
 *   those rows, plus phases with a run in flight; `+N elsewhere` counts what today's band would have
 *   tracked and this one does not.
 * - `mine`: any other branch (develop, main, detached, nothing of mine tied, deleted upstream): my open
 *   rows across every milestone, plus phases with a run in flight; `+N by others` counts the open rows
 *   that are someone else's. Same with git flow off.
 *
 * `title` is the milestone number to show (or null). `branch` falls back to `status.branch`.
 */
export function scopeOf(status, { branch, runs = [] } = {}) {
  const baseline = trackedPhases(status, runs)
  const fallbackTitle = status && status.milestone != null ? status.milestone : null
  if (!status || status.registry !== true) return { mode: 'full', visible: baseline, hidden: null, title: fallbackTitle }
  const here = typeof branch === 'string' && branch ? branch : (typeof status.branch === 'string' && status.branch ? status.branch : null)
  const phases = Array.isArray(status.phases) ? status.phases.filter(p => p && typeof p.number === 'number') : []
  const running = p => runs.some(r => r.phase === p.number)
  const tied = here ? phases.filter(p => isMineRow(p) && p.feature_branch === here) : []
  let mode = 'mine'
  let visible
  let hidden = null
  if (tied.length) {
    mode = 'branch'
    visible = phases.filter(p => tied.includes(p) || running(p))
    const n = baseline.filter(p => !visible.includes(p)).length
    if (n > 0) hidden = { label: 'elsewhere', count: n }
  } else {
    visible = phases.filter(p => running(p) || (isMineRow(p) && isOpen(p)))
    const n = phases.filter(p => p.mine === false && isOpen(p) && !visible.includes(p)).length
    if (n > 0) hidden = { label: 'by others', count: n }
  }
  const viaMilestone = visible.find(p => p.tied_by === 'milestone' && p.milestone != null)
  const ms = new Set(visible.map(p => p.milestone).filter(m => m != null))
  const title = viaMilestone ? viaMilestone.milestone : ms.size === 1 ? [...ms][0] : fallbackTitle
  return { mode, visible, hidden, title }
}

// the one button a scoped band falls back to, mirroring `ac`'s nextAction for the first open visible row
function derivedButton(visible) {
  const p = [...visible].filter(isOpen).sort((a, b) => a.number - b.number)[0]
  if (!p) return null
  const verb = p.status === 'verified' ? 'accept' : p.status === 'executing' ? 'execute'
    : p.status === 'pending' ? (p.planned ? 'execute' : p.discussed ? 'plan' : 'discuss') : null
  return verb ? { key: `/astro-${verb} ${p.number}`, label: `${cap(verb)} ${p.number}`, command: `/astro-${verb} ${p.number}` } : null
}

const ROLE = { 'astro-executor': 'executor', 'astro-verifier': 'verifier', 'astro-researcher': 'researcher', 'astro-planner': 'planner', 'astro-criteria-author': 'criteria author', 'astro-mapper': 'mapper', 'astro-integrator': 'integrator' }
const KIND = { 'astro-execute-phase': 'execute', 'astro-plan-phase': 'plan' }
const COLLAPSE_DONE = 3 // more finished phases than this fold into one `✓ N done` chip

/** `{kind, phase}` for a Workflow call astro-code started, from its result's name and its args; else null. */
export function runOf(workflowName, args) {
  const kind = KIND[workflowName]
  if (!kind) return null
  const m = /^(\d+)/.exec(String(args && typeof args === 'object' ? args.phase ?? '' : ''))
  return { kind, phase: m ? Number(m[1]) : null }
}

/** The task id a task-notification's text names, and how it ended; null when it names none. */
export function notifiedTask(text) {
  const id = /<task-id>([^<\s]+)<\/task-id>/.exec(String(text))
  if (!id) return null
  const status = /<status>([^<\s]+)<\/status>/.exec(String(text))
  return { taskId: id[1], status: status ? status[1] : null }
}

/** `2 researchers · 1 planner`, from a run's live agent types; `starting` with none live. */
export function crewOf(types) {
  const counts = new Map()
  for (const t of types) {
    const role = ROLE[t] || 'agent'
    counts.set(role, (counts.get(role) || 0) + 1)
  }
  if (!counts.size) return 'starting'
  return [...counts].map(([role, n]) => `${n} ${role}${n === 1 ? '' : 's'}`).join(' · ')
}

/** One roadmap chip per phase: its glyph and tone from its state and from what is running on it. */
function chipOf(p, runs, current) {
  const running = runs.find(r => r.phase === p.number)
  let glyph = '○'
  let tone = 'chip:todo'
  if (running) [glyph, tone] = running.kind === 'execute' ? ['⚙', 'chip:executing'] : ['✎', 'chip:planning']
  else if (p.status === 'complete') [glyph, tone] = ['✓', 'chip:done']
  else if (p.status === 'verified') [glyph, tone] = ['◉', 'chip:verified']
  else if (p.status === 'rejected') [glyph, tone] = ['✗', 'chip:rejected']
  else if (p.status === 'executing') [glyph, tone] = ['⚙', 'chip:executing']
  else if (p.planned) [glyph, tone] = ['▸', 'chip:planned']
  else if (p.discussed) [glyph, tone] = ['◌', 'chip:discussed']
  // `○84(a)`: a teammate's phase, tagged with who; one not merged into this roadmap yet is dimmed.
  if (p.remote && !running) tone = 'chip:todo'
  // `owner` is now the claim's full email; only the short tag (set on rows that are not mine) is drawn
  return { text: `${glyph}${p.number}${p.owner_tag ? `(${p.owner_tag})` : ''}`, tone, current: p.number === current }
}

function roadmapRow(status, runs, phases = trackedPhases(status, runs), empty = 'no phases on the roadmap') {
  if (!phases.length) return [{ text: empty, tone: 'note' }]
  const current = status.phase ? status.phase.number : null
  const done = phases.filter(p => p.status === 'complete' && !runs.some(r => r.phase === p.number))
  const shown = done.length > COLLAPSE_DONE ? phases.filter(p => !done.includes(p)) : phases
  const out = done.length > COLLAPSE_DONE ? [{ text: `✓ ${done.length} done`, tone: 'chip:done' }] : []
  for (const p of shown) {
    if (out.length) out.push({ text: '  ', tone: 'sep' })
    out.push(chipOf(p, runs, current))
  }
  return out
}

function runningRow(status, runs, live) {
  const out = []
  for (const r of runs) {
    if (out.length) out.push({ text: '   ', tone: 'sep' })
    const icon = r.kind === 'execute' ? '⚙' : '✎'
    out.push({ text: `${icon} ${r.kind}${r.phase == null ? '' : ` ${r.phase}`}`, tone: r.kind === 'execute' ? 'run:execute' : 'run:plan' })
    out.push({ text: ` · ${crewOf(r.agents)}`, tone: 'sep' })
  }
  // an Agent-tool executor or verifier, or a live verb no tracked run accounts for
  for (const a of live && Array.isArray(live.agents) ? live.agents : []) {
    if (out.length) out.push({ text: '   ', tone: 'sep' })
    out.push({ text: a.name, tone: 'id' }, { text: ' — ', tone: 'sep' }, { text: a.state, tone: `agent:${a.state}` })
  }
  if (!out.length && status.activity) out.push({ text: status.activity, tone: 'activity' })
  return out
}

/**
 * The band, as rows: `ROADMAP` (the current milestone's phases as chips, rejected ones hidden),
 * `OTHER` (other milestones still holding work), `RUNNING` (each astro
 * workflow run in flight with its live crew, then any Agent-tool agent, else the live verb) and
 * `NEXT` (the buttons, or a hint). `lines` holds each content row's text, the label included, so
 * a reader (or a test) can take the band in as plain text. `runs` is `[{kind, phase, agents}]`.
 */
export function bandView(status, live, { unavailable, runs = [], lists = null, branch = null } = {}) {
  if (unavailable) {
    const text = `astro-code status unavailable (${String(unavailable).slice(0, REASON_MAX)})`
    return view([[{ text, tone: 'unavailable' }]], [], null, null, status)
  }
  if (status == null) return view([], [], null, null, status)
  const scope = scopeOf(status, { branch, runs })
  const scoped = scope.mode !== 'full'
  const rows = [[{ text: 'ROADMAP  ', tone: 'label' }, ...(scoped ? roadmapRow(status, runs, scope.visible, 'nothing open of yours here') : roadmapRow(status, runs))]]
  // one dim line for what the scope hides, directly under ROADMAP; never one per phase
  if (scope.hidden && scope.hidden.count > 0) rows.push([{ text: `         +${scope.hidden.count} ${scope.hidden.label}`, tone: 'note' }])
  // `M2 4 open · M4 6 to accept, 2 open`: other milestones still holding work, apart from the
  // roadmap row so it stays the current milestone alone.
  // (full mode only: a scoped band already spans milestones, and OTHER tallies teammates' work)
  const open = scoped ? [] : openMilestones(status)
  if (open.length) {
    const other = []
    for (const o of open) {
      if (other.length) other.push({ text: ' · ', tone: 'sep' })
      const bits = [o.verified ? `${o.verified} to accept` : '', o.open ? `${o.open} open` : ''].filter(Boolean)
      other.push({ text: `M${o.milestone}`, tone: 'id' }, { text: ` ${bits.join(', ')}`, tone: 'note' })
    }
    rows.push([{ text: 'OTHER    ', tone: 'label' }, ...other])
  }
  // `DEFERRED  <fix id> 54 C2`: open fixes a human deferred a criterion into (phase 54, D3). The key is
  // `deferred_fixes` from `ac status --json`; absent or empty draws no row.
  const deferred = Array.isArray(status.deferred_fixes) ? status.deferred_fixes.filter(f => f && typeof f.id === 'string') : []
  if (deferred.length) {
    const row = []
    for (const f of deferred) {
      if (row.length) row.push({ text: ' · ', tone: 'sep' })
      const n = /^(\d+)/.exec(String(f.phase ?? ''))
      row.push({ text: f.id, tone: 'id' }, { text: ` ${[n ? n[1] : f.phase, f.criterion].filter(Boolean).join(' ')}`, tone: 'note' })
    }
    rows.push([{ text: 'DEFERRED ', tone: 'label' }, ...row])
  }
  // `FULL CHECK pending 57 58`: phases verified in fast mode that no passing milestone full check covers yet
  // (phase 57, ADR-094). The key is `full_check_pending` (phase numbers) from `ac status --json`; absent or
  // empty draws no row.
  const pending = Array.isArray(status.full_check_pending) ? status.full_check_pending.filter(n => Number.isInteger(n)) : []
  if (pending.length) rows.push([{ text: 'FULL CHECK ', tone: 'label' }, { text: 'pending ', tone: 'note' }, { text: pending.join(' '), tone: 'id' }])
  const running = runningRow(status, runs, live)
  if (running.length) rows.push([{ text: 'RUNNING  ', tone: 'label' }, ...running])
  // `backlog 3 · debt 26 · fixes 2`, the last row: the open items of the lists the band already reads.
  // A list that could not be read is left out rather than shown as 0; none at all draws no row.
  const counts = [['backlog', lists?.backlog], ['debt', lists?.debt], ['fixes', lists?.fix]].filter(([, l]) => Array.isArray(l))
  if (counts.length) {
    const row = []
    for (const [name, l] of counts) {
      if (row.length) row.push({ text: ' · ', tone: 'sep' })
      row.push({ text: name, tone: 'note' }, { text: ` ${l.length}`, tone: 'id' })
    }
    rows.push([{ text: 'COUNTS   ', tone: 'label' }, ...row])
  }
  // a phase already being executed or planned is not offered again
  const busy = new Set(runs.map(r => `/astro-${r.kind} ${r.phase}`))
  const shown = scoped ? new Set(scope.visible.map(p => p.number)) : null
  let buttons = buttonsOf(status, shown).filter(b => !busy.has(b.command))
  if (scoped && !buttons.length) {
    const d = derivedButton(scope.visible)
    if (d && !busy.has(d.command)) buttons = [d]
  }
  const nextNumber = typeof status.next === 'string' ? /^\/astro-\w+ (\d+)$/.exec(status.next) : null
  const nextHidden = shown && nextNumber && !shown.has(Number(nextNumber[1]))
  const hint = typeof status.next === 'string' && status.next && !nextHidden && !busy.has(status.next) && !buttons.some(b => b.command === status.next) ? status.next : null
  return view(rows, buttons, scoped ? meterOf(status, scope.visible) : meterOf(status), hint, status, scope.title)
}

function view(parts, buttons, meter, hint, status, milestone) {
  const m = milestone === undefined ? (status && status.milestone != null ? status.milestone : null) : milestone
  const title = m != null ? `M${m}` : null
  const version = status && typeof status.version === 'string' && status.version ? status.version : null
  return { lines: parts.map(p => p.map(t => t.text).join('')), parts, buttons, meter, hint, title, version }
}

function stateOf(status) {
  const s = String(status || '').toLowerCase()
  if (/^(completed?|done|succeeded|success|finished)$/.test(s)) return 'done'
  if (/^(failed|error|errored|killed|cancelled|canceled|aborted)$/.test(s)) return 'failed'
  return 'running'
}

/** Normalise `$.agent.list()` rows to `{live, agents, source}`; never invents rows. */
export function liveFrom(agentRows, activity, workflowAgentsListed) {
  const agents = (Array.isArray(agentRows) ? agentRows : [])
    .filter(r => r && AGENT_TYPES.has(r.type))
    .map(r => ({ name: r.name || r.type, state: stateOf(r.status) }))
  const live = agents.some(a => a.state === 'running') || activity != null
  if (workflowAgentsListed) return { live, agents, source: 'agent.list' }
  return { live, agents: agents.length ? agents : null, source: 'activity' }
}

// ── git branch for the banner ─────────────────────────────────────────────────────────────────
// Read straight from `.git/HEAD` (no `git` process): phase-band.js finds the git dir once, then
// re-reads one small file at turn boundaries. A worktree's `.git` is a FILE (`gitdir: <path>`).
export const BRANCH_MAX = 28

/** `cwd/.git`, then each parent's, up to `/`. Pure path math. */
export function gitCandidates(cwd) {
  return rootCandidates(cwd).map((p) => p.slice(0, -'.astrocode'.length) + '.git')
}

/** The git dir a `.git` FILE points at (resolved against the file's dir), or `null`. */
export function gitdirFrom(text, dotGitPath) {
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(String(text ?? ''))
  if (!m) return null
  if (m[1].startsWith('/')) return m[1]
  const base = String(dotGitPath).slice(0, String(dotGitPath).lastIndexOf('/'))
  const parts = []
  for (const seg of `${base}/${m[1]}`.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg && seg !== '.') parts.push(seg)
  }
  return `/${parts.join('/')}`
}

/** `HEAD` contents → branch name (truncated to `max` cells), short sha when detached, else `null`. */
export function branchFrom(text, max = BRANCH_MAX) {
  const s = String(text ?? '').trim()
  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(s)
  if (ref) return ref[1].length > max ? `${ref[1].slice(0, max - 1)}…` : ref[1]
  return /^[0-9a-f]{40,64}$/i.test(s) ? s.slice(0, 7) : null
}
