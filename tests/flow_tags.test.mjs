// Behavior spec for nextPatchTag(tagListStdout, milestoneN) — pure helper.
//
// WHY a separate file (not flow.test.mjs): task t3 and task t1 are in wave 1
// (parallel execution). Keeping them in separate files gives each executor a
// single-file owner so they cannot collide on flow.test.mjs. The two test
// files for phase 4 pure helpers are therefore:
//   tests/flow.test.mjs     — parseCompareUrl, flowInit, flowBranch, … (t1+)
//   tests/flow_tags.test.mjs — nextPatchTag (t3+)
//
// WHY pure-function tests with no real git repo: nextPatchTag consumes the
// stdout of `git tag -l "v<N>.*"` as a plain string. There is no need to
// spin up a git repo — the input is just a newline-separated tag list. This
// keeps the tests fast, hermetic, and free of flaky filesystem state.
//
// SPEC (from CONTEXT.md OQ3 + PLAN t3):
//   nextPatchTag(tagListStdout, milestoneN)
//     - tagListStdout: the raw stdout of `git tag -l "v<N>.*"` (may be empty,
//       may have trailing newline, may have blank lines)
//     - milestoneN: integer milestone number
//     - returns the next free patch tag string: `v<N>.<max+1>`
//     - empty list  →  `v<N>.1`
//     - `v3.1`      →  `v3.2`
//     - `v3.10` present  →  `v3.11`   (integer sort, NOT lexicographic — no
//       lexicographic bug where "10" < "2")
//     - tags for a DIFFERENT milestone (e.g. `v4.1` when milestoneN=3) are
//       ignored: they must not affect the result
//     - malformed lines (e.g. "v3.foo", "junk", "v3.") are silently ignored
//       and must not cause an error
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextPatchTag } from '../lib/flow.mjs'

// ---------------------------------------------------------------------------
// Case 1: empty tag list → first patch is .1
// ---------------------------------------------------------------------------

test('nextPatchTag returns v3.1 when there are no existing v3.* tags', () => {
  assert.equal(nextPatchTag('', 3), 'v3.1')
})

test('nextPatchTag returns v3.1 when tagListStdout is only whitespace/newlines', () => {
  assert.equal(nextPatchTag('\n\n\n', 3), 'v3.1')
})

// ---------------------------------------------------------------------------
// Case 2: single existing tag → increments by 1
// ---------------------------------------------------------------------------

test('nextPatchTag returns v3.2 when v3.1 is the only existing tag', () => {
  assert.equal(nextPatchTag('v3.1\n', 3), 'v3.2')
})

// ---------------------------------------------------------------------------
// Case 3: lexicographic sort would break at .10 — integer sort must be used
// ---------------------------------------------------------------------------

test('nextPatchTag returns v3.11 when v3.10 is present (integer sort, not lexicographic)', () => {
  // Lexicographic sort: "10" < "2" < "9" → max would be "9" → v3.10 (WRONG).
  // Integer sort: max is 10 → v3.11 (CORRECT).
  const tagList = 'v3.1\nv3.2\nv3.9\nv3.10\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.11')
})

test('nextPatchTag handles a large patch number correctly', () => {
  const tagList = 'v5.98\nv5.99\nv5.100\n'
  assert.equal(nextPatchTag(tagList, 5), 'v5.101')
})

// ---------------------------------------------------------------------------
// Case 4: tags from a different milestone are ignored
// ---------------------------------------------------------------------------

test('nextPatchTag ignores tags belonging to a different milestone', () => {
  // v4.1 and v2.9 belong to milestones 4 and 2 — must not influence milestoneN=3
  const tagList = 'v4.1\nv2.9\nv3.1\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.2')
})

test('nextPatchTag returns v3.1 when only other-milestone tags are present', () => {
  const tagList = 'v1.1\nv2.5\nv4.10\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.1')
})

// ---------------------------------------------------------------------------
// Case 5: malformed lines are silently ignored
// ---------------------------------------------------------------------------

test('nextPatchTag ignores malformed lines like "v3.foo"', () => {
  // v3.foo has a non-integer patch — ignore it; v3.1 is the only valid tag
  const tagList = 'v3.foo\nv3.1\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.2')
})

test('nextPatchTag ignores lines like "v3." with empty patch', () => {
  const tagList = 'v3.\nv3.1\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.2')
})

test('nextPatchTag ignores completely unrecognised lines', () => {
  const tagList = 'junk\nnot-a-tag\nv3.2\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.3')
})

test('nextPatchTag handles a mix of valid tags, malformed, and other-milestone tags', () => {
  const tagList = 'v3.1\nv3.foo\nv4.5\nv3.10\njunk\nv3.2\n'
  assert.equal(nextPatchTag(tagList, 3), 'v3.11')
})
