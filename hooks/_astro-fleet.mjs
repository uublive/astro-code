// Astro Fleet connector engine — shared by the Claude Code hook (hot path), the
// detached flusher, and `ac fleet …` (lib/fleet.mjs).
//
// Once `ac fleet connect` has run, EVERY Claude Code session on the machine — any
// project, not only astro-code ones — reports its activity to a fleet, which draws it
// live in the Forge. The wire contract (POST <url>/api/ingest/events) is fixed by
// astro-fleet phase 36 and implemented on both sides independently, so the shapes here
// are deliberately literal: change them only together with the fleet.
//
// Two rules shape everything below:
//   1. Reporting must NEVER slow down or break a session. The hook only maps the event,
//      appends one JSON line to a local queue and (maybe) spawns a detached flusher —
//      no network on the hot path, no stdout, exit 0 whatever happens.
//   2. Activity and outcomes only. An event is BUILT from a whitelist of fields, never
//      copied from the hook's stdin, so prompt text, tool inputs/outputs and transcript
//      paths cannot leak by a new field appearing upstream. An outcome carries a phase,
//      fix or commit title, and hide_names drops it with the project name.
//
// Lives in hooks/ (not lib/) because `ac install` copies hooks/*.mjs into
// ~/.astro/code/hooks, and the hook must run from there without the source checkout.
// Every path is computed from a `dir` argument, never at module load — tests point it
// at a throwaway directory (see the same note in lib/hosts/claude.mjs).
import {
  readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, rmSync,
  statSync, existsSync, chmodSync, openSync, closeSync, writeSync,
} from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';

export const DEFAULT_COLOR = '#4fb3ff';
export const HOOK_MARKER = '# astro-fleet';
export const BATCH_MAX = 100;
export const BODY_MAX = 256 * 1024;
export const QUEUE_MAX = 5000;
export const QUEUE_MAX_AUTH_FAILED = 1000;
export const EVENT_TTL_MS = 24 * 3600 * 1000;
export const TOOL_COALESCE_MS = 5000;
export const BACKOFF_MIN_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 5000;
// The flusher holds its lock across network calls; past this it is presumed dead.
const FLUSH_LOCK_STALE_MS = 5 * 60_000;

// ASTRO_FLEET_DIR exists for the detached flusher (told where its hook ran) and tests.
export const fleetDir = () => process.env.ASTRO_FLEET_DIR || join(homedir(), '.astro');
export function fleetPaths(dir = fleetDir()) {
  return {
    dir,
    config: join(dir, 'fleet.json'),
    queue: join(dir, 'fleet-queue.jsonl'),
    // Status the user reads (last send, last error, backoff) plus the per-session
    // caches the hot path needs (project identity, tool coalescing). Not the config:
    // the config is the user's, this file is ours and can be deleted at any time.
    state: join(dir, 'fleet-state.json'),
    lock: join(dir, 'fleet-queue.lock'),
    flushLock: join(dir, 'fleet-flush.lock'),
    log: join(dir, 'fleet.log'),
  };
}

// Claude Code hook event → wire `type`. Fixed by the contract; anything else is ignored.
export const EVENT_TYPES = {
  SessionStart: 'session_start',
  SessionEnd: 'session_end',
  UserPromptSubmit: 'prompt',
  PreToolUse: 'tool',
  PostToolUse: 'tool',
  Notification: 'waiting',
  Stop: 'stop',
  SubagentStart: 'subagent_start',
  SubagentStop: 'subagent_stop',
};

// --- small fs helpers ----------------------------------------------------------

export function readJson(file, fallback = null) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, text, mode) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, text, mode ? { mode } : undefined);
  if (mode) chmodSync(tmp, mode); // umask can strip bits from the create mode
  renameSync(tmp, file);
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// --- config ----------------------------------------------------------------------

export function loadConfig(dir = fleetDir()) {
  const c = readJson(fleetPaths(dir).config);
  return c && typeof c === 'object' && c.url && c.token ? c : null;
}

// The token is a credential: 0600 file in a 0700 directory, written atomically so a
// crash mid-write can never leave a truncated (or world-readable) config behind.
export function saveConfig(cfg, dir = fleetDir()) {
  ensureDir(dir);
  writeAtomic(fleetPaths(dir).config, JSON.stringify(cfg, null, 2) + '\n', 0o600);
}

export function normalizeColor(c) {
  if (c == null || c === true) return null;
  // `#` starts a shell comment, so an unquoted `ac fleet color #4fb3ff` arrives empty;
  // accepting the bare hex as well is kinder than a puzzling error.
  const s = String(c).trim().toLowerCase();
  const m = /^#?([0-9a-f]{6})$/.exec(s);
  return m ? `#${m[1]}` : null;
}

// https anywhere; plain http only to this machine (a token over cleartext http to a
// remote host would be readable by anyone on the path).
export function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { ok: false, error: `not a URL: ${raw}` }; }
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    return { ok: false, error: 'the fleet URL must be https (http is allowed only for localhost)' };
  }
  if (u.username || u.password) return { ok: false, error: 'the fleet URL must not carry credentials — pass the token with --token' };
  const url = `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`;
  return { ok: true, url };
}

export function redactToken(t) {
  const s = String(t || '');
  return s.length > 4 ? `…${s.slice(-4)}` : '…';
}

// --- project identity ----------------------------------------------------------------

/**
 * Normalise a git remote into a browsable https URL, or null when it isn't a network
 * remote. Credentials are always stripped (an https remote can embed a PAT), `.git` and
 * trailing slashes go, and the ssh forms become https:
 *   git@github.com:org/repo.git        → https://github.com/org/repo
 *   ssh://git@github.com:22/org/repo   → https://github.com/org/repo
 *   https://user:tok@host/org/repo.git → https://host/org/repo
 * A local-path or file:// remote returns null: it is not a URL, and sending it would
 * leak a filesystem path under a field the fleet treats as public.
 */
export function normalizeRemote(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  let host, path;
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(s);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    let u;
    try { u = new URL(s); } catch { return null; }
    if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(u.protocol)) return null;
    host = u.hostname;
    // keep a non-default port only for http(s): an ssh port means nothing to a browser
    if (u.port && (u.protocol === 'https:' || u.protocol === 'http:')) host += `:${u.port}`;
    path = u.pathname;
  } else if (scp && !/^[a-z]:\\/i.test(s)) {
    [, host, path] = scp;
  } else {
    return null;
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/i, '');
  if (!host || !path) return null;
  return `https://${host}/${path}`;
}

export function resolveProject(cwd) {
  let repoUrl = null;
  if (cwd) {
    try {
      const r = spawnSync('git', ['-C', cwd, 'remote', 'get-url', 'origin'], {
        encoding: 'utf8', timeout: 500, windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      if (r.status === 0) repoUrl = normalizeRemote(r.stdout);
    } catch { /* no git — fall back to the directory name */ }
  }
  const name = (repoUrl && repoUrl.split('/').pop()) || (cwd ? basename(cwd) : '') || 'unknown';
  return repoUrl ? { name, repo_url: repoUrl } : { name };
}

// The fleet keys a project by repo_url, else the cwd basename; hide_names hashes that
// same key so a project stays one bay, just under an opaque name.
export function hiddenName(project, cwd) {
  const key = project.repo_url || basename(cwd || '') || project.name || '';
  return `p-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`;
}

// --- event mapping -------------------------------------------------------------------

const isoSecond = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * Map one Claude Code hook payload to one wire event, or null when the hook event is
 * not one we report. Built field by field from a whitelist — nothing from `input` is
 * copied wholesale. `project` (and `cwd`) ride on EVERY event, not only session_start:
 * a session already running when the user connects must still land in the right bay.
 */
export function mapEvent(input, { project, hideNames = false, now = Date.now() } = {}) {
  if (!input || typeof input !== 'object') return null;
  const type = EVENT_TYPES[input.hook_event_name];
  if (!type || typeof input.session_id !== 'string' || !input.session_id) return null;
  const ev = { type, session_id: input.session_id, ts: isoSecond(now) };
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : null;
  attachProject(ev, project, cwd, hideNames);
  if (type === 'prompt') ev.by = promptBy(input.prompt);
  if (type === 'subagent_start' || type === 'subagent_stop') {
    if (typeof input.agent_id === 'string') ev.agent_id = input.agent_id;
    if (typeof input.agent_type === 'string') ev.agent_type = input.agent_type;
  }
  return ev;
}

// Who wrote a prompt, for the fleet's leaderboard: 'auto' when it starts with a marker
// a machine puts there (a scheduled task, a background-task notice, a forge system or
// jobs message, a relayed incoming email/WhatsApp, a loop's sentinel, forge's heartbeat
// and the /clear before it, the comms judge, the chat summarizer), else 'human' (typed,
// or a person's own Telegram/web message relayed by forge). Only this word is sent,
// never the text. A pasted_content wrapper around the marker is looked through.
const AUTO_PROMPT = /^(?:\[scheduled\]|\[heartbeat\]|\[from:(?:system|comms|jobs)\b|\[forge:|<task-notification>|<<autonomous-loop|\/clear\s*$|Channel: \S+\s+Sender:|You maintain a rolling summary)/;
export function promptBy(prompt) {
  if (typeof prompt !== 'string') return 'human';
  const s = prompt.trimStart().replace(/^<pasted_content\b[^>]*>\s*/, '');
  return AUTO_PROMPT.test(s) ? 'auto' : 'human';
}

// `cwd` and `project` by the same rules on every event type: hide_names keeps only the
// hashed name.
function attachProject(ev, project, cwd, hideNames) {
  if (project) {
    if (hideNames) {
      ev.project = { name: hiddenName(project, cwd) };
    } else {
      if (cwd) ev.cwd = cwd;
      ev.project = project.repo_url ? { name: project.name, repo_url: project.repo_url } : { name: project.name };
    }
  } else if (cwd && !hideNames) {
    ev.cwd = cwd;
  }
}

// --- outcomes ------------------------------------------------------------------------
// What a session PRODUCED, not only that it was busy: a phase verified, rejected or
// accepted, a fix accepted (all from `ac`), or a commit (from the PostToolUse hook).
// Same queue and flusher as activity; a fleet that doesn't know `outcome` skips it.

export const OUTCOME_KINDS = ['phase_verified', 'phase_rejected', 'phase_accepted', 'fix_accepted', 'commit'];
const FIRST_TRY_KINDS = new Set(['phase_accepted', 'fix_accepted']);
// The fleet's limits, in BYTES (Go len): one field over them rejects the whole batch.
const SESSION_ID_MAX = 200;
const REF_MAX = 100;
const TITLE_MAX = 300;

// Cut to at most `max` UTF-8 bytes without splitting a character.
function capBytes(s, max) {
  const b = Buffer.from(s, 'utf8');
  if (b.length <= max) return s;
  return b.subarray(0, max).toString('utf8').replace(/�+$/, '');
}

/**
 * The session an `ac` outcome belongs to: the Claude Code session running `ac`, when
 * the environment says so, else a stable per-project id. Under hide_names the fallback
 * uses the hashed name, so the repo URL can't leak through the session id.
 */
export function outcomeSessionId(project, cwd, { hideNames = false, env = process.env } = {}) {
  const sid = env.CLAUDE_CODE_SESSION_ID;
  if (typeof sid === 'string' && sid) return capBytes(sid, SESSION_ID_MAX);
  const key = hideNames ? hiddenName(project || {}, cwd) : (project?.repo_url || basename(cwd || '') || project?.name || 'unknown');
  return capBytes(`ac:${key}`, SESSION_ID_MAX);
}

/** One outcome → one wire event, built field by field like mapEvent. Null if malformed. */
export function mapOutcome(outcome, { sessionId, cwd = null, project, hideNames = false, now = Date.now() } = {}) {
  if (!outcome || !OUTCOME_KINDS.includes(outcome.kind)) return null;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  const ev = { type: 'outcome', session_id: sessionId, ts: isoSecond(now) };
  attachProject(ev, project, cwd || null, hideNames);
  const o = { kind: outcome.kind };
  if (outcome.ref != null && outcome.ref !== '') o.ref = capBytes(String(outcome.ref), REF_MAX);
  if (!hideNames && typeof outcome.title === 'string' && outcome.title) o.title = capBytes(outcome.title, TITLE_MAX);
  if (outcome.by === 'human' || outcome.by === 'agent') o.by = outcome.by;
  if (FIRST_TRY_KINDS.has(outcome.kind) && typeof outcome.first_try === 'boolean') o.first_try = outcome.first_try;
  ev.outcome = o;
  return ev;
}

// `git commit` as a command of its own: at the start, or after a shell separator, with
// optional VAR=… prefixes and git's global options (`-C dir`, `-c k=v`, `--no-pager`).
// Not `git commit-tree`, and not "git commit" inside an echo'd string.
const GIT_COMMIT_RE = /(?:^|[;&|(\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*git(?:\s+(?:-[Cc]\s+\S+|--?[A-Za-z][\w-]*(?:=\S+)?))*\s+commit(?![\w-])/;

export function isGitCommit(command) {
  return typeof command === 'string' && GIT_COMMIT_RE.test(command);
}

// HEAD's short sha and subject, in one cheap git call. Null when it can't be had.
export function headCommit(cwd) {
  if (!cwd) return null;
  try {
    const r = spawnSync('git', ['-C', cwd, 'log', '-1', '--format=%h%x1f%s'], {
      encoding: 'utf8', timeout: 500, windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (r.status !== 0 || !r.stdout) return null;
    const [sha, subject] = r.stdout.replace(/\n$/, '').split('\x1f');
    return sha ? { sha, subject: subject || '' } : null;
  } catch { return null; }
}

/**
 * The commit outcome a hook payload carries, or null. Only a PostToolUse of Bash (which
 * Claude Code fires on success; failures go to PostToolUseFailure) whose command runs
 * `git commit`. The command itself is only matched, never sent.
 */
export function commitOutcome(input, { head = headCommit } = {}) {
  if (!input || input.hook_event_name !== 'PostToolUse' || input.tool_name !== 'Bash') return null;
  if (!isGitCommit(input.tool_input?.command)) return null;
  if (input.tool_response && typeof input.tool_response === 'object' && input.tool_response.interrupted) return null;
  const h = head(typeof input.cwd === 'string' ? input.cwd : '');
  const o = { kind: 'commit', by: 'agent' };
  if (h) { o.ref = h.sha; if (h.subject) o.title = h.subject; }
  return o;
}

// --- the queue lock ------------------------------------------------------------------
// A synchronous mkdir mutex (Node has no flock). The hot path may not wait long: if the
// lock can't be had within ~60 ms the caller gets null and drops its event — losing one
// liveness tick is fine, stalling a tool call is not.

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

export function lockSync(lockPath, { waitMs = 60 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try { mkdirSync(lockPath); return true; } catch { /* held */ }
    try {
      if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
    } catch { continue; /* vanished between mkdir and stat */ }
    if (Date.now() >= deadline) return false;
    sleepMs(3);
  }
}
export function unlockSync(lockPath) {
  try { rmSync(lockPath, { recursive: true, force: true }); } catch { /* already gone */ }
}

function withQueueLock(p, fn, opts) {
  if (!lockSync(p.lock, opts)) return undefined;
  try { return fn(); } finally { unlockSync(p.lock); }
}

// --- queue -----------------------------------------------------------------------------

export function readQueue(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is dropped, not fatal */ }
  }
  return out;
}

function writeQueue(file, events) {
  writeAtomic(file, events.length ? events.map((e) => JSON.stringify(e)).join('\n') + '\n' : '', 0o600);
}

/**
 * Housekeeping: drop events older than 24 h (useless for liveness — the fleet ends a
 * session after 30 min of silence anyway) and cap the queue by dropping the OLDEST.
 * Order is preserved. Pure, so the cap and expiry are testable on their own.
 */
export function trimQueue(events, { now = Date.now(), max = QUEUE_MAX } = {}) {
  const fresh = events.filter((e) => {
    const t = Date.parse(e && e.ts);
    return Number.isFinite(t) && now - t <= EVENT_TTL_MS;
  });
  return fresh.length > max ? fresh.slice(fresh.length - max) : fresh;
}

// --- state -----------------------------------------------------------------------------

export function loadState(dir = fleetDir()) {
  const s = readJson(fleetPaths(dir).state, {});
  return s && typeof s === 'object' ? s : {};
}
function saveState(p, s) {
  writeAtomic(p.state, JSON.stringify(s) + '\n', 0o600);
}
// Read-modify-write the state under the queue lock (the hot path writes it too).
export function updateState(dir, fn) {
  const p = fleetPaths(dir);
  ensureDir(dir);
  return withQueueLock(p, () => {
    const s = loadState(dir);
    const out = fn(s) || s;
    saveState(p, out);
    return out;
  }, { waitMs: 2000 });
}

function logLine(p, msg) {
  try {
    try { if (statSync(p.log).size > 64 * 1024) rmSync(p.log, { force: true }); } catch { /* no log yet */ }
    appendFileSync(p.log, `${new Date().toISOString()} ${msg}\n`, { mode: 0o600 });
  } catch { /* logging is best-effort */ }
}

// --- the hot path ------------------------------------------------------------------------

/**
 * Turn one hook payload into (at most) one queued line — plus an `outcome` line when
 * it is a successful Bash `git commit`. Returns what happened, for
 * tests; the hook script ignores it. Never throws on bad input — but the script wraps
 * it anyway, because "never break the session" is not a property to trust one layer for.
 */
export function enqueueHookEvent(input, { dir = fleetDir(), now = Date.now(), resolve = resolveProject, head = headCommit } = {}) {
  const cfg = loadConfig(dir);
  if (!cfg) return { queued: false, why: 'not-connected' };
  if (cfg.paused) return { queued: false, why: 'paused' };
  if (!input || !EVENT_TYPES[input.hook_event_name] || !input.session_id) return { queued: false, why: 'ignored' };
  const p = fleetPaths(dir);
  const sid = input.session_id;
  const cwd = typeof input.cwd === 'string' ? input.cwd : '';

  // Project identity is cached per (session, cwd) so a burst of tool calls doesn't fork
  // git each time. A new session re-resolves: the remote may have changed since.
  const pre = loadState(dir);
  const cached = pre.projects && pre.projects[cwd];
  let project;
  if (cached && cached.sid === sid && input.hook_event_name !== 'SessionStart') {
    project = cached.project;
  } else {
    project = resolve(cwd);
  }

  const ev = mapEvent(input, { project, hideNames: !!cfg.hide_names, now });
  if (!ev) return { queued: false, why: 'ignored' };
  // A commit is an outcome on top of the tool tick, never coalesced with it: git is only
  // forked for a Bash call that ran `git commit`, so the common tool event stays cheap.
  const commit = commitOutcome(input, { head });
  const outcomeEv = commit && mapOutcome(commit, { sessionId: sid, cwd: cwd || null, project, hideNames: !!cfg.hide_names, now });

  const res = withQueueLock(p, () => {
    const s = loadState(dir);
    s.projects ??= {};
    s.last_tool ??= {};
    let changed = false;
    if (!s.projects[cwd] || s.projects[cwd].sid !== sid || JSON.stringify(s.projects[cwd].project) !== JSON.stringify(project)) {
      s.projects[cwd] = { sid, project, at: now };
      changed = true;
    }
    // Coalesce tool events: the fleet needs liveness and state, not a call log.
    if (ev.type === 'tool') {
      const last = s.last_tool[sid] || 0;
      if (now - last < TOOL_COALESCE_MS) {
        if (changed) saveState(p, s);
        if (!outcomeEv) return { queued: false, why: 'coalesced' };
        appendEvents(p, s, [outcomeEv], now);
        return { queued: true, event: outcomeEv, state: s };
      }
      s.last_tool[sid] = now;
      changed = true;
    } else if (ev.type === 'session_end' && s.last_tool[sid]) {
      delete s.last_tool[sid];
      changed = true;
    }
    // Prune per-session caches a day old so the state file can't grow without bound.
    for (const [k, v] of Object.entries(s.projects)) if (!v || now - (v.at || 0) > EVENT_TTL_MS) { delete s.projects[k]; changed = true; }
    for (const [k, v] of Object.entries(s.last_tool)) if (now - v > EVENT_TTL_MS) { delete s.last_tool[k]; changed = true; }
    if (changed) saveState(p, s);

    appendEvents(p, s, outcomeEv ? [ev, outcomeEv] : [ev], now);
    return { queued: true, event: ev, state: s };
  });
  if (!res) return { queued: false, why: 'lock-busy' };
  return res;
}

// Append under the queue lock (the caller holds it), then apply the cap.
function appendEvents(p, s, events, now) {
  appendFileSync(p.queue, events.map((e) => JSON.stringify(e) + '\n').join(''), { mode: 0o600 });
  // Cheap cap check: only read the queue back when its SIZE says it might be over
  // (no event is under ~50 bytes). Normally the flusher keeps the queue near empty;
  // this matters while the fleet is unreachable or the token was refused.
  const max = s.auth_failed ? QUEUE_MAX_AUTH_FAILED : QUEUE_MAX;
  try {
    if (statSync(p.queue).size > max * 50) {
      const q = readQueue(p.queue);
      const t = trimQueue(q, { now, max });
      if (t.length !== q.length) writeQueue(p.queue, t);
    }
  } catch { /* cap is re-applied by the flusher */ }
}

/**
 * Queue one outcome from `ac` (not from a hook). Same gates as the hook: not connected
 * or paused → nothing. `cwd` is the project root; identity resolves by resolveProject.
 */
export function enqueueOutcome(outcome, { dir = fleetDir(), cwd = '', now = Date.now(), resolve = resolveProject, env = process.env } = {}) {
  const cfg = loadConfig(dir);
  if (!cfg) return { queued: false, why: 'not-connected' };
  if (cfg.paused) return { queued: false, why: 'paused' };
  const hideNames = !!cfg.hide_names;
  const project = resolve(cwd);
  const ev = mapOutcome(outcome, {
    sessionId: outcomeSessionId(project, cwd, { hideNames, env }), cwd: cwd || null, project, hideNames, now,
  });
  if (!ev) return { queued: false, why: 'ignored' };
  const p = fleetPaths(dir);
  const res = withQueueLock(p, () => {
    const s = loadState(dir);
    appendEvents(p, s, [ev], now);
    return { queued: true, event: ev, state: s };
  });
  return res || { queued: false, why: 'lock-busy' };
}

/**
 * `ac`'s entry point: queue the outcome and start a flusher, exactly as the hook does.
 * Never throws and never waits on the network — a failure is logged to fleet.log and
 * the command carries on as if the fleet didn't exist.
 */
export function reportOutcome(outcome, opts = {}) {
  const dir = opts.dir || fleetDir();
  try {
    const r = enqueueOutcome(outcome, { ...opts, dir });
    if (r.queued && shouldSpawnFlusher(dir, { state: r.state })) {
      spawnFlusher(join(dirname(fileURLToPath(import.meta.url)), 'astro-fleet-flush.mjs'), dir);
    }
    return r;
  } catch (e) {
    if (existsSync(dir)) logLine(fleetPaths(dir), `outcome not reported: ${String(e?.message || e).slice(0, 200)}`);
    return { queued: false, why: 'error' };
  }
}

// Should the hook start a flusher now? Not while one runs, not inside a back-off window
// (it "tries again on the next hook fire"), and not after the token was refused.
export function shouldSpawnFlusher(dir = fleetDir(), { now = Date.now(), state = loadState(dir) } = {}) {
  if (state.auth_failed) return false;
  if (state.backoff_until && now < state.backoff_until) return false;
  return !flusherRunning(dir, now);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

export function flusherRunning(dir = fleetDir(), now = Date.now()) {
  const p = fleetPaths(dir);
  let st;
  try { st = statSync(p.flushLock); } catch { return false; }
  if (now - st.mtimeMs > FLUSH_LOCK_STALE_MS) return false;
  const pid = Number.parseInt(readFileSync(p.flushLock, 'utf8'), 10);
  return pidAlive(pid);
}

export function spawnFlusher(script, dir = fleetDir()) {
  const child = spawn(process.execPath, [script], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, ASTRO_FLEET_DIR: dir },
  });
  child.on('error', () => { /* best-effort */ });
  child.unref();
}

// --- the flusher -------------------------------------------------------------------------

function acquireFlushLock(p) {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(p.flushLock, 'wx', 0o600);
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      if (flusherRunning(p.dir)) return false;
      rmSync(p.flushLock, { force: true }); // stale: its owner died
    }
  }
  return false;
}

export function parseRetryAfter(v, now = Date.now()) {
  if (v == null || v === '') return null;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return Math.round(s * 1000);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

export function buildBody(color, events) {
  const body = { events };
  if (color) body.color = color;
  return JSON.stringify(body);
}

/** One POST. Never throws: a network failure comes back as `{ status: 0 }`. */
export async function postBatch(cfg, events, { timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  try {
    const res = await fetch(`${cfg.url}/api/ingest/events`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: buildBody(cfg.color, events),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let text = '';
    try { text = await res.text(); } catch { /* body unreadable — status is what counts */ }
    return { status: res.status, retryAfter: res.headers.get('retry-after'), text };
  } catch (e) {
    // undici hides the reason in `cause` (sometimes an AggregateError); a timeout is
    // its own error name. Either way only a short reason — never the request — is kept.
    const c = e?.cause;
    const why = c?.code || c?.errors?.[0]?.code || (e?.name === 'TimeoutError' ? 'timed out' : null) || c?.message || e?.message;
    return { status: 0, error: String(why || 'network error').slice(0, 120) };
  }
}

// Split so every chunk is ≤ BATCH_MAX events and ≤ BODY_MAX bytes. A lone event over
// the byte limit is returned alone; the server's 413 then drops it.
export function chunkEvents(events, color) {
  const out = [];
  let cur = [];
  for (const ev of events) {
    const next = [...cur, ev];
    if (cur.length && (next.length > BATCH_MAX || Buffer.byteLength(buildBody(color, next)) > BODY_MAX)) {
      out.push(cur);
      cur = [ev];
    } else {
      cur = next;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Send one batch, splitting on 413. Returns how many leading events of `events` may be
 * dropped from the queue, plus a stop reason when sending must pause.
 */
async function sendWithSplit(cfg, events, post) {
  const r = await post(cfg, events);
  if (r.status >= 200 && r.status < 300) return { done: events.length, ok: true };
  // A fleet older than `outcome` answers a batch of nothing else with 400 "no recognised
  // events". That is the expected skip, not an error worth showing in `ac fleet status`.
  if (r.status === 400 && events.every((e) => e && e.type === 'outcome')) return { done: events.length };
  if (r.status === 400) return { done: events.length, dropped: true, r };
  if (r.status === 413) {
    if (events.length === 1) return { done: 1, dropped: true, r };
    const mid = Math.ceil(events.length / 2);
    const a = await sendWithSplit(cfg, events.slice(0, mid), post);
    if (a.stop || a.done < mid) return a;
    const b = await sendWithSplit(cfg, events.slice(mid), post);
    return { ...b, done: mid + b.done, ok: a.ok || b.ok };
  }
  return { done: 0, stop: true, r };
}

/**
 * Drain the queue: batches of ≤100 until it is empty or the fleet says stop.
 *   2xx              → drop the batch, record last_success, clear back-off
 *   400              → drop the batch and log it (it will never succeed)
 *   413              → split and resend the halves
 *   401 / 403        → record last_error, stop sending until reconnect, keep newest 1000
 *   429, 5xx, network → keep, back off 1 s → 60 s (Retry-After wins), retry next hook fire
 * Other statuses (a 404 from a fleet without phase 36, say) are treated as retryable:
 * dropping data because of a misconfigured URL would be the worse failure.
 */
export async function flush({ dir = fleetDir(), post = postBatch, now = () => Date.now(), force = false } = {}) {
  const p = fleetPaths(dir);
  if (!existsSync(dir)) return { sent: 0, why: 'not-connected' };
  if (!acquireFlushLock(p)) return { sent: 0, why: 'already-running' };
  let sent = 0;
  try {
    for (;;) {
      const cfg = loadConfig(dir);
      if (!cfg) return { sent, why: 'not-connected' };
      if (cfg.paused) return { sent, why: 'paused' };
      const st = loadState(dir);
      if (st.auth_failed) return { sent, why: 'auth-failed' };
      if (!force && st.backoff_until && now() < st.backoff_until) return { sent, why: 'backoff' };

      const batch = withQueueLock(p, () => {
        const q = readQueue(p.queue);
        const t = trimQueue(q, { now: now() });
        if (t.length !== q.length) writeQueue(p.queue, t);
        return t.slice(0, BATCH_MAX);
      }, { waitMs: 2000 });
      if (!batch || !batch.length) return { sent, why: batch ? 'empty' : 'lock-busy' };

      let done = 0;
      let res = { ok: false };
      for (const chunk of chunkEvents(batch, cfg.color)) {
        res = await sendWithSplit(cfg, chunk, post);
        done += res.done;
        if (res.stop || res.done < chunk.length) break;
      }

      // Disconnected mid-request: the queue and state are gone on purpose — don't
      // resurrect them.
      if (!existsSync(p.config)) return { sent, why: 'not-connected' };
      // Only one flusher runs and hooks only APPEND, so the first `done` lines are
      // still exactly the ones just sent.
      updateState(dir, (s) => {
        if (done) {
          const q = readQueue(p.queue);
          writeQueue(p.queue, q.slice(done));
        }
        if (res.dropped) {
          s.last_error = { at: now(), status: res.r.status, message: `fleet rejected a batch (HTTP ${res.r.status}) — dropped` };
          logLine(p, `dropped a batch: HTTP ${res.r.status} ${String(res.r.text || '').slice(0, 200)}`);
        }
        if (res.ok) {
          s.last_success = now();
          delete s.backoff_ms;
          delete s.backoff_until;
        }
        if (res.stop) {
          const { status, retryAfter, error } = res.r;
          if (status === 401 || status === 403) {
            s.auth_failed = true;
            s.last_error = { at: now(), status, message: status === 401 ? 'token invalid or revoked (HTTP 401) — sending stopped; run `ac fleet connect` with a new token' : 'token not allowed (HTTP 403) — sending stopped' };
            const q = readQueue(p.queue);
            if (q.length > QUEUE_MAX_AUTH_FAILED) writeQueue(p.queue, q.slice(q.length - QUEUE_MAX_AUTH_FAILED));
          } else {
            const nextMs = Math.min(BACKOFF_MAX_MS, s.backoff_ms ? s.backoff_ms * 2 : BACKOFF_MIN_MS);
            const ra = status === 429 ? parseRetryAfter(retryAfter, now()) : null;
            s.backoff_ms = nextMs;
            s.backoff_until = now() + (ra != null ? ra : nextMs);
            s.last_error = { at: now(), status, message: status ? `HTTP ${status} — retrying` : `${error || 'network error'} — retrying` };
          }
        }
        return s;
      });
      sent += done;
      if (res.stop) return { sent, why: res.r.status === 401 || res.r.status === 403 ? 'auth-failed' : 'backoff', status: res.r.status };
    }
  } finally {
    rmSync(p.flushLock, { force: true });
  }
}
