// astro-code · per-phase effort dial (ADR-022).
//
// A phase's `effort` level tunes how much QUOTA the verify→remediate loop is
// allowed to burn — deep treatment for critical phases, light for routine —
// WITHOUT touching the discuss→plan→execute→verify shape. Quota tokens are the
// scarce resource, not time, so the whole budget goes into verify→remediate
// cycles (which provably converge) and NEVER into wider planning fan-outs:
// research stays 3 angles at every level. Automating the loop is only safe
// because ADR-021 made the verifier's PASS/FAIL trustworthy.
//
// Two paths read this table with DELIBERATELY different strictness:
//   - the WRITE path (`ac phase effort <n> <level>`) is strict — a typo'd level
//     must fail loud (`validateEffort`) so a bogus value never lands in the
//     roadmap (C1);
//   - the READ/resolve path (execute-phase, `ac phase effort <n>`) is lenient —
//     an absent or stale/unknown level normalizes to the `standard` budget
//     (`effortKnobs`/`resolveEffort`), so an old roadmap with no `effort` field
//     stays backward-compatible instead of crashing the loop (C3).
//
// `effort` is an ADDITIVE per-phase roadmap field with a HARDCODED `standard`
// default applied at the read site — there is NO global/config effort knob
// (deep is a deliberate per-phase choice — ADR-022 / C8).

export const EFFORT_LEVELS = ['light', 'standard', 'deep'];

// Hardcoded default applied at the READ site (`ph.effort ?? DEFAULT_EFFORT`);
// never backfilled into stored roadmap entries, never sourced from config.
export const DEFAULT_EFFORT = 'standard';

// Level → knob table. Frozen so the READ path can spread fresh copies without a
// caller ever corrupting the shared constant. `maxCycles` is the ceiling on
// verify→remediate cycles the loop may run (the loop still bails early on
// stop-on-no-progress); `tier` (when present) forces a model tier for that phase.
export const EFFORT_KNOBS = Object.freeze({
  // light = 0 cycles: a single pass = today's behavior. Verify once; a FAIL
  // stops for a human. The fast lane (`/astro-alex`) and off-the-cuff routine
  // work live here — speed over depth, spend no remediation quota.
  light: Object.freeze({ maxCycles: 0 }),
  // standard (default) = up to 1 cycle: one automated remediate→re-verify round
  // catches the common near-miss without grinding quota on a stuck approach.
  standard: Object.freeze({ maxCycles: 1 }),
  // deep = up to 3 cycles AND opus tier for execute+verify that phase: reserve
  // the scarce quota for the critical phases where convergence is worth it. The
  // opus escalation is in-memory only and never persists config (C4).
  deep: Object.freeze({ maxCycles: 3, tier: 'opus' }),
});

/**
 * Assert `level` is a known effort level, throwing loud otherwise.
 *
 * Used by the strict WRITE path so a typo'd level fails non-zero with the valid
 * choices instead of silently landing a bogus value in roadmap.json (C1).
 * Mirrors `profileModels`'s throw shape.
 *
 * @param {string} level  one of EFFORT_LEVELS
 * @returns {string} the validated level (for convenient inline use)
 */
export function validateEffort(level) {
  if (!EFFORT_LEVELS.includes(level)) {
    throw new Error(`unknown effort level "${level}" — choose one of: ${EFFORT_LEVELS.join(', ')}`);
  }
  return level;
}

/**
 * Return a FRESH copy of a level's knobs, NORMALIZING absent/unknown → standard.
 *
 * This is the lenient READ path: a phase with no `effort` field, or a stale
 * level from an older roadmap, resolves to the `standard` budget (maxCycles:1)
 * rather than throwing — keeping the loop decidable and backward-compatible (C3).
 * A new object each call so callers can mutate without corrupting EFFORT_KNOBS.
 *
 * @param {string} [level]  an effort level (or absent/unknown)
 * @returns {{maxCycles:number, tier?:string}}
 */
export function effortKnobs(level) {
  const knobs = EFFORT_KNOBS[level] || EFFORT_KNOBS[DEFAULT_EFFORT];
  return { ...knobs };
}

/**
 * Resolve the effective effort level: precedence `override > stored > default`.
 *
 * The one-off `--effort` override (a single read, never persisted) wins; then
 * the stored per-phase level; then the hardcoded `standard`. Every candidate is
 * normalized to a valid level (an invalid/absent one is skipped), and NO config
 * is consulted — there is no global effort knob (C5, C8).
 *
 * @param {string} [stored]    the phase's stored `effort` field (may be absent)
 * @param {string} [override]  a one-off `--effort` flag (may be absent)
 * @returns {string} a valid effort level
 */
export function resolveEffort(stored, override) {
  for (const candidate of [override, stored]) {
    if (EFFORT_LEVELS.includes(candidate)) return candidate;
  }
  return DEFAULT_EFFORT;
}

/**
 * Return a FRESH per-role tier map with `deep` escalated to opus.
 *
 * `deep` forces the executor and verifier to `opus` for that phase only — the
 * two roles whose quality most affects convergence — while every other level
 * passes the base tiers through untouched. Never mutates the input map and never
 * persists config: the escalation is in-memory for the phase run only (C4).
 *
 * @param {Record<string,string>} models  the base per-role tier map
 * @param {string} level                  the effective effort level
 * @returns {Record<string,string>} a new tier map
 */
export function effortModels(models, level) {
  const out = { ...models };
  if (level === 'deep') {
    out.executor = 'opus';
    out.verifier = 'opus';
  }
  return out;
}
