// brief-section -- the principles brief as ONE cached system-prompt section (phase 42, ADR-071).
//
// Why one section: today the brief reaches the model as four SessionStart hook outputs, split to
// stay under the 10k additionalContext cap (#116), plus a PreCompact re-injection of the position.
// A system-prompt section has no such cap and is cached with the prompt (PROBE.md F16), so on
// Claude the whole brief and a one-line position travel as a single `astro-mods:brief` section that
// survives /compact, /clear and /reload-plugins (F15).
//
// Why exact match: settings.json is untouched, so Cursor and Codex keep their hooks (ADR-072) and
// the hooks still run inside Claude. Their output is dropped here, by content, never by position
// or similarity (F3, F4): an entry goes only when it is byte-equal to a part `ac mods feed
// brief-section` says the hooks print. The model then reads the brief exactly once, a foreign hook
// quoting a brief line is kept, and the update banner (`systemMessage`, F6) is unreachable.
//
// The served/dropped invariant: an output is dropped ONLY while the section is served, and a section
// is served only if the fetch succeeded. Once something has been dropped the section stays even if
// failOpen switches the mods off, otherwise the model would hold ZERO copies. Before any drop, a
// failure removes the section and the hooks deliver as today (CONTEXT decision 5).
//
// Reads go through `ac` only (rule c). The feature's own failures are caught here, make no section,
// drop nothing, tell the user once, and leave the other mods' switches alone (rule e); only a
// malformed event throws into register.js's `.catch(failOpen)`.
//
// Order: classic.SessionStart can run BEFORE session.start (F20, `-p`), and session.start fires only
// once per process (F21). The two are ONE startup whichever comes first: the first starts a load
// (the switches, then the fetch) and names the other its `partner`, which then awaits that same
// load instead of fetching again. The claim is made before the first await, so two that overlap
// still share one load. The position is read at prompt.compose, not turn.start, which can run a
// turn late (F18), and the compose answer is not held across turns (F17), so the section text is
// one module variable, rebuilt only when the position really changes.
//
// Only a classic.SessionStart of a process start (source startup or resume) can be a partner (F7,
// F21); a compaction or /clear never is. A reload's session.start has no startup classic after it,
// so the compaction that follows must not take the reload's load for its own.
//
// Every other session.start and classic.SessionStart refetches: the store may have changed, and a
// stale part list would let the hooks' new output through next to the section. The bugs this
// prevents (phase 42 C3/C4): with classic first, session.start used to fetch again and mark ITS
// load as the startup's, so the next compaction reused it and missed a store change in between;
// and after a reload, the next compaction was taken for the reload's partner the same way.
// A /reload-plugins registers afresh and does not re-fire session.start (F21), so the next
// classic.SessionStart starts a load of its own; until then the hooks deliver.
import { AC } from '../lib/ac.js'
import { isOn, setSwitches, SWITCHES_ARGV, SWITCHES_TIMEOUT_MS } from '../lib/switches.js'
import { forgetTurn } from './witness.js'

export const FEATURE = 'brief-section'
export const SECTION_ID = 'astro-mods:brief'
export const BRIEF_ARGV = [...AC, 'principles', 'brief', '--stage', 'session', '--by', 'session']
export const FEED_ARGV = [...AC, 'mods', 'feed', 'brief-section']
export const POSITION_ARGV = [...FEED_ARGV, '--position']
// SWITCHES_TIMEOUT_MS (5 s) + FEED + BRIEF stay 1 s under session.start's 10 s budget (F19)
export const FEED_TIMEOUT_MS = 1500
export const BRIEF_TIMEOUT_MS = 2000
export const POSITION_TIMEOUT_MS = 1500

let loading = null // the latest load (a promise), or null before the first
let partner = null // 'session' | 'classic': the startup event that reuses `loading`; null once the pair met
let cwd = null
let parts = []
let position = ''
let brief = ''
let section = null // { id, text, scope } once served
let dropped = false // some astro output was already removed from what the model reads
let told = false

export function resetBriefSection() {
  loading = null
  partner = null
  cwd = null
  parts = []
  position = ''
  brief = ''
  section = null
  dropped = false
  told = false
}

function served() {
  return section !== null && (isOn(FEATURE) || dropped)
}

function build() {
  return { id: SECTION_ID, text: position ? `${brief}\n\n${position}` : brief, scope: 'session' }
}

function why(err) {
  return String((err && err.message) || err || 'unknown error').slice(0, 60)
}

/** Parse an `ac` read's JSON; a bad exit or non-JSON throws. */
function parseRun(ran) {
  if (ran.exitCode !== 0) throw new Error(`ac exited ${ran.exitCode}`)
  return JSON.parse(ran.stdout)
}

function notify($, text) {
  if (told) return
  told = true // set first: a toast that throws (no UI under -p) must not earn a second notice
  try {
    $.ui.toast(`astro-mods: ${text}`)
  } catch {
    // -p has no UI
  }
}

/** The once-per-registration fetch. Sets the state in ONE place, only after both reads succeeded. */
async function fetchAll($, dir) {
  if (!isOn(FEATURE)) return
  try {
    const feed = parseRun(await $.process.run(FEED_ARGV, { cwd: dir, timeoutMs: FEED_TIMEOUT_MS }))
    if (!feed || typeof feed.serve !== 'boolean') throw new Error('ac feed has no serve flag')
    if (!feed.serve) return // not an astro-code project, or the #116 opt-out: the hooks deliver
    if (!Array.isArray(feed.parts) || !feed.parts.every((p) => typeof p === 'string') || typeof feed.position !== 'string') {
      throw new Error('ac feed has an unexpected shape')
    }
    const ran = await $.process.run(BRIEF_ARGV, { cwd: dir, timeoutMs: BRIEF_TIMEOUT_MS })
    if (ran.exitCode !== 0) throw new Error(`ac exited ${ran.exitCode}`)
    const text = String(ran.stdout).trim()
    if (!text) throw new Error('ac printed an empty brief')
    cwd = dir
    parts = feed.parts.map((p) => p.trim()).filter(Boolean)
    brief = text
    position = feed.position.trim()
    section = build()
  } catch (err) {
    notify($, `brief-section off this session (${why(err)}) — the session hooks deliver the brief as before`)
  }
}

/** A startup's load: the switches (a failure throws into failOpen), then the fetch. */
async function startupLoad($, dir) {
  setSwitches(await $.process.run(SWITCHES_ARGV, { timeoutMs: SWITCHES_TIMEOUT_MS }))
  await fetchAll($, dir)
}

/** Re-read the position (one cheap `ac` call); rebuild the section only if it really changed. */
async function refreshPosition($) {
  try {
    const got = parseRun(await $.process.run(POSITION_ARGV, { cwd, timeoutMs: POSITION_TIMEOUT_MS }))
    if (!got || typeof got.position !== 'string') throw new Error('ac position has an unexpected shape')
    const next = got.position.trim()
    if (next !== position) {
      position = next
      section = build()
    }
  } catch (err) {
    notify($, `brief-section position not refreshed (${why(err)}) — the last one stays`)
  }
}

/**
 * session.start -- the plugin's ONE registration for it (F22). It lives here, not in register.js,
 * because `$` may not cross an import. It reads NO field of `e` but cwd (PROBE: cwd, surface,
 * isInteractive), reads the switches from `ac` and runs the brief fetch (or awaits the load an
 * earlier classic.SessionStart of the same startup began, which did both), and passes the event on.
 */
export async function sessionStart($, e, next) {
  forgetTurn()
  if (partner === 'session') {
    partner = null // classic.SessionStart of this startup got there first (F20): its load read the switches too
  } else {
    partner = 'classic'
    loading = startupLoad($, e.cwd)
  }
  await loading // only the switches read throws; the fetch's failures are the feature's own
  return next(e)
}

/** classic.SessionStart: drop the entries that are exactly the parts the hooks print. */
export async function briefSessionStart($, e, next) {
  const startup = e.source !== 'compact' && e.source !== 'clear' // only a process start pairs (F7)
  if (startup && partner === 'classic') {
    partner = null // session.start of this startup already started the load
  } else if (!loading) {
    partner = startup ? 'session' : null // classic ran before session.start (F20), or after a /reload-plugins (F21)
    loading = startupLoad($, e.cwd)
  } else {
    // a compaction or /clear: the hooks print the store as it is NOW, so the parts must be too
    partner = null
    loading = fetchAll($, e.cwd)
  }
  await loading
  const r = await next(e)
  if (!served() || !r || r.additionalContext === undefined) return r
  if (!Array.isArray(r.additionalContext)) throw new Error('additionalContext is not an array')
  const kept = r.additionalContext.filter((x) => !(typeof x === 'string' && parts.includes(x.trim())))
  if (kept.length === r.additionalContext.length) return r
  dropped = true
  return { ...r, additionalContext: kept }
}

/** prompt.compose: append the section LAST, with the position re-read first. */
export async function briefCompose($, e, next) {
  if (!served()) return next(e)
  await refreshPosition($)
  const r = await next(e)
  if (!r || !Array.isArray(r.sections)) throw new Error('prompt.compose answered no sections')
  return { ...r, sections: [...r.sections, section] }
}

/** The PreCompact note is a `command`-door row (F9): remove exactly the astro segment (F11). */
function stripSegment(text, pos) {
  const tail = ` completed successfully: ${JSON.stringify({ systemMessage: pos })}`
  const at = text.indexOf(tail)
  if (at < 0) return text
  const from = text.lastIndexOf('PreCompact [', at)
  if (from < 0) return text
  const to = at + tail.length
  if (text[to] === '\n') return text.slice(0, from) + text.slice(to + 1)
  if (from > 0 && text[from - 1] === '\n') return text.slice(0, from - 1) + text.slice(to)
  return text.slice(0, from) + text.slice(to)
}

/**
 * session.append: drop the PreCompact hook output equal to the freshly read position. The rewrite
 * is made on the INPUT row and handed to next(): `next(e)` resolves to the row as stored
 * ({ message, uuid }, no `door`), and a hook that relays another row is skipped (types).
 */
export async function briefAppend($, e, next) {
  if (!served() || !e || e.door !== 'command' || !e.message || !Array.isArray(e.message.content)) return next(e)
  const blocks = e.message.content
  if (!blocks.some((b) => b && typeof b.text === 'string' && b.text.includes('PreCompact ['))) return next(e)
  await refreshPosition($)
  if (!position) return next(e)
  let changed = false
  const content = blocks.map((b) => {
    if (!b || typeof b.text !== 'string') return b
    const text = stripSegment(b.text, position)
    if (text === b.text) return b
    changed = true
    return { ...b, text }
  })
  if (!changed) return next(e)
  dropped = true
  return next({ ...e, message: { ...e.message, content } })
}
