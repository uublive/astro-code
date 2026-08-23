// Phase 15 t11 — the standalone + engine-purity guard.
//
// Phase 15 wires astro-code to an OPTIONAL forge knowledge-graph MCP server, but every
// commit in that phase lives in the prose layer (templates/, commands/, agents/) —
// ADR-030 forbids the engine (`lib/`, `bin/`, `workflows/`) from ever importing, shelling
// to, or configuring the service. This file is the falsifiable half of that promise: it
// is GREEN today, before a single forge line exists, and it MUST stay green after the
// phase lands — the day it goes red is the day forge leaked into the engine or into
// standalone CLI output.
//
// Real filesystem + real git, no mocks (house style, tests/registry.test.mjs /
// tests/flags.test.mjs). This is the only test in the phase that runs both before and
// after (PLAN.md wave-1, no deps) — every other test either guards prose that does not
// exist yet (test-after) or extends an existing suite once its dependency lands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { paths } from '../lib/paths.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

// The exact tokens PLAN.md t11 pins for each assertion — kept as two separate
// constants (not merged) because the CLI-output guard and the engine-source guard
// declare deliberately different patterns in the plan.
const CLI_OUTPUT_LEAK = /mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge graph|the brain/i;
const ENGINE_SOURCE_LEAK = /mcp__|forge_knowledge|forge_capture|FORGEMASTER|knowledge.graph/i;

function run(args, cwd, env) {
  return spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8', env });
}

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-forge-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

test('C1: a real ac lifecycle with forge absent runs to completion and prints nothing forge-related', () => {
  // Throwaway HOME/CLAUDE_CONFIG_DIR — the lifecycle must not touch (or need) any
  // real user config, and this proves the run is genuinely isolated.
  const home = mkdtempSync(join(tmpdir(), 'ac-forge-home-'));
  const cfgDir = join(home, 'claude-config');
  const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: cfgDir };

  const dir = mkdtempSync(join(tmpdir(), 'ac-forge-work-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });

  // `milestone new` / `phase add` claim through the orphan-branch registry, which
  // requires a coordinated remote — stand up a real bare origin (registry.test.mjs
  // pattern) so the lifecycle below is representative, not a degraded local-only path.
  const bare = mkBareRemote();
  git(['remote', 'add', 'origin', bare], { cwd: dir });

  const steps = [
    ['init', '--name', 'forgeproj'],
    ['registry', 'init'],
    ['milestone', 'new', '--name', 'M1'],
    ['phase', 'add', 'Do the thing'],
    ['decision', 'add', 'Use plain git for coordination', '--why', 'no forge dependency', '--rejected', 'a hosted queue'],
    ['roadmap', 'render'],
    ['status'],
    ['state', 'get'],
  ];

  const transcript = [];
  for (const args of steps) {
    const res = run(args, dir, env);
    transcript.push(res.stdout || '', res.stderr || '');
    assert.strictEqual(res.status, 0, `\`ac ${args.join(' ')}\` exited ${res.status}\n${res.stderr}`);
  }

  const decisions = readFileSync(paths(dir).decisions, 'utf8');
  assert.match(decisions, /Use plain git for coordination/, 'the ADR must have landed in DECISIONS.md');

  const combined = transcript.join('\n');
  assert.doesNotMatch(
    combined, CLI_OUTPUT_LEAK,
    'no forge-related text may appear anywhere in standalone CLI output',
  );
});

test('C2 / ADR-030: lib/, bin/ and workflows/ never reference forge — the engine never learns about it', () => {
  const offenders = [];
  for (const d of ['lib', 'bin', 'workflows']) {
    const base = join(FRAMEWORK, d);
    for (const rel of readdirSync(base, { recursive: true })) {
      const full = join(base, rel);
      if (!statSync(full).isFile()) continue;
      const text = readFileSync(full, 'utf8');
      if (ENGINE_SOURCE_LEAK.test(text)) offenders.push(join(d, rel));
    }
  }
  assert.deepEqual(offenders, [], `forge references leaked into the engine: ${offenders.join(', ')}`);
});
