import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePort } from '../src/config.mjs'

test('parsePort reads a plain port', () => {
  assert.equal(parsePort('3000'), 3000)
})
