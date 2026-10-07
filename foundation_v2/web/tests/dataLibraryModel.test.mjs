import assert from 'node:assert/strict'
import test from 'node:test'
import { categoryOf, categoryLabel, filterLibrary, libraryRows } from '../src/dataLibraryModel.js'

const saved = [
  { dataset_id:'old',instrument_id:'EURUSD',timeframe:'1m',source:{provider:'CSV'},instrument_spec:{asset_class:'fx'},created_at_utc:'2026-01-01Z' },
  { dataset_id:'new',instrument_id:'EURUSD',timeframe:'1m',source:{provider:'CSV'},instrument_spec:{asset_class:'fx'},created_at_utc:'2026-02-01Z' },
  { dataset_id:'gold',instrument_id:'XAUUSD',source:{provider:'CSV'},instrument_spec:{asset_class:'metal'} },
]
test('loaded versions remain distinct; matching catalog asset does not duplicate them', () => {
  const rows = libraryRows(saved,[{instrument_id:'EURUSD',provider:'CSV',provider_id:'csv'},{instrument_id:'EURUSD',provider:'Other source',provider_id:'other'}])
  assert.deepEqual(rows.map(row => row.key),['old','new','gold','other:EURUSD'])
  assert.deepEqual(rows.map(row => row.downloaded),[true,true,true,false])
  assert.equal(rows.at(-1).row_count,undefined)
})
test('catalog category uses declared metadata, never guesses from the symbol', () => {
  assert.equal(categoryOf(saved[2]),'metal')
  assert.equal(categoryOf({instrument_id:'XAUUSD'}),'')
  assert.equal(categoryLabel(''),'Chưa phân loại')
})
test('search and category/source compose without changing the source list', () => {
  const rows = libraryRows(saved)
  assert.deepEqual(filterLibrary(rows,{category:'metal',provider:'CSV',search:' xau '}).map(row => row.key),['gold'])
  assert.equal(filterLibrary(rows,{category:'fx',provider:'Other'}).length,0)
  assert.deepEqual(rows.map(row => row.key),['old','new','gold'])
})
test('sorting keeps missing dates deterministic and puts downloaded assets first', () => {
  const rows = libraryRows(saved,[{instrument_id:'AUDUSD',provider:'CSV',provider_id:'csv'}])
  assert.equal(filterLibrary(rows,{sort:'downloaded'}).at(-1).downloaded,false)
  assert.equal(filterLibrary(rows,{sort:'newest'})[0].key,'new')
  assert.equal(filterLibrary(rows,{sort:'asset-asc'})[0].instrument_id,'AUDUSD')
  assert.equal(filterLibrary(rows,{sort:'asset-desc'})[0].instrument_id,'XAUUSD')
})
