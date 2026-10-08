import test from 'node:test'
import assert from 'node:assert/strict'
import { datasetAssetOptions } from '../src/datasetAssetOptions.js'

const dataset = (id, provider = 'QuantDataManager') => ({ dataset_id:id, instrument_id:'EUR/USD', timeframe:'60s', source:{ provider } })
test('catalog enriches only saved versions with the same source and engine', () => {
  const options = datasetAssetOptions([dataset('saved-qdm'), dataset('saved-csv', 'CSV')], [
    { instrument_id:'EUR/USD', provider:'CSV', name:'CSV pair', asset_class:'stock' },
    { instrument_id:'EUR/USD', provider:'QuantDataManager', name:'Euro / US Dollar', asset_class:'fx' },
    { instrument_id:'USD/JPY', provider:'QuantDataManager', asset_class:'fx' },
  ])
  assert.equal(options.length, 2)
  const qdm = options.find(item => item.value === 'saved-qdm')
  assert.equal(qdm.category, 'fx')
  assert.equal(qdm.name, 'Euro / US Dollar')
  assert.match(qdm.summary, /M1 · Dukascopy/)
  assert.match(qdm.summary, /#saved-qdm/)
  assert.equal(options.find(item => item.value === 'saved-csv').name, 'CSV pair')
})
test('recent history prioritizes exact saved versions without duplicating them', () => {
  const options = datasetAssetOptions([dataset('old'), dataset('new')], [], [
    { dataset_id:'old', updated_at_utc:'2026-10-01' },
    { dataset_id:'new', updated_at_utc:'2026-10-07' },
    { dataset_id:'new', updated_at_utc:'2026-10-08' },
    { dataset_id:'missing', updated_at_utc:'2026-10-08' },
  ])
  assert.deepEqual(options.map(item => item.value), ['new', 'old'])
  assert.ok(options.every(item => item.group === 'Dùng gần đây'))
})
test('archived or unavailable history does not create a recent section', () => {
  const options = datasetAssetOptions([dataset('saved')], [], [{ dataset_id:'saved', archived:true }, { dataset_id:'missing' }])
  assert.equal(options[0].group, '')
})
