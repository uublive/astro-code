// The cross-host agent runner: astro-code owns wave orchestration, each host
// only answers "how do I invoke one headless agent".
//
// Every test here injects a fake spawn, so the whole orchestration layer is
// verified without spending a token or needing any harness installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getHost } from '../lib/hosts/index.mjs';
import { runWave, buildInvocation } from '../lib/hosts/runner.mjs';
import { missingFromWave } from '../lib/waves.mjs';

const claude = getHost('claude');
const codex = getHost('codex');

/** A spawn stub: decides per-call from the argv it is handed. */
function fakeSpawn(handler) {
  const calls = [];
  const fn = async (opts) => { calls.push(opts); return handler(opts, calls.length - 1); };
  fn.calls = calls;
  return fn;
}
const ok = (stdout = 'done') => async () => ({ code: 0, stdout, stderr: '' });

// --- argv construction ----------------------------------------------------------

test('Claude runs headless with --print and an appended system prompt', () => {
  const inv = buildInvocation(claude, {
    prompt: 'do it', model: 'opus', systemPrompt: 'you are x', tools: ['Read', 'Bash'],
  });
  assert.equal(inv.command, 'claude');
  assert.ok(inv.args.includes('--print'));
  assert.deepEqual(inv.args.slice(inv.args.indexOf('--model'), inv.args.indexOf('--model') + 2), ['--model', 'opus']);
  assert.ok(inv.args.includes('--append-system-prompt'));
  assert.equal(inv.args[inv.args.length - 1], 'do it');
});

test('Codex delegates worktree isolation to the host; Claude cannot', () => {
  const task = { prompt: 'p', worktree: true, cwd: '/tmp/wt' };
  const c = buildInvocation(codex, task);
  assert.ok(c.args.includes('--worktree'), 'codex isolates natively');
  assert.equal(c.worktreeByHost, true);

  const a = buildInvocation(claude, task);
  assert.ok(!a.args.includes('--worktree'), 'claude has no such flag');
  assert.equal(a.worktreeByHost, false, 'and says so, rather than implying it happened');
  assert.equal(a.cwd, '/tmp/wt', 'so the caller-made worktree is used as the spawn cwd');
});

// --- the honest part: a schema that cannot be enforced --------------------------

test('a schema is enforced by Codex and only REQUESTED on Claude — and it says which', () => {
  const schema = { type: 'object', properties: { verdict: { type: 'string' } } };

  const c = buildInvocation(codex, { prompt: 'p', schema, schemaFile: '/tmp/s.json' });
  assert.ok(c.args.includes('--output-schema'), 'codex enforces it provider-side');
  assert.equal(c.schemaEnforced, true);
  assert.equal(c.args[c.args.length - 1], 'p', 'so the prompt is NOT polluted with the schema');

  const a = buildInvocation(claude, { prompt: 'p', schema });
  assert.equal(a.schemaEnforced, false, 'claude cannot enforce it — must not claim otherwise');
  assert.match(a.args[a.args.length - 1], /ONLY a JSON object/, 'falls back to asking in the prompt');
  assert.match(a.args[a.args.length - 1], /"verdict"/, 'and includes the actual schema');
});

test('schemaEnforced is null when no schema was asked for', () => {
  assert.equal(buildInvocation(claude, { prompt: 'p' }).schemaEnforced, null);
  assert.equal(buildInvocation(codex, { prompt: 'p' }).schemaEnforced, null);
});

// --- orchestration --------------------------------------------------------------

test('a wave runs concurrently up to the cap and returns results positionally', async () => {
  const tasks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, prompt: `p${i}` }));
  let live = 0;
  let peak = 0;
  const spawnFn = async () => {
    live++; peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    return { code: 0, stdout: 'x', stderr: '' };
  };
  const results = await runWave(tasks, { host: claude, concurrency: 2, spawnFn });
  assert.equal(results.length, 6);
  assert.ok(results.every((r) => r && r.ok));
  assert.deepEqual(results.map((r) => r.id), tasks.map((t) => t.id), 'positional, in task order');
  assert.ok(peak <= 2, `concurrency cap respected (peak ${peak})`);
});

test('a failed agent becomes a positional HOLE, never a rejected batch', async () => {
  // This mirrors the Workflow tool's parallel() contract, which waves.mjs
  // depends on: a wave that silently lost work is the bug that guarantee
  // exists to prevent.
  const tasks = [{ id: 'a', prompt: '1' }, { id: 'b', prompt: '2' }, { id: 'c', prompt: '3' }];
  const spawnFn = async (o) => (o.args.at(-1) === '2'
    ? { code: 1, stdout: '', stderr: 'boom' }
    : { code: 0, stdout: 'fine', stderr: '' });

  const results = await runWave(tasks, { host: claude, spawnFn });
  assert.equal(results.length, 3);
  assert.equal(results[1], null, 'the failure is a falsy hole at its own index');
  assert.ok(results[0].ok && results[2].ok);

  // and the existing recovery path finds exactly that hole
  assert.deepEqual(missingFromWave(tasks, results).map((t) => t.id), ['b']);
});

test('a spawn that throws is contained, not propagated', async () => {
  const spawnFn = async () => { throw new Error('ENOENT: no such binary'); };
  const results = await runWave([{ id: 'a', prompt: 'x' }], { host: claude, spawnFn });
  assert.deepEqual(results, [null], 'one broken host must not lose the whole wave');
});

test('an empty wave is a no-op, not a hang', async () => {
  assert.deepEqual(await runWave([], { host: claude, spawnFn: ok() }), []);
});

test('a host with no execCommand is rejected loudly', async () => {
  await assert.rejects(
    () => runWave([{ prompt: 'x' }], { host: { id: 'fake' } }),
    /cannot run agents/,
  );
});

// --- result extraction ----------------------------------------------------------

test('json results are parsed, including a JSONL stream where the last line wins', async () => {
  const single = await runWave([{ id: 'a', prompt: 'p', json: true }], {
    host: claude, spawnFn: ok('{"verdict":"pass"}'),
  });
  assert.deepEqual(single[0].result, { verdict: 'pass' });

  const stream = await runWave([{ id: 'a', prompt: 'p', json: true }], {
    host: codex, spawnFn: ok('{"type":"start"}\n{"type":"item"}\n{"verdict":"done"}'),
  });
  assert.deepEqual(stream[0].result, { verdict: 'done' }, 'JSONL: last parseable line');
});

test('unparseable json degrades to raw text instead of throwing', async () => {
  const r = await runWave([{ id: 'a', prompt: 'p', json: true }], {
    host: claude, spawnFn: ok('not json at all'),
  });
  assert.equal(r[0].result, 'not json at all');
});

test('progress is reported per task for both start and end', async () => {
  const events = [];
  await runWave([{ id: 'a', prompt: 'p' }], {
    host: claude, spawnFn: ok(), onProgress: (e) => events.push(`${e.phase}:${e.task.id}`),
  });
  assert.deepEqual(events, ['start:a', 'end:a']);
});

test('every task field the adapters accept is actually forwarded', () => {
  // A field silently dropped between the task and the adapter produces argv
  // that looks right in review and is wrong on the wire — which is exactly how
  // --sandbox went missing from the first live Codex run.
  const inv = buildInvocation(codex, {
    prompt: 'p', model: 'gpt-5-codex', sandbox: 'read-only', outFile: '/tmp/o', json: true,
  });
  assert.ok(inv.args.includes('--sandbox'), '--sandbox must reach the argv');
  assert.equal(inv.args[inv.args.indexOf('--sandbox') + 1], 'read-only');
  assert.ok(inv.args.includes('--output-last-message'));
  assert.ok(inv.args.includes('--json'));

  const c = buildInvocation(claude, { prompt: 'p', permissionMode: 'acceptEdits' });
  assert.equal(c.args[c.args.indexOf('--permission-mode') + 1], 'acceptEdits');
});
