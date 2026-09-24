// Surprise-note engine (D3, P3): execute RECORDS what went sideways in a run, it never
// PROPOSES a principle from it. One surprise is an accident; only the milestone-close
// sweep (P5, `lib/harvest.mjs`) sees the same note recur across phases, and recurrence
// — not a single run — is the signal worth a human's attention. Proposing here would
// mean every remediation cycle mints a queue entry nobody asked for.
//
// Why JSONL, append-only: a phase can execute more than once (re-run after a fix, a
// remediation wave, a later heal). Overwriting the file on each run would discard
// exactly the recurrence the milestone sweep exists to find; appending keeps every
// run's note, in order, as plain history.
//
// Why the gate is a verb, not a prose instruction to the agent: ADR-036 — "the model
// should remember to check X before calling this" is a bet that eventually loses.
// `recordSurprise` is called UNCONDITIONALLY by `/astro-execute` with whatever the
// workflow observed, and `surpriseSignals` — not the caller — decides whether that
// adds up to a signal. A clean run always calls in, and always gets `written: false`.
//
// Why the writer and the harvest import the same `SURPRISES_FILE` constant: the two
// live in different modules (this one writes, `lib/harvest.mjs` reads) and must never
// be free to drift onto two different filenames — that would make every prior note
// silently invisible to the sweep.
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './paths.mjs';
import { withLock, atomicWriteText } from './util.mjs';
import { redactSecrets } from './redact.mjs';

export const SURPRISES_FILE = 'SURPRISES.jsonl';

const NOTE_MAX_CHARS = 300;

// Order is part of the contract (t1): healed, remediation, no-progress, max-cycles.
// `healed` may arrive as a count (`ac phase surprise --healed 2`) or an array (a
// workflow that already has the list) — either non-empty/non-zero form is a signal.
export function surpriseSignals({ healed, remediationCycles, stoppedReason } = {}) {
  const signals = [];

  const healedCount = Array.isArray(healed) ? healed.length : Number(healed) || 0;
  if (healedCount > 0) signals.push('healed');

  if (Number(remediationCycles) > 0) signals.push('remediation');

  if (stoppedReason === 'no-progress') signals.push('no-progress');
  if (stoppedReason === 'max-cycles') signals.push('max-cycles');

  return signals;
}

// Collapse arbitrary multi-line free text to one line and cap its length, AFTER
// redaction (lib/redact.mjs's module header: truncate-first could cut a matched
// secret in half and leave an unmasked fragment on disk).
function sanitizeNote(note) {
  if (!note) return undefined;
  const masked = redactSecrets(String(note)).replace(/\s+/g, ' ').trim();
  if (!masked) return undefined;
  return masked.length > NOTE_MAX_CHARS ? masked.slice(0, NOTE_MAX_CHARS) : masked;
}

// Never let a phase slug escape its own directory under `.astrocode/phases/`; a
// caller-supplied slug that carries a separator or `..` is a defect, not a phase to
// silently accept — it must throw before anything touches the filesystem.
function assertSafeSlug(slug) {
  if (!slug || slug.includes('/') || slug.includes('\\') || slug.includes('..')) {
    throw new Error(`invalid phase slug: ${slug}`);
  }
}

/**
 * Record one execute run's outcome for `slug`, if and only if it is a surprise
 * (P3/D3). No signal → `{ written: false }` and — deliberately — no directory, no
 * file: a clean run must leave zero trace, not an empty JSONL sitting next to a phase
 * that never surprised anyone.
 */
export async function recordSurprise(root, slug, {
  healed, remediationCycles, stoppedReason, note, now = new Date(),
} = {}) {
  assertSafeSlug(slug);

  const signals = surpriseSignals({ healed, remediationCycles, stoppedReason });
  if (signals.length === 0) return { written: false };

  const entry = {
    at: new Date(now).toISOString(),
    phase: slug,
    signals,
    ...(sanitizeNote(note) !== undefined ? { note: sanitizeNote(note) } : {}),
  };

  const p = paths(root);
  const file = join(p.phases, slug, SURPRISES_FILE);

  await withLock(p.lock, () => {
    let existing = '';
    if (existsSync(file)) existing = readFileSync(file, 'utf8');
    mkdirSync(join(p.phases, slug), { recursive: true });
    atomicWriteText(file, existing + JSON.stringify(entry) + '\n');
  });

  return { written: true, entry };
}

/**
 * Read a phase's surprise log. Absent file → empty, no error (most phases never
 * surprise). A line that fails to parse is counted in `damaged` and skipped, never
 * thrown — one corrupt line must not hide every good one either side of it.
 */
export function readSurprises(file) {
  if (!existsSync(file)) return { entries: [], damaged: 0 };

  const entries = [];
  let damaged = 0;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      entries.push(JSON.parse(s));
    } catch {
      damaged++;
    }
  }
  return { entries, damaged };
}
