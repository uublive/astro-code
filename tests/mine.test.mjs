// Phase 26 t7 — RED: the miner engine (P5/P6/P8, D2/D5/D6). Every not-yet-existing
// symbol reached via a dynamic import inside each async test body (ADR-018).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sandbox, writeClaudeSession, cHuman, cAssistant, SECRETS } from './fixtures/minefixtures.mjs';
import { addPrinciple, proposePrinciple, rejectPrinciple } from '../lib/principles.mjs';

const MINE = '../lib/mine.mjs';

function proj(sb, name = 'proj') {
  const root = join(sb.home, name);
  mkdirSync(root, { recursive: true });
  return root;
}

test('cues: a plain correction is a steer, not explicit; "always"/"d\'ora in poi" are explicit; praise is no steer', async () => {
  const { steerSentences } = await import(MINE);
  const s1 = steerSentences('no, not that file.');
  assert.equal(s1.length, 1);
  assert.equal(s1[0].explicit, false);

  const s2 = steerSentences('from now on always run the linter.');
  assert.equal(s2.length, 1);
  assert.equal(s2[0].explicit, true);

  const s3 = steerSentences("d'ora in poi usa sempre pnpm.");
  assert.equal(s3.length, 1);
  assert.equal(s3[0].explicit, true);

  const s4 = steerSentences('thanks, looks good.');
  assert.equal(s4.length, 0);
});

test('C4 keying: casing/politeness collapse to one key; polarity keeps "never" separate from "always"', async () => {
  const { steerKey } = await import(MINE);
  const a = steerKey('Always run the linter before committing.');
  const b = steerKey('please always run the linter before committing!');
  const c = steerKey('ALWAYS run the linter before committing');
  const d = steerKey('never run the linter before committing');
  assert.equal(a.key, b.key);
  assert.equal(a.key, c.key);
  assert.notEqual(a.key, d.key);
  assert.equal(a.keyHash.length, 16);
});

test('C4 grouping + cap/rank + redaction + store matches via a real sweep', async () => {
  const sb = sandbox();
  const root = proj(sb);

  // Three sessions restate the same steer (plus in-session repeats, which must not
  // inflate recurrence); one explicit rule stated once; one lone non-qualifying steer;
  // a secret-bearing steer; and pre-seeded accepted/rejected entries the restatements
  // should land on as sightings, never as fresh candidates (C8/ADR-058).
  const { entry: accepted } = { entry: await addPrinciple(sb.store, { statement: 'Always use pnpm for lockfiles', kind: 'principle', why: 'w' }) };
  const proposedForReject = await proposePrinciple(sb.store, { statement: 'Never write semicolons', kind: 'antipattern', why: 'w' });
  await rejectPrinciple(sb.store, proposedForReject.entry.id, { reason: 'style is fine either way' });

  writeClaudeSession(sb.claude, root, 's1', [
    cAssistant('ok, how should I proceed?'),
    cHuman('Always run the linter before committing.'),
    cHuman('Always run the linter before committing.'), // in-session repeat — no inflation
  ]);
  writeClaudeSession(sb.claude, root, 's2', [
    cHuman('please always run the linter before committing!'),
  ]);
  writeClaudeSession(sb.claude, root, 's3', [
    cHuman('ALWAYS run the linter before committing'),
  ]);
  writeClaudeSession(sb.claude, root, 's4', [
    cHuman('no, not that one file'), // lone, non-explicit — below threshold
  ]);
  writeClaudeSession(sb.claude, root, 's5', [
    cHuman(`from now on always redact secrets like ${SECRETS[0]} and ${SECRETS[1]}`),
  ]);
  writeClaudeSession(sb.claude, root, 's6', [
    cHuman('Always use pnpm for lockfiles.'), // restates the accepted entry
  ]);
  writeClaudeSession(sb.claude, root, 's7', [
    cHuman('Always use pnpm for lockfiles.'),
  ]);
  writeClaudeSession(sb.claude, root, 's8', [
    cHuman('Never write semicolons.'), // restates the rejected entry
  ]);
  writeClaudeSession(sb.claude, root, 's9', [
    cHuman('Never write semicolons.'),
  ]);

  const { sweep } = await import(MINE);
  const result = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });

  assert.equal(result.nothingNew, false);
  assert.ok(Array.isArray(result.candidates));
  assert.ok(result.candidates.length <= 10, 'MINE_CAP guards the emitted count');

  const linter = result.candidates.find((c) => /linter/.test(c.text));
  assert.ok(linter, 'the 3-session steer must qualify as a candidate');
  assert.equal(linter.recurrence, 3);
  assert.equal(linter.sessions.length, 3);

  assert.ok(!result.candidates.some((c) => /not that one file/.test(c.text)), 'a lone non-explicit steer must not qualify');
  assert.ok(result.belowThreshold >= 1);

  const secretCandidate = result.candidates.find((c) => /redact secrets/.test(c.text));
  assert.ok(secretCandidate);
  for (const secret of SECRETS) assert.ok(!secretCandidate.text.includes(secret));
  assert.ok(!JSON.stringify(result).includes(SECRETS[0]));

  const pnpmSighting = result.sightings.find((s) => s.id === accepted.id);
  assert.ok(pnpmSighting, 'an exact restatement of an accepted entry must be a sighting, never a fresh candidate');
  assert.ok(!result.candidates.some((c) => /pnpm for lockfiles/.test(c.text)));

  const semicolonSighting = result.sightings.find((s) => s.status === 'rejected');
  assert.ok(semicolonSighting, 'an exact restatement of a rejected entry must be a sighting with its status');
  assert.ok(!result.candidates.some((c) => /semicolons/.test(c.text)));
});

test('C4 across sweeps: a one-off, advanced, then repeated in a new session qualifies via seen', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 'sA', [cHuman('please stop adding trailing commas')]);

  const { sweep, advanceSweep } = await import(MINE);
  const first = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  assert.ok(!first.candidates.some((c) => /trailing commas/.test(c.text)));
  await advanceSweep({ storeDir: sb.store, id: first.sweep });

  writeClaudeSession(sb.claude, root, 'sB', [cHuman('please stop adding trailing commas')]);
  const second = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  assert.ok(second.candidates.some((c) => /trailing commas/.test(c.text)), 'the second sighting must qualify via `seen`');
});

test('C6: after sweep + advance, re-sweeping is nothingNew; sweep() alone never writes state', async () => {
  const sb = sandbox();
  const root = proj(sb);
  writeClaudeSession(sb.claude, root, 'sA', [cHuman('from now on never use var, always use const')]);

  const { sweep, advanceSweep } = await import(MINE);
  const dryRun = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  assert.ok(dryRun.candidates.length >= 1);

  const { readdirSync, existsSync } = await import('node:fs');
  const mineDir = join(sb.store, '.local', 'mine');
  const filesBefore = existsSync(join(mineDir, 'files')) ? readdirSync(join(mineDir, 'files')) : [];

  const first = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  await advanceSweep({ storeDir: sb.store, id: first.sweep });
  const again = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  assert.equal(again.nothingNew, true);
  assert.equal(again.sweep, null);
});

test('MINE_CAP mirrors the spec\'s 10-per-sweep row (single source, D6)', async () => {
  const { MINE_CAP } = await import(MINE);
  assert.equal(MINE_CAP, 10);
  const spec = readFileSync(new URL('../templates/principle-capture.md', import.meta.url), 'utf8');
  const m = spec.match(/\*\*(\d+)\*\*\s*\n?\s*per sweep/);
  assert.ok(m, 'the spec must state the per-sweep number beside "per sweep"');
  assert.equal(Number(m[1]), MINE_CAP);
});

test('output ceilings: candidate text/excerpt/context are capped', async () => {
  const sb = sandbox();
  const root = proj(sb);
  const longText = `From now on always ${'x'.repeat(400)}`;
  writeClaudeSession(sb.claude, root, 'sA', [
    cAssistant('y'.repeat(400)),
    cHuman(longText),
  ]);
  const { sweep } = await import(MINE);
  const result = await sweep({ scope: { mode: 'project', roots: [root] }, storeDir: sb.store, env: sb.env });
  const c = result.candidates[0];
  assert.ok(c.text.length <= 300);
  assert.ok(c.excerpt.length <= 500);
  assert.ok(c.context.length <= 300);
});
