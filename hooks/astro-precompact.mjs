#!/usr/bin/env node
// PreCompact hook — preserve the astro-code position across context compaction.
//
// astro-code keeps its state on disk (.astrocode/), so nothing is truly lost when
// the conversation is compacted. But the SessionStart banner deliberately skips the
// `compact` source (see astro-update.mjs), and a summarized transcript can blur which
// milestone/phase/task was in flight. This hook fires RIGHT BEFORE compaction and emits
// a terse systemMessage with the current position + next action, so it rides into the
// compacted summary verbatim and the model re-orients without re-reading everything.
//
// It is a strict no-op outside an astro-code project (this is a GLOBAL hook, firing in
// every session in the config dir): if cwd isn't under a `.astrocode/` root, or there's
// no milestone/phase to report, it writes nothing and exits 0. Cheap, non-blocking,
// never errors out the compaction.
import { readFileSync } from 'node:fs';
import { findAstroRoot, readContext, renderResumeNote } from './_astro-ctx.mjs';

// Claude pipes a PreCompact context blob on stdin; we need its cwd.
let cwd = process.cwd();
try {
  const data = JSON.parse(readFileSync(0, 'utf8'));
  cwd = data?.cwd || data?.workspace?.current_dir || cwd;
} catch { /* no/!json stdin — fall back to process.cwd() */ }

try {
  const root = findAstroRoot(cwd);
  if (root) {
    const note = renderResumeNote(readContext(root, Math.floor(Date.now() / 1000)));
    if (note) process.stdout.write(JSON.stringify({ systemMessage: note }));
  }
} catch { /* best-effort — never block compaction */ }

process.exit(0);
