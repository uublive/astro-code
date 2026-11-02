import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveJson } from '../src/store.mjs'

test('saveJson writes readable JSON', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'seed-store-')), 'a.json')
  saveJson(file, { a: 1 })
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { a: 1 })
})
