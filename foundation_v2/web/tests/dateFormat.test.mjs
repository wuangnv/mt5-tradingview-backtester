import assert from 'node:assert/strict'
import test from 'node:test'
import { displayDate, displayTime, dateFieldDisplay, parseDateField } from '../src/dateFormat.js'
import { sessionDate } from '../src/sessionSettingsModel.js'
import { libraryDataType } from '../src/dataLibraryModel.js'

test('dates pad day/month and keep four-digit year for ISO, epoch seconds/ms and Date', () => {
  for (const value of ['2003-05-04T00:00:00Z', 1052006400, 1052006400000, new Date('2003-05-04Z')]) assert.equal(displayDate(value), '04/05/2003')
  assert.equal(displayDate(0), '01/01/1970')
  assert.equal(displayDate('2024-02-29'), '29/02/2024')
})
test('24-hour time includes seconds when requested; formatting preserves timezone semantics', () => {
  assert.equal(displayDate('2026-10-08T17:03:09Z', { timeStyle: 'short' }), '08/10/2026 17:03')
  assert.equal(displayTime('2026-10-08T00:03:09Z', { seconds: true }), '00:03:09')
  assert.equal(displayDate('2026-10-08T17:03:09Z', { timeStyle: 'medium', timeZone: 'Asia/Ho_Chi_Minh' }), '09/10/2026 00:03:09')
  assert.equal(sessionDate(1052006400, false, 'en-US'), '04/05/2003')
  assert.equal(sessionDate(1052006400, true, 'en-US'), '04/05/2003 00:00')
})
test('unknown/invalid values are explicit and cannot become epoch zero', () => {
  for (const value of [null, undefined, '', true, NaN, 'invalid']) assert.equal(displayDate(value), '—')
  assert.equal(displayDate(null, { fallback: 'N/A' }), 'N/A')
})
test('date fields round-trip ISO without timezone conversion, including midnight and seconds', () => {
  assert.equal(dateFieldDisplay('2026-10-08'), '08/10/2026')
  assert.equal(dateFieldDisplay('2026-10-08T00:03:09Z', 'datetime-local'), '08/10/2026 00:03:09')
  assert.equal(parseDateField('08/10/2026'), '2026-10-08')
  assert.equal(parseDateField('08/10/2026 23:03:09', 'datetime-local'), '2026-10-08T23:03:09')
  assert.equal(parseDateField(''), '')
})
test('fields reject impossible dates, incomplete input and invalid hours', () => {
  for (const value of ['29/02/2025', '31/04/2026', '01/13/2026', '8/10/2026', '2026-10-08', '01/01/0000']) assert.equal(parseDateField(value), null)
  for (const value of ['08/10/2026 24:00', '08/10/2026 12:60', '08/10/2026 12:00:60']) assert.equal(parseDateField(value, 'datetime-local'), null)
  assert.equal(parseDateField('29/02/2024'), '2024-02-29')
  assert.equal(parseDateField('23:59:59', 'time'), '23:59:59')
  assert.equal(parseDateField('24:00', 'time'), null)
  assert.equal(parseDateField('01:60', 'time'), null)
})
test('price type comes from saved provenance, never guessed from provider name', () => {
  assert.deepEqual(libraryDataType({ downloaded: true, timeframe: 'H1', source: { provider: 'Dukascopy', export_settings: 'user CSV' } }), { timeframe: 'H1', price: undefined })
  assert.deepEqual(libraryDataType({ downloaded: true, timeframe: 'M1', source: { export_settings: '{"price":"ask"}' } }), { timeframe: 'M1', price: 'Ask' })
  assert.deepEqual(libraryDataType({ downloaded: false }, '2003-05-04'), { timeframe: 'M1', price: 'Bid' })
  assert.deepEqual(libraryDataType({ downloaded: false }), { timeframe: '—' })
})
