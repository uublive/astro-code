// astro-code · model-tier profiles.
//
// A profile is a complete per-role tier map applied in one shot, so "go faster"
// is a single switch (`ac models fast`) instead of hand-tuning six config keys.
// The ladder is opus → sonnet for EVERY role. haiku is excluded everywhere —
// including `integrator`, whose ADR-027 carve-out is now REVERTED by ADR-035.
//
// Why the carve-out was wrong: it argued the integrator is "mechanical git with
// no quality-critical decision left to get wrong". Benchmark #2 showed the
// premise was inverted. haiku's cherry-pick JUDGEMENT was in fact sound — its
// per-branch stale/clean classification was correct and well-argued. What it got
// wrong was discipline and conformance in the one role with the largest
// destructive surface in the system: it ran a bare `git stash -u` in the SHARED
// working tree and never popped it, destroying a completed phase plan; and it
// filled the `branches` field with the target branch instead of the sources,
// aborting a phase whose work had actually integrated fine.
//
// The saving never justified that risk: `executor` is already sonnet under both
// balanced and fast, so the carve-out bought one cheap agent per wave and cost a
// destroyed plan and a dead phase. Speed comes from moving roles opus→sonnet,
// never from dropping any role to haiku.
//
// Roles: planner (synthesizes PLAN.md — quality compounds across the phase),
// researcher (parallel investigation), executor (implements one task each —
// the numerous, longest-running agents, so the biggest wall-clock lever),
// verifier (goal-backward gate — a false PASS is the costliest error),
// discover (mechanical task/dependency parsing), integrator (folds each wave onto
// the branch — the ONLY role that runs destructive git in the shared tree, which
// is why it is not a cheap-tier candidate; ADR-035).

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
    integrator: 'sonnet',
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
    integrator: 'sonnet',
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
