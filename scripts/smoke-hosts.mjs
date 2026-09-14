#!/usr/bin/env node
// Live smoke test: drive ONE real headless agent per host through the runner.
//
// Everything in tests/runner.test.mjs injects a fake spawn, which proves the
// orchestration but not that the argv we build is actually accepted by the
// binaries. This closes that gap, and it is deliberately NOT part of `npm test`:
// it spends tokens and needs the harnesses installed.
//
//   node scripts/smoke-hosts.mjs            # every detected host
//   node scripts/smoke-hosts.mjs codex      # just one
//
// The prompt is a single turn with no tool use, so a run costs about as little
// as a run can.
import { getHost, detectHosts } from '../lib/hosts/index.mjs';
import { runWave } from '../lib/hosts/runner.mjs';

const WANT = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 120_000);
const PROMPT = 'Reply with exactly the single word: PONG';

const hosts = WANT.length
  ? WANT.map((id) => getHost(id)).filter(Boolean)
  : detectHosts().filter((h) => typeof h.execCommand === 'function');

if (!hosts.length) {
  console.error('no hosts to smoke (none detected, or none named on the command line)');
  process.exit(2);
}

let failures = 0;
for (const host of hosts) {
  const task = {
    id: `smoke-${host.id}`,
    prompt: PROMPT,
    ...(host.id === 'codex' ? { sandbox: 'read-only' } : { tools: [] }),
  };
  const started = Date.now();
  process.stdout.write(`\n── ${host.label} (${host.id}) ─────────────────\n`);

  const [result] = await runWave([task], {
    host,
    timeoutMs: TIMEOUT_MS,
    onProgress: (e) => {
      if (e.phase === 'start') {
        console.log(`  $ ${e.invocation.command} ${e.invocation.args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}`);
      } else if (!e.ok) {
        console.log(`  ✗ ${e.error}`);
      }
    },
  });

  const ms = Date.now() - started;
  if (result && result.ok) {
    const text = String(result.result).trim();
    const pong = /\bPONG\b/i.test(text);
    console.log(`  ${pong ? '✓' : '!'} ${ms}ms  reply: ${JSON.stringify(text.slice(0, 120))}`);
    if (!pong) {
      console.log('    (ran, but did not say PONG — the plumbing works, the model wandered)');
    }
  } else {
    console.log(`  ✗ ${ms}ms  no result`);
    failures++;
  }
}

console.log(failures ? `\n${failures} host(s) failed to run` : '\nall hosts ran');
process.exit(failures ? 1 : 0);
