// Read and atomically mutate .planning/state.json under a lock so parallel
// agents can update project state without clobbering each other.
import { paths } from './paths.mjs';
import { readJSON, atomicWriteJSON, withLock } from './util.mjs';

export function loadState(root) {
  return readJSON(paths(root).state);
}

export async function updateState(root, mutate) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const state = readJSON(p.state) || {};
    const next = mutate({ ...state }) || state;
    next.updated_at = new Date().toISOString();
    atomicWriteJSON(p.state, next);
    return next;
  });
}
