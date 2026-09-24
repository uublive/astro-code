// The transcript reader (P2-P4, phase 26): a chunked, memory-bounded line reader plus
// per-host human-turn classification. Sync throughout — the miner is a one-shot CLI
// verb, never a long-lived process, so there is no event loop to keep free.
//
// ## Why a chunked reader, and not `lib/stats.mjs`'s `jsonLines`
//
// `jsonLines` does `readFileSync(file, 'utf8').split('\n')` — the WHOLE file materialised
// as one string before a single line is looked at. A real local Claude transcript
// directory was found to hold gigabytes across sessions during phase-26 planning (the
// "3.1 GB reality check", CRITERIA C5); loading even one multi-hundred-MB session that
// way risks the heap outright. `readLines` below opens the file once and re-reads a
// single reused `Buffer` chunk at a time via `openSync`/`readSync` at an explicit
// position, so memory is bounded by `chunkBytes + maxLineBytes` regardless of file size.
//
// ## Why the line cap, and why an oversized line is never yielded as text
//
// A human turn is never anywhere close to 4 MiB; a single huge tool result or pasted log
// line legitimately can be. `MAX_LINE_BYTES` exists so one such line cannot force the
// reader to buffer unbounded bytes — once a line's accumulated length crosses the cap, the
// buffered bytes for it are discarded and `{ oversized: true }` is yielded once the
// newline is finally found, never the text itself.
//
// ## Why a trailing partial line is never yielded
//
// A session file being actively written by a live Claude/Codex process can end mid-line.
// Yielding that partial text — or worse, recording it as having been read past — would
// let the watermark commit to a byte offset that lands inside a line that was never
// actually complete. `readLines` simply stops before it; the caller's next scan (which
// starts from the SAME recorded offset) will pick it up once it is whole.
//
// ## Claude/Codex line-shape evidence
//
// Pinned from `tests/fixtures/minefixtures.mjs`'s header (verified against real local
// transcript STRUCTURE on 2026-09-24): a subagent run lives under
// `<session>/subagents/<agent>.jsonl` (never enumerated as a top-level session);
// `isMeta` marks the expanded body that follows a `<command-message>` line; `origin.kind`
// distinguishes a human turn from an injected one (`task-notification`, `coordinator`,
// …); `entrypoint` marks a headless (`sdk-cli`) Claude session. No live Codex rollout was
// found on the planning machine, so the Codex shapes are pinned from the published
// `{ timestamp, type, payload }` rollout format, not verified against a live install.
//
// ## Why known-ignorable and unrecognised are separate counts (ADR-043/054)
//
// "Unknown" must never read as "empty". A shape drift in either host's transcript format
// (a renamed `type`, a moved field) shows up as a RISING `skipped.unrecognised` count
// rather than silently vanishing turns — the miner surfaces this so a real drift gets
// noticed instead of just mining less every month.
import { openSync, closeSync, readSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configTargets as claudeConfigTargets } from './hosts/claude.mjs';
import { baseConfigDir as codexBaseConfigDir } from './hosts/codex.mjs';
import { transcriptSlug } from '../hooks/_astro-ctx.mjs';

export const MAX_LINE_BYTES = 4 * 1024 * 1024;

/** Temporarily swap process.env for the duration of `fn`, then restore it exactly. */
function withEnv(env, fn) {
  if (!env || env === process.env) return fn();
  const prevKeys = new Set(Object.keys(process.env));
  const prev = { ...process.env };
  for (const k of Object.keys(env)) process.env[k] = env[k];
  for (const k of prevKeys) if (!(k in env)) delete process.env[k];
  try {
    return fn();
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, prev);
  }
}

/**
 * A sync generator over complete, `\n`-terminated lines: `{ text, start, end }`, or
 * `{ oversized: true, start, end }` for a line whose accumulated bytes crossed
 * `maxLineBytes` before a newline was found. A trailing partial line is never yielded.
 */
export function* readLines(file, { start = 0, maxLineBytes = MAX_LINE_BYTES, chunkBytes = 65536 } = {}) {
  let fd;
  try {
    fd = openSync(file, 'r');
  } catch {
    return;
  }
  try {
    const buf = Buffer.alloc(chunkBytes);
    let pos = start;
    let lineStart = start;
    let chunks = [];
    let lineLen = 0;
    let oversized = false;

    while (true) {
      let n;
      try {
        n = readSync(fd, buf, 0, chunkBytes, pos);
      } catch {
        break;
      }
      if (n <= 0) break;

      let segStart = 0;
      for (let j = 0; j < n; j++) {
        if (buf[j] !== 10) continue; // '\n'
        const segEnd = j;
        const seg = buf.subarray(segStart, segEnd);
        lineLen += seg.length;
        if (!oversized) {
          if (lineLen <= maxLineBytes) chunks.push(Buffer.from(seg));
          else oversized = true;
        }
        const end = pos + j + 1;
        if (oversized) {
          yield { oversized: true, start: lineStart, end };
        } else {
          yield { text: Buffer.concat(chunks).toString('utf8'), start: lineStart, end };
        }
        chunks = [];
        lineLen = 0;
        oversized = false;
        lineStart = end;
        segStart = j + 1;
      }
      if (segStart < n) {
        const seg = buf.subarray(segStart, n);
        lineLen += seg.length;
        if (!oversized) {
          if (lineLen <= maxLineBytes) chunks.push(Buffer.from(seg));
          else oversized = true;
        }
      }
      pos += n;
    }
    // A trailing partial line (no terminating '\n') is deliberately never yielded.
  } finally {
    closeSync(fd);
  }
}

// --- discovery ------------------------------------------------------------------------

function isTopLevelJsonl(dirent) {
  return dirent.isFile() && dirent.name.endsWith('.jsonl');
}

function claudeSessionsUnder(configDir, projectDir) {
  let dirents;
  try {
    dirents = readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirents.filter(isTopLevelJsonl).map((d) => ({
    file: join(projectDir, d.name),
    host: 'claude',
    session: d.name.slice(0, -'.jsonl'.length),
    configDir,
  }));
}

function walkFiles(dir) {
  let out = [];
  let dirents;
  try {
    dirents = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirents) {
    const full = join(dir, d.name);
    if (d.isDirectory()) out = out.concat(walkFiles(full));
    else if (d.isFile() && d.name.endsWith('.jsonl')) out.push(full);
  }
  return out;
}

/** The leading `session_meta` line's payload, or `{}` if unreadable/absent. */
export function codexSessionMeta(file) {
  for (const line of readLines(file, { maxLineBytes: MAX_LINE_BYTES })) {
    if (line.oversized) return {};
    let obj;
    try {
      obj = JSON.parse(line.text);
    } catch {
      return {};
    }
    if (obj.type === 'session_meta') return obj.payload || {};
    return {};
  }
  return {};
}

/**
 * Every top-level session file in scope (P2): Claude's `<configDir>/projects/<slug>/*.jsonl`
 * (never `subagents/`) for every config dir, and every Codex rollout under
 * `baseConfigDir()/sessions/**`. `roots` are matched EXACTLY (the caller already expands
 * `[root, realpathSync(root)]` — sessionFiles never guesses).
 */
export function sessionFiles({ roots = [], all = false, env = process.env } = {}) {
  return withEnv(env, () => {
    const out = [];

    // Claude.
    for (const configDir of claudeConfigTargets().keys()) {
      const projectsDir = join(configDir, 'projects');
      if (all) {
        let dirents;
        try {
          dirents = readdirSync(projectsDir, { withFileTypes: true });
        } catch {
          dirents = [];
        }
        for (const d of dirents) {
          if (!d.isDirectory()) continue;
          out.push(...claudeSessionsUnder(configDir, join(projectsDir, d.name)));
        }
      } else {
        for (const root of roots) {
          const slug = transcriptSlug(root);
          out.push(...claudeSessionsUnder(configDir, join(projectsDir, slug)).map((s) => ({ ...s, cwd: root })));
        }
      }
    }

    // Codex.
    const codexHome = codexBaseConfigDir();
    const sessionsDir = join(codexHome, 'sessions');
    for (const file of walkFiles(sessionsDir)) {
      const meta = codexSessionMeta(file);
      // A rollout whose `cwd` is unrecoverable (no readable `session_meta` line) can
      // never be proven to belong to another project, so project scope fails OPEN and
      // still scans it (ADR-043/054, unknown ≠ empty, phase-26 C9) — only a KNOWN,
      // different cwd is excluded here. `--all` already bypasses this filter outright.
      if (!all && meta.cwd !== undefined && !roots.includes(meta.cwd)) continue;
      out.push({ file, host: 'codex', session: meta.id || dirname(file), cwd: meta.cwd });
    }

    return out;
  });
}

// --- Claude classification --------------------------------------------------------------

const CLAUDE_IGNORABLE_TYPES = new Set([
  'mode', 'bridge-session', 'file-history-snapshot', 'file-history-delta', 'system',
  'atis-latch', 'attachment', 'last-prompt', 'ai-title', 'queue-operation', 'pr-link',
  'cost-state', 'permission-mode', 'frame-link', 'summary', 'custom-title',
]);

const CLAUDE_EXCLUDE_PREFIXES = [
  '<local-command-caveat>', '<bash-input>', '<bash-stdout>', '<bash-stderr>',
  '<local-command-stdout>', '<task-notification>', '<system-reminder>', '[Request interrupted',
];

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Classify one already-JSON-parsed Claude transcript line (P4). */
export function classifyClaudeLine(obj) {
  const type = obj?.type;
  if (type === 'assistant') {
    const blocks = Array.isArray(obj?.message?.content) ? obj.message.content : [];
    const text = blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('');
    return { kind: 'assistant', text };
  }
  if (type && CLAUDE_IGNORABLE_TYPES.has(type)) return { kind: 'ignored' };
  if (type !== 'user') return { kind: 'unrecognised' };

  if (obj.isSidechain) return { kind: 'excluded', reason: 'sidechain' };
  if (obj.isMeta) return { kind: 'excluded', reason: 'meta' };
  if (obj.toolUseResult !== undefined) return { kind: 'excluded', reason: 'tool-result' };
  if (obj.isCompactSummary) return { kind: 'excluded', reason: 'compact-summary' };

  const content = obj?.message?.content;
  let text;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === 'tool_result')) return { kind: 'excluded', reason: 'tool-result' };
    if (content.length && !content.every((b) => b?.type === 'text')) return { kind: 'unrecognised' };
    text = content.map((b) => b?.text || '').join('');
  } else {
    return { kind: 'unrecognised' };
  }

  const origin = obj.origin;
  if (origin && origin.kind && origin.kind !== 'human') return { kind: 'excluded', reason: 'injected' };

  const trimmed = String(text).trim();
  if (CLAUDE_EXCLUDE_PREFIXES.some((p) => trimmed.startsWith(p))) return { kind: 'excluded', reason: 'wrapper' };

  if (trimmed.startsWith('<command-message>')) {
    const m = trimmed.match(/<command-args>([\s\S]*?)<\/command-args>/);
    const args = m ? m[1].trim() : '';
    if (!args) return { kind: 'excluded', reason: 'command-no-args' };
    return { kind: 'human', text: args };
  }

  const stripped = trimmed.replace(SYSTEM_REMINDER_RE, '').trim();
  return { kind: 'human', text: stripped };
}

// --- Codex classification --------------------------------------------------------------

const CODEX_IGNORABLE_TYPES = new Set(['turn_context', 'event_msg', 'compacted']);
const CODEX_IGNORABLE_PAYLOAD_TYPES = new Set([
  'function_call', 'reasoning', 'local_shell_call', 'custom_tool_call', 'custom_tool_call_output', 'web_search_call',
]);
const CODEX_EXCLUDE_PREFIXES = ['<environment_context>', '<user_instructions>', '# AGENTS.md instructions', '<INSTRUCTIONS>'];

export function classifyCodexLine(obj) {
  const type = obj?.type;
  if (type === 'session_meta') return { kind: 'ignored' };
  if (CODEX_IGNORABLE_TYPES.has(type)) return { kind: 'ignored' };
  if (type !== 'response_item') return { kind: 'unrecognised' };

  const payload = obj.payload || {};
  if (payload.type === 'function_call_output') return { kind: 'excluded', reason: 'tool-result' };
  if (CODEX_IGNORABLE_PAYLOAD_TYPES.has(payload.type)) return { kind: 'ignored' };
  if (payload.type !== 'message') return { kind: 'unrecognised' };

  const blocks = Array.isArray(payload.content) ? payload.content : [];
  if (payload.role === 'assistant') {
    const text = blocks.filter((b) => b?.type === 'output_text').map((b) => b.text).join('');
    return { kind: 'assistant', text };
  }
  if (payload.role === 'user') {
    const text = blocks.filter((b) => b?.type === 'input_text').map((b) => b.text).join('');
    const trimmed = String(text).trim();
    if (CODEX_EXCLUDE_PREFIXES.some((p) => trimmed.startsWith(p))) return { kind: 'excluded', reason: 'injected' };
    return { kind: 'human', text };
  }
  return { kind: 'unrecognised' };
}

// --- scanSession -------------------------------------------------------------------------

const CONTEXT_TAIL_MAX = 4000; // generous internal cap; lib/mine.mjs applies the 300-char output ceiling

function isHeadlessClaudeLine(obj) {
  return obj?.type === 'user' && obj.entrypoint !== undefined && obj.entrypoint !== 'cli';
}

/**
 * Scan one session file from `start` (context read from `ctxStart ?? start`), returning
 * every human turn with its preceding assistant context, honouring headless-file
 * detection and the malformed/unrecognised/oversized skip counts (P4).
 */
export function scanSession({ file, host, start = 0, ctxStart } = {}) {
  const readFrom = ctxStart != null ? Math.min(ctxStart, start) : start;
  const turns = [];
  const skipped = { malformed: 0, unrecognised: 0, oversized: 0 };
  const excluded = {};
  let lastAssistant = '';
  let lastAssistantStart = null;
  let headless = false;
  let end = readFrom;

  if (host === 'codex') {
    const meta = codexSessionMeta(file);
    if (/exec/i.test(meta.originator || '') || meta.source === 'exec') {
      return { turns: [], end: readFrom, ctxOffset: readFrom, headless: true, skipped, excluded };
    }
  }

  for (const line of readLines(file, { start: readFrom })) {
    end = line.end;
    if (line.oversized) { skipped.oversized++; continue; }
    let obj;
    try {
      obj = JSON.parse(line.text);
    } catch {
      skipped.malformed++;
      continue;
    }

    if (host === 'claude' && isHeadlessClaudeLine(obj)) {
      headless = true;
      break;
    }

    const r = host === 'codex' ? classifyCodexLine(obj) : classifyClaudeLine(obj);
    if (r.kind === 'unrecognised') { skipped.unrecognised++; continue; }
    if (r.kind === 'ignored') continue;
    if (r.kind === 'excluded') { excluded[r.reason] = (excluded[r.reason] || 0) + 1; continue; }
    if (r.kind === 'assistant') {
      lastAssistant = r.text.length > CONTEXT_TAIL_MAX ? r.text.slice(-CONTEXT_TAIL_MAX) : r.text;
      lastAssistantStart = line.start;
      continue;
    }
    // r.kind === 'human'
    if (line.start < start) continue; // context-only window — never a turn
    turns.push({
      text: r.text, start: line.start, end: line.end,
      ctxStart: lastAssistantStart ?? line.start, ctxEnd: line.start,
      context: lastAssistant,
    });
  }

  if (headless) return { turns: [], end, ctxOffset: end, headless: true, skipped, excluded };
  return { turns, end, ctxOffset: lastAssistantStart ?? end, headless: false, skipped, excluded };
}
