import test from 'node:test'
import assert from 'node:assert/strict'
import { closeTime, sessionPeriods } from '../src/sessionPerformanceModel.js'

test('historical period P/L uses UTC close times, a Monday week and the last close rather than wall clock', () => {
  const ledger = [
    { close_time_utc: '2024-01-31T23:59:00Z', net_pnl: 10 },
    { close_time_utc: '2024-02-04T23:59:00Z', net_pnl: -4 },
    { close_time_utc: '2024-02-05T00:01:00Z', net_pnl: 7 },
    { close_time_utc: '2024-02-05T08:00:00+07:00', net_pnl: 2 },
  ]
  const result = sessionPeriods(ledger)
  assert.equal(result.anchor.toISOString(), '2024-02-05T01:00:00.000Z')
  assert.equal(result.month, 5)
  assert.equal(result.week, 9)
  assert.equal(result.day, 9)
  assert.deepEqual(result.months, [{ label: '2024-01', value: 10 }, { label: '2024-02', value: 5 }])
  assert.equal(result.weekdays.find(day => day.label === 'CN').value, -4)
  assert.equal(result.weekdays.find(day => day.label === 'T2').value, 9)
  assert.equal(result.weekdays.reduce((sum, day) => sum + day.value, 0), 15)
})

test('missing dates/PnL do not become a zero period or a fabricated daily chart', () => {
  for (const trade of [{ close_time_utc: null, net_pnl: 1 }, { close_time_utc: 'invalid', net_pnl: 1 }, { close_time_utc: 1704067200, net_pnl: null }]) {
    const result = sessionPeriods([trade])
    assert.equal(result.incomplete, true)
    assert.equal(result.day, null)
    assert.deepEqual(result.months, [])
  }
  assert.equal(sessionPeriods([]).day, null)
  assert.deepEqual(sessionPeriods([]).weekdays, [])
})

test('numeric epoch seconds and milliseconds normalize to the same historical UTC instant', () => {
  assert.equal(closeTime(1704067200).toISOString(), closeTime(1704067200000).toISOString())
  assert.equal(closeTime('1704067200').toISOString(), '2024-01-01T00:00:00.000Z')
  assert.equal(closeTime(false), null)
})
