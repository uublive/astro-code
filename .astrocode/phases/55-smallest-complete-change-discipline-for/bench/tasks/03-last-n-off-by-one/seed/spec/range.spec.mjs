import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lastN } from '../src/range.mjs'

test('lastN of an empty list is empty', () => {
  assert.deepEqual(lastN([], 2), [])
})
