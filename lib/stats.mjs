// Read token usage + wall-clock from Claude Code's session transcripts for this
// project. Ground truth: each transcript line carries a `usage` object
// (input/output/cache-creation/cache-read tokens) and a `timestamp`.
//
// Honest framing: cache_read tokens are cheap (a cache hit), so we separate them
// from "fresh" input + output + cache-creation. The lean/fast claim is really
// "small fresh context + high cache-hit ratio" — this surfaces exactly that.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { transcriptSlug } from '../hooks/_astro-ctx.mjs';

const configDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

// Claude Code keys a project's transcripts by its path with every character that is
// not an ASCII letter or digit → '-' — not only '/': a '.' (a `luigi.lauro` home dir)
// or '_' (`CIL_Quote` → `-CIL-Quote`) is replaced too, and matching only '/' found
// no transcripts at all for such paths (#38). `transcriptSlug` is the one copy
// (ADR-046 direction, hooks/_astro-ctx.mjs — phase 26 P7) — this file imports it
// rather than keeping a second regex that could silently drift from it.
export function transcriptDir(root) {
  return join(configDir(), 'projects', transcriptSlug(root));
}

function* jsonLines(file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try {
      yield JSON.parse(s);
    } catch { /* skip non-JSON lines */ }
  }
}

export function collectStats(root, { since, session } = {}) {
  const dir = transcriptDir(root);
  if (!existsSync(dir)) return { available: false, dir };

  let files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  if (session) files = files.filter((f) => f.startsWith(session));
  const sinceMs = since ? Date.parse(since) : null;

  let input = 0;
  let output = 0;
  let cacheCreate = 0;
  let cacheRead = 0;
  let turns = 0;
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const f of files) {
    for (const obj of jsonLines(join(dir, f))) {
      const ts = obj.timestamp ? Date.parse(obj.timestamp) : null;
      if (sinceMs != null && ts != null && ts < sinceMs) continue;
      const u = (obj.message && obj.message.usage) || obj.usage;
      if (u) {
        input += u.input_tokens || 0;
        output += u.output_tokens || 0;
        cacheCreate += u.cache_creation_input_tokens || 0;
        cacheRead += u.cache_read_input_tokens || 0;
        turns++;
      }
      if (ts != null) {
        if (ts < minTs) minTs = ts;
        if (ts > maxTs) maxTs = ts;
      }
    }
  }

  const wallMs = minTs !== Infinity && maxTs !== -Infinity ? maxTs - minTs : 0;
  const inputSide = input + cacheCreate + cacheRead;
  return {
    available: true,
    dir,
    files: files.length,
    turns,
    input,
    output,
    cacheCreate,
    cacheRead,
    fresh: input + cacheCreate, // uncached input side
    cacheHitRatio: inputSide ? cacheRead / inputSide : 0,
    wallMs,
  };
}
