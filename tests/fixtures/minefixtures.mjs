// Transcript fixture builders for phase 26 (the transcript miner). Named so it matches
// no `node --test` default glob pattern (`tests/*.test.mjs`), so it is never itself run
// as a test — `t1` in PLAN.md.
//
// ## Why a local, pinned slug copy instead of importing `transcriptSlug`
//
// `t1` lands before `t2` adds `transcriptSlug` to `hooks/_astro-ctx.mjs` (both are
// dependency-free wave-1 tasks, executed here in listed order). A test *helper* is not
// `lib/`/`hooks/` production code, so it is not the "one copy" ADR-046 protects — but it
// still must not drift from the real one, so it is pinned to the exact same regex Claude
// Code itself uses (`lib/stats.mjs`'s `transcriptDir`, #38) and callers may swap to the
// real export once it exists without changing behaviour.
//
// ## Verification (methodology copied from `lib/hosts/codex.mjs`'s header)
//
// Checked against the STRUCTURE of real local Claude Code transcripts under
// `~/.claude/projects/*/*.jsonl` on this machine on 2026-09-24 — field names, line
// kinds and counts only, never message content: `isMeta` command-body lines
// immediately follow a `<command-message>` line; sessions carry `parentUuid`,
// `isSidechain`, `uuid`, `sessionId`, `version`, `gitBranch`, `userType`; a subagent
// run lives under `<session>/subagents/<agent>.jsonl`; `entrypoint: 'sdk-cli'` marks a
// headless SDK-launched session.
//
// No live Codex rollout was found under `$CODEX_HOME`/`~/.codex/sessions` on this
// machine, so the Codex shapes below are pinned from the published Codex CLI rollout
// format (`{ timestamp, type, payload }`, a leading `session_meta` line), not verified
// against a live install on 2026-09-24. `lib/transcripts.mjs`'s unrecognised-line count
// makes a later shape drift visible rather than silent (ADR-043/054).
import { mkdtempSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Local pinned copy of `lib/stats.mjs` `transcriptDir`'s slug rule — see header. */
export function slug(root) {
  return String(root).replace(/[^a-zA-Z0-9]/g, '-');
}

/**
 * A fresh, isolated sandbox: every dir under a single `mkdtempSync` home, plus the env
 * a subprocess or a hook needs to never touch a developer's real home.
 */
export function sandbox() {
  const home = mkdtempSync(join(tmpdir(), 'ac-mine-home-'));
  const claude = join(home, '.claude');
  const codex = join(home, '.codex');
  const store = join(home, '.astro', 'principles');
  mkdirSync(claude, { recursive: true });
  mkdirSync(codex, { recursive: true });
  mkdirSync(store, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    CLAUDE_CONFIG_DIR: claude,
    CODEX_HOME: codex,
    ASTRO_PRINCIPLES_DIR: store,
  };
  return { home, claude, codex, store, env };
}

/** Register a second jean-claude profile dir, pointed at by `<claude>/.jean-claude/profiles.json`. */
export function addProfile(sb, name) {
  const dir = join(sb.home, `.claude-${name}`);
  mkdirSync(dir, { recursive: true });
  const metaDir = join(sb.claude, '.jean-claude');
  mkdirSync(metaDir, { recursive: true });
  const regFile = join(metaDir, 'profiles.json');
  let reg = { profiles: {} };
  if (existsSync(regFile)) {
    try { reg = JSON.parse(readFileSync(regFile, 'utf8')); } catch { reg = { profiles: {} }; }
  }
  reg.profiles ??= {};
  reg.profiles[name] = { configDir: dir };
  writeFileSync(regFile, JSON.stringify(reg, null, 2) + '\n');
  return dir;
}

export function claudeProjectDir(configDir, root) {
  return join(configDir, 'projects', slug(root));
}

/** Append each line (object → JSON, string → raw) to `file`, one per line, creating dirs. */
export function appendLines(file, lines) {
  mkdirSync(join(file, '..'), { recursive: true });
  const text = lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n';
  appendFileSync(file, text);
}

/** Write a top-level Claude session transcript `<configDir>/projects/<slug>/<id>.jsonl`. */
export function writeClaudeSession(configDir, root, id, lines) {
  const dir = claudeProjectDir(configDir, root);
  const file = join(dir, `${id}.jsonl`);
  const stamped = lines.map((l) => (
    typeof l === 'string' ? l : { sessionId: id, cwd: root, ...l }
  ));
  appendLines(file, stamped);
  return file;
}

/** Write a subagent transcript under `<session>/subagents/<agentId>.jsonl` — never a top-level file. */
export function writeClaudeSubagent(configDir, root, sessionId, agentId, lines) {
  const dir = join(claudeProjectDir(configDir, root), sessionId, 'subagents');
  const file = join(dir, `${agentId}.jsonl`);
  const stamped = lines.map((l) => (
    typeof l === 'string' ? l : { sessionId, cwd: root, isSidechain: true, ...l }
  ));
  appendLines(file, stamped);
  return file;
}

// --- Claude line builders -----------------------------------------------------------

function baseClaudeLine(overrides) {
  return {
    parentUuid: null,
    isSidechain: false,
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    userType: 'external',
    version: '1.0.0',
    gitBranch: 'main',
    ...overrides,
  };
}

/** A typed human turn: plain string content, optional `origin`. */
export function cHuman(text, { origin } = {}) {
  return baseClaudeLine({
    type: 'user',
    message: { role: 'user', content: text },
    ...(origin ? { origin } : {}),
  });
}

export function cAssistant(text) {
  return baseClaudeLine({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

/** A user line whose content is a `tool_result` block — excluded as `tool-result`. */
export function cToolResult(text) {
  return baseClaudeLine({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', content: text }] },
  });
}

/** An `isMeta` user line — excluded regardless of content. */
export function cMeta(text) {
  return baseClaudeLine({
    type: 'user',
    isMeta: true,
    message: { role: 'user', content: text },
  });
}

/** A whole line beginning `<system-reminder>` — excluded entirely (full-line form). */
export function cReminder(text) {
  return baseClaudeLine({
    type: 'user',
    message: { role: 'user', content: `<system-reminder>${text}</system-reminder>` },
  });
}

/** A user line whose `origin.kind` is `task-notification` — excluded as `injected`. */
export function cTaskNotification(text) {
  return cHuman(text, { origin: { kind: 'task-notification' } });
}

/** A slash-command invocation; the human text is ONLY the `<command-args>` span. */
export function cCommand(name, args) {
  const content = `<command-message>${name} is running…</command-message>\n`
    + `<command-name>/${name}</command-name>\n`
    + `<command-args>${args}</command-args>`;
  return baseClaudeLine({ type: 'user', message: { role: 'user', content } });
}

/** The expanded command body that follows a `cCommand` line — `isMeta`, excluded. */
export function cCommandBody(text) {
  return cMeta(text);
}

/** A subagent-shaped line — `isSidechain: true`, excluded. */
export function cSidechain(text) {
  return baseClaudeLine({
    type: 'user',
    isSidechain: true,
    message: { role: 'user', content: text },
  });
}

/** A headless (`claude -p` / SDK) turn — the whole file is dropped when this appears. */
export function cHeadless(text) {
  return baseClaudeLine({
    type: 'user',
    entrypoint: 'sdk-cli',
    message: { role: 'user', content: text },
  });
}

/** An unrecognised `type` — counted as `skipped.unrecognised`, never `ignored`. */
export function cUnknownType() {
  return baseClaudeLine({ type: 'mystery-event', payload: { ok: true } });
}

// --- Codex rollout builder -----------------------------------------------------------

function pad2(n) { return String(n).padStart(2, '0'); }

/**
 * Write a Codex rollout under `sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`, with the real
 * leading `session_meta` line prepended automatically.
 */
export function writeCodexRollout(codexHome, { id, cwd, originator = 'cli', source, date = new Date() }, lines) {
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  const dir = join(codexHome, 'sessions', String(y), m, d);
  const file = join(dir, `rollout-${date.toISOString().replace(/[:.]/g, '-')}-${id}.jsonl`);
  const meta = {
    timestamp: date.toISOString(),
    type: 'session_meta',
    payload: { id, cwd, originator, ...(source ? { source } : {}) },
  };
  appendLines(file, [meta, ...lines]);
  return file;
}

function baseCodexLine(overrides) {
  return { timestamp: new Date().toISOString(), ...overrides };
}

export function xUser(text) {
  return baseCodexLine({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  });
}

export function xAssistant(text) {
  return baseCodexLine({
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  });
}

export function xEnvContext(text) {
  return xUser(`<environment_context>${text}</environment_context>`);
}

export function xUserInstructions(text) {
  return xUser(`<user_instructions>${text}</user_instructions>`);
}

export function xToolOutput(text) {
  return baseCodexLine({
    type: 'response_item',
    payload: { type: 'function_call_output', output: text },
  });
}

// --- garbage + secrets -----------------------------------------------------------

// A truncated JSON line, a structurally-valid-but-unknown-shape line, and a line of
// binary garbage — the three malformed/unrecognised shapes P4 distinguishes.
export const GARBAGE_LINES = [
  '{"type":"user","message":{"role":"user","content":"trunc',
  '{"totally":"not a transcript line shape"}',
  '\x00\x01\xff\xfe not json at all \x07',
];

// One example of each shape `lib/redact.mjs` masks (module header, phase 22 C9).
export const SECRETS = [
  'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
  'AKIAABCDEFGHIJKLMNOP',
  'password=Sup3rSecretValue!',
  'Bearer abcdef0123456789.tok',
];
