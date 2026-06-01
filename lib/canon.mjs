// Project canon: the durable rules new code must obey (CONVENTIONS.md) and the
// append-only decision log (DECISIONS.md). This is prescriptive and always-on —
// the plan/execute workflows inject it into every agent so parallel agents and
// multiple developers stay architecturally consistent.
import { readFileSync, existsSync } from 'node:fs';
import { paths } from './paths.mjs';
import { atomicWriteText, withLock } from './util.mjs';

export function loadCanon(root) {
  const p = paths(root);
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '');
  return { conventions: read(p.conventions), decisions: read(p.decisions) };
}

// Single string suitable for injecting into an agent prompt.
export function canonText(root) {
  const { conventions, decisions } = loadCanon(root);
  return [conventions, decisions].filter(Boolean).join('\n\n');
}

function nextAdrNumber(text) {
  const headers = text.match(/^##\s+ADR-(\d+)/gm) || [];
  const max = headers.reduce((m, h) => Math.max(m, Number(h.match(/(\d+)/)[1])), 0);
  return max + 1;
}

// Append an ADR-lite entry. Lock-guarded + atomic so concurrent agents can record
// decisions without clobbering the log.
export async function addDecision(root, { title, why = '', rejected = '', date }) {
  const p = paths(root);
  if (!title) throw new Error('decision requires a title');
  return withLock(p.lock, () => {
    const existing = existsSync(p.decisions) ? readFileSync(p.decisions, 'utf8') : '';
    const id = `ADR-${String(nextAdrNumber(existing)).padStart(3, '0')}`;
    const when = date || new Date().toISOString().slice(0, 10);
    const entry =
      `\n## ${id} — ${title}\n_${when}_\n\n` +
      (why ? `**Why:** ${why}\n\n` : '') +
      (rejected ? `**Rejected:** ${rejected}\n\n` : '');
    atomicWriteText(p.decisions, (existing.trimEnd() + '\n' + entry).trimStart());
    return { id, title, date: when };
  });
}
