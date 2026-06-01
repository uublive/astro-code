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

// Per-role model tiers ("opus" | "sonnet" | "haiku"). An unset role means
// "inherit the session model" — workflows pass undefined and the agent inherits.
export function resolveModels(root) {
  return loadConfig(root).models || {};
}
