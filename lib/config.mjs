// Read and mutate .astrocode/config.json (project settings, including model tiers).
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export function loadConfig(root) {
  return readJSON(paths(root).config) || {};
}

export async function updateConfig(root, mutate) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const cfg = readJSON(p.config) || {};
    const next = mutate({ ...cfg }) || cfg;
    atomicWriteJSON(p.config, next);
    return next;
  });
}

// Per-role model tiers ("opus" | "sonnet" — haiku is excluded everywhere, ADR-035). An unset role means
// "inherit the session model" — workflows pass undefined and the agent inherits.
export function resolveModels(root) {
  return loadConfig(root).models || {};
}

// ADR-026: sequential phases with >=2 executable tasks batch onto ONE warm
// executor by default. Default true (via `!== false`) so projects predating
// this key — whose config.json never set it — stay on the fast batched path
// instead of silently reverting to the slower per-task cold-start behavior.
export function leanExecutionEnabled(root) {
  return loadConfig(root).lean_execution !== false;
}
