import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderForm } from '../src/form.mjs'

test('the form has a labelled name field', () => {
  const html = renderForm()
  assert.match(html, /<label for="name">Name<\/label>/)
  assert.match(html, /<input id="name" name="name"/)
})
