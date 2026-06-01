// Low-level filesystem helpers: atomic writes + a cross-process directory lock.
import { mkdirSync, rmSync, writeFileSync, renameSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJSON(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function atomicWriteText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, path); // atomic on the same filesystem
}

export function atomicWriteJSON(path, obj) {
  atomicWriteText(path, JSON.stringify(obj, null, 2) + '\n');
}

const LOCK_STALE_MS = 10_000;

// Mutual exclusion via mkdir (atomic create). Detects and reclaims stale locks
// left by a crashed process. Used to serialize read-modify-write on state/roadmap
// across parallel agents on the same machine.
export async function withLock(lockPath, fn, { retries = 200, intervalMs = 25 } = {}) {
  let held = false;
  for (let i = 0; i < retries; i++) {
    try {
      mkdirSync(lockPath);
      held = true;
      break;
    } catch {
      try {
        const ageMs = Date.now() - statSync(lockPath).mtimeMs;
        if (ageMs > LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch { /* lock vanished — retry immediately */ }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  if (!held) throw new Error(`could not acquire lock at ${lockPath}`);
  try {
    return await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}
