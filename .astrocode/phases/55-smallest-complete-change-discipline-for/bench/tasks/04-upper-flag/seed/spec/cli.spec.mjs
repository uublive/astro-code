import { test } from 'node:test'
import assert from 'node:assert/strict'
import { run } from '../src/cli.mjs'

test('greets by name and defaults to world', () => {
  assert.equal(run(['--name', 'ada']), 'Hello, ada!')
  assert.equal(run([]), 'Hello, world!')
})
