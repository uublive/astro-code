import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadSettings } from '../src/settings.mjs'

test('loadSettings defaults host and port', () => {
  assert.deepEqual(loadSettings({}), { host: 'localhost', port: 3000 })
})
