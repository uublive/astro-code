import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTags } from '../src/tags.mjs'

test('normalizeTags trims', () => {
  assert.deepEqual(normalizeTags([' a ', 'b']), ['a', 'b'])
})

test('normalizeTags rejects a non-array', () => {
  assert.throws(() => normalizeTags('a'), TypeError)
})
