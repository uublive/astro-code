// The project's AGENTS.md block — how astro-code explains itself to any agent,
// on any host.
//
// Claude Code gets continuous ambient context about where it is in the loop: a
// SessionStart banner, a PreCompact re-injection, and the status line. Codex
// gets none of that — its hook system requires a `trusted_hash` per hook, which
// astro-code will not forge on a user's behalf. So on every host except Claude,
// a static file read at session start IS the mechanism.
//
// AGENTS.md is the cross-host convention: Codex reads it (per-project and from
// its config home) and so does Pi. Claude Code reads CLAUDE.md for the same
// job, so when a CLAUDE.md exists the same block is mirrored there.
//
// ## Never clobber
//
// AGENTS.md is a file the USER owns and very likely already wrote. astro-code
// only ever manages the region between its markers, mirroring the convention
// lean-ctx uses in this very repo:
//
//     <!-- astro-code -->
//     ...managed...
//     <!-- /astro-code -->
//
// Everything outside the markers is untouched on every write. A file with no
// markers gets the block appended, never overwritten.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', 'templates');

export const BEGIN = '<!-- astro-code -->';
export const END = '<!-- /astro-code -->';

/** The managed block, markers included. */
export function block(body = readFileSync(join(TEMPLATES, 'AGENTS.md'), 'utf8')) {
  return `${BEGIN}\n${body.trim()}\n${END}`;
}

/**
 * Insert or refresh the managed block in `existing`.
 *
 * - no file / empty      → a minimal heading plus the block
 * - markers present      → that region is replaced, everything else preserved
 * - no markers           → the block is appended
 *
 * Pure, so the merge behaviour is testable without touching a filesystem.
 */
export function merge(existing, body) {
  const next = block(body);
  const src = String(existing ?? '');
  if (!src.trim()) return `# Agent Instructions\n\n${next}\n`;

  const start = src.indexOf(BEGIN);
  const end = src.indexOf(END);
  if (start !== -1 && end !== -1 && end > start) {
    return src.slice(0, start) + next + src.slice(end + END.length);
  }
  return `${src.replace(/\s*$/, '')}\n\n${next}\n`;
}

/**
 * Write the block into a project's AGENTS.md, and mirror it into CLAUDE.md when
 * one already exists — Claude Code reads that file for the same purpose. A
 * CLAUDE.md is never CREATED: a project that does not have one has not opted
 * into it, and inventing one is not astro-code's call.
 *
 * Returns the files actually written.
 */
export function writeAgentsMd(root, { body } = {}) {
  const written = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const file = join(root, name);
    const exists = existsSync(file);
    if (name === 'CLAUDE.md' && !exists) continue;
    const before = exists ? readFileSync(file, 'utf8') : '';
    const after = merge(before, body);
    if (after !== before) {
      writeFileSync(file, after);
      written.push(name);
    }
  }
  return written;
}
