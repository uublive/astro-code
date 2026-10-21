// Once-per-project-per-tool memory of the mutation-tool install suggestion (phase 47, P2/P3).
//
// Why it exists: D3 — a missing tool is suggested in full ONCE, then at most a one-line
// reminder, so verification never nags. The memory is a LOCAL file
// (`.astrocode/.local/mutate-notices.json`), shaped `{ "<tool>": { shown_at, dismissed } }`:
// whether a developer has been told is per machine, so it is not committed and not shared
// state (no `transact`). The directory ships its own `.gitignore` (`*`) so it is ignored in
// every project without lib touching the root `.gitignore` (ADR-048).
//
// Reads are total: missing, corrupt or wrong-shape reads as "never shown" (6105). The
// reminder text lives here and only here (9173).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { withLock, atomicWriteJSON, atomicWriteText } from './util.mjs';

export const REMINDER = 'mutation tool not installed — AI mutants used';

/** Total: never throws. Entries of the wrong shape are dropped. */
export function readNotices(root) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(paths(root).mutateNotices, 'utf8'));
  } catch {
    return {};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [tool, e] of Object.entries(raw)) {
    if (e && typeof e === 'object' && !Array.isArray(e)
        && typeof e.shown_at === 'string' && typeof e.dismissed === 'boolean') {
      out[tool] = e;
    }
  }
  return out;
}

/** Pure: `'full'` until the tool was shown or dismissed, `'reminder'` after. */
export function noticeFor(notices, tool) {
  const e = notices?.[tool];
  return e && (e.dismissed || e.shown_at) ? 'reminder' : 'full';
}

async function update(root, tool, patch) {
  const p = paths(root);
  return withLock(p.lock, () => {
    const gi = join(p.local, '.gitignore');
    if (!existsSync(gi)) atomicWriteText(gi, '*\n');
    const notices = readNotices(root);
    const prior = notices[tool] ?? { shown_at: new Date().toISOString(), dismissed: false };
    notices[tool] = { ...prior, ...patch(prior) };
    atomicWriteJSON(p.mutateNotices, notices);
  });
}

/** Record that the full suggestion was printed. Keeps an earlier `shown_at` and dismissal. */
export const markShown = (root, tool) => update(root, tool, (e) => ({ shown_at: e.shown_at }));

/** Record a dismissal: the reminder from now on, even if the full text was never shown. */
export const dismiss = (root, tool) => update(root, tool, () => ({ dismissed: true }));
