import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listItems } from '../src/list.mjs'

test('listItems returns every item as a copy', () => {
  const a = [1, 2, 3]
  const out = listItems(a)
  assert.deepEqual(out, a)
  assert.notEqual(out, a)
})
