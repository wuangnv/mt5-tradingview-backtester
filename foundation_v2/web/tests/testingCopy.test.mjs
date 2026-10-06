import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const copy = JSON.parse(fs.readFileSync(new URL('../src/testing-copy.json', import.meta.url)))
const enums = JSON.parse(fs.readFileSync(new URL('../src/testing-enums.json', import.meta.url)))
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()

test('system copy provides both locales with matching interpolation contracts', () => {
  for (const [key, entry] of Object.entries(copy)) {
    assert.ok(entry.vi.trim(), `Missing VI: ${key}`)
    assert.ok(entry.en.trim(), `Missing EN: ${key}`)
    assert.deepEqual(placeholders(entry.vi), placeholders(entry.en), `Mismatched placeholders: ${key}`)
    if (placeholders(key).length) assert.deepEqual(placeholders(entry.en), placeholders(key), `Key mismatch: ${key}`)
  }
})

test('status families have both locales and blocked execution has an explanation', () => {
  for (const statuses of Object.values(enums)) for (const [key, entry] of Object.entries(statuses)) {
    assert.ok(entry.vi.trim(), key)
    assert.ok(entry.en.trim(), key)
  }
  assert.match(copy.replay_execution_not_initialized.en, /not been initialized/)
  assert.match(copy['LIVE REPLAY CURSOR'].en, /CURRENT REPLAY CURSOR/)
})
