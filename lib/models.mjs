// astro-code · model-tier profiles.
//
// A profile is a complete per-role tier map applied in one shot, so "go faster"
// is a single switch (`ac models fast`) instead of hand-tuning six config keys.
// The ladder is opus → sonnet for every JUDGEMENT role — haiku is deliberately
// excluded from all of them (its quality was judged too low for this project).
// `integrator` is the single documented exception (ADR-027): mechanical git
// bookkeeping with a schema-pinned return, stamp-based branch→task mapping, a
// cross-checked destructive verb, and the executor-tier heal ladder as a
// backstop, so the cheap tier has no quality-critical decision left to get
// wrong. Speed comes from moving judgement roles opus→sonnet, never from
// dropping THEM to haiku.
//
// Roles: planner (synthesizes PLAN.md — quality compounds across the phase),
// researcher (parallel investigation), executor (implements one task each —
// the numerous, longest-running agents, so the biggest wall-clock lever),
// verifier (goal-backward gate — a false PASS is the costliest error),
// discover (mechanical task/dependency parsing), integrator (mechanical
// wave-fold — the sole haiku-tier role, ADR-027).

export const PROFILE_NAMES = ['max', 'balanced', 'fast'];

export const MODEL_PROFILES = {
  // Every judgement role on opus — highest quality, slowest. `integrator` stays
  // sonnet, deliberately NOT opus: opus on a cherry-pick is waste, and sonnet
  // already escapes haiku (ADR-027).
  max: {
    planner: 'opus',
    researcher: 'opus',
    executor: 'opus',
    verifier: 'opus',
    discover: 'opus',
    integrator: 'sonnet',
  },
  // Default daily-driver: opus for the two quality-critical brains (the plan
  // shapes the whole phase; the verify gate must not false-PASS), sonnet for the
  // bulk roles. `integrator` is the sole haiku-tier role (ADR-027) — mechanical
  // git bookkeeping, not judgement.
  balanced: {
    planner: 'opus',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
    integrator: 'haiku',
  },
  // Fast: push everything to sonnet EXCEPT the verify gate, which stays opus so
  // speed can never silently cost correctness — the gate still runs the full test
  // suite at full quality. The win over `balanced` is planner opus→sonnet (and the
  // executors are already sonnet, so phases dominated by execution shrink most).
  // `integrator` stays haiku (ADR-027) — a profile switch cannot leave it unset.
  fast: {
    planner: 'sonnet',
    researcher: 'sonnet',
    executor: 'sonnet',
    verifier: 'opus',
    discover: 'sonnet',
    integrator: 'haiku',
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
 * @returns {{planner:string, researcher:string, executor:string, verifier:string, discover:string, integrator:string}}
 */
export function profileModels(name) {
  const p = MODEL_PROFILES[name];
  if (!p) {
    throw new Error(`unknown model profile "${name}" — choose one of: ${PROFILE_NAMES.join(', ')}`);
  }
  return { ...p };
}
