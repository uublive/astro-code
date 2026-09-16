// astro-code · per-role REASONING level.
//
// Sibling to lib/models.mjs: that picks WHICH model runs a role, this picks how
// hard it thinks. The two are independent levers and both move cost — a cheap
// model at `xhigh` can outspend an expensive one at `low` — so a profile sets
// both together rather than leaving one silently at the host default.
//
// ## Not to be confused with lib/effort.mjs
//
// astro-code already has an `effort` dial (ADR-022): a PER-PHASE `light |
// standard | deep` budget for how many verify→remediate cycles a phase may
// burn. That is about repeating the loop; this is about a single agent's
// thinking depth. Two things both named "effort" in one config would be a
// permanent source of confusion, hence `reasoning`.
//
// ## Canonical levels, mapped per host
//
// Every host exposes this knob, with overlapping-but-different vocabularies:
//
//   Claude Code   low · medium · high · xhigh · max   (Workflow agent({effort}))
//   Codex CLI     none · low · medium · high · xhigh  (-c model_reasoning_effort)
//   Pi            off · minimal · low · medium · high · max  (--thinking)
//
// astro-code speaks one canonical vocabulary and each adapter maps it, exactly
// like TOOL_MAP in lib/hosts/render.mjs. Where a host lacks a level the mapping
// degrades to that host's ceiling rather than silently dropping the request —
// asking for maximum thinking and getting the default would be the worst
// outcome, since it is invisible.

export const REASONING_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/** Applied at the READ site when a role has no configured level, never
 *  backfilled into config — same discipline as DEFAULT_EFFORT. */
export const DEFAULT_REASONING = 'medium';

/**
 * Canonical level → each host's own value.
 *
 * Codex has no `max`: its ceiling is `xhigh`, so `max` maps there. Pi has no
 * `xhigh`: its ceiling is `max`, so `xhigh` maps there. Both are deliberate
 * ceiling-clamps, documented because a user asking for `max` on Codex should
 * understand they are getting Codex's most, not Claude's most.
 */
export const REASONING_MAP = Object.freeze({
  claude: Object.freeze({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }),
  codex: Object.freeze({ low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'xhigh' }),
  pi: Object.freeze({ low: 'low', medium: 'medium', high: 'high', xhigh: 'max', max: 'max' }),
});

/** Per-role reasoning for each model profile, mirroring MODEL_PROFILES' logic:
 *  spend on the roles whose judgement compounds, save on the mechanical ones. */
export const REASONING_PROFILES = Object.freeze({
  // Highest quality. The two brains that shape and gate a whole phase go to the
  // top; executors think hard because a bad implementation costs a re-run.
  // discover and integrator stay low — both are mechanical parsing/git work
  // where more thinking buys nothing (ADR-035 is about DISCIPLINE, not depth).
  max: Object.freeze({
    planner: 'xhigh', researcher: 'high', executor: 'high',
    verifier: 'xhigh', discover: 'low', integrator: 'low',
  }),
  // Daily driver: depth where a mistake propagates, medium elsewhere.
  balanced: Object.freeze({
    planner: 'high', researcher: 'medium', executor: 'medium',
    verifier: 'high', discover: 'low', integrator: 'low',
  }),
  // Fast: low everywhere EXCEPT the verify gate, which keeps `high` for the
  // same reason it keeps opus under the fast model profile — speed must never
  // silently cost correctness at the gate.
  fast: Object.freeze({
    planner: 'low', researcher: 'low', executor: 'low',
    verifier: 'high', discover: 'low', integrator: 'low',
  }),
});

/** Strict: a typo'd level must fail loud on the WRITE path so it never lands in
 *  config. Mirrors validateEffort. */
export function validateReasoning(level) {
  if (!REASONING_LEVELS.includes(level)) {
    throw new Error(
      `unknown reasoning level "${level}" — choose one of: ${REASONING_LEVELS.join(', ')}`,
    );
  }
  return level;
}

/** Lenient: an absent or stale/unknown level normalizes to the default, so an
 *  older config keeps working instead of crashing the loop. */
export function resolveReasoning(stored) {
  return REASONING_LEVELS.includes(stored) ? stored : DEFAULT_REASONING;
}

/** A fresh copy of a named profile's per-role reasoning map. Throws on an
 *  unknown name, matching profileModels. */
export function profileReasoning(name) {
  const p = REASONING_PROFILES[name];
  if (!p) {
    throw new Error(
      `unknown model profile "${name}" — choose one of: ${Object.keys(REASONING_PROFILES).join(', ')}`,
    );
  }
  return { ...p };
}

/**
 * Translate a canonical level into what a host actually accepts.
 *
 * An unknown host id passes the canonical value through: a new adapter that
 * forgets to register a mapping gets astro-code's vocabulary rather than
 * nothing, which fails visibly at the CLI instead of silently running at the
 * host default.
 */
export function hostReasoning(level, hostId) {
  const table = REASONING_MAP[hostId];
  const canonical = resolveReasoning(level);
  return table ? table[canonical] : canonical;
}
