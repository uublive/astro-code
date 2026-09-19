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

/**
 * Read a JSON file, distinguishing ABSENT from UNREADABLE.
 *
 * `readJSON` collapses the two into one fallback, which is right for an optional
 * sidecar and wrong for a file that IS a record. A damaged record then reads as an
 * empty one — and an empty one is not an error message, it is a confident claim that
 * there is nothing there. Observed 2026-09-18: a stray `if ` on line 1 of
 * `.astrocode/debt.json` made `ac debt list` answer "no open debt" while sitting on
 * six filed items, with nothing anywhere saying the file had not been read. The
 * second half of that failure is worse than the first: the next write would have
 * serialized the empty fallback back over the six, so a read error becomes data loss.
 *
 * Returns `fallback` ONLY when the file genuinely does not exist — the lazily-created
 * case, which is a real empty. Anything else (malformed JSON, a permission error, a
 * directory where a file belongs) throws with the path and the reason.
 */
export function readJSONStrict(path, fallback = null, label = 'file') {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e?.code === 'ENOENT') return fallback;
    throw new Error(`cannot read ${label} ${path}: ${e?.message || e}`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${label} ${path} is damaged and was NOT read as empty: ${e?.message || e}\n`
      + `  Repair it, or restore the last good copy: git checkout -- ${path}`,
    );
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
