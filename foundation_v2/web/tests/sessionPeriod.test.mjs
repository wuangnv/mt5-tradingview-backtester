import test from 'node:test'
import assert from 'node:assert/strict'
import { commonSessionRange, randomSessionDate, sessionDateTimestamp, sessionDateValue, sessionEndShortcut, sessionPeriodState } from '../src/sessionPeriod.js'

const epoch = value => Date.parse(value) / 1000
const range = { min: epoch('2025-01-01T00:00Z'), max: epoch('2026-10-09T23:59Z'), step: 60, valid: true }
test('period uses the common immutable UTC range and never interprets the local timezone', () => {
  assert.deepEqual(commonSessionRange([
    { first_timestamp: 101, last_timestamp: 999, timeframe_seconds: 60 },
    { first_timestamp: 130, last_timestamp: 850, timeframe_seconds: 60 },
  ]), { min: 180, max: 840, step: 60, valid: true })
  assert.equal(commonSessionRange([]), null)
  assert.equal(commonSessionRange([{ first_timestamp: 200, last_timestamp: 100 }]).valid, false)
  const value = '2026-10-09T08:22'
  assert.equal(sessionDateTimestamp(value), epoch(`${value}Z`))
  assert.equal(sessionDateValue(sessionDateTimestamp(value)), value)
})
test('missing, out of range, reversed dates cannot enable submission; auto does not submit a custom end', () => {
  assert.equal(sessionPeriodState({ start: '', endMode: 'auto' }, range).valid, false)
  assert.equal(sessionPeriodState({ start: '2024-01-01T00:00', endMode: 'auto' }, range).valid, false)
  assert.equal(sessionPeriodState({ start: '2026-10-09T23:59', endMode: 'auto' }, range).valid, false)
  assert.deepEqual(sessionPeriodState({ start: '2025-01-01T00:00', end: 'invalid', endMode: 'auto' }, range), { start: range.min, end: null, valid: true })
  for (const end of ['', '2024-12-31T00:00', '2025-01-01T00:00', '2027-01-01T00:00']) {
    assert.equal(sessionPeriodState({ start: '2025-01-01T00:00', end, endMode: 'custom' }, range).valid, false)
  }
})
test('duration shortcuts preserve UTC clock and clamp calendar months at month end', () => {
  const start = epoch('2025-01-31T08:22Z')
  assert.equal(sessionEndShortcut(start, 'day'), epoch('2025-02-01T08:22Z'))
  assert.equal(sessionEndShortcut(start, 'week'), epoch('2025-02-07T08:22Z'))
  assert.equal(sessionEndShortcut(start, 'month'), epoch('2025-02-28T08:22Z'))
  assert.equal(sessionEndShortcut(epoch('2024-01-31T08:22Z'), 'month'), epoch('2024-02-29T08:22Z'))
})
test('random initial date stays within range and leaves at least one future interval before custom end', () => {
  const period = { endMode: 'custom', end: '2025-01-01T00:10' }
  assert.equal(randomSessionDate(range, period, () => 0), '2025-01-01T00:00')
  assert.equal(randomSessionDate(range, period, () => .99999), '2025-01-01T00:09')
  assert.equal(randomSessionDate(range, { endMode: 'custom', end: '2025-01-01T00:00' }), null)
})
