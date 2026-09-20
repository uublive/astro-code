// Reproduction + contract for fix 2026-09-20-ac-phase-add-milestone-n-repoints-the
// (GitHub issue #16).
//
// `addPhase` used to write the phase's milestone onto `rm.milestone` — the PROJECT's
// current-milestone pointer — so claiming a phase for a FUTURE milestone silently moved
// the whole project into it. Two consequences, both reported from a real project:
//
//   1. `ac status` and ROADMAP.md then misreport which milestone is active, and
//      `ac milestone complete` archives the wrong set.
//   2. It was the only writer in the codebase that moved `rm.milestone` without also
//      moving `state.active_milestone`, so the two pointers diverged. `ac debt pay
//      --as phase` resolves its milestone as `st.active_milestone || rm.milestone`
//      (bin/ac.mjs), so a stale state pointer later filed a brand-new phase into an
//      already-COMPLETED milestone. That second symptom is this same line, not a
//      separate fallback bug.
//
// The milestone belongs ON THE PHASE. Once it is recorded there, a wrong assignment has
// to be correctable too — the reporter could not repair it at all, because `AGENTS.md`
// forbids hand-editing roadmap.json and no CLI subcommand moved a phase. Hence
// `ac phase milestone <phase> [<N>]`, read/set, shaped like `ac phase effort`/`note`.
//
// Per ADR-018 the modules under test are pulled in with `await import(...)` INSIDE each
// async test body, so a not-yet-landed export fails only its own case instead of
// crashing the file at load. The CLI surface is driven by spawning bin/ac.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initPlanning } from '../lib/planning.mjs';
import { paths } from '../lib/paths.mjs';
import { readJSON } from '../lib/util.mjs';

const FRAMEWORK = join(dirname(fileURLToPath(import.meta.url)), '..');

// A fresh project sits at milestone 1 in BOTH pointers (planning.mjs seeds
// state.active_milestone: 1 and roadmap.milestone: 1).
function scaffold() {
  const root = mkdtempSync(join(tmpdir(), 'ac-phasems-'));
  initPlanning(root, { name: 'demo' });
  return root;
}

function ac(args, cwd) {
  return spawnSync(process.execPath, [join(FRAMEWORK, 'bin', 'ac.mjs'), ...args], {
    cwd,
    encoding: 'utf8',
  });
}

// ── 1. The defect itself ────────────────────────────────────────────────────────

test('addPhase with a future milestone leaves the project pointer alone', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');

  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  await addPhase(root, { number: 2, name: 'beta', milestone: 3 });

  const rm = readJSON(paths(root).roadmap);
  assert.equal(
    rm.milestone,
    1,
    'claiming phase 2 for milestone 3 must not move the project into milestone 3',
  );
});

test('addPhase records the milestone on the phase', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');

  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  await addPhase(root, { number: 2, name: 'beta', milestone: 3 });

  const rm = readJSON(paths(root).roadmap);
  assert.equal(rm.phases.find((p) => p.number === 1).milestone, 1);
  assert.equal(
    rm.phases.find((p) => p.number === 2).milestone,
    3,
    'the milestone a phase was claimed for is the phase’s own field',
  );
});

test('addPhase never diverges roadmap.milestone from state.active_milestone', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');

  await addPhase(root, { number: 1, name: 'alpha', milestone: 2 });
  await addPhase(root, { number: 2, name: 'beta', milestone: 3 });

  const p = paths(root);
  assert.equal(
    readJSON(p.roadmap).milestone,
    readJSON(p.state).active_milestone,
    'the two current-milestone pointers must stay in step — their divergence is what ' +
      'later filed a new phase into a completed milestone',
  );
});

// The reported second-order symptom, end to end: with the pointers in step, graduating
// debt to a phase files it into the milestone the project is actually on.
test('ac debt pay --as phase files into the current milestone, not a stale one', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');
  const { setMilestone } = await import('../lib/roadmap.mjs');

  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });
  // The project genuinely advances to milestone 2 (both pointers, as `ac milestone new`
  // does), then a phase is claimed for a FUTURE milestone 4 — the reported sequence.
  await setMilestone(root, 2);
  const { updateState } = await import('../lib/state.mjs');
  await updateState(root, (s) => ({ ...s, active_milestone: 2 }));
  await addPhase(root, { number: 2, name: 'beta', milestone: 4 });

  const p = paths(root);
  assert.equal(readJSON(p.roadmap).milestone, 2, 'project is still on milestone 2');
  assert.equal(readJSON(p.state).active_milestone, 2, 'and state agrees');
});

// ── 2. Correcting a wrong assignment ────────────────────────────────────────────

test('ac phase milestone <phase> reads the phase’s milestone', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(root, { number: 1, name: 'alpha', milestone: 3 });

  const res = ac(['phase', 'milestone', '1'], root);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /\b3\b/);
});

test('ac phase milestone <phase> <N> moves the phase and only the phase', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(root, { number: 1, name: 'alpha', milestone: 3 });

  const res = ac(['phase', 'milestone', '1', '2'], root);
  assert.equal(res.status, 0, res.stderr);

  const p = paths(root);
  assert.equal(readJSON(p.roadmap).phases[0].milestone, 2, 'the phase moved');
  assert.equal(
    readJSON(p.roadmap).milestone,
    1,
    'correcting a phase must not repoint the project either',
  );
  assert.equal(readJSON(p.state).active_milestone, 1, 'nor the state pointer');
});

test('ac phase milestone rejects a non-positive or non-numeric milestone', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });

  for (const bad of ['0', '-2', 'two']) {
    const res = ac(['phase', 'milestone', '1', bad], root);
    assert.notEqual(res.status, 0, `"${bad}" must be refused, not written to disk`);
  }
  assert.equal(readJSON(paths(root).roadmap).phases[0].milestone, 1, 'nothing landed');
});

test('ac phase milestone on an unknown phase fails loudly', async () => {
  const root = scaffold();
  const res = ac(['phase', 'milestone', '99'], root);
  assert.notEqual(res.status, 0);
});

// ── 3. Backward compatibility ───────────────────────────────────────────────────

// Every roadmap.json written before this fix has phases with NO milestone field. They
// must keep loading, and reading one must say so rather than inventing a number.
test('a pre-existing phase without a milestone field still loads and reads honestly', async () => {
  const root = scaffold();
  const { addPhase } = await import('../lib/roadmap.mjs');
  await addPhase(root, { number: 1, name: 'alpha', milestone: 1 });

  // Simulate a roadmap written by an older version.
  const p = paths(root);
  const { atomicWriteJSON } = await import('../lib/util.mjs');
  const rm = readJSON(p.roadmap);
  delete rm.phases[0].milestone;
  atomicWriteJSON(p.roadmap, rm);

  const res = ac(['phase', 'milestone', '1'], root);
  assert.equal(res.status, 0, res.stderr);
  assert.doesNotMatch(
    res.stdout,
    /milestone 1\b/i,
    'an absent field must not be reported as a confident assignment',
  );

  // And it can be repaired.
  assert.equal(ac(['phase', 'milestone', '1', '2'], root).status, 0);
  assert.equal(readJSON(p.roadmap).phases[0].milestone, 2);
});
