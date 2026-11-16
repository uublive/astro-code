// The switches, as `ac` last said them this session -- and nothing else (ADR-071 rule c).
//
// This module reads no file and writes none. The only state the plugin has is the in-memory
// map below, filled by asking `ac` once at session.start (and again on every /reload-plugins,
// which fires session.start again). So a switch flipped with `ac mods enable|disable` is
// what the plugin sees on the next session.start, with no second copy to drift. `ac` is the
// only writer of the switches and the only reader of ~/.astro/config.json.
//
// `--switches-only` is the cheap read: it never spawns `claude`, so asking costs one `ac`
// start. The 5 s timeout stays under the bundled typings' session.start hook budget; an `ac`
// that is missing, slow or broken makes the call or setSwitches THROW, and the engine's
// `.catch` (failopen.js) turns that into a pass-through plus one notice -- with every switch off.
//
// The `$.process.run` call itself is spelled in register.js: the plugin validator follows `$`
// only into functions declared in the same file, never across an import, so this module takes
// the RESULT of the call and stays free of `$`.
//
// `machinePrefixes` rides in the same payload (ADR-081): the strings a tool of the user's own types
// at the head of a prompt. `ac` validates the list (lib/mods.mjs); this module only keeps what it
// was handed, behind a shape guard, and a bad or missing field means no prefixes and never touches
// the switches (fail soft). The match itself lives in machine.js.
import { AC } from './ac.js'

export const SWITCHES_ARGV = [...AC, 'mods', 'status', '--json', '--switches-only']
export const SWITCHES_TIMEOUT_MS = 5000

let state = {}
let prefixes = []

/** Take what `ac` answered. Starts from all-off, so a throw leaves every mod off. */
export function setSwitches(ran) {
  state = {}
  prefixes = []
  if (ran.exitCode !== 0) throw new Error(`ac exited ${ran.exitCode}`)
  let parsed
  try {
    parsed = JSON.parse(ran.stdout)
  } catch {
    throw new Error('ac printed output that is not JSON')
  }
  if (!parsed || typeof parsed.switches !== 'object' || parsed.switches === null) {
    throw new Error('ac printed no switches')
  }
  // only a literal `true` is on: anything else, a typo included, is off
  state = Object.fromEntries(Object.entries(parsed.switches).map(([name, on]) => [name, on === true]))
  // a shape guard, not the validity rule: anything but a list of non-empty strings is no prefixes
  const mp = parsed.machinePrefixes
  prefixes = Array.isArray(mp) && mp.every((p) => typeof p === 'string' && p !== '') ? [...mp] : []
}

/** The machine-typed prefixes `ac` handed over at session.start; `[]` when none or malformed. */
export function getPrefixes() {
  return prefixes
}

/** Is this feature switched on, as `ac` said it at session.start? Unknown names are off. */
export function isOn(name) {
  return state[name] === true
}

/** Every switch off -- a fresh registration, or a failure. */
export function resetSwitches() {
  state = {}
  prefixes = []
}
