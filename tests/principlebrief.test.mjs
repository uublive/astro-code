// Phase 25 t3 — spec for the scope matcher, selection and renderer
// (lib/principlebrief.mjs), P2-P4 of the phase plan. Pure unit tests: entries are
// plain objects shaped like `parsePrinciple` output, no fs, no git.
//
// Reached via `await import(...)` inside every test body per ADR-018 — the module
// does not exist on this branch yet (t4 lands it in the same wave); a static import
// here would crash the whole file at module load.
import { test } from 'node:test';
import assert from 'node:assert/strict';

function entry(id, over = {}) {
  return {
    id, kind: 'convention', strength: 'default', status: 'accepted',
    statement: 'A statement about something.', why: '',
    scopes: { stack: [], files: [], work: [] },
    promotions: [], history: [],
    ...over,
  };
}

// C1's matrix, restated per-entry.
function matrix() {
  return [
    entry('A', { scopes: { stack: ['node'], files: [], work: ['code'] } }),
    entry('B', { scopes: { stack: ['go'], files: [], work: [] } }),
    entry('C', { scopes: { stack: [], files: ['lib/**'], work: [] } }),
    entry('D', { scopes: { stack: [], files: [], work: ['review'] } }),
    entry('E', { scopes: { stack: [], files: [], work: [] } }),
    entry('R', { strength: 'rule', scopes: { stack: ['go'], files: [], work: [] } }),
    entry('P', { status: 'proposed', scopes: { stack: ['node'], files: [], work: [] } }),
    entry('J', { status: 'rejected', scopes: { stack: ['node'], files: [], work: [] } }),
    entry('K', { status: 'retired', scopes: { stack: ['node'], files: [], work: [] } }),
  ];
}

test('C1 scope matrix: AND across dimensions, rules bypass scope', async () => {
  const { selectBrief } = await import('../lib/principlebrief.mjs');
  const entries = matrix();
  const ctx = { stack: ['node', 'express'], work: ['code'], files: ['lib/x.mjs'] };
  const brief = selectBrief(entries, ctx);
  const defaultIds = brief.index.map((i) => i.id).sort();
  assert.deepEqual(defaultIds, ['A', 'C', 'E']);
  assert.deepEqual(brief.rules.map((r) => r.id), ['R']);
});

test('C1 second ctx: review work, no files', async () => {
  const { selectBrief } = await import('../lib/principlebrief.mjs');
  const entries = matrix();
  const ctx = { stack: [], work: ['review'], files: [] };
  const brief = selectBrief(entries, ctx);
  const defaultIds = brief.index.map((i) => i.id).sort();
  assert.deepEqual(defaultIds, ['D', 'E']);
  assert.deepEqual(brief.rules.map((r) => r.id), ['R']);
});

test('globMatch: ** dirs, * within a segment, ? one char, basename rule, trailing slash', async () => {
  const { globMatch } = await import('../lib/principlebrief.mjs');
  assert.equal(globMatch('lib/**', 'lib/x.mjs'), true);
  assert.equal(globMatch('lib/**', 'lib/a/b.mjs'), true);
  assert.equal(globMatch('lib/**', 'libx/y.mjs'), false);
  assert.equal(globMatch('*.test.mjs', 'tests/a.test.mjs'), true);
  assert.equal(globMatch('lib/*.mjs', 'lib/a/b.mjs'), false);
  assert.equal(globMatch('docs/', 'docs/x.md'), true);
});

test('workForStage maps every stage, throws naming the set for unknown', async () => {
  const { workForStage, STAGE_WORK } = await import('../lib/principlebrief.mjs');
  assert.deepEqual(workForStage('execute'), ['code', 'test']);
  assert.deepEqual(workForStage('session'), []);
  assert.throws(() => workForStage('bogus'), (e) => {
    assert.ok(e.message.includes('bogus'));
    for (const stage of Object.keys(STAGE_WORK)) assert.ok(e.message.includes(stage));
    return true;
  });
});

test('renderBrief: a default renders one line, its why never appears', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const entries = [entry('D1', {
    statement: 'A long statement. With a second sentence that goes on and on and on.',
    why: 'WHYDEFAULT',
    scopes: { stack: [], files: [], work: [] },
  })];
  const brief = selectBrief(entries, { stack: [], work: [], files: [] });
  const text = renderBrief(brief, { stack: [], work: [], files: [] });
  assert.ok(text.includes('D1'));
  assert.ok(text.includes('convention/default'));
  assert.ok(!text.includes('WHYDEFAULT'));
});

test('renderBrief: a rule renders full statement and why', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const entries = [entry('RUL1', { strength: 'rule', statement: 'Full rule statement here.', why: 'WHYRULE1' })];
  const brief = selectBrief(entries, { stack: [], work: [], files: [] });
  const text = renderBrief(brief, { stack: [], work: [], files: [] });
  assert.ok(text.includes('Full rule statement here.'));
  assert.ok(text.includes('WHYRULE1'));
});

test('renderBrief: 150 defaults + 3 rules (two out of scope) — cap, +N more, all rules present', async () => {
  const { selectBrief, renderBrief, INDEX_MAX } = await import('../lib/principlebrief.mjs');
  const defaults = [];
  for (let i = 0; i < 150; i++) {
    defaults.push(entry(`D${i}`, { scopes: { stack: [], files: [], work: [] } }));
  }
  const rules = [
    entry('RUL1', { strength: 'rule', why: 'WHYRULE1', scopes: { stack: [], files: [], work: [] } }),
    entry('RUL2', { strength: 'rule', why: 'WHYRULE2', scopes: { stack: ['go'], files: [], work: [] } }),
    entry('RUL3', { strength: 'rule', why: 'WHYRULE3', scopes: { stack: ['rust'], files: [], work: [] } }),
  ];
  const entries = [...defaults, ...rules];
  const ctx = { stack: ['node'], work: [], files: [] };
  const brief = selectBrief(entries, ctx);
  const text = renderBrief(brief, ctx);
  assert.equal(brief.rules.length, 3);
  for (const w of ['WHYRULE1', 'WHYRULE2', 'WHYRULE3']) assert.ok(text.includes(w));
  assert.equal(brief.index.length, INDEX_MAX);
  const moreCount = brief.total - brief.index.length;
  assert.ok(text.includes(`+${moreCount} more`));
  assert.ok(text.includes('ac principles ask'));
});

test('renderBrief: tags line names every tag source', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const entries = [entry('D1', { scopes: { stack: [], files: [], work: [] } })];
  const brief = selectBrief(entries, { stack: ['node', 'express'], work: [], files: [] });
  const ctx = { stack: ['node', 'express'], work: [], files: [], sources: [{ file: 'package.json', tags: ['node', 'express'] }] };
  const text = renderBrief(brief, ctx);
  assert.ok(text.includes('node'));
  assert.ok(text.includes('express'));
  assert.ok(text.includes('package.json'));
});

test('renderBrief: clash renders "canon may override"', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const entries = [entry('D1', {
    strength: 'rule',
    scopes: { stack: [], files: [], work: [] },
    clash: [{ ref: 'ADR-012', shared: ['default', 'export'] }],
  })];
  const brief = selectBrief(entries, { stack: [], work: [], files: [] });
  const text = renderBrief(brief, { stack: [], work: [], files: [] });
  assert.ok(text.includes('⚠ canon may override: ADR-012'));
});

test('renderBrief: rulesOnly renders no index and no cite line', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const entries = [
    entry('RUL1', { strength: 'rule', scopes: { stack: [], files: [], work: [] } }),
    entry('D1', { scopes: { stack: [], files: [], work: [] } }),
  ];
  const brief = selectBrief(entries, { stack: [], work: [], files: [] }, { rulesOnly: true });
  const text = renderBrief(brief, { stack: [], work: [], files: [] }, { rulesOnly: true });
  assert.ok(!text.includes('D1'));
  assert.ok(!text.includes('cite what you applied'));
});

test('renderBrief: zero served returns empty string', async () => {
  const { selectBrief, renderBrief } = await import('../lib/principlebrief.mjs');
  const brief = selectBrief([], { stack: [], work: [], files: [] });
  const text = renderBrief(brief, { stack: [], work: [], files: [] });
  assert.equal(text, '');
});

// Phase 25 verify, C1 — `--files` handed as absolute (or cwd-relative from a subdir)
// paths must scope exactly like project-relative ones.
test('projectRelative: absolute and subdir-relative paths become project-relative', async () => {
  const { projectRelative } = await import('../lib/retrieval.mjs');
  const root = '/work/proj';
  assert.deepEqual(projectRelative(['/work/proj/lib/x.mjs', './lib/y.mjs', 'lib/z.mjs'], { root, cwd: root }),
    ['lib/x.mjs', 'lib/y.mjs', 'lib/z.mjs']);
  assert.deepEqual(projectRelative(['x.mjs'], { root, cwd: '/work/proj/lib' }), ['lib/x.mjs']);
  assert.deepEqual(projectRelative(['/other/place/a.mjs'], { root, cwd: root }), ['/other/place/a.mjs']);
});
