// Phase 26 — the miner engine (P5/P6/P8, D2/D4/D6), rewritten for revision R1 (ADR-064):
// `sweep()` judges no meaning. It hands the agent every human turn (redacted, capped,
// exact-identical ones collapsed with the union of their sessions), routes exact store
// matches to sightings, bounds the batch, and carries held/kept turns by pointer only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { sandbox, writeClaudeSession, writeCodexRollout, cHuman, cAssistant, xUser, SECRETS, appendLines } from './fixtures/minefixtures.mjs';
import { addPrinciple, proposePrinciple, rejectPrinciple } from '../lib/principles.mjs';
import { sweep, advanceSweep, MINE_CAP, MINE_BATCH, MINE_BATCH_CHARS } from '../lib/mine.mjs';

function proj(sb, name = 'proj') {
  const root = join(sb.home, name);
  mkdirSync(root, { recursive: true });
  return root;
}

const scopeOf = (root) => ({ mode: 'project', roots: [root] });
const run = (sb, root, extra = {}) => sweep({ scope: scopeOf(root), storeDir: sb.store, env: sb.env, ...extra });

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]
  ));
}

test('C4(a): English, Italian and German turns all reach items[] — no language decides anything', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's-en', [cAssistant('I mocked the DB.'), cHuman("Don't mock the database in tests.")]);
  writeClaudeSession(sb.claude, root, 's-it', [cHuman('Non mockare mai il database nei test.')]);
  writeClaudeSession(sb.claude, root, 's-de', [cHuman('Nie die Datenbank in Tests mocken.')]);
  writeCodexRollout(sb.codex, { id: 'cx-fr', cwd: root }, [xUser('Ne simule jamais la base de données dans les tests.')]);

  const r = await run(sb, root);
  const texts = r.items.map((i) => i.text);
  for (const t of ["Don't mock the database in tests.", 'Non mockare mai il database nei test.', 'Nie die Datenbank in Tests mocken.', 'Ne simule jamais la base de données dans les tests.']) {
    assert.ok(texts.includes(t), `"${t}" must be handed over verbatim`);
  }
  assert.equal(r.items.length, 4, 'non-identical turns are never merged by the engine');
  const en = r.items.find((i) => i.text.startsWith("Don't"));
  assert.deepEqual(en.sessions, ['s-en']);
  assert.equal(en.fromSession, 's-en');
  assert.equal(en.fromRef, 'transcript claude:s-en');
  assert.equal(en.context, 'I mocked the DB.', 'each item carries the preceding assistant turn');
  assert.equal(en.earlier, false);
  const fr = r.items.find((i) => i.text.startsWith('Ne simule'));
  assert.equal(fr.host, 'codex');
  assert.equal(fr.fromRef, 'transcript codex:cx-fr');
  assert.ok(/^t\d+$/.test(en.id));
});

test('C4(a): turns identical after normalising collapse into ONE item carrying both sessions; near-identical ones do not', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cHuman('Nie die Datenbank in Tests mocken.'), cHuman('  nie die datenbank\tin  tests mocken.')]);
  writeClaudeSession(sb.claude, root, 's2', [cHuman('NIE die Datenbank in Tests mocken.')]);
  writeClaudeSession(sb.claude, root, 's3', [cHuman("Don't mock the database in tests"), cHuman('Dont mock the database in tests')]);

  const r = await run(sb, root);
  const de = r.items.filter((i) => /datenbank/i.test(i.text));
  assert.equal(de.length, 1);
  assert.deepEqual(de[0].sessions, ['s1', 's2']);
  const en = r.items.filter((i) => /mock the database/.test(i.text));
  assert.equal(en.length, 2, '"Don\'t" vs "Dont" is a judgement for the agent, not an exact collapse');
});

test('C4 remediate-r2: the collapse keeps symbols and punctuation — opposite instructions never merge', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 'ops1', [cHuman('always use === not ==')]);
  writeClaudeSession(sb.claude, root, 'ops2', [cHuman('always use == not ===')]);
  writeClaudeSession(sb.claude, root, 'ops3', [cHuman('Stop.'), cHuman('Stop!'), cHuman('use a && b'), cHuman('use a || b')]);

  const r = await run(sb, root);
  const ops = r.items.filter((i) => /^always use/.test(i.text));
  assert.equal(ops.length, 2, JSON.stringify(ops));
  assert.deepEqual(ops.map((i) => i.sessions), [['ops1'], ['ops2']]);
  for (const t of ['Stop.', 'Stop!', 'use a && b', 'use a || b']) {
    assert.equal(r.items.filter((i) => i.text === t).length, 1, `${t} is its own item`);
  }
});

// C4 (third verify): the store-sighting path used phase 24's normaliser, which stripped
// every symbol — so a steer was sighted against its own OPPOSITE, even a rejected entry.
test('C4: a turn is sighted only when it IS the stored statement; symbol-level opposites reach the agent', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const pairs = [
    ['Always use === not ==', 'always use == not ==='],
    ['In Go, use := not = for new variables.', 'In Go, use = not := for new variables.'],
    ['Prefer $(cmd) over `cmd`', 'Prefer `cmd` over $(cmd)'],
    ['Prefer --i over i-- in loops.', 'Prefer i-- over --i in loops.'],
    ['Use ?. for property access', 'use . for property access'],
    ['Prefer "x" over \'x\' for strings', 'Prefer \'x\' over "x" for strings'],
    ['Separate CSV fields with ,', 'Separate CSV fields with ;'],
    ['Use — not - in prose', 'Use - not — in prose'],
    ['Wrap ids in (parens) not [brackets]', 'Wrap ids in [parens] not (brackets)'],
  ];
  for (const [rejected] of pairs) {
    const e = await proposePrinciple(sb.store, { statement: rejected, kind: 'preference', why: 'w' });
    await rejectPrinciple(sb.store, e.entry.id, { reason: 'no' });
  }
  const accepted = await addPrinciple(sb.store, { statement: 'Keep functions small', kind: 'principle' });
  writeClaudeSession(sb.claude, root, 'o1', [...pairs.map(([, opp]) => cHuman(opp)), cHuman('keep   FUNCTIONS small')]);
  const r = await run(sb, root);
  const texts = r.items.map((i) => i.text);
  for (const [, opp] of pairs) assert.ok(texts.includes(opp), `the opposite must reach the agent: ${opp}`);
  assert.deepEqual(r.sightings.map((s) => s.id), [accepted.id], 'only the case/whitespace-identical turn is sighted');
});

test('C8: phase-24 equality still folds attached dashes and punctuation (no duplicate proposals)', async () => {
  const { sameStatement } = await import('../lib/principlematch.mjs');
  for (const [a, b] of [
    ['Use pnpm - never npm', 'Use pnpm—never npm'],
    ['Use pnpm – never npm', 'Use pnpm–never npm'],
    ['simple -- always', 'simple--always'],
    ['pnpm, never', 'pnpm,never'],
    ['tests. Then', 'tests.Then'],
    ['Use pnpm, always!', 'use pnpm — always'],
  ]) {
    assert.ok(sameStatement(a, b), `must be one statement: ${a} | ${b}`);
  }
});

test('C4: a steer that states the OPPOSITE of a rejected entry reaches the agent, not a sighting', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const e = await proposePrinciple(sb.store, { statement: 'Prefer C over C++', kind: 'preference', why: 'simplicity' });
  await rejectPrinciple(sb.store, e.entry.id, { reason: 'I actually want C++' });
  writeClaudeSession(sb.claude, root, 'n1', [cHuman('Prefer C++ over C')]);
  writeClaudeSession(sb.claude, root, 'n2', [cHuman('prefer c++ over c!')]);
  const r = await run(sb, root);
  assert.deepEqual(r.sightings, [], 'the opposite of a rejected entry is never recorded as a sighting of it');
  assert.ok(r.items.some((i) => /c\+\+ over c/i.test(i.text)), 'the real steer reaches the agent');
});

test('C4(b): no word list decides dropping — "No.", "stop" and praise are all handed over; only blank turns are dropped', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cHuman('No.'), cHuman('   '), cHuman('thanks, looks good'), cHuman('stop')]);
  writeClaudeSession(sb.claude, root, 's2', [cHuman('No.')]);
  const r = await run(sb, root);
  const texts = r.items.map((i) => i.text);
  assert.ok(texts.includes('No.'));
  assert.ok(texts.includes('stop'));
  assert.ok(texts.includes('thanks, looks good'));
  assert.equal(r.items.find((i) => i.text === 'No.').sessions.length, 2);
  assert.ok(!texts.some((t) => !t.trim()), 'a whitespace-only turn carries nothing to judge');
  assert.equal(r.items.length, 3);
});

test('C4(b): lib/ carries no steer-cue, polarity, contrast or explicit-rule word list', () => {
  const libDir = new URL('../lib/', import.meta.url);
  const src = readFileSync(new URL('mine.mjs', libDir), 'utf8');
  for (const name of ['STEER_CUES', 'RULE_CUES', 'POLARITY_GROUPS', 'steerSentences', 'steerKey', 'groupSteers', 'rankGroups', 'contrastSides', 'MINE_FILLER']) {
    assert.ok(!src.includes(name), `lib/mine.mjs must not carry ${name}`);
  }
  for (const f of readdirSync(libDir)) {
    if (!f.endsWith('.mjs')) continue;
    const s = readFileSync(new URL(f, libDir), 'utf8');
    assert.ok(!/STEER_CUES|RULE_CUES|POLARITY_GROUPS/.test(s), `${f} must not carry a steer word list`);
  }
});

test('C8: an exact store match becomes a sighting with its status, never an item; secrets never reach the output', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const accepted = await addPrinciple(sb.store, { statement: 'Always use pnpm for lockfiles', kind: 'principle', why: 'w' });
  const proposed = await proposePrinciple(sb.store, { statement: 'Never write semicolons', kind: 'antipattern', why: 'w' });
  await rejectPrinciple(sb.store, proposed.entry.id, { reason: 'style is fine either way' });

  writeClaudeSession(sb.claude, root, 's1', [cHuman('Always use pnpm for lockfiles.')]);
  writeClaudeSession(sb.claude, root, 's2', [cHuman('always use pnpm for lockfiles')]);
  writeClaudeSession(sb.claude, root, 's3', [cHuman('Never write semicolons.')]);
  writeClaudeSession(sb.claude, root, 's4', [cHuman(`from now on always redact secrets like ${SECRETS.join(' ')}`)]);

  const r = await run(sb, root);
  const pnpm = r.sightings.find((s) => s.id === accepted.id);
  assert.ok(pnpm, 'an exact restatement of an accepted entry is a sighting');
  assert.deepEqual(pnpm.sessions, ['s1', 's2']);
  assert.ok(pnpm.fromRef.startsWith('transcript claude:'));
  assert.ok(pnpm.excerpt);
  const semi = r.sightings.find((s) => s.status === 'rejected');
  assert.ok(semi, 'an exact restatement of a rejected entry is a sighting with its status');
  assert.equal(semi.reason, 'style is fine either way');
  assert.ok(!r.items.some((i) => /pnpm|semicolons/.test(i.text)), 'a sighted turn is never also an item');

  const secretItem = r.items.find((i) => /redact secrets/.test(i.text));
  assert.ok(secretItem, 'the secret-bearing turn is still handed over');
  const out = JSON.stringify(r);
  for (const s of SECRETS) assert.ok(!out.includes(s), `output must not contain ${s}`);
});

test('C7/budget: turns beyond MINE_BATCH are held, counted in remaining, and all come back next sweep — nothing lost', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const total = MINE_BATCH + 12;
  const lines = [];
  for (let i = 0; i < total; i++) lines.push(cHuman(`turn number ${i}`));
  writeClaudeSession(sb.claude, root, 's1', lines);

  const first = await run(sb, root);
  assert.equal(first.items.length, MINE_BATCH);
  assert.equal(first.remaining, 12);
  await advanceSweep({ storeDir: sb.store, id: first.sweep });

  const second = await run(sb, root);
  assert.equal(second.nothingNew, false, 'held turns alone make the next sweep worth running');
  assert.equal(second.items.length, 12);
  assert.equal(second.remaining, 0);
  assert.ok(second.items.every((i) => i.earlier === true));
  const seen = new Set([...first.items, ...second.items].map((i) => i.text));
  assert.equal(seen.size, total, 'every turn is handed over exactly once across the two sweeps');
  await advanceSweep({ storeDir: sb.store, id: second.sweep });

  const third = await run(sb, root);
  assert.equal(third.nothingNew, true, 'handled turns never resurface');
});

test('C7 remediate-r2: 1000 distinct turns are each handed over exactly once across sweeps — none is lost to a pending bound', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const total = 1000;
  const lines = [];
  for (let i = 0; i < total; i++) lines.push(cHuman(`distinct turn ${i}`));
  writeClaudeSession(sb.claude, root, 's1', lines);

  const counts = new Map();
  for (let sweepNo = 0; sweepNo < 50; sweepNo++) {
    const r = await run(sb, root);
    if (r.nothingNew) break;
    for (const i of r.items) counts.set(i.text, (counts.get(i.text) || 0) + 1);
    await advanceSweep({ storeDir: sb.store, id: r.sweep });
  }
  assert.equal(counts.size, total, `every turn is handed over (got ${counts.size})`);
  assert.ok([...counts.values()].every((c) => c === 1), 'no turn is handed over twice');
});

test('budget: the character budget holds long turns back as well', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const n = Math.ceil(MINE_BATCH_CHARS / 500) + 5;
  const lines = [];
  for (let i = 0; i < n; i++) lines.push(cHuman(`${String(i).padStart(4, '0')} ${'w'.repeat(600)}`));
  writeClaudeSession(sb.claude, root, 's1', lines);
  const r = await run(sb, root);
  const chars = r.items.reduce((a, i) => a + i.text.length + i.context.length, 0);
  assert.ok(chars <= MINE_BATCH_CHARS);
  assert.ok(r.remaining > 0);
  assert.equal(r.items.length + r.remaining, n);
});

test('C4(d)/C7: --keep carries the listed items into the next sweep with earlier:true; unlisted handled items never return', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [
    cAssistant('I added a trailing comma.'),
    cHuman('Keine nachgestellten Kommas, bitte.'),
    cHuman('No.'),
    cHuman('rename the helper to parseRow'),
  ]);
  const first = await run(sb, root);
  const keepMe = first.items.find((i) => /Kommas/.test(i.text));
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: [keepMe.id] });

  writeClaudeSession(sb.claude, root, 's2', [cHuman('Niente virgole finali.')]);
  const second = await run(sb, root);
  const kept = second.items.find((i) => /Kommas/.test(i.text));
  assert.ok(kept, 'the kept turn is re-offered');
  assert.equal(kept.earlier, true);
  assert.deepEqual(kept.sessions, ['s1']);
  assert.equal(kept.context, 'I added a trailing comma.', 'context is re-read from the pointer too');
  const fresh = second.items.find((i) => /virgole/.test(i.text));
  assert.ok(fresh, 'the new session’s turn is offered alongside it');
  assert.equal(fresh.earlier, false);
  assert.ok(!second.items.some((i) => i.text === 'No.' || /parseRow/.test(i.text)), 'unkept handled turns never come back');
});

test('C4(d): a kept turn restated identically in a new session collapses into one earlier item carrying both sessions', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cHuman('Nie die Datenbank in Tests mocken.')]);
  const first = await run(sb, root);
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: [first.items[0].id] });
  writeClaudeSession(sb.claude, root, 's2', [cHuman('Nie die Datenbank in Tests mocken.')]);
  const second = await run(sb, root);
  assert.equal(second.items.length, 1);
  assert.deepEqual(second.items[0].sessions, ['s1', 's2']);
  assert.equal(second.items[0].earlier, true);
});

test('C7(c): an unknown keep id refuses and advances nothing — the same sweep can still be advanced correctly', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cHuman('use tabs, not spaces')]);
  const first = await run(sb, root);
  await assert.rejects(() => advanceSweep({ storeDir: sb.store, id: first.sweep, keep: ['t999'] }), /unknown item id/);
  assert.ok(!existsSync(join(sb.store, '.local', 'mine', 'files')), 'no watermark was written');

  const again = await run(sb, root);
  assert.equal(again.nothingNew, false, 'the watermark did not move');
  assert.equal(again.items.length, 1);
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: [first.items[0].id] });
});

test('C6: kept turns alone are "nothing new"; sweep() never writes the watermark', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cHuman('from now on never use var')]);
  const dry = await run(sb, root);
  assert.equal(dry.items.length, 1);
  assert.ok(!existsSync(join(sb.store, '.local', 'mine', 'files')), 'sweep() alone writes no watermark');

  const first = await run(sb, root);
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: [first.items[0].id] });
  const again = await run(sb, root);
  assert.equal(again.nothingNew, true);
  assert.equal(again.sweep, null);

  const rescanned = await run(sb, root, { rescan: true });
  assert.equal(rescanned.nothingNew, false);
  assert.equal(rescanned.items.length, 1, 'a rescan collapses the re-read kept turn with its own fresh copy');
});

test('carry-over: a kept pointer that no longer reads as a human turn is counted in skipped.stalePending', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const file = writeClaudeSession(sb.claude, root, 's1', [cHuman('a turn to keep')]);
  const first = await run(sb, root);
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: [first.items[0].id] });
  writeFileSync(file, `${JSON.stringify({ type: 'summary', summary: 'rewritten' })}\n`.padEnd(400, ' ') + '\n');
  const second = await run(sb, root, { rescan: true });
  assert.equal(second.skipped.stalePending, 1);
});

test('C3: nothing under .local/mine holds turn text or a secret — pointers only', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const MARK = 'ZXQMARKER';
  const lines = [];
  for (let i = 0; i < MINE_BATCH + 3; i++) lines.push(cHuman(`${MARK}${i} ${SECRETS[i % SECRETS.length]}`));
  writeClaudeSession(sb.claude, root, 's1', lines);
  const first = await run(sb, root);
  assert.ok(first.remaining > 0, 'some turns are held (and so persisted as pointers)');
  // The run record exists before advance; check it too.
  const check = () => {
    for (const f of walk(join(sb.store, '.local', 'mine'))) {
      const text = readFileSync(f, 'utf8');
      assert.ok(!text.includes(MARK), `${f} must hold no turn text`);
      for (const s of SECRETS) assert.ok(!text.includes(s), `${f} must hold no secret`);
    }
  };
  check();
  await advanceSweep({ storeDir: sb.store, id: first.sweep, keep: first.items.slice(0, 3).map((i) => i.id) });
  check();
  const steers = JSON.parse(readFileSync(join(sb.store, '.local', 'mine', 'steers.json'), 'utf8'));
  assert.equal(steers.pending.length, 6, '3 held + 3 kept');
  for (const p of steers.pending) {
    assert.deepEqual(Object.keys(p).sort(), ['at', 'pointers', 'reason']);
    for (const ptr of p.pointers) assert.deepEqual(Object.keys(ptr).sort(), ['ctxEnd', 'ctxStart', 'end', 'file', 'host', 'session', 'start']);
  }
  assert.ok(!('seen' in steers), 'the pre-R1 seen map is no longer written');
});

test('C9: drifted text blocks are counted at sweep level and the result differs from a clean run', async () => {
  const sbClean = sandbox();
  const rootClean = proj(sbClean);
  writeClaudeSession(sbClean.claude, rootClean, 's1', [cHuman('use pnpm')]);
  const clean = await run(sbClean, rootClean);

  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [
    cHuman('use pnpm'),
    { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 1 }] } },
  ]);
  writeCodexRollout(sb.codex, { id: 'cx', cwd: root }, [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ok' }, { type: 'input_text', text: false }] } },
  ]);
  const drifted = await run(sb, root);
  assert.equal(clean.skipped.unrecognised, 0);
  assert.equal(drifted.skipped.unrecognised, 2);
  assert.ok(drifted.items.some((i) => i.text === 'use pnpm'));
});

test('C9 remediation: a Codex rollout with an unrecoverable cwd is scanned (not silently absent) in default project scope', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const dir = join(sb.codex, 'sessions', '2026', '09', '24');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'rollout-no-meta.jsonl');
  appendLines(file, [
    { type: 'future_codex_event', a: 1 },
    { type: 'future_codex_event', a: 2 },
    { type: 'future_codex_event', a: 3 },
    { type: 'future_codex_event', a: 4 },
  ]);
  const result = await run(sb, root);
  assert.equal(result.nothingNew, false, 'must not read as a clean/empty run');
  assert.equal(result.sessions.scanned, 1);
  assert.equal(result.skipped.unrecognised, 4);
});

test('C1: a --rescan in one project never re-offers another project’s kept turns', async () => {
  const sb = sandbox();
  const P = proj(sb, 'p');
  const Q = proj(sb, 'q');
  writeClaudeSession(sb.claude, Q, 'sq', [cHuman('only in Q')]);
  const q = await run(sb, Q);
  await advanceSweep({ storeDir: sb.store, id: q.sweep, keep: [q.items[0].id] });
  writeClaudeSession(sb.claude, P, 'sp', [cHuman('only in P')]);
  const p = await run(sb, P, { rescan: true });
  assert.deepEqual(p.items.map((i) => i.text), ['only in P']);
});

test('MINE_CAP mirrors the spec\'s 10-per-sweep row (single source, D6)', () => {
  assert.equal(MINE_CAP, 10);
  const spec = readFileSync(new URL('../templates/principle-capture.md', import.meta.url), 'utf8');
  const m = spec.match(/\*\*(\d+)\*\*\s*\n?\s*per sweep/);
  assert.ok(m, 'the spec must state the per-sweep number beside "per sweep"');
  assert.equal(Number(m[1]), MINE_CAP);
});

test('output ceilings: item text and context are capped', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 's1', [cAssistant('y'.repeat(400)), cHuman(`From now on ${'x'.repeat(700)}`)]);
  const r = await run(sb, root);
  assert.ok(r.items[0].text.length <= 500);
  assert.ok(r.items[0].context.length <= 300);
});
