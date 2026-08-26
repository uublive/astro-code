// Guards for two related CLI safety gaps found while testing 0.8.1 against a real
// project (ADR-029):
//
//   1. `parseArgs` collected ANY `--x` into `flags` and no verb validated them, so an
//      unknown flag was silently discarded and the command ran with DEFAULT behavior.
//   2. `ac canon push` had no `--dry-run` at all, yet `--dry-run` is the flag a cautious
//      operator reaches for before publishing to a branch the whole team reads.
//
// Together those made `ac canon push --dry-run` perform a REAL publish — the
// safest-sounding invocation was the most dangerous one. This file pins both halves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { git } from '../lib/git.mjs';
import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { addPhase, findPhase, setPhaseStatus } from '../lib/roadmap.mjs';
import { initRegistry } from '../lib/registry.mjs';
import { canonPush, canonPull, addDecision } from '../lib/canon.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');
const AC = join(FRAMEWORK, 'bin', 'ac.mjs');

const run = (args, cwd) =>
  spawnSync(process.execPath, [AC, ...args], { cwd, encoding: 'utf8' });

function mkBareRemote() {
  const bare = mkdtempSync(join(tmpdir(), 'ac-origin-')) + '/origin.git';
  git(['init', '--quiet', '--bare', bare]);
  return bare;
}

function mkWorkdir(bare) {
  const dir = mkdtempSync(join(tmpdir(), 'ac-flags-'));
  git(['init', '--quiet'], { cwd: dir });
  git(['config', 'user.email', 'dev@example.com'], { cwd: dir });
  git(['config', 'user.name', 'dev'], { cwd: dir });
  if (bare) git(['remote', 'add', 'origin', bare], { cwd: dir });
  initPlanning(dir, { name: 'flagproj' });
  return dir;
}

const registryTip = (bare) =>
  git(['rev-parse', 'refs/heads/astro-registry'], { cwd: bare }).stdout.trim();

// ── 1. unknown flags are rejected on the shared/destructive verbs ─────────────

test('ADR-029: `ac canon push --dryrun` (typo) exits non-zero instead of publishing', () => {
  const dir = mkWorkdir(null);
  const res = run(['canon', 'push', '--dryrun'], dir);
  assert.notStrictEqual(res.status, 0, 'a typo\'d flag must not exit 0');
  assert.match(res.stderr, /unknown flag/i);
  assert.match(res.stderr, /--dryrun/, 'the error must name the offending flag');
  assert.match(res.stderr, /--dry-run/, 'the error must name what IS accepted');
});

test('ADR-029: the flag check runs BEFORE the command does any work', () => {
  // This repo has no coordinated remote, so canon push would normally die with
  // "no coordinated remote". The unknown-flag error must win — proving the guard
  // is reached before the side-effecting path, not after it.
  const dir = mkWorkdir(null);
  const res = run(['canon', 'push', '--nope'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  assert.doesNotMatch(res.stderr, /no coordinated remote/i);
});

test('ADR-029: a typo\'d `ac decision add` flag rejects and writes NO decision', () => {
  const dir = mkWorkdir(null);
  const res = run(['decision', 'add', 'Some choice', '--wy', 'because'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  // The real damage from a silent flag drop is the side effect landing anyway.
  const decisions = existsSync(paths(dir).decisions) ? readFileSync(paths(dir).decisions, 'utf8') : '';
  assert.doesNotMatch(decisions, /Some choice/, 'the decision must NOT have been appended');
});

test('ADR-029: a typo\'d `ac phase accept --forse` rejects and leaves the phase unaccepted', async () => {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  await setPhaseStatus(dir, ph.slug, 'verified');

  const res = run(['phase', 'accept', '1', '--forse'], dir);
  assert.notStrictEqual(res.status, 0);
  assert.match(res.stderr, /unknown flag/i);
  assert.strictEqual(
    findPhase(dir, '1').status, 'verified',
    'the phase must not have been closed by a command whose flag was a typo',
  );
});

test('ADR-029: documented flags still work — the guard is an allowlist, not a ban', async () => {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const ph = findPhase(dir, '1');
  await setPhaseStatus(dir, ph.slug, 'verified');

  const res = run(['phase', 'accept', '1', '--by', 'alice'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.strictEqual(findPhase(dir, '1').status, 'complete');
});

test('ADR-029: read-only verbs are deliberately NOT guarded (no blanket enforcement)', () => {
  const dir = mkWorkdir(null);
  const res = run(['status', '--verbose'], dir);
  assert.strictEqual(res.status, 0, 'a stray flag on a read-only verb stays harmless');
});

// ── 2. canon push --dry-run reads, never writes ───────────────────────────────

test('ADR-029: canonPush dryRun reports a pending change and leaves the registry untouched', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  writeFileSync(paths(dir).conventions, '# Conventions\n\nfirst version\n');
  assert.strictEqual(canonPush(dir).ok, true, 'seed a published copy');
  const tip = registryTip(bare);

  // Now diverge locally and ask what a push WOULD do.
  writeFileSync(paths(dir).conventions, '# Conventions\n\nsecond version\n');
  const dry = canonPush(dir, { dryRun: true });

  assert.strictEqual(dry.ok, true);
  assert.strictEqual(dry.dryRun, true);
  assert.strictEqual(dry.wouldChange, true, 'a diverged local copy must report wouldChange');
  assert.strictEqual(dry.remoteExists, true);
  assert.deepStrictEqual(dry.pushed, [], 'a dry run must report nothing as pushed');
  assert.strictEqual(registryTip(bare), tip, 'the registry branch must NOT have moved');

  // And the published copy is still the OLD one.
  canonPull(dir);
  assert.match(readFileSync(paths(dir).conventions, 'utf8'), /first version/);
});

test('ADR-029: canonPush dryRun distinguishes identical from changed', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  writeFileSync(paths(dir).conventions, '# Conventions\n\nsame\n');
  assert.strictEqual(canonPush(dir).ok, true);

  const dry = canonPush(dir, { dryRun: true });
  assert.strictEqual(dry.wouldChange, false, 'a byte-identical local copy is a no-op push');
  assert.strictEqual(dry.remoteExists, true);
});

test('ADR-029: a real canonPush still publishes (the dry-run guard is opt-in)', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  const tip = registryTip(bare);

  writeFileSync(paths(dir).conventions, '# Conventions\n\npublished\n');
  const res = canonPush(dir);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.pushed, ['CONVENTIONS.md']);
  assert.notStrictEqual(registryTip(bare), tip, 'a real push must move the registry branch');
});

// ── ADR-033: acceptance provenance — who signed, and of what kind ─────────────
//
// REQ-006 is the two-gate guarantee: the AI verifier reaches `verified`, only a human
// `/astro-accept` reaches `complete`. `accepted_by` used to default to the repo's git
// identity, so an autonomous agent accepting on the operator's behalf was recorded AS the
// operator — a machine sign-off and a human one had the identical shape, making the
// guarantee unauditable from the record. Found during an unattended benchmark run.

async function verifiedPhase() {
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  await setPhaseStatus(dir, findPhase(dir, '1').slug, 'verified');
  return dir;
}

test('ADR-033: a plain accept records accepted_kind "human"', async () => {
  const dir = await verifiedPhase();
  const res = run(['phase', 'accept', '1'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  const ph = findPhase(dir, '1');
  assert.strictEqual(ph.status, 'complete');
  assert.strictEqual(ph.accepted_kind, 'human', 'an undeclared accept asserts a human made the judgement');
});

test('ADR-033: --agent records accepted_kind "agent" and the agent as signer', async () => {
  const dir = await verifiedPhase();
  const res = run(['phase', 'accept', '1', '--agent', 'FORGEMASTER'], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  const ph = findPhase(dir, '1');
  assert.strictEqual(ph.accepted_kind, 'agent');
  assert.strictEqual(ph.accepted_by, 'FORGEMASTER', 'the agent must be the recorded signer, not the git identity');
  // The distinction is worthless if a human reading the terminal cannot see it.
  assert.match(res.stdout, /AGENT/, 'a machine sign-off must be visible in the output, not just in the file');
});

test('ADR-033: the two signer kinds are distinguishable in the record', async () => {
  const human = await verifiedPhase();
  run(['phase', 'accept', '1'], human);
  const agent = await verifiedPhase();
  run(['phase', 'accept', '1', '--agent', 'bot'], agent);
  assert.notStrictEqual(
    findPhase(human, '1').accepted_kind,
    findPhase(agent, '1').accepted_kind,
    'a machine sign-off and a human sign-off must not be the same shape — that is the defect ADR-033 fixes',
  );
});

test('ADR-033: --agent is allowlisted, and a typo of it is still rejected', async () => {
  const dir = await verifiedPhase();
  const bad = run(['phase', 'accept', '1', '--agnet', 'bot'], dir);
  assert.notStrictEqual(bad.status, 0, 'a typo must not silently fall back to a human sign-off');
  assert.match(bad.stderr, /unknown flag/i);
  assert.strictEqual(findPhase(dir, '1').status, 'verified', 'the rejected accept must not have closed the phase');
});

// ── ADR-034: `ac canon pull` must never destroy a local-only ADR ──────────────
//
// Found by the v0.11.0 benchmark. The chain: astro-code's own planner emitted a task
// writing an ADR straight into DECISIONS.md; `ac canon pull` (mandated by /astro-execute)
// overwrote the file from the registry and printed success; canonPush refuses to publish
// DECISIONS.md, so there was no repair path; and `ac decision add` then REISSUED the same
// id. Three steps, each reporting success, ending in silent data loss.

test('ADR-034: canon pull preserves an ADR the registry has never seen', async () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);

  // Seed the SHARED branch through the supported path — addDecision is the only writer
  // that publishes DECISIONS.md. canonPush deliberately never does.
  const seeded = await addDecision(dir, { title: 'from the registry', why: 'shared' });
  assert.strictEqual(seeded.source, 'remote', 'the seed decision must have landed on the registry branch');

  // Now diverge exactly the way the benchmark did: an ADR written straight into the file,
  // never through `ac decision add`, so the registry has never seen it.
  const localOnly = readFileSync(paths(dir).decisions, 'utf8') +
    '\n## ADR-099 — written by hand, never pushed\n_2026-01-02_\n\n**Why:** it exists only here.\n';
  writeFileSync(paths(dir).decisions, localOnly);

  const res = canonPull(dir);
  assert.strictEqual(res.ok, true);
  const after = readFileSync(paths(dir).decisions, 'utf8');
  assert.match(after, /ADR-099/, 'a local-only ADR must survive a pull — losing it is silent data destruction');
  assert.match(after, /written by hand, never pushed/, 'its body must survive too, not just the heading');
  assert.ok(
    (res.preserved || []).includes('ADR-099'),
    'the pull must REPORT what it preserved — silence is what let the old overwrite go unnoticed',
  );
});

test('ADR-034: a pull with no local divergence reports nothing preserved', () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  const res = canonPull(dir);
  assert.deepStrictEqual(res.preserved || [], [], 'the common case must stay quiet');
});

// ── ADR-036: `ac preflight` — surface the worktree fork-base divergence ───────
//
// The harness forks each parallel executor's worktree from the REMOTE branch, not local
// HEAD, so any unpushed commit makes a whole wave read STALE at integration: ADR-015
// refuses the cherry-pick, the heal ladder re-runs every task, and the phase still reports
// PASS. Benchmark #2 lost 17 task-executions this way; the one phase that launched in sync
// healed 0 of 11. astro-code cannot fix the fork base, but it can stop the condition being
// invisible — its only other trace is `executed` exceeding `tasks` in a payload nobody reads.

function repoWithUpstream() {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  writeFileSync(join(dir, 'a.txt'), 'a');
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-qm', 'init'], { cwd: dir });
  git(['push', '-q', '-u', 'origin', 'HEAD'], { cwd: dir });
  return dir;
}

test('ADR-036: preflight is SILENT and exit 0 when HEAD matches upstream', () => {
  const dir = repoWithUpstream();
  const res = run(['preflight'], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stdout.trim() + res.stderr.trim(), '', 'the common case must produce no output at all');
});

test('ADR-036: preflight warns — but never blocks — when HEAD is ahead of upstream', () => {
  const dir = repoWithUpstream();
  writeFileSync(join(dir, 'b.txt'), 'b');
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-qm', 'unpushed'], { cwd: dir });

  const res = run(['preflight'], dir);
  // Advisory, not a gate: the operator may have meant to run this way.
  assert.strictEqual(res.status, 0, 'preflight must never block a run the operator intended');
  assert.match(res.stderr, /diverged/i);
  assert.match(res.stderr, /ahead 1/, 'it must quantify the divergence, not just assert it');
  assert.match(res.stderr, /git push/, 'it must name the one-line fix');
  assert.match(res.stderr, /STALE/, 'it must say what actually goes wrong, or it reads as pedantry');
});

test('ADR-036: preflight is silent when there is no upstream to compare against', () => {
  const dir = mkWorkdir(null);
  writeFileSync(join(dir, 'a.txt'), 'a');
  git(['add', '-A'], { cwd: dir });
  git(['commit', '-qm', 'init'], { cwd: dir });
  const res = run(['preflight'], dir);
  assert.strictEqual(res.status, 0);
  assert.strictEqual(res.stderr.trim(), '', 'no upstream means nothing to compare — not a warning');
});

test('ADR-036: /astro-execute runs preflight before launching', () => {
  const src = readFileSync(join(FRAMEWORK, 'commands', 'astro-execute.md'), 'utf8');
  assert.ok(/ac preflight/.test(src), 'astro-execute.md must call `ac preflight`');
  const pre = src.indexOf('ac preflight');
  const fan = src.indexOf('Run the execution fan-out');
  assert.ok(pre !== -1 && fan !== -1 && pre < fan, 'the check must come BEFORE the fan-out, or it warns too late to act on');
});

// ── ADR-037: the two fixes that shipped looking fixed ─────────────────────────
//
// Benchmark #3 found both. Each had a passing suite and a plausible manual check that
// could not see the defect — the same shape as every other silent failure in this repo.

test('ADR-037 (B4): canon pull rescues the ADR BODY, not just its heading', async () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  // Seed the SHARED branch first — addDecision is the only writer that publishes
  // DECISIONS.md. Without it the registry has no copy, canonPull skips the whole
  // preservation block, and the local file survives untouched for the WRONG reason.
  assert.strictEqual((await addDecision(dir, { title: 'seed', why: 'shared' })).source, 'remote');
  // A local-only ADR at EOF — the COMMON case, DECISIONS.md being append-only, and the
  // case the old `$` under /m always truncated. It only worked when another heading followed.
  writeFileSync(
    paths(dir).decisions,
    '# Decisions\n\n## ADR-998 — canary\n_2026-08-25_\n\n**Why:** UNIQUEBODYMARKER\n\n**Rejected:** the alternative\n',
  );
  const res = canonPull(dir);
  assert.strictEqual(res.ok, true);
  const after = readFileSync(paths(dir).decisions, 'utf8');
  assert.match(after, /ADR-998/, 'the heading must survive');
  // The heading alone is what the old code kept, while still reporting a full rescue — so
  // grepping for the id (the obvious check) passed either way. Assert the substance.
  assert.match(after, /UNIQUEBODYMARKER/, 'the **Why:** body must survive — a heading with no reasoning is not a rescued ADR');
  assert.match(after, /the alternative/, 'the **Rejected:** body must survive too');
});

test('ADR-037 (B4): a rescued ADR followed by another heading keeps its body too', async () => {
  const bare = mkBareRemote();
  const dir = mkWorkdir(bare);
  assert.strictEqual(initRegistry({ root: dir }).ok, true);
  assert.strictEqual((await addDecision(dir, { title: 'seed', why: 'shared' })).source, 'remote');
  writeFileSync(
    paths(dir).decisions,
    '# Decisions\n\n## ADR-998 — first\n_2026-01-01_\n\n**Why:** FIRSTBODY\n\n## ADR-999 — second\n_2026-01-02_\n\n**Why:** SECONDBODY\n',
  );
  canonPull(dir);
  const after = readFileSync(paths(dir).decisions, 'utf8');
  assert.match(after, /FIRSTBODY/);
  assert.match(after, /SECONDBODY/);
  // And it must not swallow the following heading into the previous entry.
  assert.match(after, /## ADR-999 — second/);
});

test('ADR-037 (B5): the discuss gate accepts BOTH the human and the agent marker', async () => {
  const { phaseContextStatus, contextAuthor } = await import('../lib/planning.mjs');
  const dir = mkWorkdir(null);
  await addPhase(dir, { number: 1, name: 'Do a thing' });
  const slug = findPhase(dir, '1').slug;
  const ctx = join(paths(dir).phases, slug, 'CONTEXT.md');

  writeFileSync(ctx, '<!-- astro-discuss: captured -->\n# Phase 1\n');
  assert.strictEqual(phaseContextStatus(dir, slug), 'ready', 'the human form must gate to ready');

  // ADR-035 told agents to write this form; the gate then rejected it, so an
  // agent-discussed phase read as `stub` and ADR-032's pipeline gate could never pass.
  writeFileSync(ctx, '<!-- astro-discuss: captured by agent: FORGEMASTER -->\n# Phase 1\n');
  assert.strictEqual(phaseContextStatus(dir, slug), 'ready', 'the ADR-035 agent form must ALSO gate to ready');
  assert.strictEqual(contextAuthor(readFileSync(ctx, 'utf8')), 'FORGEMASTER', 'the agent name must be extractable');

  // Provenance is recorded, not hidden: the human form reports no agent author.
  writeFileSync(ctx, '<!-- astro-discuss: captured -->\n# Phase 1\n');
  assert.strictEqual(contextAuthor(readFileSync(ctx, 'utf8')), null);

  // A file without the marker is still a stub — the gate must not have been widened away.
  writeFileSync(ctx, '# Phase 1, never discussed\n');
  assert.strictEqual(phaseContextStatus(dir, slug), 'stub', 'the gate must still reject an undiscussed file');
});
