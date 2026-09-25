// Phase 26 t6 — RED: the transcript reader (P2-P4). Every not-yet-existing symbol is
// reached through a dynamic import inside each async test body (ADR-018). Fixtures are
// imported statically (tests/fixtures/minefixtures.mjs already exists — t1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import {
  sandbox, addProfile, claudeProjectDir, writeClaudeSession, writeClaudeSubagent,
  writeCodexRollout, appendLines,
  cHuman, cAssistant, cToolResult, cMeta, cReminder, cTaskNotification,
  cCommand, cCommandBody, cSidechain, cHeadless, cUnknownType,
  xUser, xAssistant, xEnvContext, xUserInstructions, xToolOutput,
  GARBAGE_LINES,
} from './fixtures/minefixtures.mjs';

const TRANSCRIPTS = '../lib/transcripts.mjs';

// ── readLines ────────────────────────────────────────────────────────────────────────

test('readLines yields exact byte start/end and resumes from a mid-file start', async () => {
  const { readLines } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const file = join(sb.home, 'lines.jsonl');
  writeFileSync(file, 'aaa\nbb\ncccc\n');
  const all = [...readLines(file)];
  assert.deepEqual(all.map((l) => l.text), ['aaa', 'bb', 'cccc']);
  assert.equal(all[0].start, 0);
  assert.equal(all[0].end, 4);
  assert.equal(all[1].start, 4);
  assert.equal(all[2].start, 7);

  const resumed = [...readLines(file, { start: all[1].start })];
  assert.deepEqual(resumed.map((l) => l.text), ['bb', 'cccc']);
});

test('readLines never yields a trailing partial line; end stops before it', async () => {
  const { readLines } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const file = join(sb.home, 'partial.jsonl');
  writeFileSync(file, 'complete\nincomplete-no-newline');
  const all = [...readLines(file)];
  assert.deepEqual(all.map((l) => l.text), ['complete']);
  assert.equal(all[0].end, 9);
});

test('readLines yields { oversized: true } without materialising a line over the cap', async () => {
  const { readLines } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const file = join(sb.home, 'oversized.jsonl');
  const big = 'x'.repeat(1000);
  writeFileSync(file, `${big}\nok\n`);
  const all = [...readLines(file, { maxLineBytes: 100 })];
  assert.equal(all.length, 2);
  assert.equal(all[0].oversized, true);
  assert.equal(all[0].text, undefined);
  assert.deepEqual(all[1].text, 'ok');
});

test('readLines handles multi-byte UTF-8 across small chunk boundaries', async () => {
  const { readLines } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const file = join(sb.home, 'utf8.jsonl');
  writeFileSync(file, 'héllo wörld 日本語\nsecond äöü\n', 'utf8');
  const all = [...readLines(file, { chunkBytes: 7 })];
  assert.deepEqual(all.map((l) => l.text), ['héllo wörld 日本語', 'second äöü']);
});

// ── sessionFiles ─────────────────────────────────────────────────────────────────────

test('sessionFiles: default scope finds base + a profile + a matching Codex session, not project Q', async () => {
  const { sessionFiles } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  writeClaudeSession(sb.claude, root, 'sess-a', [cHuman('from base')]);
  const profileDir = addProfile(sb, 'work');
  writeClaudeSession(profileDir, root, 'sess-b', [cHuman('from profile')]);
  const qRoot = join(sb.home, 'q');
  mkdirSync(qRoot, { recursive: true });
  writeClaudeSession(sb.claude, qRoot, 'sess-q', [cHuman('from q')]);
  writeCodexRollout(sb.codex, { id: 'codex-a', cwd: root }, [xUser('codex human')]);
  writeCodexRollout(sb.codex, { id: 'codex-other', cwd: qRoot }, [xUser('codex other')]);

  const files = sessionFiles({ roots: [root], env: sb.env });
  const sessions = files.map((f) => f.session).sort();
  assert.deepEqual(sessions, ['codex-a', 'sess-a', 'sess-b'].sort());
});

test('sessionFiles: subagents/ files are never listed', async () => {
  const { sessionFiles } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  writeClaudeSession(sb.claude, root, 'sess-a', [cHuman('hi')]);
  writeClaudeSubagent(sb.claude, root, 'sess-a', 'agent-1', [cHuman('sub')]);
  const files = sessionFiles({ roots: [root], env: sb.env });
  assert.ok(!files.some((f) => f.file.includes('subagents')));
});

test('sessionFiles: --all finds everything, across every project and Codex rollout', async () => {
  const { sessionFiles } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  const other = join(sb.home, 'other');
  mkdirSync(root, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeClaudeSession(sb.claude, root, 'sess-a', [cHuman('hi')]);
  writeClaudeSession(sb.claude, other, 'sess-b', [cHuman('hi')]);
  writeCodexRollout(sb.codex, { id: 'codex-a', cwd: root }, [xUser('hi')]);
  writeCodexRollout(sb.codex, { id: 'codex-b', cwd: other }, [xUser('hi')]);
  const files = sessionFiles({ all: true, env: sb.env });
  const sessions = files.map((f) => f.session).sort();
  assert.deepEqual(sessions, ['codex-a', 'codex-b', 'sess-a', 'sess-b'].sort());
});

test('sessionFiles: the realpath variant of the root is also found', async () => {
  const { sessionFiles } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  writeClaudeSession(sb.claude, realpathSync(root), 'sess-a', [cHuman('hi')]);
  const files = sessionFiles({ roots: [root, realpathSync(root)], env: sb.env });
  assert.ok(files.some((f) => f.session === 'sess-a'));
});

// C9 remediation: a Codex rollout with no readable `session_meta` line (so its `cwd` is
// unrecoverable) must fail OPEN in default project scope — it can never be proven to
// belong to a DIFFERENT project, so "unknown ≠ empty" (ADR-043/054) means it stays in
// scope rather than vanishing as if the sweep found nothing at all.
test('sessionFiles: a Codex rollout with an unrecoverable cwd (no session_meta line) still appears in default project scope', async () => {
  const { sessionFiles } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const dir = join(sb.codex, 'sessions', '2026', '09', '24');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'rollout-no-meta.jsonl');
  appendLines(file, [
    { type: 'future_codex_event', a: 1 },
    { type: 'future_codex_event', a: 2 },
  ]);
  const files = sessionFiles({ roots: [root], env: sb.env });
  assert.ok(files.some((f) => f.host === 'codex' && f.file === file));
});

// ── Claude classification ───────────────────────────────────────────────────────────

test('classifyClaudeLine: typed human turns (with and without origin) are human', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cHuman('hello there')).kind, 'human');
  assert.equal(classifyClaudeLine(cHuman('hi', { origin: { kind: 'human' } })).kind, 'human');
});

test('classifyClaudeLine: a tool_result array is excluded', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cToolResult('result text')).kind, 'excluded');
});

test('classifyClaudeLine: isMeta is excluded', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cMeta('meta body')).kind, 'excluded');
});

test('classifyClaudeLine: a <system-reminder>-only line is excluded', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cReminder('reminder text')).kind, 'excluded');
});

test('classifyClaudeLine: task-notification origin is excluded (injected)', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cTaskNotification('notify')).kind, 'excluded');
});

test('classifyClaudeLine: a slash command\'s human text is exactly its command-args', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  const r = classifyClaudeLine(cCommand('astro-mine', 'from now on never use X4'));
  assert.equal(r.kind, 'human');
  assert.equal(r.text, 'from now on never use X4');
});

test('classifyClaudeLine: the following isMeta command body is excluded', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cCommandBody('expanded body')).kind, 'excluded');
});

test('classifyClaudeLine: isSidechain is excluded', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cSidechain('sub text')).kind, 'excluded');
});

test('classifyClaudeLine: an unknown type is unrecognised', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine(cUnknownType()).kind, 'unrecognised');
});

test('classifyClaudeLine: a known ignorable type is ignored, not skipped', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  assert.equal(classifyClaudeLine({ type: 'summary' }).kind, 'ignored');
  assert.equal(classifyClaudeLine({ type: 'file-history-snapshot' }).kind, 'ignored');
});

test('classifyClaudeLine: an assistant line is context text', async () => {
  const { classifyClaudeLine } = await import(TRANSCRIPTS);
  const r = classifyClaudeLine(cAssistant('assistant said this'));
  assert.equal(r.kind, 'assistant');
  assert.equal(r.text, 'assistant said this');
});

// ── scanSession (Claude) ─────────────────────────────────────────────────────────────

test('scanSession: a headless file yields zero turns and headless: true', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const file = writeClaudeSession(sb.claude, root, 'sess-h', [cHeadless('never please always use pnpm')]);
  const result = scanSession({ file, host: 'claude' });
  assert.equal(result.headless, true);
  assert.equal(result.turns.length, 0);
});

test('scanSession: garbage lines are counted as malformed/unrecognised while a valid steer still comes through', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const file = join(sb.home, '.claude', 'projects', root.replace(/[^a-zA-Z0-9]/g, '-'), 'sess-g.jsonl');
  mkdirSync(join(file, '..'), { recursive: true });
  appendLines(file, [...GARBAGE_LINES, cHuman('always run the linter before committing')]);
  const result = scanSession({ file, host: 'claude' });
  assert.equal(result.turns.length, 1);
  assert.ok(result.skipped.malformed >= 1);
  assert.ok(result.skipped.unrecognised >= 1);
});

test('scanSession: an all-unrecognised file yields zero turns with a non-zero unrecognised count', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const file = writeClaudeSession(sb.claude, root, 'sess-u', [cUnknownType(), cUnknownType()]);
  const result = scanSession({ file, host: 'claude' });
  assert.equal(result.turns.length, 0);
  assert.equal(result.skipped.unrecognised, 2);
});

test('scanSession: each human turn carries the preceding assistant text as context', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const file = writeClaudeSession(sb.claude, root, 'sess-c', [
    cAssistant('here is my plan'),
    cHuman('no, do it differently'),
  ]);
  const result = scanSession({ file, host: 'claude' });
  assert.equal(result.turns.length, 1);
  assert.match(result.turns[0].context, /here is my plan/);
});

test('scanSession: starting at a start past the assistant line but with ctxStart before it still gives context', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  mkdirSync(root, { recursive: true });
  const file = writeClaudeSession(sb.claude, root, 'sess-x', [
    cAssistant('earlier plan'),
    cHuman('always do it this way'),
  ]);
  const first = scanSession({ file, host: 'claude' });
  const humanStart = first.turns[0].start;
  const second = scanSession({ file, host: 'claude', start: humanStart, ctxStart: 0 });
  assert.equal(second.turns.length, 1);
  assert.match(second.turns[0].context, /earlier plan/);
});

// ── Codex ────────────────────────────────────────────────────────────────────────────

test('codexSessionMeta reads id and cwd from the leading session_meta line', async () => {
  const { codexSessionMeta } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  const file = writeCodexRollout(sb.codex, { id: 'cx-1', cwd: root }, [xUser('hi')]);
  const meta = codexSessionMeta(file);
  assert.equal(meta.id, 'cx-1');
  assert.equal(meta.cwd, root);
});

test('classifyCodexLine: codex_exec originator marks the session headless via scanSession', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  const file = writeCodexRollout(sb.codex, { id: 'cx-h', cwd: root, originator: 'codex_exec' }, [
    xUser('always run the tests first'),
  ]);
  const result = scanSession({ file, host: 'codex' });
  assert.equal(result.headless, true);
  assert.equal(result.turns.length, 0);
});

test('classifyCodexLine: environment_context and user_instructions user messages are excluded', async () => {
  const { classifyCodexLine } = await import(TRANSCRIPTS);
  assert.equal(classifyCodexLine(xEnvContext('cwd: /x')).kind, 'excluded');
  assert.equal(classifyCodexLine(xUserInstructions('be nice')).kind, 'excluded');
});

test('classifyCodexLine: function_call_output is excluded (tool-result)', async () => {
  const { classifyCodexLine } = await import(TRANSCRIPTS);
  assert.equal(classifyCodexLine(xToolOutput('some output')).kind, 'excluded');
});

test('classifyCodexLine: event_msg is ignored, not counted as a turn', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const root = join(sb.home, 'proj');
  const file = writeCodexRollout(sb.codex, { id: 'cx-e', cwd: root }, [
    xUser('never write semicolons'),
    { timestamp: new Date().toISOString(), type: 'event_msg', payload: { type: 'user_message', message: 'never write semicolons' } },
  ]);
  const result = scanSession({ file, host: 'codex' });
  assert.equal(result.turns.length, 1);
});

test('classifyCodexLine: a legacy first line without type is unrecognised', async () => {
  const { classifyCodexLine } = await import(TRANSCRIPTS);
  assert.equal(classifyCodexLine({ timestamp: new Date().toISOString(), payload: {} }).kind, 'unrecognised');
});

// Phase 26 verify, C9 — Codex shape drift is COUNTED, never read as an empty human turn.
// A user message whose content is a bare string, whose blocks are typed `text`, or which
// has no content at all used to classify as `{ kind: 'human', text: '' }`: the sweep then
// reported zero candidates and zero skips, indistinguishable from a clean session.
test('classifyCodexLine: a user or assistant message of an unknown content shape is unrecognised', async () => {
  const { classifyCodexLine } = await import(TRANSCRIPTS);
  const msg = (role, content) => ({ type: 'response_item', payload: { type: 'message', role, ...(content === undefined ? {} : { content }) } });
  assert.equal(classifyCodexLine(msg('user', 'From now on always run the linter.')).kind, 'unrecognised');
  assert.equal(classifyCodexLine(msg('user', [{ type: 'text', text: 'always run the linter' }])).kind, 'unrecognised');
  assert.equal(classifyCodexLine(msg('user', undefined)).kind, 'unrecognised');
  assert.equal(classifyCodexLine(msg('assistant', [{ type: 'text', text: 'ok' }])).kind, 'unrecognised');
  assert.equal(classifyCodexLine(msg('user', [{ type: 'input_text', text: 'hi' }])).kind, 'human');
  assert.equal(classifyCodexLine(msg('assistant', [{ type: 'output_text', text: 'ok' }])).kind, 'assistant');
});

test('scanSession: a Codex rollout made only of drifted user messages reports them as unrecognised', async () => {
  const { scanSession } = await import(TRANSCRIPTS);
  const sb = sandbox();
  const drift = (content) => ({ timestamp: new Date().toISOString(), type: 'response_item', payload: { type: 'message', role: 'user', content } });
  const file = writeCodexRollout(sb.codex, { id: 'drift1', cwd: join(sb.home, 'proj') }, [
    drift('From now on always run the linter.'),
    drift([{ type: 'text', text: 'never skip the tests' }]),
  ]);
  const result = scanSession({ file, host: 'codex' });
  assert.equal(result.turns.length, 0);
  assert.equal(result.skipped.unrecognised, 2);
});
