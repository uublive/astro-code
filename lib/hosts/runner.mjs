// Running agents on whichever host is driving.
//
// Claude Code is the only one of the three harnesses with deterministic,
// script-driven fan-out (the Workflow tool). Pi and Codex delegate through
// model-driven prose — "have code_mapper trace the path, then ui_fixer fix it"
// — which you cannot build wave execution on: the model decides what runs, and
// astro-code's whole safety argument (ADR-005) rests on the SCRIPT deciding.
//
// So astro-code owns the orchestration. `lib/waves.mjs` already computes the
// waves; this module runs one wave against a host. Each adapter only has to
// answer "how do I invoke one headless agent", which every harness supports:
//
//     claude --print …          codex exec …          pi …
//
// One orchestrator, three thin adapters — instead of reimplementing wave
// execution once per host.
//
// ## Failure semantics
//
// Deliberately mirrors the Workflow tool's `parallel()`: results are POSITIONAL
// and a failed agent resolves to a falsy entry rather than rejecting the batch.
// `waves.missingFromWave()` already depends on exactly that shape to re-run the
// holes on-branch, and it exists because a whole wave once vanished silently
// when results were blindly `.filter(Boolean)`-ed. Keeping the same contract
// means that recovery path works unchanged on every host.
import { spawn } from 'node:child_process';

/** Default process runner. Injectable so the orchestration is testable without
 *  spending a single token. */
export function defaultSpawn({ command, args, cwd, env, signal, timeoutMs }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env: env ? { ...process.env, ...env } : process.env,
        windowsHide: true,           // never flash a console on Windows
        stdio: ['ignore', 'pipe', 'pipe'],
        signal,
      });
    } catch (err) {
      return done({ code: null, stdout: '', stderr: String(err && err.message || err) });
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    const timer = timeoutMs ? setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } }, timeoutMs) : null;
    child.on('error', (err) => { if (timer) clearTimeout(timer); done({ code: null, stdout, stderr: stderr || String(err.message) }); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); done({ code, stdout, stderr }); });
  });
}

/**
 * Build the argv for one agent task on one host, filling capability gaps the
 * host cannot cover itself.
 *
 * `schema` is the honest case. Codex enforces it (`--output-schema`); Claude
 * cannot, so the schema is appended to the prompt as an instruction and the
 * result is flagged `schemaEnforced: false`. Callers must treat an unenforced
 * schema as "asked for, not guaranteed" — silently reporting it as satisfied is
 * how invalid structured output reaches a caller that then trusts it.
 */
export function buildInvocation(host, task, { workdir } = {}) {
  const caps = host.capabilities || {};
  const wantsWorktree = Boolean(task.worktree);
  const wantsSchema = Boolean(task.schema);

  let prompt = task.prompt;
  if (wantsSchema && !caps.outputSchema) {
    prompt = `${prompt}\n\nRespond with ONLY a JSON object matching this schema, no prose:\n${
      typeof task.schema === 'string' ? task.schema : JSON.stringify(task.schema, null, 2)}`;
  }

  const { command, args } = host.execCommand({
    prompt,
    model: task.model,
    systemPrompt: task.systemPrompt,
    tools: task.tools,
    cwd: caps.worktree ? undefined : task.cwd,
    worktree: wantsWorktree && caps.worktree,
    schemaFile: wantsSchema && caps.outputSchema ? task.schemaFile : undefined,
    outFile: task.outFile,
    sandbox: task.sandbox,
    permissionMode: task.permissionMode,
    json: task.json,
  });

  return {
    command,
    args,
    cwd: task.cwd || workdir,
    schemaEnforced: wantsSchema ? Boolean(caps.outputSchema) : null,
    worktreeByHost: wantsWorktree ? Boolean(caps.worktree) : null,
  };
}

/** Extract the agent's answer from a completed process. */
function readResult(host, task, proc) {
  const text = (proc.stdout || '').trim();
  if (!task.json) return text;
  // `claude --output-format json` wraps the reply; codex --json streams JSONL.
  // Try the whole body first, then the last parseable line.
  try { return JSON.parse(text); } catch { /* not a single object */ }
  const lines = text.split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { return JSON.parse(lines[i]); } catch { /* keep walking back */ }
  }
  return text;
}

/**
 * Run one wave of agent tasks against a host.
 *
 * Returns results POSITIONALLY aligned with `tasks`; a failed task yields
 * `null` so `waves.missingFromWave()` can spot the hole. Never rejects — an
 * exception here would lose the whole wave's work, which is the failure mode
 * that contract exists to prevent.
 */
export async function runWave(tasks, {
  host,
  concurrency = 4,
  spawnFn = defaultSpawn,
  timeoutMs,
  signal,
  onProgress,
} = {}) {
  if (!host || typeof host.execCommand !== 'function') {
    throw new Error(`host ${host?.id ?? '<none>'} cannot run agents: no execCommand`);
  }
  const results = new Array(tasks.length).fill(null);
  const limit = Math.max(1, Math.min(concurrency, tasks.length || 1));
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      try {
        const inv = buildInvocation(host, task);
        onProgress?.({ phase: 'start', index: i, task, invocation: inv });
        const proc = await spawnFn({
          command: inv.command, args: inv.args, cwd: inv.cwd, env: task.env, signal, timeoutMs,
        });
        const ok = proc.code === 0;
        results[i] = ok
          ? {
              id: task.id,
              ok: true,
              result: readResult(host, task, proc),
              schemaEnforced: inv.schemaEnforced,
              worktreeByHost: inv.worktreeByHost,
            }
          : null;   // falsy hole — see the failure-semantics note above
        onProgress?.({
          phase: 'end', index: i, task, ok,
          error: ok ? undefined : (proc.stderr || `exit ${proc.code}`).trim().slice(0, 500),
        });
      } catch (err) {
        results[i] = null;
        onProgress?.({ phase: 'end', index: i, task, ok: false, error: String(err?.message || err) });
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
