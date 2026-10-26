// Phase 51 t7 — lib/calibrate.mjs part 2: the trial loop, the budget stop, the summary and the record
// (C3, C4 in-process, C5, C7, C8, C9). Real git and real copies; the verifier is an injected `run`
// standing in for runCapped. Modules reached by dynamic import (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeCalibrationProject } from './fixtures/calibrate/project.mjs';

const done = (p) => rmSync(p.dir, { recursive: true, force: true });
const fence = (ids, failId) => `\`\`\`json\n${JSON.stringify({ mode: 'full', broad: false, criteria: ids.map((id) => ({ id, passed: id !== failId })) })}\n\`\`\``;
const envelope = (failId, cost = 2) => JSON.stringify({ type: 'result', is_error: false, result: fence(['C1', 'C2'], failId), ...(cost === null ? {} : { total_cost_usd: cost }) });
// A runner that records each call and answers from a script of 'pass' | 'fail' | 'crash' by call index.
function runner(script, { cost = 2, seen = [] } = {}) {
  return async (argv, o) => {
    const i = seen.length;
    seen.push({ argv, cwd: o.cwd, env: o.env, existed: existsSync(o.cwd) });
    const out = script[i % script.length];
    if (out === 'crash') return { status: 1, stdout: '', stderr: 'boom' };
    return { status: 0, stdout: envelope(out === 'pass' ? null : 'C1', cost) };
  };
}
const leftovers = () => readdirSync(tmpdir()).filter((f) => f.startsWith('ac-v-'));
const fileDigest = (p, files) => files.map((f) => (existsSync(join(p.dir, f)) ? createHash('sha1').update(readFileSync(join(p.dir, f))).digest('hex') : '-')).join();

test('every defect gets exactly K trials in rounds, each in a fresh copy that is removed afterwards', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 3, seed: 5, budget: 1000 });
    const seen = [];
    const r = await runCalibration(p.dir, plan, { run: runner(['fail'], { seen }) });
    assert.equal(seen.length, 12);
    assert.equal(r.record.completed.trials, 12);
    assert.deepEqual(r.trials.map((t) => t.defect), ['E1', 'E2', 'H1', 'H2', 'E1', 'E2', 'H1', 'H2', 'E1', 'E2', 'H1', 'H2'], 'rounds: every defect gets its r-th trial before anyone gets r+1');
    assert.equal(new Set(seen.map((s) => s.cwd)).size, 12, 'a fresh copy per trial');
    assert.ok(seen.every((s) => s.existed && !s.cwd.startsWith(p.dir)));
    assert.ok(seen.every((s) => !existsSync(s.cwd)), 'removed afterwards');
    assert.deepEqual(leftovers().filter((f) => seen.some((s) => s.cwd.includes(f))), []);
    assert.ok(r.record.defects.every((d) => d.trials === 3));
    assert.ok(r.trials.every((t) => t.scrubbed.length >= 4), 'what was removed is listed per trial');
  } finally { done(p); }
});

test('scripted outcomes give the expected defect and trial rates and per-defect pass^k', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 3, seed: 5, budget: 1000 });
    // call order is E1 E2 H1 H2 per round: E1 always PASSes, E2 once, both hard defects never
    const script = [
      'pass', 'pass', 'fail', 'fail',
      'pass', 'fail', 'fail', 'fail',
      'pass', 'fail', 'fail', 'fail',
    ];
    const r = await runCalibration(p.dir, plan, { run: runner(script) });
    const { easy, hard } = r.record.sets;
    assert.deepEqual([easy.defect_rate.x, easy.defect_rate.n], [2, 2]);
    assert.deepEqual([easy.trial_rate.x, easy.trial_rate.n], [4, 6]);
    assert.deepEqual([hard.defect_rate.x, hard.defect_rate.n], [0, 2]);
    assert.ok(hard.defect_rate.hi > 0 && hard.defect_rate.lo === 0, 'zero false PASSes still has an upper bound');
    assert.ok(easy.defect_rate.lo <= easy.defect_rate.p && easy.defect_rate.p <= easy.defect_rate.hi);
    const by = Object.fromEntries(r.record.defects.map((d) => [d.id, d]));
    assert.deepEqual(by.E1.pass_k, [0, 0, 0]);
    assert.deepEqual(by.H1.pass_k, [1, 1, 1]);
    assert.ok(Math.abs(by.E2.pass_k[0] - 2 / 3) < 1e-9 && Math.abs(by.E2.pass_k[1] - 1 / 3) < 1e-9 && by.E2.pass_k[2] === 0);
    assert.equal(easy.too_few, true, 'two defects is under the minimum');
    assert.match(r.record.definitions, /Wilson/);
  } finally { done(p); }
});

test('with a fixed cost per trial and a budget below the bill, no trial starts once spent + expected exceeds the budget, the result says stopped budget with completed counts, and rates cover only trials that ran', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 3, seed: 5, budget: 5 });
    const seen = [];
    const r = await runCalibration(p.dir, plan, { run: runner(['pass'], { cost: 2, seen }) });
    assert.equal(seen.length, 2, 'spent 4 + expected 2 > 5, so the third never starts');
    assert.equal(r.record.stopped, 'budget');
    assert.deepEqual(r.record.completed, { trials: 2, planned_trials: 12, defects: 2 });
    assert.equal(r.record.spent_usd, 4);
    assert.equal(r.record.cost_basis, 'measured');
    assert.deepEqual(r.record.defects.map((d) => d.trials), [1, 1, 0, 0]);
    assert.deepEqual([r.record.sets.easy.defect_rate.x, r.record.sets.easy.defect_rate.n], [2, 2]);
    assert.equal(r.record.sets.hard.defect_rate.n, 0, 'nothing ran for hard, so no rate is claimed');
    assert.equal(r.record.sets.hard.defect_rate.p, null);
    assert.match(readFileSync(join(p.dir, '.astrocode', 'CALIBRATION.jsonl'), 'utf8'), /"stopped":"budget"/);
  } finally { done(p); }
});

test('--max-budget-usd carries the remaining budget', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 2, runs: 2, seed: 5, budget: 9 });
    const seen = [];
    await runCalibration(p.dir, plan, { run: runner(['fail'], { cost: 2, seen }) });
    const budgets = seen.map((s) => Number(s.argv[s.argv.indexOf('--max-budget-usd') + 1]));
    assert.deepEqual(budgets, [9, 7, 5, 3]);
    assert.ok(seen.every((s) => s.argv.includes('--agent') && s.argv[s.argv.indexOf('--agent') + 1] === 'astro-verifier'));
  } finally { done(p); }
});

test('an invalid trial is excluded from n and listed', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 2, runs: 2, seed: 5, budget: 1000 });
    const r = await runCalibration(p.dir, plan, { run: runner(['crash', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail', 'fail']) });
    const e1 = r.record.defects.find((d) => d.id === 'E1');
    assert.deepEqual([e1.trials, e1.invalid, e1.caught], [1, 1, 1]);
    assert.equal(r.record.sets.easy.invalid, 1);
    assert.equal(r.record.sets.easy.trial_rate.n, 1, 'the crash is neither a PASS nor a catch');
    const bad = r.trials.filter((t) => t.outcome === 'invalid');
    assert.deepEqual(bad.map((t) => [t.defect, t.reason]), [['E1', 'exit 1']]);
  } finally { done(p); }
});

test('ENOENT stops the run with no-verifier after one attempt', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 3, seed: 5, budget: 1000 });
    let calls = 0;
    const r = await runCalibration(p.dir, plan, { run: async () => { calls += 1; return { status: null, error: Object.assign(new Error('x'), { code: 'ENOENT' }) }; } });
    assert.equal(calls, 1);
    assert.equal(r.record.stopped, 'no-verifier');
    assert.equal(r.record.completed.trials, 0);
    assert.equal(r.record.spent_usd, 0);
  } finally { done(p); }
});

test('a blindness failure never spawns', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 2, runs: 1, seed: 5, budget: 1000 });
    let calls = 0;
    const r = await runCalibration(p.dir, plan, {
      run: async () => { calls += 1; return { status: 0, stdout: envelope(null) }; },
      check: () => ({ ok: false, reasons: ['a path is still present'], reported: [] }),
    });
    assert.equal(calls, 0);
    assert.ok(r.trials.every((t) => t.outcome === 'invalid' && t.reason.startsWith('blindness:') && !t.spawned));
    assert.equal(r.record.spent_usd, 0);
  } finally { done(p); }
});

test('the record equals the returned summary and is appended once', async () => {
  const { planCalibration, runCalibration, readLog, renderSummary } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 1, seed: 5, budget: 1000 });
    const r = await runCalibration(p.dir, plan, { run: runner(['fail']) });
    const log = readLog(p.dir);
    assert.equal(log.length, 1);
    assert.deepEqual(log[0], JSON.parse(JSON.stringify(r.record)));
    assert.equal(r.log.committed, true);
    for (const k of ['schema', 'date', 'head', 'seed', 'requested', 'selected', 'completed', 'stopped', 'budget_usd', 'spent_usd', 'cost_basis', 'verifier', 'definitions', 'sets', 'defects', 'shortfall', 'unsupported', 'defect_set_hash']) assert.ok(k in log[0], k);
    for (const k of ['model', 'agent', 'prompt_hash', 'agent_sha', 'contract_sha', 'version']) assert.ok(k in log[0].verifier, k);
    // defects carry keys and counts only: no file, line or change text
    assert.ok(log[0].defects.every((d) => !('file' in d) && !('line' in d) && !('replacement' in d) && !('line_text' in d)));
    // the printed lines come from the same object
    const lines = renderSummary(r);
    assert.match(lines[0], /^false PASS by defect — easy \d+\/\d+/);
    assert.ok(lines[0].includes('hard '));
    assert.ok(lines.length <= 8 + 4 + 0);
    assert.ok(lines.some((l) => l.includes(`seed ${r.record.seed}`)));
  } finally { done(p); }
});

test('renderSummary caps the per-defect lines at 20 and names --json for the rest', async () => {
  const { renderSummary } = await import('../lib/calibrate.mjs');
  const set = { unavailable: null, too_few: false, defect_rate: { x: 1, n: 30, p: 1 / 30, lo: 0.006, hi: 0.17 }, trial_rate: { x: 1, n: 30, p: 1 / 30, lo: 0.006, hi: 0.17 }, pass_k: [0.9], invalid: 0 };
  const defects = Array.from({ length: 30 }, (_, i) => ({ id: `E${i + 1}`, set: 'easy', phase: 1, tool: 'stryker', key: `s:${i}`, trials: 1, passes: 0, caught: 1, invalid: 0, pass_k: [1] }));
  const record = { sets: { easy: set, hard: { ...set, unavailable: 'no test-gap survivors usable in accepted phases', defect_rate: null, trial_rate: null } }, completed: { trials: 30, planned_trials: 30 }, selected: { easy: 30, hard: 0 }, defects, spent_usd: 3, budget_usd: 9, cost_basis: 'measured', stopped: null, shortfall: { drifted: 2 }, unsupported: [], definitions: 'defs', seed: 1, verifier: { model: 'inherit', prompt_hash: 'abc' } };
  const lines = renderSummary({ record, log: { committed: true } });
  assert.ok(lines.length <= 8 + 20 + 1);
  assert.equal(lines.at(-1), '+10 more — --json');
  assert.match(lines[0], /hard unavailable \(no test-gap survivors usable in accepted phases\)/);
});

test('no VERDICT.json, SURVIVORS.json, roadmap or state file in root changes', async () => {
  const { planCalibration, runCalibration } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  const watch = [
    '.astrocode/roadmap.json', '.astrocode/state.json', '.astrocode/ROADMAP.md',
    `.astrocode/phases/${p.phases.second.slug}/SURVIVORS.json`, `.astrocode/phases/${p.phases.second.slug}/VERDICT.json`,
    `.astrocode/milestones/1/phases/${p.phases.first.slug}/SURVIVORS.json`, 'src/first.mjs', 'src/second.py',
  ];
  try {
    const before = fileDigest(p, watch);
    const plan = planCalibration(p.dir, { defects: 4, runs: 1, seed: 5, budget: 1000 });
    await runCalibration(p.dir, plan, { run: runner(['pass']) });
    assert.equal(fileDigest(p, watch), before);
  } finally { done(p); }
});

test('an abort signal stops between trials, removes the copy and records stopped interrupted', async () => {
  const { planCalibration, runCalibration, readLog } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 3, seed: 5, budget: 1000 });
    const ctl = new AbortController();
    const seen = [];
    const inner = runner(['fail'], { seen });
    const r = await runCalibration(p.dir, plan, { signal: ctl.signal, run: async (...a) => { ctl.abort(); return inner(...a); } });
    assert.equal(seen.length, 1);
    assert.equal(r.record.stopped, 'interrupted');
    assert.equal(existsSync(seen[0].cwd), false);
    assert.equal(readLog(p.dir).at(-1).stopped, 'interrupted');
  } finally { done(p); }
});

test('the summary reports the defects that ran, not only the ones selected', async () => {
  const { planCalibration, runCalibration, renderSummary } = await import('../lib/calibrate.mjs');
  const p = await makeCalibrationProject({ killed: 4 });
  try {
    const plan = planCalibration(p.dir, { defects: 4, runs: 2, seed: 5, budget: 5 });
    const r = await runCalibration(p.dir, plan, { run: runner(['pass'], { cost: 5 }) });
    assert.equal(r.record.completed.defects, 1);
    assert.match(renderSummary(r).join ? renderSummary(r).join('\n') : String(renderSummary(r)), /on 1 of 4 defects/);
  } finally { done(p); }
});
