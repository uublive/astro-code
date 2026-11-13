// Phase 43 t4 — the phase-band autocomplete matcher and rows (pure, no `$`).
// Symbols arrive through `await import(...)` inside each test (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const mod = () => import('../mods/astro-mods/hooks/lib/complete.js');

test('commandSource: the five loop verbs read phase numbers, bare or namespaced', async () => {
  const { commandSource } = await mod();
  for (const v of ['discuss', 'plan', 'execute', 'verify', 'accept']) {
    const t = `/astro-${v} `;
    assert.equal(commandSource(t, t.length), 'phases', v);
  }
  const ns = '/astro-code:astro-plan ';
  assert.equal(commandSource(ns, ns.length), 'phases');
  assert.equal(commandSource('/astro-plan    4', 15), 'phases'); // several spaces, token "4" starts at 15
});

test('commandSource: debt, backlog and fix sources', async () => {
  const { commandSource } = await mod();
  assert.equal(commandSource('/astro-debt-pay ', 16), 'debt');
  assert.equal(commandSource('/astro-backlog-promote ', 23), 'backlog');
  assert.equal(commandSource('/astro-fix-accept ', 18), 'fix');
});

test('commandSource: everything else is null', async () => {
  const { commandSource } = await mod();
  for (const t of ['/astro-fix ', '/astro-debt ', '/astro-status ', '/other 4', 'plain text ', '/astro-plan', '/astro-plan 4 x', '', '/astro-planet ', 'x /astro-plan ']) {
    assert.equal(commandSource(t, t.length), null, JSON.stringify(t));
  }
  // the token being completed is the SECOND word: start sits after the 4 and a space
  assert.equal(commandSource('/astro-plan 4 x', 14), null);
  assert.equal(commandSource(undefined, 0), null);
  assert.equal(commandSource('/astro-plan ', undefined), null);
});

test('completionRows phases: number text, name label cut to 40, status plus planned/discussed', async () => {
  const { completionRows } = await mod();
  const long = 'N'.repeat(60);
  const rows = completionRows('phases', [
    { number: 40, name: 'Alpha', slug: '40-alpha', status: 'verified', planned: true, discussed: true },
    { number: 41, name: long, slug: '41-n', status: 'pending', planned: false, discussed: true },
    { number: 42, name: 'Gamma', slug: '42-g', status: 'pending', planned: false, discussed: false },
    { number: 39, name: 'Early', slug: '39-e', status: 'complete', planned: true, discussed: true },
  ], '');
  assert.deepEqual(rows.map(r => r.text), ['39', '40', '41', '42']);
  assert.equal(rows[2].label.length, 40);
  assert.equal(rows[1].description, 'verified · planned');
  assert.equal(rows[2].description, 'pending · discussed');
  assert.equal(rows[3].description, 'pending');
  assert.ok(rows.every(r => !/-/.test(r.text)), 'never a slug');
});

test('completionRows debt, backlog, fix', async () => {
  const { completionRows } = await mod();
  const long = 'T'.repeat(80);
  const debt = completionRows('debt', [{ id: '2026-a', title: long, cost: 'M' }, { id: '2026-b', title: 'b' }], '');
  assert.equal(debt[0].text, '2026-a');
  assert.equal(debt[0].label.length, 48);
  assert.equal(debt[0].description, 'M');
  assert.equal(debt[1].description, undefined);
  const back = completionRows('backlog', [{ id: 'bk-1', title: 'Idea' }], '');
  assert.deepEqual(back, [{ text: 'bk-1', label: 'Idea' }]);
  const fix = completionRows('fix', [{ id: 'fx-1', title: 'Broken', status: 'open' }], '');
  assert.deepEqual(fix, [{ text: 'fx-1', label: 'Broken', description: 'open' }]);
});

test('completionRows: token filters by id prefix; empty keeps all', async () => {
  const { completionRows } = await mod();
  const data = [{ number: 4, name: 'a', status: 'pending' }, { number: 41, name: 'b', status: 'pending' }, { number: 5, name: 'c', status: 'pending' }];
  assert.deepEqual(completionRows('phases', data, '4').map(r => r.text), ['4', '41']);
  assert.deepEqual(completionRows('phases', data, '').map(r => r.text), ['4', '5', '41']);
  assert.deepEqual(completionRows('phases', data, '9'), []);
});

test('completionRows: malformed data yields [] and never throws', async () => {
  const { completionRows } = await mod();
  for (const d of [null, undefined, {}, 'x', 5, [null], [{}], [{ id: '' }], [{ number: null }]]) {
    assert.deepEqual(completionRows('phases', d, ''), []);
    assert.deepEqual(completionRows('debt', d, ''), []);
  }
  assert.deepEqual(completionRows('nope', [{ id: 'x' }], ''), []);
  assert.deepEqual(completionRows('debt', [{ id: 'ok', title: 'fine' }, null, { id: '' }], '').map(r => r.text), ['ok']);
});

// --- phase 58: the autocomplete rows follow the band's scope ------------------------------
// Drives the real feature handlers with a fake `$` (fs and process only), as register.js would.
async function bandFeature(status, headText) {
  const sw = await import('../mods/astro-mods/hooks/lib/switches.js');
  sw.setSwitches({ exitCode: 0, stdout: JSON.stringify({ switches: { 'phase-band': true } }) });
  const f = await import('../mods/astro-mods/hooks/features/phase-band.js');
  const calls = [];
  const $ = {
    fs: {
      stat: async (p) => { if (p.endsWith('/.astrocode') || p.endsWith('/.git')) return { kind: 'dir', mtimeMs: 1 }; throw new Error('ENOENT'); },
      read: async (p) => { if (p.endsWith('/HEAD')) return headText; throw new Error('ENOENT'); },
    },
    process: { run: async (argv) => { calls.push(argv.join(' ')); return { exitCode: 0, stdout: argv[1] === 'status' ? JSON.stringify(status) : '[]' }; } },
    agent: { list: async () => [] },
    ui: { invalidate() {} },
  };
  f.resetPhaseBand();
  await f.phaseBandStart($, { isInteractive: true, cwd: '/proj' }, async () => undefined);
  await f.phaseBandSettled();
  const complete = async () => {
    const r = await f.phaseBandComplete($, { text: '/astro-plan ', start: 12, token: '' }, async () => ({ suggestions: [] }));
    return r.suggestions.map((x) => x.text);
  };
  return { complete, calls };
}
const prow = (number, o = {}) => ({ number, name: `P${number}`, slug: `${number}-p`, status: 'pending', planned: false, discussed: false, milestone: 1, ...o });
const scoped = (registry) => ({
  milestone: 1, next: null, siblings: [], registry,
  phases: [
    prow(1, { mine: true, feature_branch: 'feature/alpha', onBranch: true }),
    prow(2, { mine: true }),
    prow(3, { mine: false, owner_tag: 'a', feature_branch: 'feature/alpha' }),
  ],
});

test('autocomplete phase rows: branch mode excludes a teammate\'s and an untied phase, full mode is unchanged', async () => {
  const branch = await bandFeature(scoped(true), 'ref: refs/heads/feature/alpha\n');
  assert.deepEqual(await branch.complete(), ['1']);
  const full = await bandFeature(scoped(undefined), 'ref: refs/heads/feature/alpha\n');
  assert.deepEqual(await full.complete(), ['1', '2', '3']);
});

test('autocomplete phase rows: mine mode off the branch, and a detached HEAD is mine mode; no extra process (C9)', async () => {
  const dev = await bandFeature(scoped(true), 'ref: refs/heads/develop\n');
  assert.deepEqual(await dev.complete(), ['1', '2']);
  const det = await bandFeature(scoped(true), '0123456789abcdef0123456789abcdef01234567\n');
  assert.deepEqual(await det.complete(), ['1', '2']);
  assert.ok(dev.calls.every((c) => /^ac (status|debt|backlog|fix) /.test(c)), dev.calls.join(' | '));
});
