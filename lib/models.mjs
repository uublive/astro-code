// astro-code · model-tier profiles.
//
// A profile is a complete per-role tier map applied in one shot, so "go faster"
// is a single switch (`ac models fast`) instead of hand-tuning five config keys.
// The ladder is opus → sonnet ONLY — haiku is deliberately excluded everywhere
// (its quality was judged too low for this project). Speed comes from moving
// roles opus→sonnet, never from dropping to haiku.
//
// Roles: planner (synthesizes PLAN.md — quality compounds across the phase),
// researcher (parallel investigation), executor (implements one task each —
// the numerous, longest-running agents, so the biggest wall-clock lever),
// verifier (goal-backward gate — a false PASS is the costliest error),
// discover (mechanical task/dependency parsing).

export const PROFILE_NAMES = ['max', 'balanced', 'fast'];

export const MODEL_PROFILES = {
  // Every role on opus — highest quality, slowest. No speed compromise at all.
  max: {
    planner: 'opus',
    researcher: 'opus',
    executor: 'opus',
    verifier: 'opus',
    discover: 'opus',
  },
  // Default daily-driver: opus for the two quality-critical brains (the plan
  // shapes the whole phase; the verify gate must not false-PASS), sonnet for the
  // bulk roles. No haiku.
  balanced: {
    planner: 'opus',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
  },
  // Fast: push everything to sonnet EXCEPT the verify gate, which stays opus so
  // speed can never silently cost correctness — the gate still runs the full test
  // suite at full quality. The win over `balanced` is planner opus→sonnet (and the
  // executors are already sonnet, so phases dominated by execution shrink most).
  fast: {
    planner: 'sonnet',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
  },
};

/**
 * Return a fresh copy of a named profile's per-role tier map.
 *
 * Returns a NEW object each call so callers can mutate/merge without corrupting
 * the shared constant. Throws on an unknown name (with the valid choices) rather
 * than silently returning undefined — a typo'd profile should fail loud, not
 * quietly leave models unset.
 *
 * @param {string} name  one of PROFILE_NAMES
 * @returns {{planner:string, researcher:string, executor:string, verifier:string, discover:string}}
 */
export function profileModels(name) {
  const p = MODEL_PROFILES[name];
  if (!p) {
    throw new Error(`unknown model profile "${name}" — choose one of: ${PROFILE_NAMES.join(', ')}`);
  }
  return { ...p };
}
