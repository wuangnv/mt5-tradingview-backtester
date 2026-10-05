import assert from 'node:assert/strict'
import test from 'node:test'
import { sessionDate, sessionRemainingDays, sessionRange, sessionSettingsFacts } from '../src/sessionSettingsModel.js'

test('remaining range uses canonical cutoff, preserving weekends and ignoring trade close times', () => {
  const dataset = { first_timestamp: 1783285500, last_timestamp: 1791174360 }
  const payload = { provenance: { cutoff_timestamp: 1791000000 } }
  assert.equal(sessionRemainingDays(dataset, payload, { cutoff_timestamp: 1783315500 }), 91)
  assert.deepEqual(sessionRange({}, dataset, payload, { cutoff_timestamp: 1783315500 }), { first: 1783285500, last: 1791174360, days: 91 })
  assert.equal(sessionRemainingDays(dataset, {}), null)
  assert.equal(sessionRemainingDays(dataset, { cutoff_timestamp: dataset.last_timestamp + 100 }), 0)
})

test('unknown balances and range stay unknown, numeric zero remains visible', () => {
  assert.equal(sessionDate(null), '—')
  assert.equal(sessionDate(''), '—')
  assert.equal(sessionSettingsFacts({ instrument_id: 'EURUSDm' }, {}, {}, null).balance, null)
  assert.equal(sessionSettingsFacts({}, {}, {}, null, { payload: { execution: { balance: 0, starting_balance: 10000 } } }).balance, 0)
  assert.equal(sessionSettingsFacts({}, {}, {}, null, { payload: { execution: { balance: 0, starting_balance: 10000 } } }).startingBalance, 10000)
})
