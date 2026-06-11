// Unit tests for lib/heal.mjs — resolveHealList.
//
// The phase-04 wave-2 trap: auto-merge stacked duplicate helpers with no
// conflict marker; textual success ≠ correct code.  ADR-014 mandates
// drop-and-rerun at the integrated tip — never rebase.  resolveHealList
// computes exactly which tasks need that re-run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveHealList } from '../lib/heal.mjs';

// Wave task list used across tests — plan order matters.
const WAVE = [
  { id: 't1', file: 'lib/a.mjs', depends_on: [] },
  { id: 't2', file: 'lib/b.mjs', depends_on: [] },
  { id: 't3', file: 'lib/c.mjs', depends_on: [] },
  { id: 't4', file: 'lib/d.mjs', depends_on: [] },
];

// ── 1. conflict with a mapped taskId → only that task is re-run ────────────
test('a conflict with a non-null taskId returns only that task', () => {
  const conflicts = [{ branch: 'worktree-t2', taskId: 't2' }];
  const integrated = new Set(['t1', 't3', 't4']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  assert.deepEqual(result.map((t) => t.id), ['t2']);
});

// ── 2. conflict with taskId:null → every task NOT confirmed integrated ──────
test('a null-taskId conflict adds every wave task not explicitly integrated', () => {
  // Integrator confirmed t1 and t3; t2 and t4 were not confirmed, plus the
  // branch could not be mapped → all unconfirmed tasks are added.
  const conflicts = [{ branch: 'worktree-x', taskId: null }];
  const integrated = new Set(['t1', 't3']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  // t2 and t4 are not in integrated
  assert.deepEqual(result.map((t) => t.id), ['t2', 't4']);
});

// ── 3. mix: some mapped, one null → union, deduplicated, in plan order ──────
test('mix of mapped and null conflicts produces a deduplicated plan-order list', () => {
  // t2 is named directly; the null conflict would also want t2+t4 (t1,t3 confirmed)
  const conflicts = [
    { branch: 'worktree-t2', taskId: 't2' },
    { branch: 'worktree-x',  taskId: null },
  ];
  const integrated = new Set(['t1', 't3']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  // t2 from both paths, t4 from null path → deduplicated → [t2, t4]
  assert.deepEqual(result.map((t) => t.id), ['t2', 't4']);
});

// ── 4. all tasks confirmed integrated, no null conflict → empty list ─────────
test('when all wave tasks are confirmed integrated, heal list is empty', () => {
  const conflicts = [{ branch: 'worktree-t2', taskId: 't2' }];
  // Every task confirmed — but t2 appears in conflicts with a taskId, so it is added.
  // Testing: no null conflict AND all confirmed except the explicit one.
  const integrated = new Set(['t1', 't2', 't3', 't4']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  // t2 has a non-null taskId → added regardless of integrated set
  assert.deepEqual(result.map((t) => t.id), ['t2']);
});

// ── 5. null conflict when integrator confirmed nobody → entire wave re-runs ──
test('null conflict with empty integrated set returns the full wave in plan order', () => {
  const conflicts = [{ branch: 'worktree-x', taskId: null }];
  const integrated = new Set();
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  assert.deepEqual(result.map((t) => t.id), ['t1', 't2', 't3', 't4']);
});

// ── 6. duplicate taskId in multiple conflicts → listed only once ──────────
test('the same taskId appearing in two conflict objects is deduplicated', () => {
  const conflicts = [
    { branch: 'worktree-t2-a', taskId: 't2' },
    { branch: 'worktree-t2-b', taskId: 't2' },
  ];
  const integrated = new Set(['t1', 't3', 't4']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  assert.deepEqual(result.map((t) => t.id), ['t2']);
});

// ── 7. plan order is always preserved regardless of conflict insertion order ──
test('output preserves wave (plan) order, regardless of conflict order', () => {
  // Conflicts name t4 then t2; output must still be [t2, t4] (plan order).
  const conflicts = [
    { branch: 'worktree-t4', taskId: 't4' },
    { branch: 'worktree-t2', taskId: 't2' },
  ];
  const integrated = new Set(['t1', 't3']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  assert.deepEqual(result.map((t) => t.id), ['t2', 't4']);
});

// ── 8. taskId in conflicts not present in wave is silently ignored ──────────
test('a taskId that does not exist in the wave is silently ignored', () => {
  const conflicts = [{ branch: 'worktree-ghost', taskId: 't-nonexistent' }];
  const integrated = new Set(['t1', 't2', 't3', 't4']);
  const result = resolveHealList(WAVE, conflicts, integrated, (b) => b.replace('worktree-', ''));
  assert.deepEqual(result.map((t) => t.id), []);
});

// ── 9. branchForTask is not called — it is optional context, not needed ──────
//
// The signature receives branchForTask for completeness (callers may pass it),
// but resolveHealList is a pure task-id computation.  Passing undefined must not throw.
test('branchForTask may be undefined — resolveHealList is a pure id computation', () => {
  const conflicts = [{ branch: 'worktree-t3', taskId: 't3' }];
  const integrated = new Set(['t1', 't2', 't4']);
  const result = resolveHealList(WAVE, conflicts, integrated, undefined);
  assert.deepEqual(result.map((t) => t.id), ['t3']);
});

// ── 10. empty conflicts → empty heal list ────────────────────────────────────
test('no conflicts means nothing to heal', () => {
  const result = resolveHealList(WAVE, [], new Set(['t1', 't2', 't3', 't4']), undefined);
  assert.deepEqual(result.map((t) => t.id), []);
});
